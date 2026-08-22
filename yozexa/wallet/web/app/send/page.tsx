"use client";

import { useEffect, useState } from "react";
import {
  formatYZXA,
  looksConfusable,
  messages,
  parseAmount,
  shortenAddress,
  signTransaction,
  type FeeTier,
  type Simulation,
  type Unit,
} from "@yozexa/sdk";

import { UnlockGate } from "@/components/unlock-gate";
import { client } from "@/lib/node";
import { currentAddress, withKey } from "@/lib/session";

type Stage = "compose" | "review" | "sending" | "sent";

export default function SendPage() {
  return (
    <UnlockGate>
      <Send />
    </UnlockGate>
  );
}

function Send() {
  const [stage, setStage] = useState<Stage>("compose");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<Unit>("YOZ");
  const [memo, setMemo] = useState("");
  const [tiers, setTiers] = useState<FeeTier[]>([]);
  const [tier, setTier] = useState<"economy" | "normal" | "priority">("normal");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [resolved, setResolved] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [signed, setSigned] = useState<ReturnType<typeof signTransaction> | null>(null);
  const [result, setResult] = useState<{ hash: string; status: string; explanation?: string } | null>(null);
  const [recentRecipients, setRecentRecipients] = useState<string[]>([]);

  useEffect(() => {
    client()
      .feeMarket()
      .then((fm) => setTiers(fm.tiers))
      .catch(() => setTiers([]));
    try {
      setRecentRecipients(JSON.parse(localStorage.getItem("yozexa.recipients.v1") ?? "[]") as string[]);
    } catch {
      setRecentRecipients([]);
    }
  }, []);

  async function review(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const from = currentAddress();
      if (!from) throw new Error("The wallet is locked.");

      const api = client();
      // Resolve first, and show the user what the chain will actually credit.
      const to = await api.resolveRecipient(recipient);
      const value = parseAmount(amount, unit);
      if (value <= 0n) throw new Error("Enter an amount greater than zero.");
      if (to === from) throw new Error("You cannot send to your own account.");

      // Everything the signature commits to is read immediately before
      // signing, so the wallet cannot sign a transaction that is already stale.
      const [status, account, feeMarket] = await Promise.all([
        api.status(),
        api.account(from),
        api.feeMarket(),
      ]);
      const selected = feeMarket.tiers.find((t) => t.name === tier);
      if (!selected) throw new Error("That fee tier is not available on this node.");

      // Signing happens here, in the browser, with a key that never leaves it.
      const tx = withKey((key) =>
        signTransaction(
          {
            chainId: status.chain_id,
            msgs: [messages.send(from, to, value)],
            sequence: account.sequence,
            fee: { gasLimit: 300_000, gasPrice: BigInt(selected.gas_price) },
            ...(memo ? { memo } : {}),
          },
          key,
        ),
      );

      const sim = await api.simulate(tx);
      if (!sim.valid) throw new Error(sim.error ?? "The node rejected this transaction.");

      setResolved(to);
      setSimulation(sim);
      setSigned(tx);
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!signed) return;
    setStage("sending");
    setError(null);
    try {
      const api = client();
      const broadcast = await api.broadcast(signed, "commit");
      if (broadcast.status === "failed") {
        throw new Error(broadcast.log || "The transaction failed on chain.");
      }
      const status = await api.txStatus(broadcast.hash).catch(() => null);
      setResult({
        hash: broadcast.hash,
        status: status?.status ?? broadcast.status,
        ...(status?.explanation ? { explanation: status.explanation } : {}),
      });

      if (resolved) {
        const next = [resolved, ...recentRecipients.filter((r) => r !== resolved)].slice(0, 10);
        localStorage.setItem("yozexa.recipients.v1", JSON.stringify(next));
      }
      setStage("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("review");
    }
  }

  if (stage === "sent" && result) {
    return (
      <>
        <h1>{result.status === "failed" ? "Payment failed" : "Payment sent"}</h1>
        <div className={`alert ${result.status === "failed" ? "danger" : "ok"}`}>
          <strong style={{ textTransform: "capitalize" }}>{result.status}</strong>
          {result.explanation ? <div style={{ marginTop: 6 }}>{result.explanation}</div> : null}
        </div>
        <div className="card">
          <div className="hint">Transaction</div>
          <p className="mono break" style={{ fontSize: 12 }}>{result.hash}</p>
        </div>
        <a className="primary" href="/">Done</a>
        <button className="secondary" onClick={() => window.location.reload()}>
          Send another
        </button>
      </>
    );
  }

  if (stage === "review" || stage === "sending") {
    const confusable = recentRecipients.some(
      (r) => resolved && looksConfusable(r, resolved),
    );
    return (
      <>
        <h1>Review</h1>
        <p className="subtitle">Check what you are actually signing.</p>
        {error ? <div className="alert danger">{error}</div> : null}

        {simulation?.effects.map((effect, i) => (
          <div className="review-effect" key={i}>
            {effect.description}
          </div>
        ))}

        {confusable ? (
          <div className="alert danger">
            <strong>This address closely resembles one you have paid before, but is not the
            same.</strong> That is how address-poisoning attacks work. Check every character of
            the destination before continuing.
          </div>
        ) : null}

        {simulation?.warnings?.map((warning, i) => (
          <div className="alert warn" key={i}>
            {warning}
          </div>
        ))}

        <div className="review">
          <div className="review-row">
            <span className="k">To</span>
            <span className="v mono" style={{ fontSize: 12 }}>{resolved}</span>
          </div>
          {recipient !== resolved ? (
            <div className="review-row">
              <span className="k">Resolved from</span>
              <span className="v">{recipient}</span>
            </div>
          ) : null}
          <div className="review-row">
            <span className="k">Network fee</span>
            <span className="v mono">{simulation?.estimated_fee_yzxa} YZXA</span>
          </div>
          <div className="review-row">
            <span className="k">Fee tier</span>
            <span className="v" style={{ textTransform: "capitalize" }}>{tier}</span>
          </div>
          {memo ? (
            <div className="review-row">
              <span className="k">Memo</span>
              <span className="v">{memo}</span>
            </div>
          ) : null}
          <div className="review-row">
            <span className="k">Your balance after</span>
            <span className="v mono">
              {simulation
                ? formatYZXA(
                    BigInt(simulation.signer_balance) -
                      BigInt(simulation.estimated_fee) -
                      parseAmount(amount || "0", unit),
                  )
                : "—"}{" "}
              YZXA
            </span>
          </div>
        </div>

        <button className="primary" onClick={() => void send()} disabled={stage === "sending"}>
          {stage === "sending" ? "Sending…" : "Confirm and send"}
        </button>
        <button className="secondary" onClick={() => setStage("compose")} disabled={stage === "sending"}>
          Back
        </button>
      </>
    );
  }

  return (
    <>
      <h1>Send</h1>
      <p className="subtitle">To a YOZEXA address or a YOZEXA ID like maria.yzx.</p>
      {error ? <div className="alert danger">{error}</div> : null}
      <form onSubmit={review}>
        <div className="field">
          <label htmlFor="to">Recipient</label>
          <input
            id="to"
            className="mono"
            value={recipient}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="yzx1… or maria.yzx"
          />
          {recentRecipients.length > 0 ? (
            <div className="hint">
              Recent:{" "}
              {recentRecipients.slice(0, 3).map((r) => (
                <button
                  key={r}
                  type="button"
                  className="ghost"
                  style={{ fontSize: 12, marginRight: 10 }}
                  onClick={() => setRecipient(r)}
                >
                  {shortenAddress(r, 8, 6)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="amount">Amount</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25"
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as Unit)}
              style={{ width: 110 }}
              aria-label="Unit"
            >
              <option value="YOZ">YOZ</option>
              <option value="YZXA">YZXA</option>
            </select>
          </div>
          <div className="hint">1 YOZ = 0.00001 YZXA</div>
        </div>

        <div className="field">
          <label>Network fee</label>
          <div className="tiers">
            {tiers.map((t) => (
              <div
                key={t.name}
                className="tier"
                data-selected={tier === t.name}
                onClick={() => setTier(t.name)}
                role="radio"
                aria-checked={tier === t.name}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setTier(t.name);
                }}
              >
                <div className="name">{t.name}</div>
                <div className="desc">{t.description}</div>
                <div className="price">{t.gas_price} ayzxa per gas unit</div>
              </div>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="memo">Memo (optional)</label>
          <input
            id="memo"
            value={memo}
            maxLength={512}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Order 1042"
          />
          <div className="hint">
            Public and permanent. Never put personal information — a name, a document number, a
            phone number — in a memo.
          </div>
        </div>

        <button
          className="primary"
          type="submit"
          disabled={busy || recipient.trim() === "" || amount.trim() === ""}
        >
          {busy ? "Checking…" : "Review payment"}
        </button>
      </form>
    </>
  );
}
