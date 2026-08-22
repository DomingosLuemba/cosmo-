"use client";

import { useState } from "react";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { isValidAddress } from "@yozexa/sdk";

type Stage = "idle" | "working" | "claiming" | "done";

/** Count leading zero bits, matching the server's check exactly. */
function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    for (let mask = 0x80; mask > 0; mask >>= 1) {
      if (byte & mask) return bits;
      bits++;
    }
    return bits;
  }
  return bits;
}

export default function FaucetPage() {
  const [address, setAddress] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ hash: string; amount_yzxa: string; chain_id: string } | null>(null);

  async function claim(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);

    const target = address.trim();
    if (!isValidAddress(target)) {
      setError("That is not a valid YOZEXA address. It should start with yzx1.");
      return;
    }

    try {
      setStage("working");
      setProgress(0);

      const challengeResponse = await fetch("/api/faucet/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: target }),
      });
      const challenge = (await challengeResponse.json()) as {
        nonce?: string;
        difficulty?: number;
        error?: string;
      };
      if (!challengeResponse.ok || !challenge.nonce) {
        throw new Error(challenge.error ?? "could not get a challenge");
      }

      // Proof of work, in this tab. It costs a second or so of your CPU, which
      // is what makes draining the faucet with a script expensive.
      const difficulty = challenge.difficulty ?? 20;
      const encoder = new TextEncoder();
      let solution = 0;
      const started = Date.now();
      for (;;) {
        const digest = sha256(encoder.encode(`${challenge.nonce}:${solution}`));
        if (leadingZeroBits(digest) >= difficulty) break;
        solution++;
        if (solution % 20_000 === 0) {
          setProgress(solution);
          // Yield so the tab stays responsive rather than appearing frozen.
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (Date.now() - started > 120_000) {
            throw new Error("the proof of work took too long; try again");
          }
        }
      }

      setStage("claiming");
      const claimResponse = await fetch("/api/faucet/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: target, nonce: challenge.nonce, solution: String(solution) }),
      });
      const payload = (await claimResponse.json()) as {
        hash?: string;
        amount_yzxa?: string;
        chain_id?: string;
        error?: string;
      };
      if (!claimResponse.ok || !payload.hash) {
        throw new Error(payload.error ?? "the faucet could not pay");
      }
      setResult({
        hash: payload.hash,
        amount_yzxa: payload.amount_yzxa ?? "?",
        chain_id: payload.chain_id ?? "?",
      });
      setStage("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("idle");
    }
  }

  return (
    <>
      <h1>Testnet faucet</h1>
      <p className="subtitle">Free YZXA for building and testing.</p>

      <div className="notice" style={{ borderColor: "var(--warn)", background: "color-mix(in srgb, var(--warn) 10%, transparent)", color: "var(--warn)" }}>
        <strong>Testnet YZXA has NO REAL VALUE.</strong> It cannot be sold, exchanged or converted,
        and it exists only so you can build. Anyone offering to buy it is running a scam.
      </div>

      {error ? <div className="notice">{error}</div> : null}

      {result ? (
        <div className="card">
          <div className="label">Sent</div>
          <div className="value mono">{result.amount_yzxa} YZXA</div>
          <div className="hint">on {result.chain_id}</div>
          <p className="mono dim break" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
            {result.hash}
          </p>
        </div>
      ) : null}

      <form onSubmit={claim}>
        <div className="card">
          <label htmlFor="address" style={{ fontSize: 13, color: "var(--text-dim)", display: "block" }}>
            Your testnet address
          </label>
          <input
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="yzx1…"
            autoCapitalize="none"
            spellCheck={false}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-inset)",
              color: "var(--text)",
              fontFamily: "var(--mono)",
              fontSize: 14,
              margin: "6px 0 14px",
            }}
          />
          <button
            type="submit"
            disabled={stage === "working" || stage === "claiming"}
            style={{
              padding: "12px 26px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent)",
              color: "var(--bg)",
              fontWeight: 650,
              fontSize: 14,
              cursor: stage === "idle" || stage === "done" ? "pointer" : "not-allowed",
              opacity: stage === "working" || stage === "claiming" ? 0.6 : 1,
            }}
          >
            {stage === "working"
              ? `Solving proof of work… ${progress.toLocaleString()} tries`
              : stage === "claiming"
                ? "Sending…"
                : "Request testnet YZXA"}
          </button>
        </div>
      </form>

      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>How this faucet resists abuse</h2>
        <p className="dim" style={{ fontSize: 13 }}>
          Before it pays, your browser has to solve a proof of work — a hash with 20 leading zero
          bits, about a second of CPU. That is invisible to a person asking once and expensive for
          a script asking thousands of times.
        </p>
        <p className="dim" style={{ fontSize: 13 }}>
          A proof of work rather than a CAPTCHA on purpose: it works offline, needs no third-party
          service, and does not send your IP address to an advertising company in exchange for a
          checkbox.
        </p>
        <p className="dim" style={{ fontSize: 13, marginBottom: 0 }}>
          Each challenge is bound to the address it was issued for and is burned after one use, so
          a solution cannot be computed once and reused. One claim per address every 12 hours, and
          one per client every hour.
        </p>
      </div>
    </>
  );
}
