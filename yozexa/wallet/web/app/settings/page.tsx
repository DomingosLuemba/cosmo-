"use client";

import { useEffect, useState } from "react";

import { nodeUrl, setNodeUrl, client } from "@/lib/node";
import { IDLE_LOCK_MINUTES, lock } from "@/lib/session";
import { activeEntry, loadVault, removeEntry, saveVault, type Vault } from "@/lib/vault";

export default function SettingsPage() {
  const [vault, setVault] = useState<Vault | null>(null);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    setVault(loadVault());
    setUrl(nodeUrl());
    client()
      .status()
      .then((s) => setStatus(`${s.chain_id} · height ${s.height}`))
      .catch((err: unknown) => setError(String(err)));
  }, []);

  function saveNode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      setNodeUrl(url);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const entry = vault ? activeEntry(vault) : null;

  return (
    <>
      <h1>Settings</h1>

      <div className="card">
        <h2>Node</h2>
        {status ? <p className="dim" style={{ fontSize: 13 }}>Connected to {status}</p> : null}
        {error ? <div className="alert danger">{error}</div> : null}
        <form onSubmit={saveNode}>
          <div className="field">
            <label htmlFor="node">Node API address</label>
            <input
              id="node"
              className="mono"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
            <div className="hint">
              You choose which node this wallet reads from and submits through. A node never sees
              your key — it only receives transactions you have already signed.
            </div>
          </div>
          <button className="secondary" type="submit">Save node</button>
        </form>
      </div>

      <div className="card">
        <h2>Security</h2>
        <p className="dim" style={{ fontSize: 13 }}>
          This wallet locks itself after {IDLE_LOCK_MINUTES} minutes of inactivity. Your key is
          encrypted with scrypt and AES-256-GCM and exists in memory only while unlocked.
        </p>
        <button className="secondary" onClick={() => lock()}>Lock now</button>
      </div>

      {entry ? (
        <div className="card">
          <h2>This wallet</h2>
          <p className="dim" style={{ fontSize: 13 }}>
            {entry.name} · created {entry.createdAt.slice(0, 10)}
          </p>
          <p className="mono break" style={{ fontSize: 12 }}>{entry.address}</p>
          {!entry.backedUp ? (
            <div className="alert warn">
              You have not confirmed a backup of this wallet&rsquo;s recovery phrase. If you lose
              this device, the account is gone.
            </div>
          ) : null}

          {confirmRemove === entry.address ? (
            <div className="alert danger">
              <strong>Remove this wallet from this device?</strong>
              <p style={{ margin: "8px 0" }}>
                This deletes the encrypted key stored here. Without your 24-word recovery phrase
                the account cannot be restored by anyone — including YOZEXA Labs.
              </p>
              <button
                className="secondary"
                style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                onClick={() => {
                  const next = removeEntry(loadVault(), entry.address);
                  saveVault(next);
                  lock();
                  window.location.href = "/";
                }}
              >
                Yes, remove it
              </button>
              <button className="secondary" onClick={() => setConfirmRemove(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="secondary" onClick={() => setConfirmRemove(entry.address)}>
              Remove wallet from this device
            </button>
          )}
        </div>
      ) : null}

      <div className="card">
        <h2>About</h2>
        <p className="dim" style={{ fontSize: 13, marginBottom: 8 }}>
          YOZEXA Wallet is self-custody. Your keys are generated and stored on this device,
          encrypted, and used only to sign locally. They are never transmitted.
        </p>
        <p className="dim" style={{ fontSize: 13, marginBottom: 0 }}>
          Nobody can freeze this account, reverse a payment you made, or recover it for you. That
          is the trade self-custody makes, and it is not reversible after the fact.
        </p>
      </div>
    </>
  );
}
