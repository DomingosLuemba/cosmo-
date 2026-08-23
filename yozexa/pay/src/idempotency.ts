/**
 * Idempotency.
 *
 * A payments API without this charges customers twice on a network timeout,
 * which is not an edge case: it is the normal behaviour of the internet. A
 * client that never sees a response retries; without idempotency that retry is
 * a second payment.
 */
import { createHash } from "node:crypto";

import type { Pool } from "@yozexa/indexer";

export interface StoredResponse {
  status: number;
  body: unknown;
}

export function fingerprint(method: string, path: string, body: string): string {
  return createHash("sha256").update(`${method} ${path}\n${body}`, "utf8").digest("hex");
}

/** A request with this key is still running, so its response does not exist yet. */
export class IdempotencyInFlight extends Error {
  constructor(readonly key: string) {
    super(
      `A request with Idempotency-Key ${JSON.stringify(key)} is still in progress. ` +
        `Retry once it has finished; retrying now would run the same operation twice.`,
    );
    this.name = "IdempotencyInFlight";
  }
}

export class IdempotencyConflict extends Error {
  constructor(readonly key: string) {
    super(
      `Idempotency-Key ${JSON.stringify(key)} was already used for a different request. ` +
        `Reusing a key with a different body would return the wrong response, so it is refused.`,
    );
    this.name = "IdempotencyConflict";
  }
}

/**
 * Claim a key before doing the work it protects.
 *
 * Looking the key up and *then* running the request leaves a gap: two
 * concurrent requests with the same key both find nothing, both execute, and
 * the customer is charged twice. Recording the response afterwards does not
 * help — by then the second charge has happened, and `ON CONFLICT DO NOTHING`
 * discards only the duplicate *response*.
 *
 * So the insert comes first, and the primary key does the excluding. Exactly
 * one caller wins:
 *
 *   `{ claimed: true }`  — this caller owns the key and must run the request,
 *                          then call `complete` or `release`
 *   `{ replay }`         — the same request already finished; return its response
 *   throws InFlight      — the same request is running right now
 *   throws Conflict      — this key was used for a *different* request
 */
export type Claim =
  | { claimed: true; replay?: undefined }
  | { claimed: false; replay: StoredResponse };

export async function claim(
  pool: Pool,
  merchantId: string,
  key: string,
  requestHash: string,
): Promise<Claim> {
  const inserted = await pool.query(
    `INSERT INTO idempotency_keys (merchant_id, key, request_hash, state, claimed_at)
     VALUES ($1, $2, $3, 'in_progress', now())
     ON CONFLICT (merchant_id, key) DO NOTHING
     RETURNING key`,
    [merchantId, key, requestHash],
  );
  if ((inserted.rowCount ?? 0) > 0) return { claimed: true };

  const { rows } = await pool.query<{
    request_hash: string;
    state: string;
    response_status: number | null;
    response_body: unknown;
  }>(
    `SELECT request_hash, state, response_status, response_body
       FROM idempotency_keys
      WHERE merchant_id = $1 AND key = $2`,
    [merchantId, key],
  );
  const row = rows[0];
  // Vanishingly rare, but real: the sweeper can delete the row between the
  // failed insert and this read. Treat it as ours rather than as a conflict.
  if (!row) return { claimed: true };
  if (row.request_hash !== requestHash) throw new IdempotencyConflict(key);
  if (row.state !== "completed" || row.response_status === null) {
    throw new IdempotencyInFlight(key);
  }
  return { claimed: false, replay: { status: row.response_status, body: row.response_body } };
}

/** Record the response against a key this caller claimed. */
export async function complete(
  pool: Pool,
  merchantId: string,
  key: string,
  response: StoredResponse,
): Promise<void> {
  await pool.query(
    `UPDATE idempotency_keys
        SET response_status = $3, response_body = $4, state = 'completed'
      WHERE merchant_id = $1 AND key = $2`,
    [merchantId, key, response.status, JSON.stringify(response.body)],
  );
}

/**
 * Give up a claim without recording a response.
 *
 * Called when the request failed in a way that should be retryable. Without
 * it a transient error would hold the key forever and the client could never
 * retry with the same one — which is exactly what they were told to do.
 */
export async function release(pool: Pool, merchantId: string, key: string): Promise<void> {
  await pool.query(
    `DELETE FROM idempotency_keys
      WHERE merchant_id = $1 AND key = $2 AND state = 'in_progress'`,
    [merchantId, key],
  );
}

/**
 * Delete keys older than the retention window, and release claims whose
 * request died.
 *
 * A process killed mid-request leaves an `in_progress` row that nothing will
 * ever complete, and the client would keep getting "still in progress" for a
 * request that is not running. They are released after a few minutes — longer
 * than any request this service will finish, short enough that a retry is not
 * left waiting.
 */
export async function sweep(pool: Pool, retentionHours = 24, staleMinutes = 5): Promise<number> {
  const expired = await pool.query(
    `DELETE FROM idempotency_keys WHERE created_at < now() - ($1 || ' hours')::interval`,
    [retentionHours],
  );
  const abandoned = await pool.query(
    `DELETE FROM idempotency_keys
      WHERE state = 'in_progress' AND claimed_at < now() - ($1 || ' minutes')::interval`,
    [staleMinutes],
  );
  return (expired.rowCount ?? 0) + (abandoned.rowCount ?? 0);
}
