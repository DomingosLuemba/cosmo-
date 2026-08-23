"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrivateKey } from "@yozexa/sdk";

import { YzxButton } from "@/components/yzx/button";
import { YzxCard } from "@/components/yzx/card";
import { YzxAlert, YzxNavigationBar } from "@/components/yzx/primitives";
import { addEntry, encryptKey, loadVault, markBackedUp, saveVault } from "@/lib/vault";
import { unlock } from "@/lib/session";
import { humanize } from "@/lib/errors";

export default function ImportPage() {
  const router = useRouter();
  const [phrase, setPhrase] = useState("");
  const [extraWord, setExtraWord] = useState("");
  const [name, setName] = useState("Restored wallet");
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);

  const wordCount = phrase.trim() ? phrase.trim().split(/\s+/).length : 0;

  async function restore(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (passphrase.length < 8) return setError("Choose a passphrase of at least 8 characters.");
    if (passphrase !== repeat) return setError("The two passphrases don't match.");

    setBusy(true);
    try {
      const key = PrivateKey.fromMnemonic(phrase.trim().replace(/\s+/g, " "), extraWord);
      const entry = await encryptKey(name.trim() || "Restored wallet", key, passphrase, true);
      let vault = addEntry(loadVault(), entry);
      // A restored phrase is, by definition, already written down.
      vault = markBackedUp(vault, entry.address);
      saveVault(vault);
      unlock(key);
      setAddress(entry.address);
      setPhrase("");
      setExtraWord("");
    } catch (err) {
      setError(humanize(err).message);
    } finally {
      setBusy(false);
      setPassphrase("");
      setRepeat("");
    }
  }

  if (address) {
    return (
      <>
        <YzxNavigationBar title="Wallet restored" />
        <YzxCard tone="sunken" style={{ marginBottom: "var(--yzx-space-5)" }}>
          <p style={{ margin: 0, fontSize: "var(--yzx-text-2xs)", letterSpacing: "var(--yzx-tracking-wide)", textTransform: "uppercase", color: "var(--yzx-text-tertiary)", fontWeight: "var(--yzx-weight-semibold)" }}>
            Your address
          </p>
          <p className="yzx-mono" style={{ margin: "var(--yzx-space-2) 0 0", fontSize: "var(--yzx-text-xs)", wordBreak: "break-all" }}>
            {address}
          </p>
        </YzxCard>
        <YzxAlert tone="info" title="Not the address you expected?">
          Check the phrase, and whether that wallet used a BIP-39 passphrase — a &ldquo;25th
          word&rdquo;. A different passphrase produces a completely different account from the
          same words.
        </YzxAlert>
        <YzxButton onClick={() => router.push("/")}>Open wallet</YzxButton>
      </>
    );
  }

  return (
    <>
      <YzxNavigationBar title="Restore wallet" back="/welcome" />

      {error ? <YzxAlert tone="danger">{error}</YzxAlert> : null}

      <form onSubmit={restore}>
        <label htmlFor="phrase" style={label}>Recovery phrase</label>
        <textarea
          id="phrase"
          className="yzx-mono"
          rows={4}
          value={phrase}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="word one two three …"
          style={{ ...input, resize: "vertical", fontSize: "var(--yzx-text-sm)" }}
        />
        <p style={hint}>
          {wordCount > 0 ? `${wordCount} of 24 words. ` : ""}
          Typed on this device and never sent anywhere. Only type it into software you trust —
          anyone who reads it controls the account.
        </p>

        <label htmlFor="extra" style={label}>BIP-39 passphrase (optional)</label>
        <input
          id="extra"
          type="password"
          value={extraWord}
          autoComplete="off"
          onChange={(e) => setExtraWord(e.target.value)}
          style={input}
        />
        <p style={hint}>
          Leave blank unless the wallet you&rsquo;re restoring used one. It is not the same as the
          passphrase below.
        </p>

        <label htmlFor="name" style={label}>Wallet name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} style={input} />

        <label htmlFor="pass" style={{ ...label, marginTop: "var(--yzx-space-4)" }}>
          New passphrase for this device
        </label>
        <input
          id="pass"
          type="password"
          value={passphrase}
          autoComplete="new-password"
          onChange={(e) => setPassphrase(e.target.value)}
          style={input}
        />

        <label htmlFor="repeat" style={{ ...label, marginTop: "var(--yzx-space-4)" }}>
          Repeat passphrase
        </label>
        <input
          id="repeat"
          type="password"
          value={repeat}
          autoComplete="new-password"
          onChange={(e) => setRepeat(e.target.value)}
          style={input}
        />

        <div style={{ marginTop: "var(--yzx-space-6)" }}>
          <YzxButton type="submit" busy={busy} disabled={busy || wordCount === 0}>
            {busy ? "Restoring…" : "Restore wallet"}
          </YzxButton>
        </div>
      </form>
    </>
  );
}

const label: React.CSSProperties = {
  display: "block",
  fontSize: "var(--yzx-text-xs)",
  fontWeight: "var(--yzx-weight-semibold)",
  letterSpacing: "var(--yzx-tracking-wide)",
  textTransform: "uppercase",
  color: "var(--yzx-text-tertiary)",
  marginBottom: "var(--yzx-space-2)",
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "var(--yzx-space-4)",
  background: "var(--yzx-surface)",
  border: "1px solid var(--yzx-border)",
  borderRadius: "var(--yzx-radius-lg)",
  color: "var(--yzx-text)",
  fontSize: "var(--yzx-text-md)",
};

const hint: React.CSSProperties = {
  margin: "var(--yzx-space-2) 0 var(--yzx-space-4)",
  fontSize: "var(--yzx-text-xs)",
  color: "var(--yzx-text-tertiary)",
  lineHeight: "var(--yzx-leading-relaxed)",
};
