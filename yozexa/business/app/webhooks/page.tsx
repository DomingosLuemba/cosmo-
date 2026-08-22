import { redirect } from "next/navigation";

import { isConnected, pay, type WebhookEndpoint } from "@/lib/pay";

export const dynamic = "force-dynamic";

const EVENTS = [
  "payment.created",
  "payment.pending",
  "payment.confirmed",
  "payment.finalized",
  "payment.failed",
  "payment.refunded",
  "invoice.paid",
  "subscription.charged",
];

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; secret?: string }>;
}) {
  if (!(await isConnected())) redirect("/connect");
  const params = await searchParams;

  let endpoints: WebhookEndpoint[] = [];
  let error: string | null = params.error ?? null;
  try {
    endpoints = (await pay.webhooks()).webhooks;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  async function create(formData: FormData) {
    "use server";
    try {
      const events = EVENTS.filter((e) => formData.get(e) === "on");
      const result = (await pay.createWebhook({
        url: String(formData.get("url") ?? "").trim(),
        events,
      })) as { secret: string };
      redirect("/webhooks?secret=" + encodeURIComponent(result.secret));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NEXT_REDIRECT")) throw err;
      redirect("/webhooks?error=" + encodeURIComponent(message));
    }
  }

  return (
    <>
      <h1>Webhooks</h1>
      <p className="subtitle">
        Signed notifications when a payment changes state.
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {params.secret ? (
        <div className="notice info">
          <strong>Signing secret — shown once.</strong>
          <p className="mono break" style={{ margin: "8px 0" }}>{params.secret}</p>
          <p style={{ margin: 0 }}>
            Store it now. It cannot be retrieved again, only rotated. Your endpoint must use it to
            verify every delivery before trusting the body.
          </p>
        </div>
      ) : null}

      {endpoints.length > 0 ? (
        <div className="table-wrap" style={{ marginBottom: 24 }}>
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Events</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((e) => (
                <tr key={e.id}>
                  <td className="mono" style={{ fontSize: 12 }}>{e.url}</td>
                  <td className="dim" style={{ fontSize: 12 }}>{e.events.join(", ")}</td>
                  <td>
                    <span className={`pill ${e.active ? "ok" : "dim"}`}>
                      {e.active ? "active" : "disabled"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <form action={create}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Add an endpoint</h2>
          <label htmlFor="url" style={{ fontSize: 13, color: "var(--text-dim)" }}>
            URL (https, or localhost for development)
          </label>
          <input
            id="url"
            name="url"
            required
            placeholder="https://example.com/yozexa/webhooks"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-inset)",
              color: "var(--text)",
              fontSize: 14,
              margin: "6px 0 16px",
            }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px,1fr))", gap: 8 }}>
            {EVENTS.map((event) => (
              <label key={event} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  name={event}
                  defaultChecked={event === "payment.confirmed" || event === "invoice.paid"}
                  style={{ width: "auto" }}
                />
                <span className="mono" style={{ fontSize: 12 }}>{event}</span>
              </label>
            ))}
          </div>
          <button
            type="submit"
            style={{
              marginTop: 16,
              padding: "11px 24px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent)",
              color: "var(--bg)",
              fontWeight: 650,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Add endpoint
          </button>
        </div>
      </form>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Verify every delivery</h2>
        <p className="dim" style={{ fontSize: 13 }}>
          A webhook that is not verified is a message anyone on the internet can send you. Check
          the signature and the timestamp <strong>before</strong> parsing the body, and make your
          handler idempotent — a delivery that timed out after you processed it will be retried.
        </p>
        <pre
          className="mono"
          style={{
            background: "var(--bg-inset)",
            padding: 14,
            borderRadius: 8,
            overflowX: "auto",
            fontSize: 12,
            margin: 0,
          }}
        >
{`import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, body, header, toleranceSeconds = 300) {
  const parts = new Map(header.split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.get("t"));
  const provided = parts.get("v1");
  if (!Number.isFinite(t) || !provided) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(\`\${t}.\${body}\`, "utf8")
    .digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}`}
        </pre>
      </div>
    </>
  );
}
