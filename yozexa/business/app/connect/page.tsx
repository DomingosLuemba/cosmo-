import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { COOKIE_NAME, PAY_API } from "@/lib/pay";

export const dynamic = "force-dynamic";

/**
 * Connecting the dashboard to a merchant account.
 *
 * The key is verified against YOZEXA Pay before it is stored, so a typo fails
 * here rather than on every later page. It is stored httpOnly and SameSite
 * strict: client JavaScript in this dashboard cannot read it, and it is not
 * sent on cross-site requests.
 */
export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function connect(formData: FormData) {
    "use server";
    const key = String(formData.get("key") ?? "").trim();
    if (!key.startsWith("yzk_")) {
      redirect("/connect?error=" + encodeURIComponent("That does not look like a YOZEXA API key."));
    }

    const response = await fetch(`${PAY_API}/v1/balances`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      redirect(
        "/connect?error=" +
          encodeURIComponent(body.error ?? `YOZEXA Pay rejected that key (${response.status}).`),
      );
    }

    const store = await cookies();
    store.set(COOKIE_NAME, key, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    redirect("/");
  }

  return (
    <>
      <h1>Connect your account</h1>
      <p className="subtitle">
        Paste a YOZEXA Pay API key. It is stored in an httpOnly cookie on this browser and used
        only from this server.
      </p>

      {error ? <div className="notice">{error}</div> : null}

      <form action={connect}>
        <div className="card">
          <label htmlFor="key" style={{ display: "block", marginBottom: 8, fontSize: 13 }}>
            API key
          </label>
          <input
            id="key"
            name="key"
            type="password"
            placeholder="yzk_test_…"
            autoComplete="off"
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-inset)",
              color: "var(--text)",
              fontFamily: "var(--mono)",
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            style={{
              marginTop: 14,
              padding: "12px 24px",
              borderRadius: 8,
              border: "none",
              background: "var(--accent)",
              color: "var(--bg)",
              fontWeight: 650,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Connect
          </button>
        </div>
      </form>

      <div className="notice info">
        <strong>A note on how this works today.</strong> One shared merchant key connects this
        dashboard, rather than individual user accounts with roles and an audit trail of who did
        what. That is the right model for a business with staff, and it is documented as the next
        step rather than presented as if it already existed. Until then, treat a key as a
        credential for everyone who can reach this dashboard.
      </div>
    </>
  );
}
