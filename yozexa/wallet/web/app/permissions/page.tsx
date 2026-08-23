"use client";

import { useCallback, useEffect, useState } from "react";
import { formatYZXA, messages, parseAmount, signTransaction } from "@yozexa/sdk";

import { UnlockGate } from "@/components/unlock-gate";
import { YzxButton } from "@/components/yzx/button";
import { YzxCard, YzxSectionHeader } from "@/components/yzx/card";
import { YzxAlert, YzxAvatar, YzxNavigationBar } from "@/components/yzx/primitives";
import { humanize, type HumanError } from "@/lib/errors";
import { client } from "@/lib/node";
import { currentAddress, withKey } from "@/lib/session";

interface Grant {
  granter: string;
  grantee: string;
  total: string;
  per_period: string;
  period_seconds: number;
  spent_total: string;
  spent_this_period: string;
  expires_at_unix: number;
  allowed_msg_types: string[];
  allowed_recipients?: string[];
  require_approval_above?: string;
}

export default function PermissionsPage() {
  return (
    <UnlockGate>
      <Permissions />
    </UnlockGate>
  );
}

function Permissions() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState<HumanError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [grantee, setGrantee] = useState("");
  const [total, setTotal] = useState("");
  const [perPeriod, setPerPeriod] = useState("");
  const [periodHours, setPeriodHours] = useState("24");
  const [expiryHours, setExpiryHours] = useState("24");
  const [approvalAbove, setApprovalAbove] = useState("");
  const [recipients, setRecipients] = useState("");

  const load = useCallback(async () => {
    const address = currentAddress();
    if (!address) return;
    try {
      const { grants: list } = await client().grants(address);
      setGrants((list ?? []) as unknown as Grant[]);
    } catch (err) {
      setError(humanize(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(msg: ReturnType<typeof messages.grant>, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const from = currentAddress();
      if (!from) throw new Error("The wallet is locked.");
      const api = client();
      const [status, account, feeMarket] = await Promise.all([
        api.status(),
        api.account(from),
        api.feeMarket(),
      ]);
      const price = feeMarket.tiers.find((t) => t.name === "normal");
      if (!price) throw new Error("The node did not offer a fee tier.");

      const tx = withKey((key) =>
        signTransaction(
          {
            chainId: status.chain_id,
            msgs: [msg],
            sequence: account.sequence,
            fee: { gasLimit: 300_000, gasPrice: BigInt(price.gas_price) },
          },
          key,
        ),
      );
      const result = await api.broadcast(tx, "commit");
      if (result.status === "failed") throw new Error(result.log || "The transaction failed.");
      setNotice(successMessage);
      await load();
    } catch (err) {
      setError(humanize(err));
    } finally {
      setBusy(false);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const from = currentAddress();
    if (!from) return;
    try {
      const api = client();
      const granteeAddress = await api.resolveRecipient(grantee.trim());
      const allowed: string[] = [];
      for (const raw of recipients.split(/[\s,]+/).filter(Boolean)) {
        allowed.push(await api.resolveRecipient(raw));
      }
      const periodSeconds = Number(periodHours) * 3600;
      const msg = messages.grant(
        from,
        granteeAddress,
        {
          total: parseAmount(total, "YZXA"),
          ...(perPeriod.trim()
            ? { perPeriod: parseAmount(perPeriod, "YZXA"), periodSeconds }
            : {}),
        },
        new Date(Date.now() + Number(expiryHours) * 3600 * 1000),
        {
          ...(allowed.length > 0 ? { allowedRecipients: allowed } : {}),
          ...(approvalAbove.trim()
            ? { requireApprovalAbove: parseAmount(approvalAbove, "YZXA") }
            : {}),
        },
      );
      await submit(msg, "Permission granted. You can revoke it at any time.");
      setShowForm(false);
      setGrantee("");
      setTotal("");
      setPerPeriod("");
      setApprovalAbove("");
      setRecipients("");
    } catch (err) {
      setError(humanize(err));
    }
  }

  async function revoke(g: Grant) {
    const from = currentAddress();
    if (!from) return;
    await submit(
      messages.revoke(from, g.grantee) as ReturnType<typeof messages.grant>,
      "Permission revoked. It stopped working immediately.",
    );
  }

  return (
    <>
      <YzxNavigationBar title="Permissions" back="/profile" />

      <h1
        style={{
          margin: "0 0 var(--yzx-space-2)",
          fontSize: "var(--yzx-text-2xl)",
          letterSpacing: "var(--yzx-tracking-tight)",
        }}
      >
        Spending permissions
      </h1>
      <p style={intro}>
        Let an app, a device or an agent spend a bounded amount on your behalf. Every limit is
        enforced by the chain, not by the software you are trusting.
      </p>

      {error ? (
        <YzxAlert tone="danger" title={error.message}>
          {error.action}
        </YzxAlert>
      ) : null}
      {notice ? <YzxAlert tone="success" title={notice} /> : null}

      {grants.length === 0 ? (
        <YzxCard tone="sunken">
          <p style={{ margin: 0, color: "var(--yzx-text-secondary)", fontSize: "var(--yzx-text-sm)", lineHeight: "var(--yzx-leading-relaxed)" }}>
            No permissions issued. Nothing can spend from this account except you, holding this
            key, on this device.
          </p>
        </YzxCard>
      ) : (
        <>
          <YzxSectionHeader title="Issued" />
          <div style={{ display: "grid", gap: "var(--yzx-space-3)", marginBottom: "var(--yzx-space-5)" }}>
            {grants.map((g) => {
              const total = BigInt(g.total);
              const spent = BigInt(g.spent_total);
              const remaining = total - spent;
              const expired = g.expires_at_unix * 1000 < Date.now();
              const usedPercent = total > 0n ? Number((spent * 100n) / total) : 0;
              return (
                <YzxCard key={g.grantee}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--yzx-space-3)" }}>
                    <YzxAvatar seed={g.grantee} size={38} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p className="yzx-mono" style={{ margin: 0, fontSize: "var(--yzx-text-xs)", wordBreak: "break-all" }}>
                        {g.grantee.slice(0, 16)}…{g.grantee.slice(-6)}
                      </p>
                      <p style={{ margin: "2px 0 0", fontSize: "var(--yzx-text-2xs)", color: "var(--yzx-text-tertiary)" }}>
                        {expired ? "Expired — it can no longer spend" : "Active"}
                      </p>
                    </div>
                  </div>

                  <p style={{ margin: "var(--yzx-space-4) 0 var(--yzx-space-2)", fontSize: "var(--yzx-text-sm)" }}>
                    <span className="yzx-mono">{formatYZXA(remaining)}</span> of{" "}
                    <span className="yzx-mono">{formatYZXA(total)}</span> YZXA left
                  </p>
                  {/* The bar repeats what the numbers above already say, so a
                      reader who cannot see it loses nothing. */}
                  <div
                    aria-hidden="true"
                    style={{
                      height: "5px",
                      borderRadius: "var(--yzx-radius-full)",
                      background: "var(--yzx-surface-sunken)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(100, Math.max(0, usedPercent))}%`,
                        height: "100%",
                        background: expired ? "var(--yzx-text-tertiary)" : "var(--yzx-brand)",
                      }}
                    />
                  </div>

                  <dl style={{ margin: "var(--yzx-space-4) 0 0", display: "grid", gap: "var(--yzx-space-2)" }}>
                    <Fact
                      label="Rate"
                      value={
                        g.period_seconds > 0
                          ? `Up to ${formatYZXA(BigInt(g.per_period))} YZXA every ${Math.round(g.period_seconds / 3600)}h`
                          : "No separate rate limit"
                      }
                    />
                    <Fact
                      label="Recipients"
                      value={
                        g.allowed_recipients?.length
                          ? `Only ${g.allowed_recipients.length} named address${g.allowed_recipients.length === 1 ? "" : "es"}`
                          : "Any recipient"
                      }
                    />
                    <Fact
                      label="Expires"
                      value={
                        expired
                          ? "Already expired"
                          : `${new Date(g.expires_at_unix * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`
                      }
                    />
                  </dl>

                  <div style={{ marginTop: "var(--yzx-space-4)" }}>
                    <YzxButton variant="danger" size="md" disabled={busy} onClick={() => void revoke(g)}>
                      {busy ? "Revoking…" : "Revoke now"}
                    </YzxButton>
                  </div>
                </YzxCard>
              );
            })}
          </div>
        </>
      )}

      {!showForm ? (
        <YzxButton onClick={() => setShowForm(true)}>Grant a permission</YzxButton>
      ) : (
        <form onSubmit={create}>
          <YzxSectionHeader title="New permission" />
          <YzxCard>
            <Field
              id="grantee"
              label="Who may spend"
              hint="An address or a YOZEXA ID. Check it: this is who gets the budget."
            >
              <input
                id="grantee"
                className="yzx-mono"
                value={grantee}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setGrantee(e.target.value)}
                placeholder="yzx1… or maria.yzx"
                style={input}
              />
            </Field>

            <Field
              id="total"
              label="Total limit (YZXA)"
              hint="Required. There is no unlimited option on this network — the protocol cannot express one."
            >
              <input
                id="total"
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="20"
                style={input}
              />
            </Field>

            <Field
              id="perPeriod"
              label="Limit per period (optional)"
              hint="An amount, and how many hours the window covers. Caps how fast the budget can be drained."
            >
              <div style={{ display: "flex", gap: "var(--yzx-space-2)" }}>
                <input
                  id="perPeriod"
                  inputMode="decimal"
                  value={perPeriod}
                  onChange={(e) => setPerPeriod(e.target.value)}
                  placeholder="5"
                  style={{ ...input, flex: 1 }}
                />
                <input
                  inputMode="numeric"
                  value={periodHours}
                  onChange={(e) => setPeriodHours(e.target.value)}
                  style={{ ...input, width: "104px" }}
                  aria-label="Period in hours"
                />
              </div>
            </Field>

            <Field
              id="approval"
              label="Ask me above (optional)"
              hint="Single payments above this are refused by the chain and need your own signature."
            >
              <input
                id="approval"
                inputMode="decimal"
                value={approvalAbove}
                onChange={(e) => setApprovalAbove(e.target.value)}
                placeholder="2"
                style={input}
              />
            </Field>

            <Field
              id="recipients"
              label="Only these recipients (optional)"
              hint="Leave blank to allow any recipient. Naming them is stronger — the chain refuses everything else."
            >
              <textarea
                id="recipients"
                className="yzx-mono"
                rows={2}
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                placeholder="yzx1… yzx1…"
                style={{ ...input, resize: "vertical" }}
              />
            </Field>

            <Field id="expiry" label="Expires in (hours)" hint="Required, and at most one year.">
              <input
                id="expiry"
                inputMode="numeric"
                value={expiryHours}
                onChange={(e) => setExpiryHours(e.target.value)}
                style={input}
              />
            </Field>

            <div style={{ display: "grid", gap: "var(--yzx-space-3)", marginTop: "var(--yzx-space-5)" }}>
              <YzxButton type="submit" busy={busy} disabled={busy || !grantee || !total}>
                {busy ? "Granting…" : "Grant permission"}
              </YzxButton>
              <YzxButton variant="ghost" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </YzxButton>
            </div>
          </YzxCard>
        </form>
      )}

      <YzxSectionHeader title="What a permission can and cannot do" />
      <YzxCard tone="sunken">
        <p style={note}>
          The chain enforces every limit, so the holder cannot exceed the total, the rate, the
          recipient list or the expiry — whatever software it runs, and however it is compromised.
        </p>
        <p style={note}>
          It can never vote with your stake, create a validator, give away your YOZEXA ID, or issue
          permissions of its own.
        </p>
        <p style={{ ...note, marginBottom: 0 }}>
          This is how subscriptions, device session keys and agent wallets work here: the agent
          holds a key that is structurally incapable of draining your account, and never holds your
          main key.
        </p>
      </YzxCard>
    </>
  );
}

/** One labelled fact inside a grant card. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--yzx-space-4)" }}>
      <dt style={{ fontSize: "var(--yzx-text-xs)", color: "var(--yzx-text-tertiary)", flexShrink: 0 }}>
        {label}
      </dt>
      <dd style={{ margin: 0, fontSize: "var(--yzx-text-xs)", color: "var(--yzx-text-secondary)", textAlign: "right" }}>
        {value}
      </dd>
    </div>
  );
}

/** A labelled form field with its explanation attached, not floating nearby. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "var(--yzx-space-5)" }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      {children}
      <p
        style={{
          margin: "var(--yzx-space-2) 0 0",
          fontSize: "var(--yzx-text-2xs)",
          color: "var(--yzx-text-tertiary)",
          lineHeight: "var(--yzx-leading-relaxed)",
        }}
      >
        {hint}
      </p>
    </div>
  );
}

const intro: React.CSSProperties = {
  margin: "0 0 var(--yzx-space-5)",
  color: "var(--yzx-text-secondary)",
  fontSize: "var(--yzx-text-base)",
  lineHeight: "var(--yzx-leading-relaxed)",
};

const note: React.CSSProperties = {
  margin: "0 0 var(--yzx-space-3)",
  fontSize: "var(--yzx-text-sm)",
  color: "var(--yzx-text-secondary)",
  lineHeight: "var(--yzx-leading-relaxed)",
};

const labelStyle: React.CSSProperties = {
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
  fontSize: "var(--yzx-text-base)",
};
