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
 * Look up a previous response for this key.
 *
 * Returns the stored response when the key has been seen with the *same*
 * request, and throws when it has been seen with a different one — replaying a
 * key against a different body must never quietly return the earlier answer.
 */
export async function lookup(
  pool: Pool,
  merchantId: string,
  key: string,
  requestHash: string,
): Promise<StoredResponse | null> {
  const { rows } = await pool.query<{
    request_hash: string;
    response_status: number;
    response_body: unknown;
  }>(
    `SELECT request_hash, response_status, response_body
       FROM idempotency_keys
      WHERE merchant_id = $1 AND key = $2`,
    [merchantId, key],
  );
  if (rows.length === 0) return null;
  const row = rows[0]!;
  if (row.request_hash !== requestHash) throw new IdempotencyConflict(key);
  return { status: row.response_status, body: row.response_body };
}

/** Record a response against an idempotency key. */
export async function store(
  pool: Pool,
  merchantId: string,
  key: string,
  requestHash: string,
  response: StoredResponse,
): Promise<void> {
  await pool.query(
    `INSERT INTO idempotency_keys (merchant_id, key, request_hash, response_status, response_body)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (merchant_id, key) DO NOTHING`,
    [merchantId, key, requestHash, response.status, JSON.stringify(response.body)],
  );
}

/** Delete keys older than the retention window. */
export async function sweep(pool: Pool, retentionHours = 24): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM idempotency_keys WHERE created_at < now() - ($1 || ' hours')::interval`,
    [retentionHours],
  );
  return rowCount ?? 0;
}
