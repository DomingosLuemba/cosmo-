"use client";

/**
 * Fiat reference prices.
 *
 * YZXA has no price until a market sets one. This module therefore has exactly
 * two honest states: a price from a named source with a timestamp, or no price
 * at all. It never falls back to a constant, and there is no default rate
 * anywhere in this file — a made-up number shown next to a balance is worse
 * than no number, because the user cannot tell it is made up.
 *
 * The wallet is expected to run for a long time in the "unavailable" state.
 * Every component that displays fiat handles it as a normal case, not an error.
 */

export type FiatCurrency = "USD" | "EUR" | "AOA" | "GBP" | "BRL";

export const FIAT_CURRENCIES: readonly FiatCurrency[] = ["USD", "EUR", "AOA", "GBP", "BRL"];

export interface PriceQuote {
  currency: FiatCurrency;
  /** Price of one whole YZXA, in the currency. */
  price: number;
  /** Who said so. Shown to the user. */
  source: string;
  fetchedAt: Date;
}

/** No price is available, and here is why. */
export interface PriceUnavailable {
  reason: string;
}

export type PriceResult = PriceQuote | PriceUnavailable;

export function hasPrice(result: PriceResult): result is PriceQuote {
  return "price" in result;
}

const STORAGE_KEY = "yozexa.price-source.v1";
const CURRENCY_KEY = "yozexa.currency.v1";
const MAX_AGE_MS = 60_000;

let cache: { at: number; result: PriceResult } | null = null;

/** The price feed the user has configured, if any. */
export function priceSourceUrl(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setPriceSourceUrl(url: string | null): void {
  if (typeof window === "undefined") return;
  cache = null;
  if (!url) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  if (!/^https:\/\//.test(url) && !url.startsWith("http://127.0.0.1")) {
    throw new Error("A price source must be an https address.");
  }
  window.localStorage.setItem(STORAGE_KEY, url);
}

/** The display currency the user picked. */
export function displayCurrency(): FiatCurrency {
  if (typeof window === "undefined") return "USD";
  const stored = window.localStorage.getItem(CURRENCY_KEY);
  return (FIAT_CURRENCIES as readonly string[]).includes(stored ?? "")
    ? (stored as FiatCurrency)
    : "USD";
}

export function setDisplayCurrency(currency: FiatCurrency): void {
  if (typeof window === "undefined") return;
  cache = null;
  window.localStorage.setItem(CURRENCY_KEY, currency);
}

/**
 * Fetch the current price, or report that there is none.
 *
 * A stale cache is never served past MAX_AGE_MS: an old rate is a pricing
 * error, and on a screen showing money that is not a small one.
 */
export async function fetchPrice(currency = displayCurrency()): Promise<PriceResult> {
  if (cache && Date.now() - cache.at < MAX_AGE_MS) return cache.result;

  const url = priceSourceUrl();
  if (!url) {
    const result: PriceUnavailable = {
      reason:
        "No price source is configured, so YZXA has no fiat value to show here. " +
        "Amounts are shown in YZXA and YOZ.",
    };
    cache = { at: Date.now(), result };
    return result;
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) throw new Error(`the price source returned ${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    const raw = body[currency];
    const price = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`the price source did not return a ${currency} price`);
    }
    const result: PriceQuote = {
      currency,
      price,
      source: new URL(url).host,
      fetchedAt: new Date(),
    };
    cache = { at: Date.now(), result };
    return result;
  } catch (err) {
    const result: PriceUnavailable = {
      reason: `Could not reach the price source: ${err instanceof Error ? err.message : String(err)}`,
    };
    cache = { at: Date.now(), result };
    return result;
  }
}

const ONE_YZXA = 10n ** 18n;

/**
 * Convert a base-unit amount into a fiat string, or null when there is no
 * price.
 *
 * The conversion runs in bigint down to minor units before touching a float,
 * so the single rounding happens in one place that can be pointed at.
 */
export function toFiat(baseUnits: bigint, quote: PriceQuote, locale = "en-US"): string {
  const micros = BigInt(Math.round(quote.price * 1_000_000));
  const minor = (baseUnits * micros) / (ONE_YZXA * 10_000n);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: quote.currency,
    maximumFractionDigits: 2,
  }).format(Number(minor) / 100);
}

/** Convert a fiat minor-unit amount into base units, rounding up. */
export function fromFiatMinor(minorUnits: bigint, quote: PriceQuote): bigint {
  const micros = BigInt(Math.round(quote.price * 1_000_000));
  if (micros <= 0n) return 0n;
  const numerator = minorUnits * ONE_YZXA * 10_000n;
  return (numerator + micros - 1n) / micros;
}
