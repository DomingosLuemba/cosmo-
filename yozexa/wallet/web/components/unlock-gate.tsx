"use client";

import { useEffect, useState } from "react";

import { activeEntry, decryptKey, loadVault, WrongPassphrase, type VaultEntry } from "@/lib/vault";
import { isUnlocked, subscribe, unlock } from "@/lib/session";

/**
 * Everything that can spend sits behind this.
 *
 * It renders its children only once a key has been decrypted in memory. There
 * is no "remember me": the passphrase is asked for again after the idle
 * timeout, because a browser tab left open should not stay able to spend.
 */
export function UnlockGate({ children }: { children: React.ReactNode }) {
  const [entry, setEntry] = useState<VaultEntry | null>(null);
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntry(activeEntry(loadVault()));
    setUnlocked(isUnlocked());
    setReady(true);
    return subscribe(() => setUnlocked(isUnlocked()));
  }, []);

  if (!ready) return null;

  if (!entry) {
    return (
      <>
        <h1>No wallet yet</h1>
        <p className="subtitle">
          Create a wallet, or restore one from its 24-word recovery phrase.
        </p>
        <a className="primary" href="/create">Create a wallet</a>
        <button className="secondary" onClick={() => (window.location.href = "/import")}>
          I have a recovery phrase
        </button>
      </>
    );
  }

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
      setError(err instanceof WrongPassphrase ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Unlock</h1>
      <p className="subtitle">
        {entry.name} · <span className="mono">{entry.address.slice(0, 12)}…{entry.address.slice(-6)}</span>
      </p>
      {error ? <div className="alert danger">{error}</div> : null}
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="passphrase">Passphrase</label>
          <input
            id="passphrase"
            type="password"
            value={passphrase}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </div>
        <button className="primary" type="submit" disabled={busy || passphrase.length === 0}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
      <p className="hint center" style={{ marginTop: 18 }}>
        Your keys never leave this device. Nobody, including YOZEXA Labs, can unlock this wallet
        for you or recover it if you lose both your passphrase and your recovery phrase.
      </p>
    </>
  );
}
