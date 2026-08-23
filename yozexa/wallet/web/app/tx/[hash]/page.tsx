"use client";

import { use, useEffect, useState } from "react";
import { formatYZXA } from "@yozexa/sdk";

import { UnlockGate } from "@/components/unlock-gate";
import { YzxButton } from "@/components/yzx/button";
import { YzxCard, YzxDetailRow } from "@/components/yzx/card";
import { YzxAlert, YzxCopyButton, YzxNavigationBar, YzxSkeleton } from "@/components/yzx/primitives";
import { client, nodeUrl } from "@/lib/node";
import { humanize, type HumanError } from "@/lib/errors";

interface TxDetail {
  hash: string;
  status: string;
  code: number;
  log?: string;
  height?: number;
  confirmations: number;
  explanation: string;
  gas_used?: number;
  events?: unknown;
}

export default function TransactionPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = use(params);
  return (
    <UnlockGate>
      <TransactionDetail hash={hash} />
    </UnlockGate>
  );
}

function TransactionDetail({ hash }: { hash: string }) {
  const [tx, setTx] = useState<TxDetail | null>(null);
  const [error, setError] = useState<HumanError | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client()
      .txStatus(hash)
      .then((result) => {
        if (!cancelled) setTx(result as unknown as TxDetail);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(humanize(err));
      });
    return () => {
      cancelled = true;
    };
  }, [hash]);

  const settled = tx?.status === "confirmed" || tx?.status === "finalized";
  const transfers = extractTransfers(tx?.events);

  return (
    <>
      <YzxNavigationBar
        title={
          tx
            ? tx.status === "failed"
              ? "Payment failed"
              : settled
                ? "Payment completed"
                : "Payment pending"
            : "Transaction"
        }
        back="/activity"
        trailing={
          tx ? (
            <button
              type="button"
              aria-label="Share"
              onClick={async () => {
                const text = `YOZEXA transaction ${hash}`;
                if (navigator.share) await navigator.share({ text }).catch(() => undefined);
                else await navigator.clipboard.writeText(text).catch(() => undefined);
              }}
              style={{
                width: "36px",
                height: "36px",
                display: "grid",
                placeItems: "center",
                borderRadius: "var(--yzx-radius-full)",
                background: "var(--yzx-surface-raised)",
                border: "1px solid var(--yzx-border)",
                color: "var(--yzx-text-secondary)",
                cursor: "pointer",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 12v3.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          ) : undefined
        }
      />

      {error ? (
        <YzxAlert tone="danger" title={error.message}>
          {error.action}
        </YzxAlert>
      ) : null}

      {tx === null && !error ? (
        <div style={{ display: "grid", gap: "var(--yzx-space-4)", marginTop: "var(--yzx-space-6)" }}>
          <YzxSkeleton width="60%" height={40} style={{ margin: "0 auto" }} />
          <YzxSkeleton height={160} radius="var(--yzx-radius-lg)" />
        </div>
      ) : null}

      {tx ? (
        <>
          {transfers.length > 0 ? (
            <div style={{ textAlign: "center", margin: "var(--yzx-space-6) 0" }}>
              <span
                className="yzx-num"
                style={{
                  display: "block",
                  fontSize: "var(--yzx-text-3xl)",
                  fontWeight: "var(--yzx-weight-bold)",
                  letterSpacing: "var(--yzx-tracking-tight)",
                  color: tx.status === "failed" ? "var(--yzx-text-tertiary)" : "var(--yzx-text)",
                  textDecoration: tx.status === "failed" ? "line-through" : "none",
                }}
              >
                {formatYZXA(transfers.reduce((sum, t) => sum + t.amount, 0n))}
              </span>
              <span style={{ fontSize: "var(--yzx-text-base)", color: "var(--yzx-text-secondary)" }}>
                YZXA
              </span>
            </div>
          ) : null}

          <YzxAlert
            tone={tx.status === "failed" ? "danger" : settled ? "success" : "warning"}
            title={
              tx.status === "failed"
                ? "Failed"
                : tx.status === "finalized"
                  ? "Finalized"
                  : tx.status === "confirmed"
                    ? "Confirmed"
                    : "Pending"
            }
          >
            {tx.explanation}
          </YzxAlert>

          <YzxCard>
            {transfers.map((t, i) => (
              <YzxDetailRow
                key={i}
                label={i === 0 ? "To" : ""}
                value={t.to}
                sub={`${formatYZXA(t.amount)} YZXA`}
                mono
              />
            ))}
            {tx.height ? <YzxDetailRow label="Block" value={tx.height.toLocaleString()} /> : null}
            <YzxDetailRow
              label="Confirmations"
              value={tx.confirmations.toLocaleString()}
              sub={settled ? "Committed blocks cannot be reverted" : undefined}
            />
            {tx.gas_used ? <YzxDetailRow label="Gas used" value={tx.gas_used.toLocaleString()} /> : null}
            <YzxDetailRow
              label="Transaction"
              value={
                <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--yzx-space-2)" }}>
                  <span style={{ fontSize: "var(--yzx-text-xs)" }}>
                    {hash.slice(0, 10)}…{hash.slice(-8)}
                  </span>
                  <YzxCopyButton value={hash} label="Copy transaction hash" />
                </span>
              }
            />
          </YzxCard>

          {tx.log ? (
            <div style={{ marginTop: "var(--yzx-space-4)" }}>
              <button
                type="button"
                onClick={() => setShowTechnical(!showTechnical)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "var(--yzx-text-tertiary)",
                  fontSize: "var(--yzx-text-xs)",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                {showTechnical ? "Hide developer details" : "Developer details"}
              </button>
              {showTechnical ? (
                <pre
                  className="yzx-mono"
                  style={{
                    marginTop: "var(--yzx-space-2)",
                    padding: "var(--yzx-space-3)",
                    background: "var(--yzx-surface-sunken)",
                    border: "1px solid var(--yzx-border)",
                    borderRadius: "var(--yzx-radius-md)",
                    fontSize: "var(--yzx-text-2xs)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    color: "var(--yzx-text-secondary)",
                  }}
                >
                  {tx.log}
                </pre>
              ) : null}
            </div>
          ) : null}

          <div style={{ marginTop: "var(--yzx-space-6)" }}>
            <YzxButton
              variant="secondary"
              onClick={() => window.open(explorerUrl(hash), "_blank", "noopener,noreferrer")}
            >
              View on YOZEXA Explorer
            </YzxButton>
          </div>
        </>
      ) : null}
    </>
  );
}

function extractTransfers(events: unknown): Array<{ to: string; amount: bigint }> {
  if (!Array.isArray(events)) return [];
  const out: Array<{ to: string; amount: bigint }> = [];
  for (const event of events) {
    const e = event as { type?: string; attributes?: Array<{ key?: string; value?: string }> };
    if (e.type !== "transfer") continue;
    const attrs = new Map((e.attributes ?? []).map((a) => [a.key ?? "", a.value ?? ""]));
    const to = attrs.get("to");
    const amount = attrs.get("amount");
    if (to && amount && /^\d+$/.test(amount)) out.push({ to, amount: BigInt(amount) });
  }
  return out;
}

/**
 * The explorer for the node the wallet is talking to.
 *
 * Derived from the configured node rather than hard-coded, so a wallet pointed
 * at a local network links to a local explorer instead of sending the user to
 * a site that has never heard of their transaction.
 */
function explorerUrl(hash: string): string {
  const configured = process.env.NEXT_PUBLIC_EXPLORER_URL;
  if (configured) return `${configured.replace(/\/+$/, "")}/tx/${hash}`;
  try {
    const node = new URL(nodeUrl());
    return `${node.protocol}//${node.hostname}:3001/tx/${hash}`;
  } catch {
    return `/tx/${hash}`;
  }
}
