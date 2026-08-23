"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatYZXA,
  looksConfusable,
  messages,
  shortenAddress,
  signTransaction,
  type FeeTier,
  type Simulation,
  type SignedTx,
  type Unit,
} from "@yozexa/sdk";

import { UnlockGate } from "@/components/unlock-gate";
import { YzxAmountInput } from "@/components/yzx/amount-input";
import { YzxButton } from "@/components/yzx/button";
import { YzxCard, YzxDetailRow } from "@/components/yzx/card";
import { YzxAlert, YzxAvatar, YzxCopyButton, YzxNavigationBar, YzxSheet } from "@/components/yzx/primitives";
import { client } from "@/lib/node";
import { currentAddress, withKey } from "@/lib/session";
import { humanize, type HumanError } from "@/lib/errors";
import { entryUnit, renderAmount } from "@/lib/display";

type Stage = "compose" | "review" | "sending" | "done";

const RECENTS_KEY = "yozexa.recipients.v1";

export default function SendPage() {
  return (
    <UnlockGate>
      <Send />
    </UnlockGate>
  );
}

function Send() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("compose");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  // Starts in whatever unit the balance is being shown in — see entryUnit.
  const [unit, setUnit] = useState<Exclude<Unit, "ayzxa">>("YZXA");
  const [baseUnits, setBaseUnits] = useState<bigint | null>(null);
  const [memo, setMemo] = useState("");
  const [tier, setTier] = useState<"economy" | "normal" | "priority">("normal");
  const [tiers, setTiers] = useState<FeeTier[]>([]);
  const [feeSheet, setFeeSheet] = useState(false);

  const [spendable, setSpendable] = useState<bigint | undefined>(undefined);
  const [recents, setRecents] = useState<string[]>([]);

  const [resolved, setResolved] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [signed, setSigned] = useState<SignedTx | null>(null);
  const [result, setResult] = useState<{ hash: string; status: string; explanation?: string } | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<HumanError | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  /**
   * Accept a payment request handed over from Pay or a scanned `yozexa:` URI.
   *
   * The amount arrives in base units, which is the only form that survives the
   * trip without a rounding argument. It is filled in but never sent on its
   * own: the request still lands on the compose screen, so whoever is paying
   * reads the destination and the amount and presses the button themselves.
   */
  useEffect(() => {
    setUnit(entryUnit());

    const params = new URLSearchParams(window.location.search);
    const to = params.get("to");
    const base = params.get("amount");
    const note = params.get("note");

    if (to) setRecipient(to.trim());
    if (note) setMemo(note.slice(0, 512));
    if (base && /^\d+$/.test(base)) {
      const units = BigInt(base);
      // Show it in the unit that renders the amount most readably, rather
      // than forcing YOZ on a large payment or YZXA on a tiny one.
      const unit: Exclude<Unit, "ayzxa"> = units >= 10n ** 15n ? "YZXA" : "YOZ";
      setUnit(unit);
      setAmount(renderAmount(units, unit).replace(/,/g, ""));
    }
    if (to || base) setPrefilled(true);
  }, []);

  useEffect(() => {
    const address = currentAddress();
    if (!address) return;
    const api = client();
    void api.feeMarket().then((fm) => setTiers(fm.tiers)).catch(() => setTiers([]));
    void api.account(address).then((a) => setSpendable(BigInt(a.spendable))).catch(() => undefined);
    try {
      setRecents(JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as string[]);
    } catch {
      setRecents([]);
    }
  }, []);

  const review = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const from = currentAddress();
      if (!from) throw new Error("The wallet is locked.");
      if (baseUnits === null) throw new Error("Enter an amount to send.");

      const api = client();
      // Resolve first: the user must see the address the chain will credit,
      // not just the name they typed.
      const to = await api.resolveRecipient(recipient.trim());
      if (to === from) throw new Error("You cannot send to your own account.");

      // Everything the signature commits to is read immediately before
      // signing, so the wallet cannot sign a stale transaction.
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
            msgs: [messages.send(from, to, baseUnits)],
            sequence: account.sequence,
            fee: { gasLimit: 300_000, gasPrice: BigInt(selected.gas_price) },
            ...(memo ? { memo } : {}),
          },
          key,
        ),
      );

      const sim = await api.simulate(tx);
      if (!sim.valid) throw new Error(sim.error ?? "The node would not accept this transaction.");

      setResolved(to);
      setSimulation(sim);
      setSigned(tx);
      setStage("review");
    } catch (err) {
      setError(humanize(err));
    } finally {
      setBusy(false);
    }
  }, [recipient, baseUnits, tier, memo]);

  const send = useCallback(async () => {
    if (!signed) return;
    setStage("sending");
    setError(null);
    try {
      const api = client();
      const broadcast = await api.broadcast(signed, "commit");
      if (broadcast.status === "failed") throw new Error(broadcast.log || "The payment failed on chain.");

      const status = await api.txStatus(broadcast.hash).catch(() => null);
      setResult({
        hash: broadcast.hash,
        status: status?.status ?? broadcast.status,
        ...(status?.explanation ? { explanation: status.explanation } : {}),
      });

      if (resolved) {
        const next = [resolved, ...recents.filter((r) => r !== resolved)].slice(0, 8);
        try {
          localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
        } catch {
          /* a convenience list that cannot be stored is not worth failing over */
        }
      }
      setStage("done");
    } catch (err) {
      setError(humanize(err));
      setStage("review");
    }
  }, [signed, resolved, recents]);

  /* ─────────────────────────── SUCCESS ─────────────────────────── */
  if (stage === "done" && result) {
    const failed = result.status === "failed";
    return (
      <>
        <YzxNavigationBar />
        <div style={{ textAlign: "center", paddingTop: "var(--yzx-space-8)" }}>
          <SuccessMark failed={failed} />
          <h1
            style={{
              margin: "var(--yzx-space-6) 0 var(--yzx-space-2)",
              fontSize: "var(--yzx-text-xl)",
              letterSpacing: "var(--yzx-tracking-tight)",
            }}
          >
            {failed ? "Payment failed" : "Payment sent"}
          </h1>
          <p style={{ margin: 0, color: "var(--yzx-text-secondary)", fontSize: "var(--yzx-text-base)" }}>
            {failed
              ? "Nothing was transferred. The network fee was still charged."
              : `${renderAmount(baseUnits ?? 0n, unit)} ${unit} sent to ${shortenAddress(resolved ?? "", 10, 6)}.`}
          </p>
          {result.explanation ? (
            <p
              style={{
                margin: "var(--yzx-space-4) auto 0",
                maxWidth: "36ch",
                fontSize: "var(--yzx-text-xs)",
                color: "var(--yzx-text-tertiary)",
                lineHeight: "var(--yzx-leading-relaxed)",
              }}
            >
              {result.explanation}
            </p>
          ) : null}

          <div style={{ display: "grid", gap: "var(--yzx-space-3)", marginTop: "var(--yzx-space-8)" }}>
            <YzxButton variant="secondary" onClick={() => router.push(`/tx/${result.hash}`)}>
              View transaction
            </YzxButton>
            <YzxButton
              variant="secondary"
              onClick={async () => {
                const text = `YOZEXA payment ${result.hash}`;
                if (navigator.share) {
                  await navigator.share({ title: "YOZEXA receipt", text }).catch(() => undefined);
                } else {
                  await navigator.clipboard.writeText(text).catch(() => undefined);
                }
              }}
            >
              Share receipt
            </YzxButton>
            <YzxButton onClick={() => router.push("/")}>Done</YzxButton>
          </div>
        </div>
      </>
    );
  }

  /* ─────────────────────────── REVIEW ─────────────────────────── */
  if (stage === "review" || stage === "sending") {
    const confusable = recents.some((r) => resolved && looksConfusable(r, resolved));
    const total =
      simulation && baseUnits !== null ? baseUnits + BigInt(simulation.estimated_fee) : null;

    return (
      <>
        <YzxNavigationBar title="Review payment" back={() => setStage("compose")} />

        {error ? <ErrorNote error={error} showTechnical={showTechnical} onToggle={setShowTechnical} /> : null}

        {confusable ? (
          <YzxAlert tone="danger" title="This address looks like one you've paid before — but isn't.">
            That is how address-poisoning attacks work. Check every character of the destination
            before you continue.
          </YzxAlert>
        ) : null}

        {simulation?.warnings?.map((warning, i) => (
          <YzxAlert key={i} tone="warning">
            {warning}
          </YzxAlert>
        ))}

        {/* What the node says will happen, in its own words. */}
        {simulation?.effects.map((effect, i) => (
          <div
            key={i}
            style={{
              borderLeft: "3px solid var(--yzx-brand)",
              background: "var(--yzx-surface)",
              borderRadius: "0 var(--yzx-radius-md) var(--yzx-radius-md) 0",
              padding: "var(--yzx-space-3) var(--yzx-space-4)",
              marginBottom: "var(--yzx-space-3)",
              fontSize: "var(--yzx-text-base)",
            }}
          >
            {effect.description}
          </div>
        ))}

        <YzxCard style={{ marginTop: "var(--yzx-space-4)" }}>
          <YzxDetailRow
            label="You send"
            value={`${renderAmount(baseUnits ?? 0n, unit)} ${unit}`}
            sub={`${formatYZXA(baseUnits ?? 0n)} YZXA`}
            emphasis
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--yzx-space-3) 0", borderBottom: "1px solid var(--yzx-border)" }}>
            <span style={{ fontSize: "var(--yzx-text-sm)", color: "var(--yzx-text-secondary)" }}>To</span>
            <span style={{ display: "flex", alignItems: "center", gap: "var(--yzx-space-2)", minWidth: 0 }}>
              <YzxAvatar seed={resolved ?? ""} label={recipient} size={26} />
              <span style={{ textAlign: "right", minWidth: 0 }}>
                {recipient !== resolved ? (
                  <span style={{ display: "block", fontWeight: "var(--yzx-weight-medium)" }}>{recipient}</span>
                ) : null}
                <span
                  className="yzx-mono"
                  style={{ display: "block", fontSize: "var(--yzx-text-2xs)", color: "var(--yzx-text-tertiary)", wordBreak: "break-all" }}
                >
                  {resolved}
                </span>
              </span>
            </span>
          </div>
          <YzxDetailRow
            label="Network fee"
            value={`${simulation?.estimated_fee_yzxa ?? "—"} YZXA`}
            sub={tier}
          />
          {memo ? <YzxDetailRow label="Memo" value={memo} /> : null}
          <YzxDetailRow
            label="Total"
            value={total !== null ? `${formatYZXA(total)} YZXA` : "—"}
            emphasis
          />
        </YzxCard>

        <div style={{ marginTop: "var(--yzx-space-6)", display: "grid", gap: "var(--yzx-space-3)" }}>
          <YzxButton onClick={() => void send()} busy={stage === "sending"} disabled={stage === "sending"}>
            {stage === "sending" ? "Sending…" : "Send now"}
          </YzxButton>
          <YzxButton variant="ghost" onClick={() => setStage("compose")} disabled={stage === "sending"}>
            Back
          </YzxButton>
        </div>

        <p
          style={{
            marginTop: "var(--yzx-space-5)",
            textAlign: "center",
            fontSize: "var(--yzx-text-2xs)",
            color: "var(--yzx-text-tertiary)",
            lineHeight: "var(--yzx-leading-relaxed)",
          }}
        >
          A YOZEXA payment cannot be reversed once it is in a committed block. Check the
          destination.
        </p>
      </>
    );
  }

  /* ─────────────────────────── COMPOSE ─────────────────────────── */
  return (
    <>
      <YzxNavigationBar title="Send" back="/" />

      {prefilled ? (
        <YzxAlert tone="info" title="Filled in from a payment request">
          Someone asked you for this. Check the destination and the amount — nothing is sent
          until you confirm it yourself.
        </YzxAlert>
      ) : null}

      {error ? <ErrorNote error={error} showTechnical={showTechnical} onToggle={setShowTechnical} /> : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void review();
        }}
      >
        <div style={{ marginBottom: "var(--yzx-space-5)" }}>
          <YzxAmountInput
            value={amount}
            unit={unit}
            onValueChange={setAmount}
            onUnitChange={setUnit}
            onValidChange={setBaseUnits}
            autoFocus
            {...(spendable !== undefined ? { max: spendable } : {})}
          />
        </div>

        <label
          htmlFor="recipient"
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
          To
        </label>
        <input
          id="recipient"
          className="yzx-mono"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          placeholder="yzx1… or maria.yzx"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={{
            width: "100%",
            padding: "var(--yzx-space-4)",
            background: "var(--yzx-surface)",
            border: "1px solid var(--yzx-border)",
            borderRadius: "var(--yzx-radius-lg)",
            color: "var(--yzx-text)",
            fontSize: "var(--yzx-text-base)",
          }}
        />

        {recents.length > 0 ? (
          <div style={{ display: "flex", gap: "var(--yzx-space-2)", marginTop: "var(--yzx-space-3)", flexWrap: "wrap" }}>
            {recents.slice(0, 3).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRecipient(r)}
                className="yzx-mono"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--yzx-space-2)",
                  background: "var(--yzx-surface-raised)",
                  border: "1px solid var(--yzx-border)",
                  borderRadius: "var(--yzx-radius-full)",
                  padding: "var(--yzx-space-1) var(--yzx-space-3)",
                  color: "var(--yzx-text-secondary)",
                  fontSize: "var(--yzx-text-2xs)",
                  cursor: "pointer",
                }}
              >
                <YzxAvatar seed={r} size={18} />
                {shortenAddress(r, 8, 5)}
              </button>
            ))}
          </div>
        ) : null}

        <label
          htmlFor="memo"
          style={{
            display: "block",
            fontSize: "var(--yzx-text-xs)",
            fontWeight: "var(--yzx-weight-semibold)",
            letterSpacing: "var(--yzx-tracking-wide)",
            textTransform: "uppercase",
            color: "var(--yzx-text-tertiary)",
            margin: "var(--yzx-space-5) 0 var(--yzx-space-2)",
          }}
        >
          Memo (optional)
        </label>
        <input
          id="memo"
          value={memo}
          maxLength={512}
          onChange={(event) => setMemo(event.target.value)}
          placeholder="Order 1042"
          style={{
            width: "100%",
            padding: "var(--yzx-space-4)",
            background: "var(--yzx-surface)",
            border: "1px solid var(--yzx-border)",
            borderRadius: "var(--yzx-radius-lg)",
            color: "var(--yzx-text)",
            fontSize: "var(--yzx-text-base)",
          }}
        />
        <p style={{ margin: "var(--yzx-space-2) 0 0", fontSize: "var(--yzx-text-xs)", color: "var(--yzx-text-tertiary)" }}>
          Public and permanent. Never put a name, a document number or a phone number here.
        </p>

        <button
          type="button"
          onClick={() => setFeeSheet(true)}
          style={{
            display: "flex",
            width: "100%",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "var(--yzx-space-5)",
            padding: "var(--yzx-space-4)",
            background: "var(--yzx-surface)",
            border: "1px solid var(--yzx-border)",
            borderRadius: "var(--yzx-radius-lg)",
            cursor: "pointer",
            color: "var(--yzx-text)",
            fontSize: "var(--yzx-text-base)",
          }}
        >
          <span style={{ color: "var(--yzx-text-secondary)" }}>Network fee</span>
          <span style={{ textTransform: "capitalize", fontWeight: "var(--yzx-weight-medium)" }}>
            {tier} ›
          </span>
        </button>

        <div style={{ marginTop: "var(--yzx-space-6)" }}>
          <YzxButton
            type="submit"
            busy={busy}
            disabled={busy || baseUnits === null || recipient.trim() === ""}
          >
            {busy ? "Checking…" : "Continue"}
          </YzxButton>
        </div>
      </form>

      <YzxSheet open={feeSheet} onClose={() => setFeeSheet(false)} title="Network fee">
        <p style={{ marginTop: 0, fontSize: "var(--yzx-text-sm)", color: "var(--yzx-text-secondary)" }}>
          The fee goes to the validators securing the network. YOZEXA Labs takes nothing from a
          payment between people.
        </p>
        <div style={{ display: "grid", gap: "var(--yzx-space-2)" }}>
          {tiers.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => {
                setTier(t.name);
                setFeeSheet(false);
              }}
              aria-pressed={tier === t.name}
              style={{
                textAlign: "left",
                padding: "var(--yzx-space-4)",
                background: tier === t.name ? "var(--yzx-brand-wash)" : "var(--yzx-surface-raised)",
                border: `1px solid ${tier === t.name ? "var(--yzx-brand)" : "var(--yzx-border)"}`,
                borderRadius: "var(--yzx-radius-lg)",
                cursor: "pointer",
                color: "var(--yzx-text)",
              }}
            >
              <span
                style={{
                  display: "block",
                  fontWeight: "var(--yzx-weight-semibold)",
                  textTransform: "capitalize",
                  marginBottom: "2px",
                }}
              >
                {t.name}
                {tier === t.name ? " ✓" : ""}
              </span>
              <span style={{ display: "block", fontSize: "var(--yzx-text-xs)", color: "var(--yzx-text-secondary)" }}>
                {t.description}
              </span>
            </button>
          ))}
        </div>
      </YzxSheet>
    </>
  );
}

