"use client";

import Link from "next/link";

import { useEffect, useState } from "react";
import type { AccountView } from "@yozexa/sdk";
import { formatYZXA } from "@yozexa/sdk";

import { UnlockGate } from "@/components/unlock-gate";
import { YzxCard } from "@/components/yzx/card";
import { YzxAlert, YzxAvatar, YzxCopyButton, YzxNavigationBar, YzxSecurityBadge } from "@/components/yzx/primitives";
import { client } from "@/lib/node";
import { currentAddress, lock } from "@/lib/session";
import { activeEntry, loadVault, type VaultEntry } from "@/lib/vault";
import { securityScore } from "@/lib/security";

export default function ProfilePage() {
  return (
    <UnlockGate>
      <Profile />
    </UnlockGate>
  );
}

const ROWS: Array<{ href: string; label: string; note?: string }> = [
  { href: "/profile/security", label: "Security" },
  { href: "/permissions", label: "Spending permissions", note: "Apps, devices and agents" },
  { href: "/stake", label: "Earn", note: "Staking" },
  { href: "/profile/settings", label: "Appearance, currency and network" },
];

function Profile() {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [entry, setEntry] = useState<VaultEntry | null>(null);

  useEffect(() => {
    setEntry(activeEntry(loadVault()));
    const address = currentAddress();
    if (address) client().account(address).then(setAccount).catch(() => undefined);
  }, []);

  const score = entry ? securityScore(entry) : null;

  return (
    <>
      <YzxNavigationBar title="Profile" />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--yzx-space-4)",
          marginBottom: "var(--yzx-space-6)",
        }}
      >
        <YzxAvatar seed={account?.address ?? ""} label={account?.alias ?? entry?.name} size={56} />
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: "var(--yzx-text-lg)", fontWeight: "var(--yzx-weight-semibold)" }}>
            {account?.alias ?? entry?.name ?? "Your wallet"}
          </p>
          <p
            className="yzx-mono"
            style={{
              margin: "2px 0 0",
              fontSize: "var(--yzx-text-xs)",
              color: "var(--yzx-text-tertiary)",
              wordBreak: "break-all",
            }}
          >
            {account?.address ?? entry?.address}
          </p>
          {account?.address ? <YzxCopyButton value={account.address} label="Copy address" /> : null}
        </div>
      </div>

      {score ? (
        <Link href="/profile/security" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
          <YzxCard tone={score.level === "excellent" ? "surface" : "warning"}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: "var(--yzx-text-2xs)",
                    letterSpacing: "var(--yzx-tracking-wide)",
                    textTransform: "uppercase",
                    color: "var(--yzx-text-tertiary)",
                    fontWeight: "var(--yzx-weight-semibold)",
                  }}
                >
                  Security
                </p>
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: "var(--yzx-text-lg)",
                    fontWeight: "var(--yzx-weight-semibold)",
                    textTransform: "capitalize",
                    color: score.level === "excellent" ? "var(--yzx-positive)" : "var(--yzx-warning)",
                  }}
                >
                  {score.level}
                </p>
              </div>
              <span style={{ color: "var(--yzx-text-tertiary)" }}>›</span>
            </div>
            {score.topAction ? (
              <p style={{ margin: "var(--yzx-space-3) 0 0", fontSize: "var(--yzx-text-sm)", color: "var(--yzx-text-secondary)" }}>
                {score.topAction}
              </p>
            ) : null}
          </YzxCard>
        </Link>
      ) : null}

      {account?.vesting ? (
        <div style={{ marginTop: "var(--yzx-space-4)" }}>
          <YzxAlert tone="warning" title="This account has a vesting schedule.">
            {formatYZXA(BigInt(account.vesting.locked))} YZXA of your{" "}
            {formatYZXA(BigInt(account.vesting.total))} YZXA allocation is still locked. The
            protocol will not move it — not with your key, and not by any governance vote. The
            schedule ends {new Date(account.vesting.end_unix * 1000).toISOString().slice(0, 10)}.
          </YzxAlert>
        </div>
      ) : null}

      <nav aria-label="Settings" style={{ marginTop: "var(--yzx-space-6)" }}>
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            border: "1px solid var(--yzx-border)",
            borderRadius: "var(--yzx-radius-lg)",
            overflow: "hidden",
          }}
        >
          {ROWS.map((row) => (
            <li key={row.href}>
              <Link
                href={row.href}
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
                  <span style={{ display: "block", fontSize: "var(--yzx-text-base)" }}>{row.label}</span>
                  {row.note ? (
                    <span style={{ display: "block", fontSize: "var(--yzx-text-xs)", color: "var(--yzx-text-tertiary)" }}>
                      {row.note}
                    </span>
                  ) : null}
                </span>
                <span style={{ color: "var(--yzx-text-tertiary)" }}>›</span>
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => {
                lock();
                window.location.href = "/";
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "var(--yzx-space-4)",
                background: "var(--yzx-surface)",
                border: "none",
                color: "var(--yzx-brand-soft)",
                fontSize: "var(--yzx-text-base)",
                fontWeight: "var(--yzx-weight-medium)",
                cursor: "pointer",
                minHeight: "var(--yzx-touch-target)",
              }}
            >
              Lock wallet
            </button>
          </li>
        </ul>
      </nav>

      <p
        style={{
          marginTop: "var(--yzx-space-6)",
          fontSize: "var(--yzx-text-xs)",
          color: "var(--yzx-text-tertiary)",
          lineHeight: "var(--yzx-leading-relaxed)",
        }}
      >
        YOZEXA Wallet is self-custody. Your keys are generated and stored on this device,
        encrypted, and used only to sign locally — they are never transmitted. Nobody can freeze
        this account, reverse a payment you made, or recover it for you.
      </p>
      {entry ? (
        <p style={{ marginTop: "var(--yzx-space-3)", fontSize: "var(--yzx-text-2xs)", color: "var(--yzx-text-tertiary)" }}>
          Encryption: {entry.kdf} + {entry.cipher}
        </p>
      ) : null}
    </>
  );
}
