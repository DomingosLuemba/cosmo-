"use client";

import Link from "next/link";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountView } from "@yozexa/sdk";

import { OfflineNotice } from "@/components/network-banner";
import { UnlockGate } from "@/components/unlock-gate";
import { YzxActionButton, YzxButton } from "@/components/yzx/button";
import { YzxBalance } from "@/components/yzx/balance";
import { YzxBalanceCard } from "@/components/yzx/balance-card";
import { YzxSectionHeader } from "@/components/yzx/card";
import { YzxMark } from "@/components/yzx/logo";
import { YzxAlert, YzxAvatar, YzxSkeleton } from "@/components/yzx/primitives";
import { YzxTransactionRow, type Movement } from "@/components/yzx/transaction-row";
import { client } from "@/lib/node";
import { currentAddress } from "@/lib/session";
import { recentMovements } from "@/lib/movements";
import { humanize } from "@/lib/errors";

const HIDDEN_KEY = "yozexa.hide-balance.v1";

export default function HomePage() {
  return (
    <UnlockGate>
      <Home />
    </UnlockGate>
  );
}

function Home() {
  const router = useRouter();
  const [account, setAccount] = useState<AccountView | null>(null);
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDDEN_KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const address = currentAddress();
    if (!address) return;
    try {
      const api = client();
      const [status, view] = await Promise.all([api.status(), api.account(address)]);
      setChainId(status.chain_id);
      setAccount(view);
      setOffline(false);
    } catch {
      // The balance already on screen stays. Rendering zero because a request
      // failed would tell the user their money is gone.
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 8_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const address = currentAddress();
    if (!address) return;
    recentMovements(client(), address, { blocks: 30, limit: 4 })
      .then((result) => setMovements(result.movements))
      .catch(() => setMovements([]));
  }, []);

  const balance = account ? BigInt(account.balance) : 0n;
  const locked = account ? BigInt(account.locked) : 0n;
  const loading = account === null && !offline;
  const empty = account !== null && balance === 0n;

  function toggleHidden() {
    const next = !hidden;
    setHidden(next);
    try {
      window.localStorage.setItem(HIDDEN_KEY, next ? "1" : "0");
    } catch {
      /* a preference that cannot be stored is not worth failing over */
    }
  }

  return (
    <>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--yzx-space-3)",
          minHeight: "56px",
          paddingTop: "calc(env(safe-area-inset-top) + var(--yzx-space-2))",
          marginBottom: "var(--yzx-space-3)",
        }}
      >
        <Link href="/profile" aria-label="Profile">
          {account ? (
            <YzxAvatar seed={account.address} label={account.alias ?? "Your account"} size={34} />
          ) : (
            <YzxSkeleton width={34} height={34} radius="var(--yzx-radius-full)" />
          )}
        </Link>
        <span style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <YzxMark size={22} title="YOZEXA" />
        </span>
        <Link
          href="/activity"
          aria-label="Notifications and activity"
          style={{
            width: "34px",
            height: "34px",
            display: "grid",
            placeItems: "center",
            borderRadius: "var(--yzx-radius-full)",
            background: "var(--yzx-surface-raised)",
            border: "1px solid var(--yzx-border)",
            color: "var(--yzx-text-secondary)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 6.5a4 4 0 1 1 8 0c0 3 1 4 1 4H3s1-1 1-4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M6.5 13a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </Link>
      </header>

      {offline ? <OfflineNotice onRetry={() => void refresh()} /> : null}

      <YzxBalanceCard network={chainId ?? undefined}>
        <YzxBalance
          baseUnits={balance}
          loading={loading}
          hidden={hidden}
          onToggleHidden={toggleHidden}
        />
        {locked > 0n && !hidden ? (
          <p
            style={{
              margin: "var(--yzx-space-4) 0 0",
              textAlign: "center",
              fontSize: "var(--yzx-text-xs)",
              color: "var(--yzx-warning)",
            }}
          >
            Part of this balance is locked by a vesting schedule and cannot be spent yet.{" "}
            <Link href="/profile" style={{ color: "inherit", textDecoration: "underline" }}>
              Details
            </Link>
          </p>
        ) : null}
      </YzxBalanceCard>

      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          margin: "var(--yzx-space-6) 0 var(--yzx-space-4)",
        }}
      >
        <YzxActionButton label="Send" href="/send" glyph={<ArrowUp />} />
        <YzxActionButton label="Receive" href="/receive" glyph={<ArrowDown />} />
        <YzxActionButton label="Pay" href="/pay" glyph={<QrGlyph />} emphasis />
        <YzxActionButton
          label="Swap"
          glyph={<SwapGlyph />}
          unavailable="Swapping needs the YOZEXA DEX, which is not built yet."
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-around", marginBottom: "var(--yzx-space-2)" }}>
        <YzxActionButton
          label="Buy"
          glyph={<span style={{ fontSize: 20, fontWeight: 600 }}>+</span>}
          unavailable="Buying YZXA needs a licensed partner in your country. None is connected yet."
        />
        <YzxActionButton
          label="Sell"
          glyph={<span style={{ fontSize: 20, fontWeight: 600 }}>−</span>}
          unavailable="Selling YZXA needs a licensed partner in your country. None is connected yet."
        />
        <YzxActionButton label="Earn" href="/stake" glyph={<EarnGlyph />} />
        <YzxActionButton label="More" href="/profile" glyph={<MoreGlyph />} />
      </div>

      {empty ? (
        <div style={{ marginTop: "var(--yzx-space-6)" }}>
          <YzxAlert tone="info" title="Your YOZEXA wallet is ready.">
            Receive your first YZXA to get started. Your address is ready to share.
          </YzxAlert>
          <div style={{ display: "grid", gap: "var(--yzx-space-3)" }}>
            <YzxButton onClick={() => router.push("/receive")}>Receive</YzxButton>
            <YzxButton variant="secondary" onClick={() => router.push("/explore")}>
              Learn about YOZEXA
            </YzxButton>
          </div>
        </div>
      ) : (
        <>
          <YzxSectionHeader title="Recent activity" action={{ label: "See all", href: "/activity" }} />
          <div
            style={{
              border: "1px solid var(--yzx-border)",
              borderRadius: "var(--yzx-radius-lg)",
              overflow: "hidden",
            }}
          >
            {movements === null ? (
              <div style={{ padding: "var(--yzx-space-4)", display: "grid", gap: "var(--yzx-space-4)" }}>
                {[0, 1, 2].map((i) => (
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
            ) : movements.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  padding: "var(--yzx-space-5)",
                  textAlign: "center",
                  color: "var(--yzx-text-tertiary)",
                  fontSize: "var(--yzx-text-sm)",
                }}
              >
                Nothing here yet. Payments will appear as soon as they settle.
              </p>
            ) : (
              movements.map((movement) => (
                <YzxTransactionRow
                  key={movement.id}
                  movement={movement}
                  href={movement.hash ? `/tx/${movement.hash}` : undefined}
                />
              ))
            )}
          </div>
        </>
      )}

      <p
        style={{
          marginTop: "var(--yzx-space-6)",
          textAlign: "center",
          fontSize: "var(--yzx-text-2xs)",
          color: "var(--yzx-text-tertiary)",
          lineHeight: "var(--yzx-leading-relaxed)",
        }}
      >
        Buy and Sell need a licensed partner. Swap needs the YOZEXA DEX. Both are shown so the
        roadmap is visible — not to suggest they work.
      </p>
    </>
  );
}

function ArrowUp() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 14.5V3.5M9 3.5 4.5 8M9 3.5 13.5 8" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ArrowDown() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 3.5v11M9 14.5 4.5 10M9 14.5 13.5 10" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function QrGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.8" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.8" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M11.5 11.5h2.5v2.5M17.5 14v3.5H14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function SwapGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 6.5h11L11 3.5M15 11.5H4l3 3" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function EarnGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 13.5 7 8l3 3 5-6.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function MoreGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="4" cy="9" r="1.5" fill="currentColor" />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" />
      <circle cx="14" cy="9" r="1.5" fill="currentColor" />
    </svg>
  );
}
