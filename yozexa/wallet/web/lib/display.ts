"use client";

/**
 * How an amount is shown.
 *
 * A person holding 0.00025 YZXA should not have to count zeros to read their
 * balance, so the wallet offers three ways to look at the same number:
 *
 *   fiat  — a market reference, only when a price source exists
 *   YZXA  — the currency
 *   YOZ   — the retail sub-unit, 1 YOZ = 0.00001 YZXA
 *
 * The unit is a display choice. It never changes what is signed: every
 * transaction commits to base units.
 */
import { formatYZXA, formatYOZ } from "@yozexa/sdk";

export type DisplayUnit = "fiat" | "YZXA" | "YOZ";

const KEY = "yozexa.display-unit.v1";

export function displayUnit(): DisplayUnit {
  if (typeof window === "undefined") return "YZXA";
  const stored = window.localStorage.getItem(KEY);
  return stored === "fiat" || stored === "YOZ" || stored === "YZXA" ? stored : "YZXA";
}

/**
 * Change the unit everywhere at once.
 *
 * Subscribers are notified so that a balance and the list beneath it never
 * disagree: tapping the balance has to move the whole screen, or the reader
 * sees YZXA above YOZ and has to do the conversion to check they match.
 */
export function setDisplayUnit(unit: DisplayUnit): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, unit);
  for (const listener of unitListeners) listener(unit);
}

const unitListeners = new Set<(unit: DisplayUnit) => void>();

/**
 * The unit an amount field should start in.
 *
 * It follows the same preference as the balance, with fiat resolved to YZXA:
 * nobody enters a payment in fiat on a chain with no price source, and a field
 * that starts in a different unit from the balance the user just read is how
 * someone sends a hundred-thousandth of what they meant.
 */
export function entryUnit(): Exclude<DisplayUnit, "fiat"> {
  return displayUnit() === "YOZ" ? "YOZ" : "YZXA";
}

/** Watch for unit changes. Returns the unsubscribe function. */
export function subscribeToUnit(listener: (unit: DisplayUnit) => void): () => void {
  unitListeners.add(listener);
  return () => unitListeners.delete(listener);
}

/** The next unit in the cycle, skipping fiat when no price is available. */
export function nextUnit(current: DisplayUnit, fiatAvailable: boolean): DisplayUnit {
  const cycle: DisplayUnit[] = fiatAvailable ? ["fiat", "YZXA", "YOZ"] : ["YZXA", "YOZ"];
  const index = cycle.indexOf(current);
  return cycle[(index + 1) % cycle.length] ?? cycle[0]!;
}

/** Group thousands without changing precision. */
export function grouped(decimal: string, locale = "en-US"): string {
  const [whole = "0", fraction] = decimal.split(".");
  const groupedWhole = new Intl.NumberFormat(locale, { useGrouping: true }).format(BigInt(whole));
  return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
}

/**
 * Trim a long fraction for display only.
 *
 * The full precision is always available — every screen that trims also shows
 * the exact figure somewhere, and nothing that is signed is ever trimmed.
 */
export function trimFraction(decimal: string, maxDigits: number): string {
  const [whole = "0", fraction = ""] = decimal.split(".");
  if (fraction.length <= maxDigits) return decimal;
  const cut = fraction.slice(0, maxDigits).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

/** Render base units in a unit, without a currency symbol. */
export function renderAmount(baseUnits: bigint, unit: Exclude<DisplayUnit, "fiat">): string {
  return unit === "YOZ"
    ? grouped(trimFraction(formatYOZ(baseUnits), 4))
    : grouped(trimFraction(formatYZXA(baseUnits), 8));
}

/** The exact, untrimmed figure, for the places that must not round. */
export function exactAmount(baseUnits: bigint, unit: Exclude<DisplayUnit, "fiat">): string {
  return unit === "YOZ" ? formatYOZ(baseUnits) : formatYZXA(baseUnits);
}
