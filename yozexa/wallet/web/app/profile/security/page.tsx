"use client";

import { useEffect, useState } from "react";

import { UnlockGate } from "@/components/unlock-gate";
import { YzxButton } from "@/components/yzx/button";
import { YzxCard } from "@/components/yzx/card";
import { YzxAlert, YzxNavigationBar, YzxSecurityBadge } from "@/components/yzx/primitives";
import { activeEntry, loadVault, removeEntry, saveVault, type VaultEntry } from "@/lib/vault";
import { lock, IDLE_LOCK_MINUTES } from "@/lib/session";
import { securityScore, type SecurityScore } from "@/lib/security";

export default function SecurityPage() {
  return (
    <UnlockGate>
      <Security />
    </UnlockGate>
  );
}

function Security() {
  const [entry, setEntry] = useState<VaultEntry | null>(null);
  const [score, setScore] = useState<SecurityScore | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    const active = activeEntry(loadVault());
    setEntry(active);
    if (active) setScore(securityScore(active));
  }, []);

  if (!entry || !score) return null;

  const levelColor =
    score.level === "excellent"
      ? "var(--yzx-positive)"
      : score.level === "good"
        ? "var(--yzx-warning)"
        : "var(--yzx-negative)";

  return (
    <>
      <YzxNavigationBar title="Security" back="/profile" />

      <YzxCard style={{ marginBottom: "var(--yzx-space-5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--yzx-space-4)" }}>
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
              Security score
            </p>
            <p
              style={{
                margin: "2px 0 0",
                fontSize: "var(--yzx-text-2xl)",
                fontWeight: "var(--yzx-weight-bold)",
                letterSpacing: "var(--yzx-tracking-tight)",
                textTransform: "capitalize",
                color: levelColor,
              }}
            >
              {score.level}
            </p>
          </div>
          <ShieldGlyph color={levelColor} />
        </div>
      </YzxCard>

      {score.topAction ? (
        <YzxAlert tone="warning" title="One thing to fix">
          {score.topAction}.
        </YzxAlert>
      ) : null}

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--yzx-space-3)" }}>
        {score.checks.map((check) => (
          <li key={check.id}>
            <YzxCard>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--yzx-space-3)",
                  marginBottom: "var(--yzx-space-2)",
                }}
              >
                <span style={{ fontSize: "var(--yzx-text-base)", fontWeight: "var(--yzx-weight-medium)" }}>
                  {check.label}
                </span>
                <YzxSecurityBadge state={check.state}>
                  {check.state === "on"
                    ? "On"
                    : check.state === "off"
                      ? "Not set"
                      : check.state === "warning"
                        ? "Check"
                        : "Optional"}
                </YzxSecurityBadge>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "var(--yzx-text-sm)",
                  color: "var(--yzx-text-secondary)",
                  lineHeight: "var(--yzx-leading-snug)",
                }}
              >
                {check.detail}
              </p>
            </YzxCard>
          </li>
        ))}
      </ul>

      <h2
        style={{
          margin: "var(--yzx-space-8) 0 var(--yzx-space-3)",
          fontSize: "var(--yzx-text-base)",
          fontWeight: "var(--yzx-weight-semibold)",
        }}
      >
        Protection
      </h2>
      <YzxCard tone="sunken">
        <p style={{ margin: 0, fontSize: "var(--yzx-text-sm)", color: "var(--yzx-text-secondary)", lineHeight: "var(--yzx-leading-relaxed)" }}>
          The wallet locks after {IDLE_LOCK_MINUTES} minutes of inactivity, warns you when a
          destination closely resembles one you have paid before, and refuses to build a spending
          permission without a limit and an expiry — the protocol will not accept one either.
        </p>
        <p style={{ margin: "var(--yzx-space-3) 0 0", fontSize: "var(--yzx-text-sm)", color: "var(--yzx-text-secondary)", lineHeight: "var(--yzx-leading-relaxed)" }}>
          Spending limits, address allow-lists and a large-transaction confirmation are designed
          and not yet built. They are not listed above as if they were on.
        </p>
      </YzxCard>

      <div style={{ marginTop: "var(--yzx-space-6)", display: "grid", gap: "var(--yzx-space-3)" }}>
        <YzxButton variant="secondary" onClick={() => lock()}>
          Lock now
        </YzxButton>

        {confirmRemove ? (
          <YzxCard tone="danger">
            <p style={{ margin: "0 0 var(--yzx-space-3)", fontSize: "var(--yzx-text-sm)" }}>
              <strong style={{ display: "block", color: "var(--yzx-negative)", marginBottom: "4px" }}>
                Remove this wallet from this device?
              </strong>
              This deletes the encrypted key stored here. Without your 24-word recovery phrase, the
              account cannot be restored by anyone — including YOZEXA Labs.
            </p>
            <div style={{ display: "grid", gap: "var(--yzx-space-2)" }}>
              <YzxButton
                variant="danger"
                onClick={() => {
                  saveVault(removeEntry(loadVault(), entry.address));
                  lock();
                  window.location.href = "/welcome";
                }}
              >
                Yes, remove it
              </YzxButton>
              <YzxButton variant="ghost" onClick={() => setConfirmRemove(false)}>
                Cancel
              </YzxButton>
            </div>
          </YzxCard>
        ) : (
          <YzxButton variant="ghost" onClick={() => setConfirmRemove(true)}>
            Remove wallet from this device
          </YzxButton>
        )}
      </div>
    </>
  );
}

function ShieldGlyph({ color }: { color: string }) {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M20 4 33 9v10c0 8-5.6 14.2-13 17-7.4-2.8-13-9-13-17V9l13-5Z"
        fill={color}
        fillOpacity="0.14"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M14.5 20.5 18.5 24.5 26 16.5" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
