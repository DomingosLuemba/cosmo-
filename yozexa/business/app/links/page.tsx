import { redirect } from "next/navigation";

import { isConnected, pay, PAY_API } from "@/lib/pay";

export const dynamic = "force-dynamic";

export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string; url?: string }>;
}) {
  if (!(await isConnected())) redirect("/connect");
  const params = await searchParams;

  async function create(formData: FormData) {
    "use server";
    const description = String(formData.get("description") ?? "").trim();
    const amount = String(formData.get("amount") ?? "").trim();
    const currency = String(formData.get("currency") ?? "").trim();
    const fiat = String(formData.get("fiat_amount") ?? "").trim();
    const maxUses = String(formData.get("max_uses") ?? "").trim();

    try {
      const body: Record<string, unknown> = { description };
      if (amount) body.amount = amount;
      if (fiat && currency) {
        body.fiat_amount = String(Math.round(Number(fiat) * 100));
        body.currency = currency;
      }
      if (maxUses) body.max_uses = Number(maxUses);
      const link = (await pay.createLink(body)) as { slug: string };
      redirect(`/links?created=1&url=${encodeURIComponent(`${PAY_API}/pay/${link.slug}`)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NEXT_REDIRECT")) throw err;
      redirect("/links?error=" + encodeURIComponent(message));
    }
  }

  return (
    <>
      <h1>Payment links</h1>
      <p className="subtitle">
        A link a customer can open and pay from any YOZEXA wallet.
      </p>

      {params.error ? <div className="notice">{params.error}</div> : null}
      {params.created && params.url ? (
        <div className="notice info">
          <strong>Link created.</strong>
          <p className="mono break" style={{ margin: "8px 0 0", fontSize: 13 }}>{params.url}</p>
        </div>
      ) : null}

      <form action={create}>
        <div className="card">
          <div className="grid cols-2">
            <div>
              <label htmlFor="description" style={{ fontSize: 13, color: "var(--text-dim)" }}>
                Description
              </label>
              <input id="description" name="description" required style={inputStyle} />
            </div>
            <div>
              <label htmlFor="max_uses" style={{ fontSize: 13, color: "var(--text-dim)" }}>
                Maximum uses (blank = unlimited)
              </label>
              <input id="max_uses" name="max_uses" inputMode="numeric" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="amount" style={{ fontSize: 13, color: "var(--text-dim)" }}>
                Amount in base units (ayzxa)
              </label>
              <input id="amount" name="amount" inputMode="numeric" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="fiat_amount" style={{ fontSize: 13, color: "var(--text-dim)" }}>
                …or a fiat amount
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input id="fiat_amount" name="fiat_amount" inputMode="decimal" style={inputStyle} />
                <input name="currency" placeholder="EUR" style={{ ...inputStyle, width: 90 }} />
              </div>
            </div>
          </div>
          <button type="submit" style={buttonStyle}>Create link</button>
        </div>
      </form>

      <div className="notice info">
        <strong>Pricing in fiat needs a price source.</strong> If none is configured, YOZEXA Pay
        refuses a fiat-priced link rather than quoting an invented rate. Price in YZXA, or
        configure a price source. A quote, once made, is fixed only until it expires — an exchange
        rate is never guaranteed indefinitely.
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-inset)",
  color: "var(--text)",
  fontSize: 14,
  marginTop: 6,
};

const buttonStyle: React.CSSProperties = {
  marginTop: 16,
  padding: "11px 24px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--bg)",
  fontWeight: 650,
  fontSize: 14,
  cursor: "pointer",
};
