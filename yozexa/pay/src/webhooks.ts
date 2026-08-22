/**
 * Webhooks.
 *
 * Every delivery is signed, every delivery is recorded, and every delivery is
 * deduplicated. A merchant must be able to tell a genuine YOZEXA notification
 * from anything else that can reach their endpoint — otherwise "payment
 * confirmed" is a message anyone on the internet can send them.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import type { Pool } from "@yozexa/indexer";

import { newDeliveryId } from "./ids.js";

export const WEBHOOK_EVENTS = [
  "payment.created",
  "payment.pending",
  "payment.confirmed",
  "payment.finalized",
  "payment.failed",
  "payment.refunded",
  "invoice.paid",
  "subscription.charged",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Maximum delivery attempts before a delivery is marked exhausted. */
export const MAX_ATTEMPTS = 8;

/**
 * Sign a webhook body.
 *
 * Format: `t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`
 *
 * The timestamp is inside the signed material, so a captured delivery cannot be
 * replayed later with a fresh timestamp.
 */
export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`, "utf8").digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

/**
 * Verify a webhook signature. This is the function a merchant's own server
 * should run — it is exported and documented so integrators do not write their
 * own and get the comparison wrong.
 *
 * Rejects signatures older than `toleranceSeconds` (default 5 minutes) and
 * compares in constant time.
 */
export function verifySignature(
  secret: string,
  body: string,
  header: string,
  toleranceSeconds = 300,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const parts = new Map(
    header.split(",").map((part) => {
      const [k = "", v = ""] = part.split("=", 2);
      return [k.trim(), v.trim()];
    }),
  );
  const timestamp = Number(parts.get("t"));
  const provided = parts.get("v1");
  if (!Number.isFinite(timestamp) || !provided) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Queue an event for every endpoint of a merchant that subscribes to it.
 *
 * `idempotencyKey` deduplicates: one logical event reaches one endpoint at most
 * once, even if the caller enqueues it twice. Handlers must still be
 * idempotent, because a delivery that timed out after the merchant processed it
 * will be retried.
 */
export async function enqueue(
  pool: Pool,
  merchantId: string,
  event: WebhookEvent,
  payload: unknown,
  idempotencyKey: string,
): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM webhook_endpoints
      WHERE merchant_id = $1 AND active = true AND $2 = ANY(events)`,
    [merchantId, event],
  );
  let queued = 0;
  for (const endpoint of rows) {
    const { rowCount } = await pool.query(
      `INSERT INTO webhook_deliveries (id, endpoint_id, event_type, payload, idempotency_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint_id, idempotency_key) DO NOTHING`,
      [newDeliveryId(), endpoint.id, event, JSON.stringify(payload), idempotencyKey],
    );
    queued += rowCount ?? 0;
  }
  return queued;
}

export interface DeliveryResult {
  id: string;
  delivered: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Attempt every delivery that is due.
 *
 * Backoff is exponential with a cap, so a merchant endpoint that is down for an
 * hour is retried a handful of times rather than hammered, and a delivery that
 * never succeeds ends as `exhausted` rather than retrying forever.
 */
export async function deliverDue(
  pool: Pool,
  options: {
    secretFor: (endpointId: string) => Promise<string | null>;
    fetchImpl?: typeof globalThis.fetch;
    limit?: number;
    timeoutMs?: number;
  },
): Promise<DeliveryResult[]> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const { rows } = await pool.query<{
    id: string;
    endpoint_id: string;
    event_type: string;
    payload: unknown;
    attempts: number;
    url: string;
  }>(
    `SELECT d.id, d.endpoint_id, d.event_type, d.payload, d.attempts, e.url
       FROM webhook_deliveries d
       JOIN webhook_endpoints e ON e.id = d.endpoint_id
      WHERE d.status = 'pending' AND d.next_attempt_at <= now() AND e.active = true
      ORDER BY d.next_attempt_at
      LIMIT $1`,
    [options.limit ?? 50],
  );

  const results: DeliveryResult[] = [];
  for (const row of rows) {
    const secret = await options.secretFor(row.endpoint_id);
    if (!secret) {
      await pool.query(
        `UPDATE webhook_deliveries
            SET status = 'failed', last_error = 'no signing secret configured'
          WHERE id = $1`,
        [row.id],
      );
      results.push({ id: row.id, delivered: false, error: "no signing secret configured" });
      continue;
    }

    const body = JSON.stringify({
      id: row.id,
      type: row.event_type,
      created: new Date().toISOString(),
      data: row.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(secret, body, timestamp);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
    let statusCode: number | undefined;
    let error: string | undefined;
    try {
      const response = await fetchImpl(row.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Yozexa-Signature": signature,
          "X-Yozexa-Event": row.event_type,
          "X-Yozexa-Delivery": row.id,
        },
        body,
        signal: controller.signal,
      });
      statusCode = response.status;
      if (!response.ok) error = `endpoint returned ${response.status}`;
    } catch (err) {
      error = String(err);
    } finally {
      clearTimeout(timer);
    }

    const attempts = row.attempts + 1;
    if (!error) {
      await pool.query(
        `UPDATE webhook_deliveries
            SET status = 'delivered', attempts = $2, last_status_code = $3, delivered_at = now()
          WHERE id = $1`,
        [row.id, attempts, statusCode ?? null],
      );
      results.push({ id: row.id, delivered: true, ...(statusCode !== undefined ? { statusCode } : {}) });
      continue;
    }

    const exhausted = attempts >= MAX_ATTEMPTS;
    const backoffSeconds = Math.min(2 ** attempts * 5, 3_600);
    await pool.query(
      `UPDATE webhook_deliveries
          SET status = $2,
              attempts = $3,
              last_status_code = $4,
              last_error = $5,
              next_attempt_at = now() + ($6 || ' seconds')::interval
        WHERE id = $1`,
      [row.id, exhausted ? "exhausted" : "pending", attempts, statusCode ?? null, error, backoffSeconds],
    );
    results.push({
      id: row.id,
      delivered: false,
      ...(statusCode !== undefined ? { statusCode } : {}),
      error,
    });
  }
  return results;
}
