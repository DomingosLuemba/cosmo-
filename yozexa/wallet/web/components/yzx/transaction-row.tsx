"use client";

import Link from "next/link";

import { useEffect, useState } from "react";

import { displayUnit, renderAmount, subscribeToUnit, type DisplayUnit } from "@/lib/display";
import { YzxAvatar } from "./primitives";

export type MovementKind = "received" | "sent" | "payment" | "staking" | "fee" | "burn";

export interface Movement {
  id: string;
  kind: MovementKind;
  /** Who or what the movement was with, already resolved for display. */
  counterparty: string;
  /** A friendly name when one is known — an alias, a merchant. */
  title?: string;
  amount: bigint;
  /** True when the account received. */
  incoming: boolean;
  at: Date;
  status?: "pending" | "confirmed" | "finalized" | "failed";
  hash?: string;
}

/**
 * YZXTransactionRow.
 *
 * Direction is carried by the word, the sign and the icon — three signals, so
 * losing colour loses nothing. A pending or failed movement says so in text
 * rather than relying on a tint.
 */
export function YzxTransactionRow({
  movement,
  href,
  unit,
}: {
  movement: Movement;
  href?: string;
  /** Overrides the account-wide preference; used where a screen fixes a unit. */
  unit?: Exclude<DisplayUnit, "fiat">;
}) {
  const label = {
    received: "Received",
    sent: "Sent",
    payment: "Payment",
    staking: "Staking reward",
    fee: "Network fee",
    burn: "Burned",
  }[movement.kind];

  // The unit is one preference across the whole wallet: a list that always
  // says YOZ while the balance above it says YZXA makes the reader do the
  // conversion in their head to check the two agree.
  //
  // It is read after mount, not during render: the preference lives in local
  // storage, which the server cannot see, and rendering one unit on the server
  // and another on the client is a hydration mismatch.
  const [stored, setStored] = useState<Exclude<DisplayUnit, "fiat">>("YZXA");
  useEffect(() => {
    setStored(preferredUnit());
    return subscribeToUnit(() => setStored(preferredUnit()));
  }, []);
  const shown = unit ?? stored;
  const amount = `${movement.incoming ? "+" : "−"}${renderAmount(movement.amount, shown)} ${shown}`;

  const body = (
    <>
      <span style={{ position: "relative", flexShrink: 0 }}>
        <YzxAvatar seed={movement.counterparty} label={movement.title ?? movement.counterparty} size={38} />
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: "17px",
            height: "17px",
            borderRadius: "var(--yzx-radius-full)",
            background: movement.incoming ? "var(--yzx-positive)" : "var(--yzx-surface-raised)",
            color: movement.incoming ? "var(--yzx-bg)" : "var(--yzx-text-secondary)",
            border: "2px solid var(--yzx-surface)",
            display: "grid",
            placeItems: "center",
            fontSize: "9px",
            fontWeight: "var(--yzx-weight-bold)",
            lineHeight: 1,
          }}
        >
          {movement.incoming ? "↓" : "↑"}
        </span>
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: "var(--yzx-text-base)",
            fontWeight: "var(--yzx-weight-medium)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {movement.title ?? label}
        </span>
        <span
          style={{
            display: "block",
            fontSize: "var(--yzx-text-xs)",
            color: "var(--yzx-text-tertiary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {movement.title ? `${label} · ` : ""}
          {relativeTime(movement.at)}
          {movement.status && movement.status !== "confirmed" && movement.status !== "finalized"
            ? ` · ${movement.status}`
            : ""}
        </span>
      </span>

      <span
        className="yzx-num"
        style={{
          flexShrink: 0,
          fontSize: "var(--yzx-text-base)",
          fontWeight: "var(--yzx-weight-semibold)",
          color:
            movement.status === "failed"
              ? "var(--yzx-text-tertiary)"
              : movement.incoming
                ? "var(--yzx-positive)"
                : "var(--yzx-text)",
          textDecoration: movement.status === "failed" ? "line-through" : "none",
        }}
      >
        {amount}
      </span>
    </>
  );

  const style: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--yzx-space-3)",
    padding: "var(--yzx-space-3) var(--yzx-space-4)",
    borderBottom: "1px solid var(--yzx-border)",
    background: "var(--yzx-surface)",
    color: "var(--yzx-text)",
    textDecoration: "none",
    minHeight: "var(--yzx-touch-target)",
  };

  return href ? (
    <Link href={href} style={style}>
      {body}
    </Link>
  ) : (
    <div style={style}>{body}</div>
  );
}

function relativeTime(at: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h ago`;
  if (seconds < 7 * 86_400) return `${Math.round(seconds / 86_400)}d ago`;
  return at.toISOString().slice(0, 10);
}

/**
 * The stored display unit, with fiat resolved to YZXA.
 *
 * A movement is an on-chain amount; converting it to a fiat figure would need
 * the rate at the time it happened, not today's, and the wallet does not keep
 * historical rates. Showing today's rate against a year-old payment would be
 * wrong in a way that looks precise, so amounts here stay in the currency.
 */
function preferredUnit(): Exclude<DisplayUnit, "fiat"> {
  const stored = displayUnit();
  return stored === "YOZ" ? "YOZ" : "YZXA";
}
