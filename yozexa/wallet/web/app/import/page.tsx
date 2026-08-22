"use client";

import { useState } from "react";
import { PrivateKey } from "@yozexa/sdk";

import { addEntry, encryptKey, loadVault, markBackedUp, saveVault } from "@/lib/vault";
import { unlock } from "@/lib/session";

export default function ImportPage() {
  const [phrase, setPhrase] = useState("");
  const [extraWord, setExtraWord] = useState("");
  const [name, setName] = useState("Restored wallet");
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  async function restore(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (passphrase.length < 8) return setError("Choose a passphrase of at least 8 characters.");
    if (passphrase !== repeat) return setError("The two passphrases do not match.");

    setBusy(true);
    try {
      const key = PrivateKey.fromMnemonic(phrase.trim().replace(/\s+/g, " "), extraWord);
      const entry = await encryptKey(name || "Restored wallet", key, passphrase, true);
      let vault = addEntry(loadVault(), entry);
      // A restored phrase is by definition already written down.
      vault = markBackedUp(vault, entry.address);
      saveVault(vault);
      unlock(key);
      setAddress(entry.address);
      setPhrase("");
      setExtraWord("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setPassphrase("");
      setRepeat("");
    }
  }

  if (address) {
    return (
      <>
        <h1>Wallet restored</h1>
        <div className="card">
          <div className="hint">Address</div>
          <p className="mono break" style={{ fontSize: 13 }}>{address}</p>
        </div>
        <p className="subtitle">
          If this is not the address you expected, check the phrase and whether the wallet used a
          BIP-39 passphrase (a &ldquo;25th word&rdquo;). A different passphrase produces a
          completely different account from the same words.
        </p>
        <a className="primary" href="/">Open wallet</a>
      </>
    );
  }

  return (
    <>
      <h1>Restore a wallet</h1>
      <p className="subtitle">Enter the 24-word recovery phrase for the account you want back.</p>
      {error ? <div className="alert danger">{error}</div> : null}
      <form onSubmit={restore}>
        <div className="field">
          <label htmlFor="phrase">Recovery phrase</label>
          <textarea
            id="phrase"
            className="mono"
            rows={4}
            value={phrase}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="word one two three …"
          />
          <div className="hint">
            Typed on this device and never sent anywhere. Only type it into software you trust —
            anyone who reads it controls the account.
          </div>
        </div>
        <div className="field">
          <label htmlFor="extra">BIP-39 passphrase (optional)</label>
          <input
            id="extra"
            type="password"
            value={extraWord}
            autoComplete="off"
            onChange={(e) => setExtraWord(e.target.value)}
          />
          <div className="hint">
            Leave blank unless the wallet you are restoring used one. It is not the same as the
            passphrase below.
          </div>
        </div>
        <div className="field">
          <label htmlFor="name">Wallet name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pass">New passphrase for this device</label>
          <input
            id="pass"
            type="password"
            value={passphrase}
            autoComplete="new-password"
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="repeat">Repeat passphrase</label>
          <input
            id="repeat"
            type="password"
            value={repeat}
            autoComplete="new-password"
            onChange={(e) => setRepeat(e.target.value)}
          />
        </div>
        <button className="primary" type="submit" disabled={busy || phrase.trim() === ""}>
          {busy ? "Restoring…" : "Restore wallet"}
        </button>
      </form>
    </>
  );
}
