"use client";

import type { VaultEntry } from "./vault";

/**
 * The wallet's own view of how well protected it is.
 *
 * Scored on things this wallet can actually verify on this device. It does not
 * claim credit for protections it cannot check, and it never reports
 * "Excellent" while a real gap is open — a security score that flatters is
 * worse than none, because it stops the user looking.
 */
export interface SecurityCheck {
  id: string;
  label: string;
  state: "on" | "off" | "optional" | "warning";
  detail: string;
  /** What the user should do, when there is something to do. */
  action?: string;
  /** Whether an unmet check should hold the overall score down. */
  required: boolean;
}

export interface SecurityScore {
  level: "excellent" | "good" | "needs attention";
  checks: SecurityCheck[];
  topAction?: string;
}

export function securityChecks(entry: VaultEntry): SecurityCheck[] {
  const secureContext = typeof window !== "undefined" && window.isSecureContext;
  const hasWebAuthn = typeof window !== "undefined" && "PublicKeyCredential" in window;

  return [
    {
      id: "encrypted",
      label: "Key encrypted on this device",
      state: "on",
      detail: `${entry.kdf} with ${entry.cipher}. The key is never stored in the clear and never leaves this device.`,
      required: true,
    },
    {
      id: "backup",
      label: "Recovery phrase backed up",
      state: entry.backedUp ? "on" : "off",
      detail: entry.backedUp
        ? "You confirmed you wrote down the 24-word recovery phrase."
        : "You have not confirmed a backup. If you lose this device, this account is gone — nobody can recover it for you.",
      ...(entry.backedUp ? {} : { action: "Back up your recovery phrase" }),
      required: true,
    },
    {
      id: "auto-lock",
      label: "Automatic lock",
      state: "on",
      detail: "The wallet locks itself after 10 minutes of inactivity and asks for your passphrase again.",
      required: false,
    },
    {
      id: "secure-context",
      label: "Secure connection",
      state: secureContext ? "on" : "warning",
      detail: secureContext
        ? "This page is served over a secure context, so the browser's key storage is available."
        : "This page is not on a secure connection. Use https, or localhost for development — key storage is weaker otherwise.",
      ...(secureContext ? {} : { action: "Open the wallet over https" }),
      required: true,
    },
    {
      id: "biometrics",
      label: "Biometric unlock",
      state: hasWebAuthn ? "optional" : "optional",
      detail: hasWebAuthn
        ? "This device supports passkeys. Biometric unlock is not enabled in this build yet — the passphrase is currently the only way in."
        : "This device does not expose a passkey API to the browser.",
      required: false,
    },
    {
      id: "hardware",
      label: "Hardware wallet",
      state: "optional",
      detail: "Not connected. For balances that matter, a hardware wallet keeps the key off this device entirely.",
      required: false,
    },
  ];
}

export function securityScore(entry: VaultEntry): SecurityScore {
  const checks = securityChecks(entry);
  const failing = checks.filter((c) => c.required && c.state !== "on");

  const level: SecurityScore["level"] =
    failing.length === 0 ? "excellent" : failing.length === 1 ? "good" : "needs attention";

  const topAction = failing.find((c) => c.action)?.action;
  return { level, checks, ...(topAction ? { topAction } : {}) };
}
