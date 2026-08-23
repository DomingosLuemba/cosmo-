"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatYZXA } from "@yozexa/sdk";

import { YzxCard, YzxSectionHeader } from "@/components/yzx/card";
import { YzxAlert, YzxNavigationBar, YzxSkeleton } from "@/components/yzx/primitives";
import { client } from "@/lib/node";

/**
 * Explore.
 *
 * The ecosystem directory this will become is empty, and an empty directory
 * filled with invented projects would be the exact thing this project refuses
 * to do. So this screen shows what genuinely exists: the live network, and
 * honest links into it.
 */
export default function ExplorePage() {
  const [supply, setSupply] = useState<Record<string, string | number> | null>(null);
  const [status, setStatus] = useState<{ chain_id: string; height: number } | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const api = client();
    Promise.all([api.status(), api.supply()])
      .then(([s, sup]) => {
        setStatus({ chain_id: s.chain_id, height: s.height });
        setSupply(sup);
      })
      .catch(() => setOffline(true));
  }, []);

  const minted = supply ? BigInt(String(supply.minted_supply)) : null;
  const burned = supply ? BigInt(String(supply.burned_supply)) : null;
  const max = supply ? BigInt(String(supply.max_supply)) : null;

  return (
    <>
      <YzxNavigationBar title="Explore" />

      {offline ? (
        <YzxAlert tone="info" title="No node reachable">
          Connect to a node in Settings to see live network information.
        </YzxAlert>
      ) : null}

      <YzxSectionHeader title="The network" />
      <YzxCard>
        <div style={{ display: "grid", gap: "var(--yzx-space-4)" }}>
          <Stat label="Chain" value={status?.chain_id ?? null} />
          <Stat label="Block height" value={status ? status.height.toLocaleString() : null} />
          <Stat
            label="Circulating supply"
            value={minted !== null && burned !== null ? `${formatYZXA(minted - burned)} YZXA` : null}
          />
          <Stat
            label="Maximum supply"
            value={max !== null ? `${formatYZXA(max)} YZXA` : null}
            note="Fixed forever. No vote, upgrade or administrator can raise it."
          />
        </div>
      </YzxCard>

      <YzxSectionHeader title="Apps and services" />
      <YzxAlert tone="info" title="The ecosystem directory is empty.">
        Nothing is listed here because nothing real is built on YOZEXA yet. Placeholder projects
        would make this screen look finished and tell you nothing true, so it stays empty until
        there is something to list.
      </YzxAlert>

      <YzxSectionHeader title="Learn" />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, border: "1px solid var(--yzx-border)", borderRadius: "var(--yzx-radius-lg)", overflow: "hidden" }}>
        <LinkRow label="What YZXA is" note="A fixed supply of 10,000,000, enforced by the protocol" href="/explore/about" />
        <LinkRow label="How staking works" note="And what you can lose" href="/stake" />
        <LinkRow label="Spending permissions" note="Subscriptions, devices and AI agents" href="/permissions" />
      </ul>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: "var(--yzx-text-2xs)", letterSpacing: "var(--yzx-tracking-wide)", textTransform: "uppercase", color: "var(--yzx-text-tertiary)", fontWeight: "var(--yzx-weight-semibold)" }}>
        {label}
      </p>
      {value === null ? (
        <YzxSkeleton width="60%" height={20} style={{ marginTop: 6 }} />
      ) : (
        <p className="yzx-num" style={{ margin: "2px 0 0", fontSize: "var(--yzx-text-lg)", fontWeight: "var(--yzx-weight-semibold)", wordBreak: "break-word" }}>
          {value}
        </p>
      )}
      {note ? (
        <p style={{ margin: "4px 0 0", fontSize: "var(--yzx-text-xs)", color: "var(--yzx-text-tertiary)" }}>{note}</p>
      ) : null}
    </div>
  );
}

function LinkRow({ label, note, href }: { label: string; note: string; href: string }) {
  return (
    <li>
      <Link
        href={href}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--yzx-space-3)",
          padding: "var(--yzx-space-4)",
          background: "var(--yzx-surface)",
          borderBottom: "1px solid var(--yzx-border)",
          color: "var(--yzx-text)",
          textDecoration: "none",
          minHeight: "var(--yzx-touch-target)",
        }}
      >
        <span>
          <span style={{ display: "block", fontSize: "var(--yzx-text-base)" }}>{label}</span>
          <span style={{ display: "block", fontSize: "var(--yzx-text-xs)", color: "var(--yzx-text-tertiary)" }}>{note}</span>
        </span>
        <span style={{ color: "var(--yzx-text-tertiary)" }}>›</span>
      </Link>
    </li>
  );
}
