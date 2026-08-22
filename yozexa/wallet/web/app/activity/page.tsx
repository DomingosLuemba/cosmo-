"use client";

import { useCallback, useEffect, useState } from "react";
import { formatYZXA } from "@yozexa/sdk";

import { UnlockGate } from "@/components/unlock-gate";
import { client } from "@/lib/node";
import { currentAddress } from "@/lib/session";

interface Movement {
  hash: string;
  height: number;
  time: string;
  direction: "in" | "out";
  counterparty: string;
  amount: bigint;
}

export default function ActivityPage() {
  return (
    <UnlockGate>
      <Activity />
    </UnlockGate>
  );
}

function Activity() {
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const address = currentAddress();
    if (!address) return;
    try {
      const api = client();
      // Walk recent blocks and pick out this account's transfers. A wallet
      // backed by an indexer would query it directly; scanning is honest about
      // being a fallback rather than pretending to have full history.
      const { blocks } = await api.blocks(60);
      const found: Movement[] = [];
      for (const summary of blocks) {
        const height = Number((summary as { height: number }).height);
        if (Number((summary as { transaction_count: number }).transaction_count) === 0) continue;
        const block = (await api.block(height)) as {
          time: string;
          transactions?: Array<{ hash: string; signer?: string }>;
        };
        for (const tx of block.transactions ?? []) {
          const status = await api.txStatus(tx.hash).catch(() => null);
          if (!status) continue;
          const events = (status as unknown as { events?: unknown }).events;
          for (const event of Array.isArray(events) ? events : []) {
            const e = event as { type?: string; attributes?: Array<{ key?: string; value?: string }> };
            if (e.type !== "transfer") continue;
            const attrs = new Map((e.attributes ?? []).map((a) => [a.key ?? "", a.value ?? ""]));
            const from = attrs.get("from");
            const to = attrs.get("to");
            const amount = attrs.get("amount");
            if (!from || !to || !amount) continue;
            if (from === address) {
              found.push({ hash: tx.hash, height, time: block.time, direction: "out", counterparty: to, amount: BigInt(amount) });
            } else if (to === address) {
              found.push({ hash: tx.hash, height, time: block.time, direction: "in", counterparty: from, amount: BigInt(amount) });
            }
          }
        }
      }
      setMovements(found);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMovements([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <h1>Activity</h1>
      <p className="subtitle">Payments to and from this account in recent blocks.</p>
      {error ? <div className="alert danger">{error}</div> : null}

      {movements === null ? (
        <p className="dim">Scanning recent blocks…</p>
      ) : movements.length === 0 ? (
        <div className="card">
          <p className="dim" style={{ margin: 0 }}>
            No payments found in the last 60 blocks. This view scans the chain directly rather than
            relying on an index, so it only reaches back so far — the full history is always
            available in the explorer.
          </p>
        </div>
      ) : (
        <div className="list">
          {movements.map((m, i) => (
            <div className="list-item" key={`${m.hash}-${i}`}>
              <div>
                <div className="title">{m.direction === "in" ? "Received" : "Sent"}</div>
                <div className="meta mono">
                  {m.counterparty.slice(0, 12)}…{m.counterparty.slice(-6)}
                </div>
                <div className="meta">Block {m.height.toLocaleString()}</div>
              </div>
              <div
                className="amount"
                style={{ color: m.direction === "in" ? "var(--ok)" : undefined }}
              >
                {m.direction === "in" ? "+" : "−"}
                {formatYZXA(m.amount)}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
