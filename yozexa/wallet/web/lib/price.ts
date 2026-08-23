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
  /**
   * Price of one whole YZXA, in the currency, as the source wrote it.
   *
   * A decimal string rather than a number: every conversion below scales it
   * into integers, and a rate that arrives as a float has already been rounded
   * once before anyone can see it. Display code that wants a number can parse
   * it — nothing that produces an amount does.
   */
  price: string;
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
    // A JSON string keeps every digit the source sent; a JSON number has
    // already been through a double, so the shortest text that reads back as
    // that double loses nothing further.
    const price = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
    if (scalePrice(price) <= 0n) {
      throw new Error(`the price source did not return a usable ${currency} price`);
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

/** Decimal digits of the rate that are kept. */
const PRICE_DECIMALS = 6;

/**
 * Scale a decimal price string into an integer, exactly, in integer
 * arithmetic. Digits past `PRICE_DECIMALS` are truncated.
 *
 * Returns 0n for anything unparseable, which every caller treats as no price —
 * a wallet that cannot read a rate must show no fiat figure, never a wrong one.
 * Accepts exponent form, which is how `String(1e-7)` reaches this function.
 */
export function scalePrice(value: string): bigint {
  const m = /^(\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!m) return 0n;
  const whole = m[1] ?? "";
  const fraction = m[2] ?? "";
  if (whole === "" && fraction === "") return 0n;
  const digits = BigInt((whole + fraction) || "0");
  const shift = PRICE_DECIMALS - fraction.length + (m[3] ? Number(m[3]) : 0);
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  return digits / 10n ** BigInt(-shift);
}

/**
 * Convert a base-unit amount into a fiat string, or null when there is no
 * price.
 *
 * The conversion runs in bigint down to minor units before touching a float,
 * so the single rounding happens in one place that can be pointed at.
 */
export function toFiat(baseUnits: bigint, quote: PriceQuote, locale = "en-US"): string {
  const micros = scalePrice(quote.price);
  const minor = (baseUnits * micros) / (ONE_YZXA * 10_000n);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: quote.currency,
    maximumFractionDigits: 2,
  }).format(Number(minor) / 100);
}

/** Convert a fiat minor-unit amount into base units, rounding up. */
export function fromFiatMinor(minorUnits: bigint, quote: PriceQuote): bigint {
  const micros = scalePrice(quote.price);
  if (micros <= 0n) return 0n;
  const numerator = minorUnits * ONE_YZXA * 10_000n;
  return (numerator + micros - 1n) / micros;
}
