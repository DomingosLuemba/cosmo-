"use client";

import { useEffect, useState } from "react";

import { displayUnit, exactAmount, nextUnit, renderAmount, setDisplayUnit, type DisplayUnit } from "@/lib/display";
import { fetchPrice, hasPrice, toFiat, type PriceResult } from "@/lib/price";

/**
 * YZXBalance — the number the whole app is really about.
 *
 * Tapping it cycles fiat → YZXA → YOZ, so a person can look at the same money
 * the way that makes sense to them. Fiat is only ever in the cycle when a
 * price source actually answered; otherwise it is skipped entirely rather than
 * shown as a zero or a guess.
 *
 * The figure can be hidden, and the choice is remembered — a balance on screen
 * in public is a safety problem, not a preference.
 */
export function YzxBalance({
  baseUnits,
  loading = false,
  hidden = false,
  onToggleHidden,
}: {
  baseUnits: bigint;
  loading?: boolean;
  hidden?: boolean;
  onToggleHidden?: () => void;
}) {
  const [unit, setUnit] = useState<DisplayUnit>("YZXA");
  const [price, setPrice] = useState<PriceResult | null>(null);

  useEffect(() => {
    setUnit(displayUnit());
    void fetchPrice().then(setPrice);
  }, []);

  const fiatAvailable = price !== null && hasPrice(price);
  const effective: DisplayUnit = unit === "fiat" && !fiatAvailable ? "YZXA" : unit;

  function cycle() {
    const next = nextUnit(effective, fiatAvailable);
    setUnit(next);
    setDisplayUnit(next);
  }

  const primary =
    effective === "fiat" && price && hasPrice(price)
      ? toFiat(baseUnits, price)
      : renderAmount(baseUnits, effective === "fiat" ? "YZXA" : effective);

  const primaryLabel = effective === "fiat" ? "" : effective;

  // The secondary line always shows a different unit, so both readings are
  // visible without tapping.
  const secondary =
    effective === "YZXA"
      ? `${renderAmount(baseUnits, "YOZ")} YOZ`
      : `${renderAmount(baseUnits, "YZXA")} YZXA`;

  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--yzx-space-2)",
          marginBottom: "var(--yzx-space-1)",
        }}
      >
        <span
          style={{
            fontSize: "var(--yzx-text-xs)",
            fontWeight: "var(--yzx-weight-semibold)",
            letterSpacing: "var(--yzx-tracking-wide)",
            textTransform: "uppercase",
            color: "var(--yzx-text-tertiary)",
          }}
        >
          Total balance
        </span>
        {onToggleHidden ? (
          <button
            type="button"
            onClick={onToggleHidden}
            aria-label={hidden ? "Show balance" : "Hide balance"}
            aria-pressed={hidden}
            style={{
              background: "none",
              border: "none",
              padding: "var(--yzx-space-1)",
              cursor: "pointer",
              color: "var(--yzx-text-tertiary)",
              lineHeight: 0,
            }}
          >
            {hidden ? <EyeOff /> : <Eye />}
          </button>
        ) : null}
      </div>

      {loading ? (
        <div
          style={{
            height: "44px",
            width: "62%",
            margin: "0 auto var(--yzx-space-2)",
            borderRadius: "var(--yzx-radius-md)",
            background: `linear-gradient(90deg,
              var(--yzx-surface-raised) 0%,
              var(--yzx-border) 50%,
              var(--yzx-surface-raised) 100%)`,
            backgroundSize: "320px 100%",
            animation: "yzx-shimmer 1.4s linear infinite",
          }}
          aria-label="Loading balance"
          role="status"
        />
      ) : hidden ? (
        <div
          className="yzx-num"
          style={{
            fontSize: "var(--yzx-text-3xl)",
            fontWeight: "var(--yzx-weight-bold)",
            letterSpacing: "0.08em",
            lineHeight: "var(--yzx-leading-tight)",
          }}
        >
          ••••••
          <span className="yzx-sr-only">Balance hidden</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={cycle}
          aria-label={`Balance, showing ${effective}. Activate to change unit.`}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            display: "block",
            width: "100%",
          }}
        >
          <span
            className="yzx-num"
            style={{
              display: "block",
              fontSize: "var(--yzx-text-3xl)",
              fontWeight: "var(--yzx-weight-bold)",
              letterSpacing: "var(--yzx-tracking-tight)",
              lineHeight: "var(--yzx-leading-tight)",
              color: "var(--yzx-text)",
              wordBreak: "break-word",
            }}
          >
            {primary}
            {primaryLabel ? (
              <span
                style={{
                  fontSize: "var(--yzx-text-lg)",
                  fontWeight: "var(--yzx-weight-semibold)",
                  color: "var(--yzx-text-secondary)",
                  marginLeft: "var(--yzx-space-2)",
                }}
              >
                {primaryLabel}
              </span>
            ) : null}
          </span>
          <span
            className="yzx-num"
            style={{
              display: "block",
              fontSize: "var(--yzx-text-sm)",
              color: "var(--yzx-text-secondary)",
              marginTop: "var(--yzx-space-1)",
            }}
          >
            {secondary}
          </span>
        </button>
      )}

      {/* When there is no price, say so once, plainly, instead of leaving a
          gap where a fiat figure would normally be. */}
      {!loading && !hidden && !fiatAvailable ? (
        <p
          style={{
            fontSize: "var(--yzx-text-2xs)",
            color: "var(--yzx-text-tertiary)",
            margin: "var(--yzx-space-2) auto 0",
            maxWidth: "30ch",
          }}
        >
          No fiat value shown — YZXA has no market price configured.
        </p>
      ) : null}

      {/* The exact figure, for anyone who needs it and for screen readers. */}
      <span className="yzx-sr-only">
        Exactly {exactAmount(baseUnits, "YZXA")} YZXA.
      </span>
    </div>
  );
}

function Eye() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1 8s2.5-4.5 7-4.5c1 0 1.9.2 2.7.5M15 8s-2.5 4.5-7 4.5c-1 0-1.9-.2-2.7-.5"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
