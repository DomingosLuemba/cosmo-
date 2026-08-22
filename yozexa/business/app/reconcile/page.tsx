import { redirect } from "next/navigation";
import { formatYZXA } from "@yozexa/sdk";

import { formatFiat, isConnected, pay, type LedgerRow } from "@/lib/pay";

export const dynamic = "force-dynamic";

/**
 * Reconciliation.
 *
 * A merchant needs to tie every settlement to an on-chain transaction and to
 * their own records. This view exists so that is possible without exporting to
 * a spreadsheet and hoping.
 */
export default async function ReconcilePage() {
  if (!(await isConnected())) redirect("/connect");

  let rows: LedgerRow[] = [];
  let error: string | null = null;
  try {
    rows = (await pay.transactions(200)).transactions;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const settled = rows.filter((r) => r.status === "confirmed" || r.status === "finalized");
  const total = settled.reduce((acc, r) => acc + BigInt(r.received_amount ?? "0"), 0n);
  const unmatched = rows.filter((r) => r.status === "created" || r.status === "pending");

  const csv = [
    "payment_id,status,expected_amount,received_amount,tx_hash,from_address,block_height,confirmed_at,reference,fiat_amount_cents,fiat_currency,invoice_id,created_at",
    ...rows.map((r) =>
      [
        r.id,
        r.status,
        r.expected_amount,
        r.received_amount ?? "",
        r.tx_hash ?? "",
        r.from_address ?? "",
        r.block_height ?? "",
        r.confirmed_at ?? "",
        (r.reference ?? "").replace(/[",\n]/g, " "),
        r.fiat_amount_cents ?? "",
        r.fiat_currency ?? "",
        r.invoice_id ?? "",
        r.created_at,
      ].join(","),
    ),
  ].join("\n");

  return (
    <>
      <h1>Reconciliation</h1>
      <p className="subtitle">
        Every payment, what settled it on chain, and what is still outstanding.
      </p>

      {error ? <div className="notice">{error}</div> : null}

      <div className="grid cols-3">
        <div className="card">
          <div className="label">Settled payments</div>
          <div className="value">{settled.length}</div>
        </div>
        <div className="card">
          <div className="label">Total received</div>
          <div className="value mono">{formatYZXA(total)}</div>
        </div>
        <div className="card">
          <div className="label">Still outstanding</div>
          <div className="value">{unmatched.length}</div>
          <div className="hint">created or pending, not yet settled</div>
        </div>
      </div>

      <h2>Ledger</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Payment</th>
              <th>Status</th>
              <th className="num">Received</th>
              <th>Transaction</th>
              <th className="num">Block</th>
              <th>Payer</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono" style={{ fontSize: 11 }}>{r.id}</td>
                <td>{r.status}</td>
                <td className="num mono">
                  {r.received_amount ? formatYZXA(BigInt(r.received_amount)) : "—"}
                  {r.fiat_amount_cents ? (
                    <div className="dim" style={{ fontSize: 11 }}>
                      {formatFiat(r.fiat_amount_cents, r.fiat_currency)}
                    </div>
                  ) : null}
                </td>
                <td className="mono dim trunc" style={{ maxWidth: 150, fontSize: 11 }}>
                  {r.tx_hash ?? "—"}
                </td>
                <td className="num dim">{r.block_height ?? "—"}</td>
                <td className="mono dim trunc" style={{ maxWidth: 130, fontSize: 11 }}>
                  {r.from_address ?? "—"}
                </td>
                <td className="dim">{r.reference ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Export</h2>
      <div className="card">
        <p className="dim" style={{ fontSize: 13, marginTop: 0 }}>
          Copy this into your accounting system. Every settled row carries the transaction hash and
          block height, so any figure here can be checked against the chain itself.
        </p>
        <pre
          className="mono"
          style={{
            background: "var(--bg-inset)",
            padding: 14,
            borderRadius: 8,
            overflowX: "auto",
            fontSize: 11,
            maxHeight: 260,
            margin: 0,
          }}
        >
          {csv}
        </pre>
      </div>
    </>
  );
}
