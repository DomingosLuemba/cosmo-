"use client";

import { useEffect, useState } from "react";
import { parseAmount, type Unit } from "@yozexa/sdk";

import { fetchPrice, hasPrice, toFiat, type PriceResult } from "@/lib/price";

/**
 * YZXAmountInput — the field a payment is typed into.
 *
 * Two rules it exists to keep:
 *
 *   1. What the user typed is parsed exactly, in base units, by the same
 *      parser the chain uses. Nothing is rounded on the way in.
 *   2. The fiat line underneath appears only when a price source answered.
 *      With no price, it says so rather than showing a converted zero.
 *
 * Invalid input is reported as it is typed, in words, rather than silently
 * accepted and rejected later by the node.
 */
export function YzxAmountInput({
  value,
  unit,
  onValueChange,
  onUnitChange,
  onValidChange,
  autoFocus = false,
  label = "You send",
  max,
}: {
  value: string;
  unit: Exclude<Unit, "ayzxa">;
  onValueChange: (next: string) => void;
  onUnitChange: (next: Exclude<Unit, "ayzxa">) => void;
  onValidChange?: (baseUnits: bigint | null) => void;
  autoFocus?: boolean;
  label?: string;
  /** Spendable balance, for the "Max" control and an over-balance warning. */
  max?: bigint;
}) {
  const [price, setPrice] = useState<PriceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baseUnits, setBaseUnits] = useState<bigint | null>(null);

  useEffect(() => {
    void fetchPrice().then(setPrice);
  }, []);

  useEffect(() => {
    if (value.trim() === "") {
      setError(null);
      setBaseUnits(null);
      onValidChange?.(null);
      return;
    }
    try {
      const parsed = parseAmount(value, unit);
      if (parsed <= 0n) {
        setError("Enter an amount greater than zero.");
        setBaseUnits(null);
        onValidChange?.(null);
        return;
      }
      if (max !== undefined && parsed > max) {
        setError("That's more than this account can spend right now.");
        setBaseUnits(parsed);
        onValidChange?.(null);
        return;
      }
      setError(null);
      setBaseUnits(parsed);
      onValidChange?.(parsed);
    } catch {
      // The parser's own message is precise but technical; this is the
      // version a person can act on.
      setError(
        unit === "YOZ"
          ? "Enter a plain number, with at most 13 decimal places."
          : "Enter a plain number, with at most 18 decimal places.",
      );
      setBaseUnits(null);
      onValidChange?.(null);
    }
  }, [value, unit, max, onValidChange]);

  const fiat = baseUnits !== null && price && hasPrice(price) ? toFiat(baseUnits, price) : null;

  return (
    <div>
      <label
        htmlFor="yzx-amount"
        style={{
          display: "block",
          fontSize: "var(--yzx-text-xs)",
          fontWeight: "var(--yzx-weight-semibold)",
          letterSpacing: "var(--yzx-tracking-wide)",
          textTransform: "uppercase",
          color: "var(--yzx-text-tertiary)",
          marginBottom: "var(--yzx-space-2)",
        }}
      >
        {label}
      </label>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--yzx-space-3)",
          padding: "var(--yzx-space-4)",
          background: "var(--yzx-surface)",
          border: `1px solid ${error ? "var(--yzx-negative)" : "var(--yzx-border)"}`,
          borderRadius: "var(--yzx-radius-lg)",
        }}
      >
        <input
          id="yzx-amount"
          className="yzx-num"
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          placeholder="0"
          onChange={(event) => onValueChange(event.target.value.replace(/[^\d.]/g, ""))}
          aria-describedby="yzx-amount-help"
          aria-invalid={Boolean(error)}
          style={{
            flex: 1,
            minWidth: 0,
            background: "none",
            border: "none",
            outline: "none",
            color: "var(--yzx-text)",
            fontSize: "var(--yzx-text-3xl)",
            fontWeight: "var(--yzx-weight-bold)",
            letterSpacing: "var(--yzx-tracking-tight)",
            padding: 0,
          }}
        />

        <label className="yzx-sr-only" htmlFor="yzx-unit">Unit</label>
        <select
          id="yzx-unit"
          value={unit}
          onChange={(event) => onUnitChange(event.target.value as Exclude<Unit, "ayzxa">)}
          style={{
            flexShrink: 0,
            background: "var(--yzx-surface-raised)",
            border: "1px solid var(--yzx-border)",
            borderRadius: "var(--yzx-radius-full)",
            color: "var(--yzx-text)",
            fontSize: "var(--yzx-text-base)",
            fontWeight: "var(--yzx-weight-semibold)",
            padding: "var(--yzx-space-2) var(--yzx-space-3)",
            cursor: "pointer",
          }}
        >
          <option value="YOZ">YOZ</option>
          <option value="YZXA">YZXA</option>
        </select>
      </div>

      <div
        id="yzx-amount-help"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--yzx-space-3)",
          marginTop: "var(--yzx-space-2)",
          minHeight: "20px",
          fontSize: "var(--yzx-text-sm)",
        }}
      >
        <span style={{ color: error ? "var(--yzx-negative)" : "var(--yzx-text-secondary)" }}>
          {error ?? fiat ?? (baseUnits !== null ? "No fiat value available" : "1 YOZ = 0.00001 YZXA")}
        </span>
        {max !== undefined && max > 0n ? (
          <button
            type="button"
            onClick={() => {
              // "Max" fills the spendable balance exactly. The fee is taken
              // from it at review time, and the review screen shows the total,
              // so this never silently over-commits the account.
              const whole = unit === "YOZ" ? max / 10n ** 13n : max / 10n ** 18n;
              const frac = unit === "YOZ" ? max % 10n ** 13n : max % 10n ** 18n;
              const digits = unit === "YOZ" ? 13 : 18;
              const fracStr = frac.toString().padStart(digits, "0").replace(/0+$/, "");
              onValueChange(fracStr ? `${whole}.${fracStr}` : `${whole}`);
            }}
            style={{
              flexShrink: 0,
              background: "var(--yzx-brand-wash)",
              border: "1px solid var(--yzx-brand-edge)",
              borderRadius: "var(--yzx-radius-full)",
              color: "var(--yzx-brand-soft)",
              fontSize: "var(--yzx-text-xs)",
              fontWeight: "var(--yzx-weight-semibold)",
              padding: "2px var(--yzx-space-3)",
              cursor: "pointer",
            }}
          >
            Max
          </button>
        ) : null}
      </div>
    </div>
  );
}
