"use client";

import { useState } from "react";
import { PrivateKey } from "@yozexa/sdk";

import { addEntry, encryptKey, loadVault, markBackedUp, saveVault } from "@/lib/vault";
import { unlock } from "@/lib/session";

type Step = "passphrase" | "phrase" | "confirm" | "done";

export default function CreatePage() {
  const [step, setStep] = useState<Step>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [name, setName] = useState("My wallet");
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  async function createWallet(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (passphrase.length < 8) return setError("Choose a passphrase of at least 8 characters.");
    if (passphrase !== repeat) return setError("The two passphrases do not match.");

    setBusy(true);
    try {
      const phrase = PrivateKey.generateMnemonic();
      const key = PrivateKey.fromMnemonic(phrase);
      const entry = await encryptKey(name || "My wallet", key, passphrase, true);
      saveVault(addEntry(loadVault(), entry));

      setMnemonic(phrase);
      setAddress(entry.address);
      // Ask for three words back, chosen at random, so "I wrote it down" is
      // demonstrated rather than asserted.
      const indices = new Set<number>();
      while (indices.size < 3) indices.add(Math.floor(Math.random() * 24));
      setChallenge([...indices].sort((a, b) => a - b));
      unlock(key);
      setStep("phrase");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setPassphrase("");
      setRepeat("");
    }
  }

  function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!mnemonic || !address) return;
    const words = mnemonic.split(" ");
    for (const index of challenge) {
      if ((answers[index] ?? "").trim().toLowerCase() !== words[index]) {
        setError(`Word ${index + 1} does not match. Check your written copy.`);
        return;
      }
    }
    saveVault(markBackedUp(loadVault(), address));
    setMnemonic(null);
    setStep("done");
  }

  if (step === "passphrase") {
    return (
      <>
        <h1>Create a wallet</h1>
        <p className="subtitle">
          Your keys are generated on this device and encrypted with a passphrase only you know.
        </p>
        {error ? <div className="alert danger">{error}</div> : null}
        <form onSubmit={createWallet}>
          <div className="field">
            <label htmlFor="name">Wallet name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pass">Passphrase</label>
            <input
              id="pass"
              type="password"
              value={passphrase}
              autoComplete="new-password"
              onChange={(e) => setPassphrase(e.target.value)}
            />
            <div className="hint">
              At least 8 characters. This encrypts your key on this device — it is not a password
              on a server, and nobody can reset it.
            </div>
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
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Generating…" : "Create wallet"}
          </button>
        </form>
      </>
    );
  }

  if (step === "phrase" && mnemonic) {
    return (
      <>
        <h1>Your recovery phrase</h1>
        <div className="alert danger">
          <strong>Write these 24 words down, on paper, offline.</strong> Anyone who reads them
          controls this account. If you lose them and forget your passphrase, nobody — including
          YOZEXA Labs — can recover your funds. That is what self-custody means.
        </div>
        <div className="phrase">
          {mnemonic.split(" ").map((word, i) => (
            <div className="word" key={i}>
              <i>{i + 1}</i>
              {word}
            </div>
          ))}
        </div>
        <button className="primary" onClick={() => setStep("confirm")}>
          I have written them down
        </button>
        <p className="hint center" style={{ marginTop: 14 }}>
          Do not screenshot this. Do not put it in a password manager you cannot control, a
          message, or a note that syncs to a cloud.
        </p>
      </>
    );
  }

  if (step === "confirm" && mnemonic) {
    return (
      <>
        <h1>Check your copy</h1>
        <p className="subtitle">Type these three words back, from what you wrote down.</p>
        {error ? <div className="alert danger">{error}</div> : null}
        <form onSubmit={verify}>
          {challenge.map((index) => (
            <div className="field" key={index}>
              <label htmlFor={`w${index}`}>Word {index + 1}</label>
              <input
                id={`w${index}`}
                className="mono"
                autoCapitalize="none"
                autoCorrect="off"
                value={answers[index] ?? ""}
                onChange={(e) => setAnswers({ ...answers, [index]: e.target.value })}
              />
            </div>
          ))}
          <button className="primary" type="submit">Confirm</button>
        </form>
        <button className="secondary" onClick={() => setStep("phrase")}>
          Show the phrase again
        </button>
      </>
    );
  }

  return (
    <>
      <h1>Wallet ready</h1>
      <p className="subtitle">Your account is created and unlocked on this device.</p>
      <div className="card">
        <div className="hint">Address</div>
        <p className="mono break" style={{ fontSize: 13 }}>{address}</p>
      </div>
      <a className="primary" href="/">Open wallet</a>
    </>
  );
}
