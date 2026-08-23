import { cookies } from "next/headers";

/**
 * The Business dashboard's link to YOZEXA Pay.
 *
 * The merchant's API key is held in an httpOnly, SameSite=Strict cookie and
 * used only on the server. It is never sent to the browser, never placed in a
 * page, and never reachable from client JavaScript — so a script injected into
 * this dashboard cannot read it.
 *
 * This is a first-version design and it is worth being explicit about its
 * limit: a production dashboard needs real user accounts, per-user roles and
 * an audit trail of who did what, rather than one shared merchant key. The
 * employees and permissions views below describe that model; they read from
 * Pay rather than inventing an account system this service does not have.
 */
export const PAY_API = process.env.PAY_API ?? "http://127.0.0.1:8080";
export const COOKIE_NAME = "yzx_business_key";

export class NotConnected extends Error {
  constructor() {
    super("This dashboard is not connected to a YOZEXA Pay account.");
    this.name = "NotConnected";
  }
}

export async function apiKey(): Promise<string> {
  const store = await cookies();
  const key = store.get(COOKIE_NAME)?.value;
  if (!key) throw new NotConnected();
  return key;
}

export async function isConnected(): Promise<boolean> {
  const store = await cookies();
  return Boolean(store.get(COOKIE_NAME)?.value);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const key = await apiKey();
  const response = await fetch(`${PAY_API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`YOZEXA Pay returned a non-JSON response: ${text.slice(0, 160)}`);
  }
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? `YOZEXA Pay returned ${response.status}`);
  }
  return body as T;
}

export const pay = {
  payments: (query = "") => request<{ payments: PaymentView[] }>(`/v1/payments${query}`),
  balances: () => request<Balances>("/v1/balances"),
  transactions: (limit = 100) =>
    request<{ transactions: LedgerRow[] }>(`/v1/transactions?limit=${limit}`),
  webhooks: () => request<{ webhooks: WebhookEndpoint[] }>("/v1/webhooks"),
  createPayment: (body: Record<string, unknown>) =>
    request<PaymentView>("/v1/payments", { method: "POST", body: JSON.stringify(body) }),
  createLink: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/v1/payment-links", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createInvoice: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/v1/invoices", { method: "POST", body: JSON.stringify(body) }),
  sendInvoice: (id: string) =>
    request<Record<string, unknown>>(`/v1/invoices/${id}/send`, { method: "POST" }),
  createRefund: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/v1/refunds", { method: "POST", body: JSON.stringify(body) }),
  createWebhook: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>("/v1/webhooks", { method: "POST", body: JSON.stringify(body) }),
};

export interface PaymentView {
  id: string;
  status: string;
  expected_amount: string;
  expected_amount_yzxa: string;
  expected_address: string;
  received_amount: string | null;
  received_amount_yzxa: string | null;
  fiat_amount_cents: string | null;
  fiat_currency: string | null;
  tx_hash: string | null;
  from_address: string | null;
  confirmed_at: string | null;
  description: string | null;
  reference: string | null;
  invoice_id: string | null;
  created_at: string;
}

export interface Balances {
  settled_total: string;
  refunded_total: string;
  net_settled: string;
  by_status: Record<string, { count: number; total: string }>;
  on_chain_balance: string | null;
  note: string;
}

export interface LedgerRow {
  id: string;
  status: string;
  expected_amount: string;
  received_amount: string | null;
  tx_hash: string | null;
  from_address: string | null;
  block_height: string | null;
  confirmed_at: string | null;
  reference: string | null;
  fiat_amount_cents: string | null;
  fiat_currency: string | null;
  invoice_id: string | null;
  created_at: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
}

/** Render minor currency units for display. */
export function formatFiat(cents: string | null, currency: string | null): string {
  if (!cents || !currency) return "—";
  const value = Number(cents) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}
