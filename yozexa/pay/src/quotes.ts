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
  /**
   * Price of one YZXA in `currency` as a decimal string, or null when
   * unavailable.
   *
   * A string, not a number: a rate that reaches the conversion as a float has
   * already been rounded once, invisibly, and above about 9,007 units per YZXA
   * a double can no longer represent the scaled rate exactly. Money is scaled
   * from decimal text into integers, and rounds exactly once, where it is
   * written down.
   */
  priceOf(currency: string): Promise<string | null>;
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
  async priceOf(): Promise<string | null> {
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
  readonly #cache = new Map<string, { price: string; expiresAt: number }>();

  constructor(
    readonly name: string,
    private readonly url: string,
    private readonly cacheTtlMs = 10_000,
    private readonly fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async priceOf(currency: string): Promise<string | null> {
    const cached = this.#cache.get(currency);
    if (cached && Date.now() < cached.expiresAt) return cached.price;

    try {
      const response = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return null;
      const body = (await response.json()) as Record<string, unknown>;
      const raw = body[currency.toUpperCase()];
      // A JSON string keeps every digit the upstream sent. A JSON number has
      // already been through a double by the time JSON.parse returns, so the
      // best that can be done is the shortest text that reads back as that
      // exact double — no precision is lost that was not lost already.
      const price = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : null;
      if (price === null || !isPositiveDecimal(price)) return null;
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

/** Decimal digits kept of the rate. Ten is finer than any real market quotes. */
const RATE_DECIMALS = 10;
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

/** True for a positive decimal number written as text, in plain or exponent form. */
export function isPositiveDecimal(value: string): boolean {
  if (!/^\d*\.?\d+([eE][+-]?\d+)?$/.test(value)) return false;
  return scaleDecimal(value, RATE_DECIMALS) > 0n;
}

/**
 * Scale a decimal string by 10^decimals, exactly, in integer arithmetic.
 *
 * Digits past `decimals` are truncated rather than rounded: the quote already
 * rounds up in the caller's favour, and a second rounding here would round
 * twice on one conversion. Accepts exponent form because `String(1e-7)` is
 * `"1e-7"`, which is how a JSON number reaches this function.
 *
 * Returns 0n for anything unparseable, which every caller treats as no price.
 */
export function scaleDecimal(value: string, decimals: number): bigint {
  const m = /^(\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!m) return 0n;
  const whole = m[1] ?? "";
  const fraction = m[2] ?? "";
  const exponent = m[3] ? Number(m[3]) : 0;
  if (whole === "" && fraction === "") return 0n;

  // All the digits as one integer, then a single shift that folds together the
  // fraction length, the exponent and the requested scale.
  const digits = BigInt((whole + fraction) || "0");
  const shift = decimals - fraction.length + exponent;
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  return digits / divisor; // truncates
}

/**
 * Convert a fiat amount in minor units (cents) into base units of YZXA.
 *
 * Every step is integer arithmetic over the rate as written by the price
 * source: the rate is scaled from decimal text straight into a bigint, so no
 * value passes through a float and there is exactly one rounding, here.
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

  // The price of one YZXA in the currency's major unit, scaled by 10^10.
  const priceScaled = scaleDecimal(price, RATE_DECIMALS);
  if (priceScaled <= 0n) throw new QuoteUnavailable(currency, source.name);

  // ...and in minor units, which is what amountCents is denominated in.
  const rateScaled = priceScaled * 100n;

  // amount = amountCents / rate YZXA, in base units, rounded up.
  const amount = (amountCents * ONE_YZXA * RATE_SCALE + rateScaled - 1n) / rateScaled;

  return {
    amount,
    // The rate actually applied, not the one that was quoted upstream: a
    // merchant reconciling a payment has to be able to recompute the amount
    // from what the receipt says.
    rate: formatScaled(priceScaled, RATE_DECIMALS),
    source: source.name,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  };
}

/** True when a quote has passed its expiry. */
export function isExpired(quote: { expiresAt: Date | null }, now = new Date()): boolean {
  return quote.expiresAt !== null && now >= quote.expiresAt;
}

/** Render a scaled integer back as a fixed-point decimal string. */
function formatScaled(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0");
  return `${whole}.${fraction}`;
}
