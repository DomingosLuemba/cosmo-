"use client";

import { useEffect, useState } from "react";

import { YzxButton } from "./yzx/button";
import { YzxMark } from "./yzx/logo";
import { activeEntry, decryptKey, loadVault, WrongPassphrase, type VaultEntry } from "@/lib/vault";
import { isUnlocked, subscribe, unlock } from "@/lib/session";
import { humanize } from "@/lib/errors";

/**
 * Everything that can spend sits behind this.
 *
 * There is no "remember me". The passphrase is asked for again after the idle
 * timeout, because a browser tab left open on a shared machine should not stay
 * able to move money.
 */
export function UnlockGate({ children }: { children: React.ReactNode }) {
  const [entry, setEntry] = useState<VaultEntry | null>(null);
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const vault = loadVault();
    const active = activeEntry(vault);
    setEntry(active);
    setUnlocked(isUnlocked());
    setReady(true);
    // With no wallet at all, onboarding is the only sensible destination.
    if (!active) window.location.replace("/welcome");
    return subscribe(() => setUnlocked(isUnlocked()));
  }, []);

  if (!ready || !entry) return null;
  if (unlocked) return <>{children}</>;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!entry) return;
    setBusy(true);
    setError(null);
    try {
      // Deliberately slow: the scrypt work factor is what makes a weak
      // passphrase expensive to attack offline.
      const key = await decryptKey(entry, passphrase);
      setPassphrase("");
      unlock(key);
    } catch (err) {
      setError(err instanceof WrongPassphrase ? err.message : humanize(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ paddingTop: "var(--yzx-space-16)", textAlign: "center" }}>
      <YzxMark size={44} />
      <h1
        style={{
          margin: "var(--yzx-space-5) 0 var(--yzx-space-1)",
          fontSize: "var(--yzx-text-xl)",
          letterSpacing: "var(--yzx-tracking-tight)",
        }}
      >
        Unlock
      </h1>
      <p
        style={{
          margin: "0 0 var(--yzx-space-6)",
          color: "var(--yzx-text-secondary)",
          fontSize: "var(--yzx-text-sm)",
        }}
      >
        {entry.name} · <span className="yzx-mono">{entry.address.slice(0, 10)}…{entry.address.slice(-6)}</span>
      </p>

      {error ? (
        <p
          role="alert"
          style={{
            color: "var(--yzx-negative)",
            background: "var(--yzx-negative-wash)",
            border: "1px solid var(--yzx-negative)",
            borderRadius: "var(--yzx-radius-md)",
            padding: "var(--yzx-space-3)",
            fontSize: "var(--yzx-text-sm)",
            textAlign: "left",
            marginBottom: "var(--yzx-space-4)",
          }}
        >
          {error}
        </p>
      ) : null}

      <form onSubmit={submit} style={{ textAlign: "left" }}>
        <label
          htmlFor="passphrase"
          style={{
            display: "block",
            fontSize: "var(--yzx-text-xs)",
            fontWeight: "var(--yzx-weight-semibold)",
            letterSpacing: "var(--yzx-tracking-wide)",
            textTransform: "uppercase",
            color: "var(--yzx-text-tertiary)",
            marginBottom: "var(--yzx-space-2)",
          }}
        >
          Passphrase
        </label>
        <input
          id="passphrase"
          type="password"
          value={passphrase}
          autoFocus
          autoComplete="current-password"
          onChange={(event) => setPassphrase(event.target.value)}
          style={{
            width: "100%",
            padding: "var(--yzx-space-4)",
            background: "var(--yzx-surface)",
            border: "1px solid var(--yzx-border)",
            borderRadius: "var(--yzx-radius-lg)",
            color: "var(--yzx-text)",
            fontSize: "var(--yzx-text-md)",
            marginBottom: "var(--yzx-space-5)",
          }}
        />
        <YzxButton type="submit" busy={busy} disabled={busy || passphrase.length === 0}>
          {busy ? "Unlocking…" : "Unlock"}
        </YzxButton>
      </form>

      <p
        style={{
          marginTop: "var(--yzx-space-6)",
          fontSize: "var(--yzx-text-xs)",
          color: "var(--yzx-text-tertiary)",
          lineHeight: "var(--yzx-leading-relaxed)",
        }}
      >
        Your keys never leave this device. Nobody — including YOZEXA Labs — can unlock this wallet
        for you, or recover it if you lose both your passphrase and your recovery phrase.
      </p>
    </div>
  );
}
