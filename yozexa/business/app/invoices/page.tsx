import { redirect } from "next/navigation";

import { isConnected, pay } from "@/lib/pay";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  if (!(await isConnected())) redirect("/connect");
  const params = await searchParams;

  async function create(formData: FormData) {
    "use server";
    try {
      const description = String(formData.get("item_description") ?? "").trim();
      const quantity = Number(formData.get("quantity") ?? 1);
      const unitPrice = Number(formData.get("unit_price") ?? 0);
      const invoice = (await pay.createInvoice({
        number: String(formData.get("number") ?? "").trim(),
        customer_name: String(formData.get("customer_name") ?? "").trim(),
        customer_email: String(formData.get("customer_email") ?? "").trim() || undefined,
        currency: String(formData.get("currency") ?? "EUR").trim(),
        line_items: [
          { description, quantity, unitPriceCents: Math.round(unitPrice * 100) },
        ],
        tax: String(Math.round(Number(formData.get("tax") ?? 0) * 100)),
        due_date: String(formData.get("due_date") ?? "").trim() || undefined,
      })) as { id: string; number: string };
      redirect("/invoices?ok=" + encodeURIComponent(`Invoice ${invoice.number} created as a draft.`));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NEXT_REDIRECT")) throw err;
      redirect("/invoices?error=" + encodeURIComponent(message));
    }
  }

  async function send(formData: FormData) {
    "use server";
    try {
      await pay.sendInvoice(String(formData.get("invoice_id") ?? ""));
      redirect("/invoices?ok=" + encodeURIComponent("Invoice sent and a payment created for it."));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NEXT_REDIRECT")) throw err;
      redirect("/invoices?error=" + encodeURIComponent(message));
    }
  }

  return (
    <>
      <h1>Invoices</h1>
      <p className="subtitle">
        Draft → sent → paid. Sending an invoice creates the payment a customer settles against.
      </p>

      {params.error ? <div className="notice">{params.error}</div> : null}
      {params.ok ? <div className="notice info">{params.ok}</div> : null}

      <form action={create}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>New invoice</h2>
          <div className="grid cols-3">
            <Field name="number" label="Invoice number" required />
            <Field name="customer_name" label="Customer" required />
            <Field name="customer_email" label="Customer email" type="email" />
            <Field name="item_description" label="Line item" required />
            <Field name="quantity" label="Quantity" inputMode="numeric" defaultValue="1" />
            <Field name="unit_price" label="Unit price" inputMode="decimal" />
            <Field name="tax" label="Tax" inputMode="decimal" defaultValue="0" />
            <Field name="currency" label="Currency" defaultValue="EUR" />
            <Field name="due_date" label="Due date" type="date" />
          </div>
          <button type="submit" style={buttonStyle}>Create draft invoice</button>
        </div>
      </form>

      <form action={send}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Send a draft</h2>
          <Field name="invoice_id" label="Invoice id" required />
          <button type="submit" style={buttonStyle}>Send invoice</button>
          <p className="dim" style={{ fontSize: 13, marginBottom: 0, marginTop: 12 }}>
            Sending creates a payment for the invoice total. When it settles on chain the invoice
            is marked paid automatically and an <code className="mono">invoice.paid</code> webhook
            fires.
          </p>
        </div>
      </form>
    </>
  );
}

function Field({
  name,
  label,
  type = "text",
  required = false,
  inputMode,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  inputMode?: "numeric" | "decimal";
  defaultValue?: string;
}) {
  return (
    <div>
      <label htmlFor={name} style={{ fontSize: 13, color: "var(--text-dim)" }}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        inputMode={inputMode}
        defaultValue={defaultValue}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--bg-inset)",
          color: "var(--text)",
          fontSize: 14,
          marginTop: 6,
        }}
      />
    </div>
  );
}

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
