/**
 * API key authentication for YOZEXA Pay.
 *
 * Keys are shown once, at creation, and only a SHA-256 hash is stored. A leaked
 * database therefore does not hand an attacker working credentials, and a lost
 * key cannot be recovered — only rotated. That is the correct trade for a
 * payments API.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { Pool } from "@yozexa/indexer";

export interface ApiKeyRecord {
  id: string;
  merchantId: string;
  environment: "test" | "live";
  scopes: string[];
  rateLimitPerMinute: number;
  ipAllowlist: string[] | null;
}

export interface GeneratedKey {
  /** The full key. Shown once and never stored. */
  key: string;
  /** The HMAC secret for signing requests and verifying webhooks. Shown once. */
  secret: string;
  keyHash: string;
  keyPrefix: string;
  secretHash: string;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Generate a new API key and its signing secret. */
export function generateApiKey(environment: "test" | "live"): GeneratedKey {
  const key = `yzk_${environment}_${randomBytes(24).toString("base64url")}`;
  const secret = `yzs_${environment}_${randomBytes(32).toString("base64url")}`;
  return {
    key,
    secret,
    keyHash: sha256Hex(key),
    keyPrefix: key.slice(0, 16),
    secretHash: sha256Hex(secret),
  };
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Authenticate a request.
 *
 * Rejects a key whose environment does not match this instance's. A `yzk_test_`
 * key must never be able to act against mainnet, and a `yzk_live_` key must
 * never be pointed at a test network by accident.
 */
export async function authenticate(
  pool: Pool,
  authorizationHeader: string | undefined,
  serviceEnvironment: "test" | "live",
  clientIp?: string,
): Promise<ApiKeyRecord> {
  if (!authorizationHeader) {
    throw new AuthError("missing Authorization header; expected `Authorization: Bearer yzk_...`");
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  if (!match) throw new AuthError("malformed Authorization header; expected `Bearer <key>`");
  const key = match[1]!;

  if (!key.startsWith("yzk_test_") && !key.startsWith("yzk_live_")) {
    throw new AuthError("that does not look like a YOZEXA API key");
  }
  const keyEnvironment = key.startsWith("yzk_live_") ? "live" : "test";
  if (keyEnvironment !== serviceEnvironment) {
    throw new AuthError(
      `this is a ${serviceEnvironment} endpoint and you presented a ${keyEnvironment} key`,
      403,
    );
  }

  const { rows } = await pool.query<{
    id: string;
    merchant_id: string;
    environment: "test" | "live";
    scopes: string[];
    rate_limit_per_minute: number;
    ip_allowlist: string[] | null;
    revoked_at: Date | null;
    merchant_status: string;
  }>(
    `SELECT k.id, k.merchant_id, k.environment, k.scopes, k.rate_limit_per_minute,
            k.ip_allowlist, k.revoked_at, m.status AS merchant_status
       FROM api_keys k
       JOIN merchants m ON m.id = k.merchant_id
      WHERE k.key_hash = $1`,
    [sha256Hex(key)],
  );
  if (rows.length === 0) throw new AuthError("unknown API key");
  const record = rows[0]!;
  if (record.revoked_at) throw new AuthError("this API key has been revoked", 403);
  if (record.merchant_status !== "active") {
    throw new AuthError(`this merchant account is ${record.merchant_status}`, 403);
  }
  if (record.ip_allowlist && record.ip_allowlist.length > 0) {
    if (!clientIp || !record.ip_allowlist.includes(clientIp)) {
      throw new AuthError("this API key is restricted to other IP addresses", 403);
    }
  }

  // Best-effort: a failure to record last use must not fail the request.
  pool
    .query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [record.id])
    .catch(() => undefined);

  return {
    id: record.id,
    merchantId: record.merchant_id,
    environment: record.environment,
    scopes: record.scopes,
    rateLimitPerMinute: record.rate_limit_per_minute,
    ipAllowlist: record.ip_allowlist,
  };
}

/** Require a scope, or refuse the request. */
export function requireScope(key: ApiKeyRecord, scope: string): void {
  if (!key.scopes.includes(scope)) {
    throw new AuthError(`this API key does not have the ${scope} scope`, 403);
  }
}

/** Constant-time string comparison for secrets and signatures. */
export function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * A fixed-window rate limiter held in memory.
 *
 * In-memory is honest about its scope: it limits one process. A multi-instance
 * deployment needs a shared counter (Redis) or edge rate limiting, and the
 * deployment documentation says so rather than this pretending to be global.
 */
export class RateLimiter {
  readonly #windows = new Map<string, { count: number; resetAt: number }>();

  check(keyId: string, limitPerMinute: number): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const existing = this.#windows.get(keyId);
    if (!existing || now >= existing.resetAt) {
      const resetAt = now + 60_000;
      this.#windows.set(keyId, { count: 1, resetAt });
      return { allowed: true, remaining: limitPerMinute - 1, resetAt };
    }
    existing.count++;
    return {
      allowed: existing.count <= limitPerMinute,
      remaining: Math.max(0, limitPerMinute - existing.count),
      resetAt: existing.resetAt,
    };
  }

  /** Drop expired windows so the map does not grow without bound. */
  sweep(): void {
    const now = Date.now();
    for (const [key, window] of this.#windows) {
      if (now >= window.resetAt) this.#windows.delete(key);
    }
  }
}
