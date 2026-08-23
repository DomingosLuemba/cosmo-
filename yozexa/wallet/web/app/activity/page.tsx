"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { UnlockGate } from "@/components/unlock-gate";
import { YzxNavigationBar, YzxSkeleton } from "@/components/yzx/primitives";
import { YzxTransactionRow, type Movement } from "@/components/yzx/transaction-row";
import { client } from "@/lib/node";
import { currentAddress } from "@/lib/session";
import { recentMovements } from "@/lib/movements";
import { humanize, type HumanError } from "@/lib/errors";

type Filter = "all" | "received" | "sent" | "staking";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "received", label: "Received" },
  { id: "sent", label: "Sent" },
  { id: "staking", label: "Staking" },
];

export default function ActivityPage() {
  return (
    <UnlockGate>
      <Activity />
    </UnlockGate>
  );
}

function Activity() {
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<HumanError | null>(null);

  const load = useCallback(async () => {
    const address = currentAddress();
    if (!address) return;
    try {
      const result = await recentMovements(client(), address, { blocks: 80, limit: 60 });
      setMovements(result.movements);
      setNote(result.complete ? null : (result.note ?? null));
      setError(null);
    } catch (err) {
      setError(humanize(err));
      setMovements([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (!movements) return null;
    const needle = query.trim().toLowerCase();
    return movements.filter((m) => {
      if (filter === "received" && !m.incoming) return false;
      if (filter === "sent" && m.incoming) return false;
      if (filter === "staking" && m.kind !== "staking") return false;
      if (!needle) return true;
      return (
        m.counterparty.toLowerCase().includes(needle) ||
        (m.title ?? "").toLowerCase().includes(needle) ||
        (m.hash ?? "").toLowerCase().includes(needle)
      );
    });
  }, [movements, filter, query]);

  return (
    <>
      <YzxNavigationBar title="Activity" />

      <label className="yzx-sr-only" htmlFor="search">Search transactions</label>
      <input
        id="search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search transactions"
        style={{
          width: "100%",
          padding: "var(--yzx-space-3) var(--yzx-space-4)",
          background: "var(--yzx-surface)",
          border: "1px solid var(--yzx-border)",
          borderRadius: "var(--yzx-radius-lg)",
          color: "var(--yzx-text)",
          fontSize: "var(--yzx-text-base)",
          marginBottom: "var(--yzx-space-4)",
        }}
      />

      <div
        role="tablist"
        aria-label="Filter activity"
        style={{
          display: "flex",
          gap: "var(--yzx-space-2)",
          marginBottom: "var(--yzx-space-4)",
          overflowX: "auto",
          paddingBottom: "var(--yzx-space-1)",
        }}
      >
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => setFilter(f.id)}
            style={{
              flexShrink: 0,
              padding: "var(--yzx-space-2) var(--yzx-space-4)",
              borderRadius: "var(--yzx-radius-full)",
              border: `1px solid ${filter === f.id ? "transparent" : "var(--yzx-border)"}`,
              background: filter === f.id ? "var(--yzx-brand)" : "var(--yzx-surface)",
              color: filter === f.id ? "var(--yzx-brand-ink)" : "var(--yzx-text-secondary)",
              fontSize: "var(--yzx-text-sm)",
              fontWeight: "var(--yzx-weight-medium)",
              cursor: "pointer",
              minHeight: "36px",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <p
          role="alert"
          style={{
            padding: "var(--yzx-space-4)",
            background: "var(--yzx-negative-wash)",
            border: "1px solid var(--yzx-negative)",
            borderRadius: "var(--yzx-radius-md)",
            fontSize: "var(--yzx-text-sm)",
          }}
        >
          <strong style={{ display: "block", color: "var(--yzx-negative)" }}>{error.message}</strong>
          <span style={{ color: "var(--yzx-text-secondary)" }}>{error.action}</span>
        </p>
      ) : null}

      <div
        style={{
          border: "1px solid var(--yzx-border)",
          borderRadius: "var(--yzx-radius-lg)",
          overflow: "hidden",
        }}
      >
        {visible === null ? (
          <div style={{ padding: "var(--yzx-space-4)", display: "grid", gap: "var(--yzx-space-4)" }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} style={{ display: "flex", gap: "var(--yzx-space-3)", alignItems: "center" }}>
                <YzxSkeleton width={38} height={38} radius="var(--yzx-radius-full)" />
                <span style={{ flex: 1 }}>
                  <YzxSkeleton width="55%" height={13} />
                  <YzxSkeleton width="35%" height={11} style={{ marginTop: 6 }} />
                </span>
                <YzxSkeleton width={64} height={13} />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p
            style={{
              margin: 0,
              padding: "var(--yzx-space-8) var(--yzx-space-5)",
              textAlign: "center",
              color: "var(--yzx-text-tertiary)",
              fontSize: "var(--yzx-text-sm)",
            }}
          >
            {query || filter !== "all"
              ? "Nothing matches this filter."
              : "No payments yet. They will appear here as soon as they settle."}
          </p>
        ) : (
          visible.map((movement) => (
            <YzxTransactionRow
              key={movement.id}
              movement={movement}
              href={movement.hash ? `/tx/${movement.hash}` : undefined}
            />
          ))
        )}
      </div>

      {note ? (
        <p
          style={{
            marginTop: "var(--yzx-space-4)",
            fontSize: "var(--yzx-text-2xs)",
            color: "var(--yzx-text-tertiary)",
            lineHeight: "var(--yzx-leading-relaxed)",
          }}
        >
          {note}
        </p>
      ) : null}
    </>
  );
}
