/**
 * Fiat quoting.
 *
 * A merchant prices in euros; the customer pays in YZXA. Something has to
 * decide the rate, and this module is deliberately explicit about the fact that
 * "something" is an external market and not YOZEXA.
 *
 * Three rules:
 *
 *   1. A quote always names its source and its expiry. A rate with neither is
 *      a number somebody made up.
 *   2. A quote is never guaranteed beyond its expiry window.
 *   3. When no price source is configured, quoting a fiat amount FAILS. It does
 *      not fall back to a hard-coded rate, because a wrong rate silently
 *      undercharges or overcharges every customer.
 */
import { ONE_YZXA } from "@yozexa/sdk";

export interface Quote {
  /** Base units the customer must send. */
  amount: bigint;
  /** Price of one YZXA in the fiat currency, as a decimal string. */
  rate: string;
  /** Where the rate came from. */
  source: string;
  expiresAt: Date;
}

/** A source of market prices. */
export interface PriceSource {
  readonly name: string;
  /** Price of one YZXA in `currency`, or null when unavailable. */
  priceOf(currency: string): Promise<number | null>;
}

/**
 * The source used when none is configured.
 *
 * It returns no price at all, which makes every fiat-denominated quote fail
 * loudly. That is the correct behaviour before a real market exists: YZXA has
 * no price, and inventing one for a demo is exactly how a fake number ends up
 * in production.
 */
export class NoPriceSource implements PriceSource {
  readonly name = "none";
  async priceOf(): Promise<number | null> {
    return null;
  }
}

/**
 * A price source backed by an HTTP endpoint returning `{ "EUR": 1.23, ... }`.
 *
 * Prices are cached briefly so a burst of checkouts does not hammer the
 * upstream, and a stale cache is never served past its TTL: an old rate is a
 * pricing error.
 */
export class HttpPriceSource implements PriceSource {
  readonly #cache = new Map<string, { price: number; expiresAt: number }>();

  constructor(
    readonly name: string,
    private readonly url: string,
    private readonly cacheTtlMs = 10_000,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async priceOf(currency: string): Promise<number | null> {
    const cached = this.#cache.get(currency);
    if (cached && Date.now() < cached.expiresAt) return cached.price;

    try {
      const response = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return null;
      const body = (await response.json()) as Record<string, unknown>;
      const raw = body[currency.toUpperCase()];
      const price = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(price) || price <= 0) return null;
      this.#cache.set(currency, { price, expiresAt: Date.now() + this.cacheTtlMs });
      return price;
    } catch {
      return null;
    }
  }
}

export class QuoteUnavailable extends Error {
  constructor(currency: string, source: string) {
    super(
      `no ${currency} price for YZXA is available from ${JSON.stringify(source)}, so this payment ` +
        `cannot be quoted in ${currency}. Price the payment in YZXA instead, or configure a price source.`,
    );
    this.name = "QuoteUnavailable";
  }
}

/**
 * Convert a fiat amount in minor units (cents) into base units of YZXA.
 *
 * The conversion runs in bigint arithmetic after a single, explicit rounding of
 * the rate to 10 decimal places, so the result is reproducible and the rounding
 * happens once, in a place that can be pointed at.
 *
 * Rounds **up**: the merchant must not be short-changed by a fraction of a
 * base unit, and the customer overpays by at most 10^-18 YZXA.
 */
export async function quoteFiat(
  source: PriceSource,
  amountCents: bigint,
  currency: string,
  ttlSeconds: number,
): Promise<Quote> {
  if (amountCents <= 0n) throw new Error("the amount to quote must be positive");
  const price = await source.priceOf(currency);
  if (price === null) throw new QuoteUnavailable(currency, source.name);

  // rate: price of one YZXA in minor units of the currency, scaled by 10^10.
  const SCALE = 10_000_000_000n;
  const rateScaled = BigInt(Math.round(price * 100 * Number(SCALE)));
  if (rateScaled <= 0n) throw new QuoteUnavailable(currency, source.name);

  // amount = amountCents / (price*100) YZXA, in base units, rounded up.
  const numerator = amountCents * ONE_YZXA * SCALE;
  const amount = (numerator + rateScaled - 1n) / rateScaled;

  return {
    amount,
    rate: price.toFixed(10),
    source: source.name,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  };
}

/** True when a quote has passed its expiry. */
export function isExpired(quote: { expiresAt: Date | null }, now = new Date()): boolean {
  return quote.expiresAt !== null && now >= quote.expiresAt;
}
