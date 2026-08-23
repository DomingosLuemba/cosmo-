import { redirect } from "next/navigation";
import { formatYZXA } from "@yozexa/sdk";

import { StatusPill } from "@/components/status-pill";
import { formatFiat, isConnected, pay, type PaymentView } from "@/lib/pay";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  if (!(await isConnected())) redirect("/connect");

  let balances;
  let payments: PaymentView[] = [];
  let error: string | null = null;
  try {
    const [b, p] = await Promise.all([pay.balances(), pay.payments("?limit=10")]);
    balances = b;
    payments = p.payments;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error || !balances) {
    return (
      <>
        <h1>Overview</h1>
        <div className="notice">
          <strong>Cannot reach YOZEXA Pay.</strong>
          <p style={{ margin: "8px 0 0" }}>{error}</p>
        </div>
      </>
    );
  }

  const settled = BigInt(balances.settled_total);
  const refunded = BigInt(balances.refunded_total);
  const net = BigInt(balances.net_settled);
  const onChain = balances.on_chain_balance ? BigInt(balances.on_chain_balance) : null;

  const counts = balances.by_status;
  const outstanding = (counts.created?.count ?? 0) + (counts.pending?.count ?? 0);

  return (
    <>
      <h1>Overview</h1>
      <p className="subtitle">Settlement and payment activity for this merchant account.</p>

      <div className="grid cols-4">
        <div className="card">
          <div className="label">Settled</div>
          <div className="value mono">{formatYZXA(settled)}</div>
          <div className="hint">YZXA received across confirmed payments</div>
        </div>
        <div className="card">
          <div className="label">Refunded</div>
          <div className="value mono">{formatYZXA(refunded)}</div>
          <div className="hint">returned to customers</div>
        </div>
        <div className="card">
          <div className="label">Net settled</div>
          <div className="value mono">{formatYZXA(net)}</div>
          <div className="hint">settled minus refunded</div>
        </div>
        <div className="card">
          <div className="label">Awaiting payment</div>
          <div className="value">{outstanding}</div>
          <div className="hint">payments created or pending</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="label">On-chain balance of your settlement address</div>
        <div className="value mono">{onChain === null ? "unavailable" : formatYZXA(onChain)}</div>
        <div className="hint">{balances.note}</div>
      </div>

      <h2>Recent payments</h2>
      {payments.length === 0 ? (
        <div className="notice info">
          No payments yet. Create a payment link or an invoice to get one.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Payment</th>
                <th>Status</th>
                <th className="num">Expected</th>
                <th className="num">Received</th>
                <th>Reference</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={`/payments?id=${p.id}`} className="mono" style={{ fontSize: 12 }}>
                      {p.id}
                    </a>
                    {p.description ? <div className="dim" style={{ fontSize: 12 }}>{p.description}</div> : null}
                  </td>
                  <td>
                    <StatusPill status={p.status} />
                  </td>
                  <td className="num mono">
                    {p.expected_amount_yzxa}
                    {p.fiat_amount_cents ? (
                      <div className="dim" style={{ fontSize: 11 }}>
                        {formatFiat(p.fiat_amount_cents, p.fiat_currency)}
                      </div>
                    ) : null}
                  </td>
                  <td className="num mono">{p.received_amount_yzxa ?? "—"}</td>
                  <td className="dim">{p.reference ?? "—"}</td>
                  <td className="dim" style={{ fontSize: 12 }}>
                    {p.created_at.slice(0, 16).replace("T", " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
