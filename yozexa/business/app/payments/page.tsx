import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { formatFiat, isConnected, pay, type PaymentView } from "@/lib/pay";
import { StatusPill } from "@/components/status-pill";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; ok?: string }>;
}) {
  if (!(await isConnected())) redirect("/connect");
  const params = await searchParams;

  let payments: PaymentView[] = [];
  let error: string | null = params.error ?? null;
  try {
    const query = params.status ? `?status=${encodeURIComponent(params.status)}&limit=50` : "?limit=50";
    payments = (await pay.payments(query)).payments;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  async function refund(formData: FormData) {
    "use server";
    const paymentId = String(formData.get("payment_id") ?? "");
    const reason = String(formData.get("reason") ?? "");
    try {
      await pay.createRefund({ payment_id: paymentId, ...(reason ? { reason } : {}) });
      revalidatePath("/payments");
      redirect("/payments?ok=" + encodeURIComponent("Refund recorded."));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NEXT_REDIRECT")) throw err;
      redirect("/payments?error=" + encodeURIComponent(message));
    }
  }

  return (
    <>
      <h1>Payments</h1>
      <p className="subtitle">
        Every payment intent and what actually settled against it on chain.
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {params.ok ? <div className="notice info">{params.ok}</div> : null}

      <p style={{ marginBottom: 18 }}>
        {["", "created", "pending", "confirmed", "refunded", "expired"].map((s) => (
          <a
            key={s || "all"}
            href={s ? `/payments?status=${s}` : "/payments"}
            style={{
              marginRight: 14,
              fontWeight: params.status === s || (!params.status && !s) ? 700 : 400,
            }}
          >
            {s || "all"}
          </a>
        ))}
      </p>

      {payments.length === 0 ? (
        <div className="notice info">No payments match this filter.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Payment</th>
                <th>Status</th>
                <th className="num">Expected</th>
                <th className="num">Received</th>
                <th>Settled by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="mono" style={{ fontSize: 12 }}>{p.id}</span>
                    {p.description ? (
                      <div className="dim" style={{ fontSize: 12 }}>{p.description}</div>
                    ) : null}
                    {p.reference ? (
                      <div className="dim" style={{ fontSize: 11 }}>ref {p.reference}</div>
                    ) : null}
                  </td>
                  <td><StatusPill status={p.status} /></td>
                  <td className="num mono">
                    {p.expected_amount_yzxa}
                    {p.fiat_amount_cents ? (
                      <div className="dim" style={{ fontSize: 11 }}>
                        {formatFiat(p.fiat_amount_cents, p.fiat_currency)}
                      </div>
                    ) : null}
                  </td>
                  <td className="num mono">{p.received_amount_yzxa ?? "—"}</td>
                  <td>
                    {p.tx_hash ? (
                      <span className="mono dim trunc" style={{ maxWidth: 160, fontSize: 11 }}>
                        {p.tx_hash}
                      </span>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td>
                    {p.status === "confirmed" || p.status === "finalized" ? (
                      <form action={refund}>
                        <input type="hidden" name="payment_id" value={p.id} />
                        <input
                          name="reason"
                          placeholder="reason"
                          style={{
                            width: 110,
                            padding: "5px 8px",
                            fontSize: 12,
                            borderRadius: 6,
                            border: "1px solid var(--border)",
                            background: "var(--bg-inset)",
                            color: "var(--text)",
                            marginRight: 6,
                          }}
                        />
                        <button
                          type="submit"
                          style={{
                            padding: "5px 12px",
                            fontSize: 12,
                            borderRadius: 6,
                            border: "1px solid var(--border)",
                            background: "transparent",
                            color: "var(--text)",
                            cursor: "pointer",
                          }}
                        >
                          Refund
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="notice info" style={{ marginTop: 20 }}>
        <strong>A refund is a new payment, not a reversal.</strong> A settled payment on a BFT
        chain cannot be undone. Recording a refund here creates the obligation and links it to the
        original so reconciliation stays honest; your wallet or treasury service makes the actual
        transfer and reports the transaction hash back.
      </div>
    </>
  );
}