function ErrorNote({
  error,
  showTechnical,
  onToggle,
}: {
  error: HumanError;
  showTechnical: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <YzxAlert tone="danger" title={error.message}>
      {error.action}
      <div style={{ marginTop: "var(--yzx-space-2)" }}>
        <button
          type="button"
          onClick={() => onToggle(!showTechnical)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--yzx-text-tertiary)",
            fontSize: "var(--yzx-text-2xs)",
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          {showTechnical ? "Hide" : "Developer details"}
        </button>
        {showTechnical ? (
          <pre
            className="yzx-mono"
            style={{
              marginTop: "var(--yzx-space-2)",
              padding: "var(--yzx-space-2)",
              background: "var(--yzx-surface-sunken)",
              borderRadius: "var(--yzx-radius-sm)",
              fontSize: "var(--yzx-text-2xs)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "var(--yzx-text-tertiary)",
            }}
          >
            {error.technical}
          </pre>
        ) : null}
      </div>
    </YzxAlert>
  );
}

/** A single confident stroke. No confetti — this is money, not a game. */
function SuccessMark({ failed }: { failed: boolean }) {
  const color = failed ? "var(--yzx-negative)" : "var(--yzx-positive)";
  return (
    <div style={{ position: "relative", width: 96, height: 96, margin: "0 auto" }}>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "var(--yzx-radius-full)",
          border: `2px solid ${color}`,
          opacity: 0.35,
          animation: "yzx-ring 1.1s var(--yzx-ease-out) both",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "var(--yzx-radius-full)",
          border: `2px solid ${color}`,
          display: "grid",
          placeItems: "center",
          background: failed ? "var(--yzx-negative-wash)" : "var(--yzx-positive-wash)",
        }}
      >
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" role="img" aria-label={failed ? "Failed" : "Sent"}>
          {failed ? (
            <path d="M13 13l14 14M27 13L13 27" stroke={color} strokeWidth="3.2" strokeLinecap="round" />
          ) : (
            <path
              d="M11 20.5 17.5 27 29 14"
              stroke={color}
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="48"
              style={{ animation: "yzx-check var(--yzx-duration-slow) var(--yzx-ease-out) 120ms both" }}
            />
          )}
        </svg>
      </div>
    </div>
  );
}
