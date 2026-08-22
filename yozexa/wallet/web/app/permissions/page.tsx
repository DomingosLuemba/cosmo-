"use client";

import { useCallback, useEffect, useState } from "react";
import { formatYZXA, messages, parseAmount, signTransaction } from "@yozexa/sdk";

import { UnlockGate } from "@/components/unlock-gate";
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
  const [error, setError] = useState<string | null>(null);
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      <h1>Spending permissions</h1>
      <p className="subtitle">
        Let an app, a device or an agent spend a bounded amount on your behalf.
      </p>

      {error ? <div className="alert danger">{error}</div> : null}
      {notice ? <div className="alert ok">{notice}</div> : null}

      {grants.length === 0 ? (
        <div className="card">
          <p className="dim" style={{ margin: 0 }}>
            No permissions issued. Nothing can spend from this account except you.
          </p>
        </div>
      ) : (
        <div className="list" style={{ marginBottom: 18 }}>
          {grants.map((g) => {
            const total = BigInt(g.total);
            const spent = BigInt(g.spent_total);
            const remaining = total - spent;
            const expired = g.expires_at_unix * 1000 < Date.now();
            return (
              <div className="list-item" key={g.grantee} style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div className="title mono" style={{ fontSize: 12 }}>
                    {g.grantee.slice(0, 16)}…{g.grantee.slice(-6)}
                  </div>
                  <div className="meta">
                    {formatYZXA(remaining)} of {formatYZXA(total)} YZXA left
                    {g.period_seconds > 0
                      ? ` · up to ${formatYZXA(BigInt(g.per_period))} per ${Math.round(g.period_seconds / 3600)}h`
                      : ""}
                  </div>
                  <div className="meta">
                    {g.allowed_recipients?.length
                      ? `only to ${g.allowed_recipients.length} named address${g.allowed_recipients.length === 1 ? "" : "es"}`
                      : "any recipient"}
                    {" · "}
                    {expired ? (
                      <span style={{ color: "var(--text-dim)" }}>expired</span>
                    ) : (
                      `expires ${new Date(g.expires_at_unix * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`
                    )}
                  </div>
                  <button
                    className="ghost"
                    disabled={busy}
                    style={{ color: "var(--danger)" }}
                    onClick={() => void revoke(g)}
                  >
                    Revoke now
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!showForm ? (
        <button className="primary" onClick={() => setShowForm(true)}>
          Grant a permission
        </button>
      ) : (
        <form onSubmit={create}>
          <div className="card">
            <h2>New permission</h2>
            <div className="field">
              <label htmlFor="grantee">Who may spend</label>
              <input
                id="grantee"
                className="mono"
                value={grantee}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(e) => setGrantee(e.target.value)}
                placeholder="yzx1… or an alias"
              />
            </div>
            <div className="field">
              <label htmlFor="total">Total limit (YZXA)</label>
              <input
                id="total"
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                placeholder="20"
              />
              <div className="hint">Required. There is no unlimited option on this network.</div>
            </div>
            <div className="field">
              <label htmlFor="perPeriod">Limit per period (optional)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="perPeriod"
                  inputMode="decimal"
                  value={perPeriod}
                  onChange={(e) => setPerPeriod(e.target.value)}
                  placeholder="5"
                />
                <input
                  inputMode="numeric"
                  value={periodHours}
                  onChange={(e) => setPeriodHours(e.target.value)}
                  style={{ width: 110 }}
                  aria-label="Period in hours"
                />
              </div>
              <div className="hint">Amount, and the number of hours the window covers.</div>
            </div>
            <div className="field">
              <label htmlFor="approval">Ask me above (optional)</label>
              <input
                id="approval"
                inputMode="decimal"
                value={approvalAbove}
                onChange={(e) => setApprovalAbove(e.target.value)}
                placeholder="2"
              />
              <div className="hint">
                Single payments above this are refused by the chain and need your signature.
              </div>
            </div>
            <div className="field">
              <label htmlFor="recipients">Only these recipients (optional)</label>
              <textarea
                id="recipients"
                className="mono"
                rows={2}
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                placeholder="yzx1… yzx1…"
              />
              <div className="hint">
                Leave blank to allow any recipient. Naming them is stronger.
              </div>
            </div>
            <div className="field">
              <label htmlFor="expiry">Expires in (hours)</label>
              <input
                id="expiry"
                inputMode="numeric"
                value={expiryHours}
                onChange={(e) => setExpiryHours(e.target.value)}
              />
              <div className="hint">Required, and at most one year.</div>
            </div>
            <button className="primary" type="submit" disabled={busy || !grantee || !total}>
              {busy ? "Granting…" : "Grant permission"}
            </button>
            <button className="secondary" type="button" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <h2>What a permission can and cannot do</h2>
        <p className="dim" style={{ fontSize: 13 }}>
          The chain enforces every limit, so the holder cannot exceed the total, the rate, the
          recipient list or the expiry — whatever software it runs. It can never vote with your
          stake, create a validator, give away your YOZEXA ID, or issue permissions of its own.
        </p>
        <p className="dim" style={{ fontSize: 13, marginBottom: 0 }}>
          This is how subscriptions, device session keys and AI agent wallets work here: the agent
          holds a key that is structurally incapable of draining your account, and never holds your
          main key.
        </p>
      </div>
    </>
  );
}
