/**
 * YOZEXA monetary units.
 *
 * Every amount in this SDK is a `bigint` in base units (ayzxa, 10^-18 YZXA) and
 * crosses the wire as a decimal string. `number` is never used for a monetary
 * value: a JavaScript number cannot represent 10^18 exactly, so using one for a
 * balance is a way to lose or invent money.
 */

/** The smallest indivisible unit. */
export const BASE_DENOM = "ayzxa";
/** The currency. */
export const DISPLAY_DENOM = "YZXA";
/** The retail sub-unit wallets show. */
export const SUB_DENOM = "YOZ";

/** 1 YZXA in base units. */
export const ONE_YZXA = 10n ** 18n;
/** 1 YOZ in base units: 0.00001 YZXA. */
export const ONE_YOZ = 10n ** 13n;

/** The absolute, protocol-enforced ceiling: 10,000,000 YZXA. */
export const MAX_SUPPLY = 10_000_000n * ONE_YZXA;

export type Unit = "YZXA" | "YOZ" | "ayzxa";

const SCALE: Record<Unit, number> = { YZXA: 18, YOZ: 13, ayzxa: 0 };

/**
 * Parse a decimal amount string into base units, exactly.
 *
 * Rejects anything ambiguous — signs, exponents, separators, whitespace, or
 * more fractional digits than the unit supports — rather than rounding it.
 * Silent truncation here would mean sending someone the wrong amount.
 */
export function parseAmount(input: string, unit: Unit = "YZXA"): bigint {
  const scale = SCALE[unit];
  if (scale === undefined) throw new Error(`unknown unit ${unit}`);

  const s = input.trim();
  if (s === "") throw new Error("empty amount");
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(
      `invalid amount ${JSON.stringify(input)}: expected a plain non-negative decimal number`,
    );
  }
  const [intPart = "", fracPart = ""] = s.split(".");
  if (fracPart.length > scale) {
    throw new Error(
      `invalid amount ${JSON.stringify(input)}: ${fracPart.length} fractional digits exceeds ${scale} for ${unit}`,
    );
  }
  return BigInt(intPart + fracPart.padEnd(scale, "0"));
}

/** Render base units as a decimal string in the given unit, without loss. */
export function formatAmount(value: bigint, unit: Unit = "YZXA"): string {
  const scale = SCALE[unit];
  if (scale === undefined) throw new Error(`unknown unit ${unit}`);
  if (scale === 0) return value.toString();

  const negative = value < 0n;
  const abs = negative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const whole = abs / divisor;
  let frac = (abs % divisor).toString().padStart(scale, "0").replace(/0+$/, "");
  if (frac === "") frac = "0";
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** Convenience: format base units as YZXA. */
export const formatYZXA = (v: bigint): string => formatAmount(v, "YZXA");
/** Convenience: format base units as YOZ. */
export const formatYOZ = (v: bigint): string => formatAmount(v, "YOZ");

/**
 * Format an amount for a user interface, choosing the unit that reads best.
 *
 * Small amounts are shown in YOZ so a person sees "25 YOZ" rather than
 * "0.00025 YZXA" and does not have to count zeros to understand their balance.
 */
export function formatForDisplay(value: bigint): { amount: string; unit: Unit } {
  if (value !== 0n && value < ONE_YZXA / 100n) {
    return { amount: formatYOZ(value), unit: "YOZ" };
  }
  return { amount: formatYZXA(value), unit: "YZXA" };
}

/**
 * Convert a base-unit amount to a fiat reference string.
 *
 * `priceYZXA` is the market price of ONE YZXA in the target currency, obtained
 * from a price source the caller names. This is a *reference*, never a
 * guarantee, and the caller is responsible for labelling it as such and for
 * showing when it was fetched. Pass `null` when no price is available: this
 * returns `null` rather than inventing a number.
 *
 * Prefer passing the rate as a decimal **string**, exactly as the source wrote
 * it: a rate handed over as a number has already been rounded by the time it
 * arrives, and above roughly 9 × 10^9 units per YZXA a double can no longer
 * represent the scaled rate exactly. A string is scaled into integers here and
 * loses nothing.
 *
 * The result is a formatted string for a person to read. It is never an amount
 * to send — everything that moves money works in base units.
 */
export function fiatReference(
  value: bigint,
  priceYZXA: number | string | null,
  currency: string,
  locale = "en-US",
): string | null {
  if (priceYZXA === null) return null;
  const text = typeof priceYZXA === "number"
    ? (Number.isFinite(priceYZXA) && priceYZXA >= 0 ? String(priceYZXA) : null)
    : priceYZXA.trim();
  if (text === null) return null;

  const micros = scaleDecimalString(text, 6);
  if (micros < 0n) return null;
  const cents = (value * micros) / (ONE_YZXA * 10_000n);
  // The only float in this function, and only to hand a cent count to the
  // formatter: exact for any amount below about 90 trillion units of currency.
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(Number(cents) / 100);
}

/**
 * Scale a non-negative decimal string by 10^decimals, exactly, in integer
 * arithmetic. Digits past `decimals` are truncated.
 *
 * Returns -1n for anything that is not a non-negative decimal, which callers
 * treat as "no usable rate" rather than as zero.
 */
export function scaleDecimalString(value: string, decimals: number): bigint {
  const m = /^(\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!m) return -1n;
  const whole = m[1] ?? "";
  const fraction = m[2] ?? "";
  if (whole === "" && fraction === "") return -1n;
  const digits = BigInt((whole + fraction) || "0");
  const shift = decimals - fraction.length + (m[3] ? Number(m[3]) : 0);
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  return digits / 10n ** BigInt(-shift);
}
