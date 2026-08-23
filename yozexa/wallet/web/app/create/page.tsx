"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PrivateKey } from "@yozexa/sdk";

import { YzxButton } from "@/components/yzx/button";
import { YzxCard } from "@/components/yzx/card";
import { YzxAlert, YzxNavigationBar } from "@/components/yzx/primitives";
import { YzxMark } from "@/components/yzx/logo";
import { addEntry, encryptKey, loadVault, markBackedUp, saveVault } from "@/lib/vault";
import { unlock } from "@/lib/session";
import { humanize } from "@/lib/errors";

type Step = "security" | "phrase" | "verify" | "ready";

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "security", label: "Set up security" },
  { id: "phrase", label: "Recovery" },
  { id: "verify", label: "Confirm" },
  { id: "ready", label: "Ready" },
];

export default function CreatePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("security");
  const [name, setName] = useState("My wallet");
  const [passphrase, setPassphrase] = useState("");
  const [repeat, setRepeat] = useState("");
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (passphrase.length < 8) return setError("Choose a passphrase of at least 8 characters.");
    if (passphrase !== repeat) return setError("The two passphrases don't match.");

    setBusy(true);
    try {
      const phrase = PrivateKey.generateMnemonic();
      const key = PrivateKey.fromMnemonic(phrase);
      const entry = await encryptKey(name.trim() || "My wallet", key, passphrase, true);
      saveVault(addEntry(loadVault(), entry));

      setMnemonic(phrase);
      setAddress(entry.address);
      // Three words back, chosen at random: "I wrote it down" demonstrated
      // rather than asserted.
      const picks = new Set<number>();
      while (picks.size < 3) picks.add(Math.floor(Math.random() * 24));
      setChallenge([...picks].sort((a, b) => a - b));
      unlock(key);
      setStep("phrase");
    } catch (err) {
      setError(humanize(err).message);
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
        setError(`Word ${index + 1} doesn't match. Check your written copy.`);
        return;
      }
    }
    setError(null);
    saveVault(markBackedUp(loadVault(), address));
    // The phrase leaves memory the moment it is confirmed.
    setMnemonic(null);
    setStep("ready");
  }

  return (
    <>
      <YzxNavigationBar title="Create wallet" back={step === "security" ? "/welcome" : undefined} />
      <StepDots current={step} />

      {error ? <YzxAlert tone="danger">{error}</YzxAlert> : null}

      {step === "security" ? (
        <form onSubmit={create}>
          <p style={intro}>
            Your wallet is created here, on this device. The passphrase encrypts it — it is not a
            password on a server, and nobody can reset it for you.
          </p>

          <label htmlFor="name" style={label}>Wallet name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} style={input} />

          <label htmlFor="pass" style={{ ...label, marginTop: "var(--yzx-space-4)" }}>Passphrase</label>
          <input
            id="pass"
            type="password"
            value={passphrase}
            autoComplete="new-password"
            onChange={(e) => setPassphrase(e.target.value)}
            style={input}
          />
          <p style={hint}>At least 8 characters. Longer is better than more complicated.</p>

          <label htmlFor="repeat" style={label}>Repeat passphrase</label>
          <input
            id="repeat"
            type="password"
            value={repeat}
            autoComplete="new-password"
            onChange={(e) => setRepeat(e.target.value)}
            style={input}
          />

          <div style={{ marginTop: "var(--yzx-space-6)" }}>
            <YzxButton type="submit" busy={busy} disabled={busy}>
              {busy ? "Creating…" : "Continue"}
            </YzxButton>
          </div>
        </form>
      ) : null}

      {step === "phrase" && mnemonic ? (
        <>
          <YzxAlert tone="danger" title="Write these 24 words down, on paper, offline.">
            Anyone who reads them controls this account. If you lose them and forget your
            passphrase, nobody — including YOZEXA Labs — can recover your funds. That is what
            self-custody means.
          </YzxAlert>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "var(--yzx-space-2)",
              padding: "var(--yzx-space-4)",
              background: "var(--yzx-surface-sunken)",
              border: "1px solid var(--yzx-border)",
              borderRadius: "var(--yzx-radius-lg)",
              marginBottom: "var(--yzx-space-5)",
            }}
          >
            {mnemonic.split(" ").map((word, i) => (
              <span
                key={i}
                className="yzx-mono"
                style={{
                  fontSize: "var(--yzx-text-xs)",
                  background: "var(--yzx-surface)",
                  border: "1px solid var(--yzx-border)",
                  borderRadius: "var(--yzx-radius-sm)",
                  padding: "var(--yzx-space-2)",
                }}
              >
                <span style={{ color: "var(--yzx-text-tertiary)", marginRight: "6px" }}>{i + 1}</span>
                {word}
              </span>
            ))}
          </div>

          <YzxButton onClick={() => setStep("verify")}>I&rsquo;ve written them down</YzxButton>
          <p style={{ ...hint, marginTop: "var(--yzx-space-4)", textAlign: "center" }}>
            Don&rsquo;t screenshot this. Don&rsquo;t put it in a note that syncs to a cloud, or in
            a message.
          </p>
        </>
      ) : null}

      {step === "verify" && mnemonic ? (
        <form onSubmit={verify}>
          <p style={intro}>Type these three words back, from what you wrote down.</p>
          {challenge.map((index) => (
            <div key={index} style={{ marginBottom: "var(--yzx-space-4)" }}>
              <label htmlFor={`w${index}`} style={label}>Word {index + 1}</label>
              <input
                id={`w${index}`}
                className="yzx-mono"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={answers[index] ?? ""}
                onChange={(e) => setAnswers({ ...answers, [index]: e.target.value })}
                style={input}
              />
            </div>
          ))}
          <YzxButton type="submit">Confirm</YzxButton>
          <div style={{ marginTop: "var(--yzx-space-3)" }}>
            <YzxButton variant="ghost" onClick={() => setStep("phrase")} type="button">
              Show the phrase again
            </YzxButton>
          </div>
        </form>
      ) : null}

      {step === "ready" ? (
        <div style={{ textAlign: "center", paddingTop: "var(--yzx-space-6)" }}>
          <YzxMark size={56} />
          <h2 style={{ margin: "var(--yzx-space-5) 0 var(--yzx-space-2)", fontSize: "var(--yzx-text-xl)" }}>
            Wallet ready
          </h2>
          <p style={{ margin: "0 0 var(--yzx-space-5)", color: "var(--yzx-text-secondary)", fontSize: "var(--yzx-text-base)" }}>
            Your account is created and unlocked on this device.
          </p>
          <YzxCard tone="sunken" style={{ textAlign: "left", marginBottom: "var(--yzx-space-5)" }}>
            <p style={{ margin: 0, fontSize: "var(--yzx-text-2xs)", letterSpacing: "var(--yzx-tracking-wide)", textTransform: "uppercase", color: "var(--yzx-text-tertiary)", fontWeight: "var(--yzx-weight-semibold)" }}>
              Your address
            </p>
            <p className="yzx-mono" style={{ margin: "var(--yzx-space-2) 0 0", fontSize: "var(--yzx-text-xs)", wordBreak: "break-all" }}>
              {address}
            </p>
          </YzxCard>
          <YzxButton onClick={() => router.push("/")}>Open wallet</YzxButton>
        </div>
      ) : null}
    </>
  );
}

function StepDots({ current }: { current: Step }) {
  const index = STEPS.findIndex((s) => s.id === current);
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={STEPS.length}
      aria-valuenow={index + 1}
      aria-label={`Step ${index + 1} of ${STEPS.length}: ${STEPS[index]?.label}`}
      style={{ display: "flex", gap: "6px", margin: "var(--yzx-space-2) 0 var(--yzx-space-6)" }}
    >
      {STEPS.map((s, i) => (
        <span
          key={s.id}
          style={{
            flex: 1,
            height: "3px",
            borderRadius: "var(--yzx-radius-full)",
            background: i <= index ? "var(--yzx-brand)" : "var(--yzx-border)",
            transition: "background var(--yzx-duration-normal) var(--yzx-ease)",
          }}
        />
      ))}
    </div>
  );
}

const intro: React.CSSProperties = {
  margin: "0 0 var(--yzx-space-5)",
  fontSize: "var(--yzx-text-base)",
  color: "var(--yzx-text-secondary)",
  lineHeight: "var(--yzx-leading-relaxed)",
};

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
