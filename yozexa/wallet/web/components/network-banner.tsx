"use client";

import { useEffect, useState } from "react";

import { client } from "@/lib/node";

/**
 * A network that is not mainnet says so on every screen.
 *
 * It stays visible rather than being dismissible, because the whole point is
 * that a test wallet must never be mistaken for the real one — and a banner a
 * user can close is a banner they will close.
 */
export function NetworkBanner() {
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client()
      .status()
      .then((status) => {
        if (!cancelled) setWarning(status.network_warning ?? null);
      })
      .catch(() => {
        if (!cancelled) setWarning(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!warning) return null;

  return (
    <div
      role="status"
      style={{
        background: "var(--yzx-warning-wash)",
        color: "var(--yzx-warning)",
        borderBottom: "1px solid var(--yzx-warning)",
        textAlign: "center",
        padding: "var(--yzx-space-2) var(--yzx-space-4)",
        fontSize: "var(--yzx-text-2xs)",
        fontWeight: "var(--yzx-weight-bold)",
        letterSpacing: "0.02em",
        paddingTop: "calc(var(--yzx-space-2) + env(safe-area-inset-top))",
      }}
    >
      {warning}
    </div>
  );
}

/**
 * Offline notice.
 *
 * Shown when the node is unreachable. It says the wallet is safe and the
 * figures may be stale — it never renders a balance as zero because a request
 * failed, which would be the single most alarming thing a wallet could do.
 */
export function OfflineNotice({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--yzx-space-3)",
        background: "var(--yzx-neutral-wash)",
        border: "1px solid var(--yzx-border)",
        borderRadius: "var(--yzx-radius-md)",
        padding: "var(--yzx-space-3) var(--yzx-space-4)",
        marginBottom: "var(--yzx-space-4)",
        fontSize: "var(--yzx-text-sm)",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: "16px" }}>⚠</span>
      <span style={{ flex: 1 }}>
        <strong style={{ display: "block" }}>You&rsquo;re offline</strong>
        <span style={{ color: "var(--yzx-text-secondary)" }}>
          Your wallet is safe. Some information may be out of date.
        </span>
      </span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          style={{
            flexShrink: 0,
            background: "none",
            border: "none",
            color: "var(--yzx-brand-soft)",
            fontWeight: "var(--yzx-weight-semibold)",
            fontSize: "var(--yzx-text-sm)",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
