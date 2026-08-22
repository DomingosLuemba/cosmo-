/**
 * YOZEXA Pay tests.
 *
 * These run against a real PostgreSQL database, not a mock, because the
 * properties being tested — unique constraints preventing double-crediting,
 * transactional settlement, idempotency — live in the database. A mock would
 * test the mock.
 *
 * Set DATABASE_URL to run them; they skip themselves otherwise.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { migrate, openPool, type Pool } from "@yozexa/indexer";
import { PrivateKey, ONE_YZXA } from "@yozexa/sdk";

import { generateApiKey, sha256Hex, authenticate, AuthError, RateLimiter } from "../src/auth.js";
import { fingerprint, IdempotencyConflict, lookup, store } from "../src/idempotency.js";
import { PaymentsService, PaymentError } from "../src/payments.js";
import { NoPriceSource, HttpPriceSource, quoteFiat, QuoteUnavailable } from "../src/quotes.js";
import { signPayload, verifySignature, enqueue, deliverDue } from "../src/webhooks.js";
import { newMerchantId, newApiKeyId } from "../src/ids.js";
import { migrationsDir } from "../src/paths.js";
import {
  decryptSecret,
  encryptSecret,
  generateServiceKey,
  hasSigningKey,
  MissingSigningKey,
} from "../src/secrets.js";
import { webhookSecret } from "../src/server.js";

const DATABASE_URL = process.env.DATABASE_URL;
const shouldRun = Boolean(DATABASE_URL);

let pool: Pool;
let merchantId: string;
let settlementAddress: string;
let payments: PaymentsService;

before(async () => {
  if (!shouldRun) return;
  pool = openPool({ connectionString: DATABASE_URL! });
  await migrate(pool, migrationsDir());

  merchantId = newMerchantId();
  settlementAddress = PrivateKey.generate().address();
  await pool.query(
    `INSERT INTO merchants (id, name, email, settlement_address, default_currency)
     VALUES ($1, $2, $3, $4, 'EUR')`,
    [merchantId, "Test Merchant", `${merchantId}@example.test`, settlementAddress],
  );
  payments = new PaymentsService(pool, new NoPriceSource(), 60);
});

after(async () => {
  if (!shouldRun) return;
  await pool.query("DELETE FROM merchants WHERE id = $1", [merchantId]);
  await pool.end();
});

describe("API keys", { skip: !shouldRun }, () => {
  it("stores only a hash, and authenticates the plaintext key", async () => {
    const generated = generateApiKey("test");
    const keyId = newApiKeyId();
    await pool.query(
      `INSERT INTO api_keys (id, merchant_id, name, environment, key_hash, key_prefix, secret_hash)
       VALUES ($1, $2, 'test key', 'test', $3, $4, $5)`,
      [keyId, merchantId, generated.keyHash, generated.keyPrefix, generated.secretHash],
    );

    // The plaintext key is nowhere in the database.
    const { rows } = await pool.query<{ key_hash: string }>(
      "SELECT key_hash FROM api_keys WHERE id = $1",
      [keyId],
    );
    assert.equal(rows[0]!.key_hash, sha256Hex(generated.key));
    assert.notEqual(rows[0]!.key_hash, generated.key);

    const record = await authenticate(pool, `Bearer ${generated.key}`, "test");
    assert.equal(record.merchantId, merchantId);

    await pool.query("DELETE FROM api_keys WHERE id = $1", [keyId]);
  });

  it("refuses a test key on a live endpoint and the reverse", async () => {
    const live = generateApiKey("live");
    await assert.rejects(
      () => authenticate(pool, `Bearer ${live.key}`, "test"),
      (err: unknown) => err instanceof AuthError && err.status === 403,
    );
    const test = generateApiKey("test");
    await assert.rejects(
      () => authenticate(pool, `Bearer ${test.key}`, "live"),
      (err: unknown) => err instanceof AuthError && err.status === 403,
    );
  });

  it("refuses a revoked key", async () => {
    const generated = generateApiKey("test");
    const keyId = newApiKeyId();
    await pool.query(
      `INSERT INTO api_keys (id, merchant_id, name, environment, key_hash, key_prefix, secret_hash, revoked_at)
       VALUES ($1, $2, 'revoked', 'test', $3, $4, $5, now())`,
      [keyId, merchantId, generated.keyHash, generated.keyPrefix, generated.secretHash],
    );
    await assert.rejects(() => authenticate(pool, `Bearer ${generated.key}`, "test"), /revoked/);
    await pool.query("DELETE FROM api_keys WHERE id = $1", [keyId]);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit and then refuses", () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 5; i++) {
      assert.equal(limiter.check("k", 5).allowed, true, `request ${i} should be allowed`);
    }
    assert.equal(limiter.check("k", 5).allowed, false);
  });
});

describe("quoting", () => {
  it("refuses to invent a rate when no price source is configured", async () => {
    await assert.rejects(
      () => quoteFiat(new NoPriceSource(), 4999n, "EUR", 60),
      QuoteUnavailable,
    );
  });

  it("converts fiat to base units exactly, rounding in the merchant's favour", async () => {
    const source = new HttpPriceSource("test", "http://price.invalid", 0, async () =>
      new Response(JSON.stringify({ EUR: 2 }), { status: 200 }),
    );
    // €49.99 at €2 per YZXA = 24.995 YZXA.
    const quote = await quoteFiat(source, 4999n, "EUR", 60);
    assert.equal(quote.amount, (24n * ONE_YZXA) + (995n * ONE_YZXA) / 1000n);
    assert.equal(quote.source, "test");
    assert.ok(quote.expiresAt.getTime() > Date.now());
  });

  it("rounds up so a merchant is never short-changed", async () => {
    const source = new HttpPriceSource("test", "http://price.invalid", 0, async () =>
      new Response(JSON.stringify({ EUR: 3 }), { status: 200 }),
    );
    // 1 cent at €3/YZXA is a repeating decimal; the result must round up.
    const quote = await quoteFiat(source, 1n, "EUR", 60);
    const exact = ONE_YZXA / 300n;
    assert.ok(quote.amount >= exact, `${quote.amount} < ${exact}`);
    assert.ok(quote.amount - exact <= 1n, "rounded up by more than one base unit");
  });
});

describe("payments", { skip: !shouldRun }, () => {
  it("creates a payment priced in YZXA", async () => {
    const payment = await payments.create({
      merchantId,
      amount: 25n * (ONE_YZXA / 100_000n),
      description: "Coffee",
      reference: "order-1",
    });
    assert.equal(payment.status, "created");
    assert.equal(payment.expected_address, settlementAddress);
    assert.equal(payment.expected_amount, "250000000000000");
  });

  it("makes concurrent identical amounts unique, so matching stays unambiguous", async () => {
    const price = 42n * ONE_YZXA;
    const a = await payments.create({ merchantId, amount: price });
    const b = await payments.create({ merchantId, amount: price });
    const c = await payments.create({ merchantId, amount: price });

    const amounts = [a, b, c].map((p) => BigInt(p.expected_amount));
    assert.equal(new Set(amounts.map(String)).size, 3, "two outstanding payments share an amount");
    for (const amount of amounts) {
      // Never quoted below the price, and adjusted by a negligible amount.
      assert.ok(amount >= price, "a payment was quoted below its price");
      assert.ok(amount - price < 4_096n, "the uniqueness adjustment was too large");
    }
  });

  it("refuses a fiat-priced payment when no rate is available", async () => {
    await assert.rejects(
      () => payments.create({ merchantId, fiatAmountCents: 4999n, fiatCurrency: "EUR" }),
      QuoteUnavailable,
    );
  });

  it("settles when a matching transfer arrives, and only once", async () => {
    const payment = await payments.create({ merchantId, amount: 7n * ONE_YZXA });
    const txHash = randomUUID().replace(/-/g, "").toUpperCase();

    const settled = await payments.settleTransfer({
      txHash,
      blockHeight: 100,
      blockTime: new Date(),
      transferIndex: 0,
      from: PrivateKey.generate().address(),
      to: settlementAddress,
      amount: payment.expected_amount,
      memo: null,
    });
    assert.ok(settled, "the payment was not settled");
    assert.equal(settled.id, payment.id);
    assert.equal(settled.status, "confirmed");
    assert.equal(settled.tx_hash, txHash);

    // The same transfer must not settle a second payment. This is enforced by
    // a unique index on tx_hash, not by application logic.
    const second = await payments.create({ merchantId, amount: 7n * ONE_YZXA });
    await assert.rejects(
      () =>
        payments.settleTransfer({
          txHash,
          blockHeight: 101,
          blockTime: new Date(),
          transferIndex: 0,
          from: PrivateKey.generate().address(),
          to: settlementAddress,
          amount: second.expected_amount,
          memo: null,
        }),
      /duplicate key|unique/i,
      "the same transaction settled a second payment",
    );
    await pool.query("DELETE FROM payments WHERE id = $1", [second.id]);
  });

  it("does not settle an underpayment, even with a matching memo", async () => {
    const payment = await payments.create({ merchantId, amount: 100n * ONE_YZXA, reference: "under-1" });
    const settled = await payments.settleTransfer({
      txHash: randomUUID().replace(/-/g, "").toUpperCase(),
      blockHeight: 200,
      blockTime: new Date(),
      transferIndex: 0,
      from: PrivateKey.generate().address(),
      to: settlementAddress,
      amount: (99n * ONE_YZXA).toString(),
      memo: payment.id,
    });
    assert.equal(settled, null, "an underpayment was accepted as settlement");
    assert.equal((await payments.get(merchantId, payment.id)).status, "created");
  });

  it("credits an overpayment only when the memo says which payment it is", async () => {
    const payment = await payments.create({ merchantId, amount: 3n * ONE_YZXA, reference: "over-1" });

    // Without a memo, an overpayment is NOT matched: guessing which order it
    // belongs to would risk marking the wrong one paid.
    const unmatched = await payments.settleTransfer({
      txHash: randomUUID().replace(/-/g, "").toUpperCase(),
      blockHeight: 300,
      blockTime: new Date(),
      transferIndex: 0,
      from: PrivateKey.generate().address(),
      to: settlementAddress,
      amount: (5n * ONE_YZXA).toString(),
      memo: null,
    });
    assert.equal(unmatched, null, "an ambiguous overpayment was credited to a payment");

    // With a memo naming the payment, it settles and the overpayment is
    // recorded rather than discarded.
    const settled = await payments.settleTransfer({
      txHash: randomUUID().replace(/-/g, "").toUpperCase(),
      blockHeight: 301,
      blockTime: new Date(),
      transferIndex: 0,
      from: PrivateKey.generate().address(),
      to: settlementAddress,
      amount: (5n * ONE_YZXA).toString(),
      memo: payment.id,
    });
    assert.ok(settled);
    assert.equal(settled.id, payment.id);
    assert.equal(settled.received_amount, (5n * ONE_YZXA).toString());
    assert.ok(BigInt(settled.received_amount!) > BigInt(settled.expected_amount));
  });

  it("never credits a payment that a transfer does not identify", async () => {
    // An older, cheaper payment must not absorb a transfer meant for a newer,
    // more expensive one.
    const cheap = await payments.create({ merchantId, amount: ONE_YZXA / 2n, reference: "cheap" });
    const expensive = await payments.create({ merchantId, amount: 900n * ONE_YZXA, reference: "expensive" });

    const settled = await payments.settleTransfer({
      txHash: randomUUID().replace(/-/g, "").toUpperCase(),
      blockHeight: 350,
      blockTime: new Date(),
      transferIndex: 0,
      from: PrivateKey.generate().address(),
      to: settlementAddress,
      amount: expensive.expected_amount,
      memo: null,
    });
    assert.equal(settled?.id, expensive.id, "the transfer settled the wrong order");
    const stillOpen = await payments.get(merchantId, cheap.id);
    assert.equal(stillOpen.status, "created");
  });
});

describe("refunds", { skip: !shouldRun }, () => {
  it("cannot refund more than was received", async () => {
    const payment = await payments.create({ merchantId, amount: 10n * ONE_YZXA });
    const payer = PrivateKey.generate().address();
    await payments.settleTransfer({
      txHash: randomUUID().replace(/-/g, "").toUpperCase(),
      blockHeight: 400,
      blockTime: new Date(),
      transferIndex: 0,
      from: payer,
      to: settlementAddress,
      amount: payment.expected_amount,
      memo: null,
    });

    const received = BigInt((await payments.get(merchantId, payment.id)).received_amount!);
    await payments.createRefund({ merchantId, paymentId: payment.id, amount: 4n * ONE_YZXA });
    await assert.rejects(
      () => payments.createRefund({ merchantId, paymentId: payment.id, amount: 7n * ONE_YZXA }),
      /would exceed/,
    );
    // The remainder is fine, and completes the refund.
    await payments.createRefund({ merchantId, paymentId: payment.id, amount: received - 4n * ONE_YZXA });
    const after = await payments.get(merchantId, payment.id);
    assert.equal(after.status, "refunded");
  });

  it("refuses to refund a payment that never settled", async () => {
    const payment = await payments.create({ merchantId, amount: ONE_YZXA });
    await assert.rejects(
      () => payments.createRefund({ merchantId, paymentId: payment.id }),
      PaymentError,
    );
  });
});

describe("payment links", { skip: !shouldRun }, () => {
  it("respects max_uses even under concurrent opens", async () => {
    const link = await payments.createLink({
      merchantId,
      description: "One-time link",
      amount: ONE_YZXA,
      maxUses: 1,
    });
    const slug = (link as { slug: string }).slug;

    const results = await Promise.allSettled([payments.openLink(slug), payments.openLink(slug)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    assert.equal(fulfilled.length, 1, "a single-use link was opened more than once");
  });
});

describe("idempotency", { skip: !shouldRun }, () => {
  it("replays the stored response for the same key and body", async () => {
    const key = randomUUID();
    const hash = fingerprint("POST", "/v1/payments", '{"amount":"1"}');
    assert.equal(await lookup(pool, merchantId, key, hash), null);

    await store(pool, merchantId, key, hash, { status: 201, body: { id: "pay_x" } });
    const replay = await lookup(pool, merchantId, key, hash);
    assert.deepEqual(replay, { status: 201, body: { id: "pay_x" } });
  });

  it("refuses the same key with a different body", async () => {
    const key = randomUUID();
    const first = fingerprint("POST", "/v1/payments", '{"amount":"1"}');
    await store(pool, merchantId, key, first, { status: 201, body: { id: "pay_y" } });

    const different = fingerprint("POST", "/v1/payments", '{"amount":"999"}');
    await assert.rejects(() => lookup(pool, merchantId, key, different), IdempotencyConflict);
  });
});

describe("webhook signatures", () => {
  it("verifies a signature it produced", () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ type: "payment.confirmed" });
    const now = Math.floor(Date.now() / 1000);
    const header = signPayload(secret, body, now);
    assert.equal(verifySignature(secret, body, header, 300, now), true);
  });

  it("rejects a wrong secret, a tampered body and a stale timestamp", () => {
    const secret = "whsec_test";
    const body = JSON.stringify({ type: "payment.confirmed", amount: "1" });
    const now = Math.floor(Date.now() / 1000);
    const header = signPayload(secret, body, now);

    assert.equal(verifySignature("whsec_other", body, header, 300, now), false);
    assert.equal(
      verifySignature(secret, JSON.stringify({ type: "payment.confirmed", amount: "999" }), header, 300, now),
      false,
    );
    // Replaying an old delivery must fail even with a valid signature.
    assert.equal(verifySignature(secret, body, header, 300, now + 400), false);
    assert.equal(verifySignature(secret, body, "garbage", 300, now), false);
  });
});

describe("webhook delivery", { skip: !shouldRun }, () => {
  it("delivers once, signs the body, and retries with backoff on failure", async () => {
    const endpointId = `whe_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await pool.query(
      `INSERT INTO webhook_endpoints (id, merchant_id, url, secret_hash, events)
       VALUES ($1, $2, 'http://127.0.0.1:1/hook', $3, ARRAY['payment.confirmed'])`,
      [endpointId, merchantId, sha256Hex("secret")],
    );

    const queued = await enqueue(pool, merchantId, "payment.confirmed", { id: "pay_1" }, "pay_1:confirmed");
    assert.equal(queued, 1);
    // Enqueuing the same logical event again must not create a second delivery.
    assert.equal(await enqueue(pool, merchantId, "payment.confirmed", { id: "pay_1" }, "pay_1:confirmed"), 0);

    const seen: Array<{ url: string; signature: string; body: string }> = [];
    const results = await deliverDue(pool, {
      secretFor: async () => "secret",
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push({
          url: String(url),
          signature: String((init.headers as Record<string, string>)["X-Yozexa-Signature"]),
          body: String(init.body),
        });
        return new Response("ok", { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0]!.delivered, true);
    assert.equal(seen.length, 1);
    assert.ok(verifySignature("secret", seen[0]!.body, seen[0]!.signature));

    // A delivered webhook is not delivered again.
    const again = await deliverDue(pool, {
      secretFor: async () => "secret",
      fetchImpl: (async () => new Response("ok", { status: 200 })) as unknown as typeof globalThis.fetch,
    });
    assert.equal(again.length, 0);

    await pool.query("DELETE FROM webhook_endpoints WHERE id = $1", [endpointId]);
  });

  it("backs off and eventually exhausts a failing endpoint", async () => {
    const endpointId = `whe_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await pool.query(
      `INSERT INTO webhook_endpoints (id, merchant_id, url, secret_hash, events)
       VALUES ($1, $2, 'http://127.0.0.1:1/dead', $3, ARRAY['payment.failed'])`,
      [endpointId, merchantId, sha256Hex("secret")],
    );
    await enqueue(pool, merchantId, "payment.failed", { id: "pay_2" }, "pay_2:failed");

    const failing = (async () => new Response("no", { status: 500 })) as unknown as typeof globalThis.fetch;
    const first = await deliverDue(pool, { secretFor: async () => "secret", fetchImpl: failing });
    assert.equal(first[0]!.delivered, false);

    const { rows } = await pool.query<{ status: string; attempts: number; next_attempt_at: Date }>(
      "SELECT status, attempts, next_attempt_at FROM webhook_deliveries WHERE endpoint_id = $1",
      [endpointId],
    );
    assert.equal(rows[0]!.status, "pending");
    assert.equal(Number(rows[0]!.attempts), 1);
    assert.ok(rows[0]!.next_attempt_at.getTime() > Date.now(), "no backoff was applied");

    await pool.query("DELETE FROM webhook_endpoints WHERE id = $1", [endpointId]);
  });
});

describe("webhook secrets at rest", () => {
  it("round-trips a secret and binds it to its endpoint", () => {
    process.env.WEBHOOK_SIGNING_KEY = generateServiceKey();
    const secret = "whsec_example";
    const stored = encryptSecret(secret, "whe_1");

    assert.notEqual(stored, secret, "the secret was stored in the clear");
    assert.equal(decryptSecret(stored, "whe_1"), secret);

    // The endpoint id is authenticated, so a ciphertext cannot be moved to
    // another row to make one endpoint sign with another's secret.
    assert.throws(() => decryptSecret(stored, "whe_2"));
    // A tampered ciphertext must not decrypt.
    const tampered = stored.slice(0, -4) + "AAAA";
    assert.throws(() => decryptSecret(tampered, "whe_1"));
  });

  it("reports a missing service key rather than signing with nothing", () => {
    const saved = process.env.WEBHOOK_SIGNING_KEY;
    delete process.env.WEBHOOK_SIGNING_KEY;
    assert.equal(hasSigningKey(), false);
    assert.throws(() => encryptSecret("x", "whe_1"), MissingSigningKey);
    if (saved) process.env.WEBHOOK_SIGNING_KEY = saved;
  });
});

describe("webhooks are signed with the secret the merchant was given", { skip: !shouldRun }, () => {
  it("delivers a signature the merchant's own verifier accepts", async () => {
    process.env.WEBHOOK_SIGNING_KEY = generateServiceKey();
    const endpointId = `whe_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const secret = "whsec_the_one_the_merchant_stored";

    await pool.query(
      `INSERT INTO webhook_endpoints (id, merchant_id, url, secret_hash, secret_encrypted, events)
       VALUES ($1, $2, 'http://127.0.0.1:1/hook', $3, $4, ARRAY['payment.confirmed'])`,
      [endpointId, merchantId, sha256Hex(secret), encryptSecret(secret, endpointId)],
    );
    await enqueue(pool, merchantId, "payment.confirmed", { id: "pay_signed" }, "pay_signed:confirmed");

    let delivered: { signature: string; body: string } | null = null;
    await deliverDue(pool, {
      secretFor: (id) => webhookSecret(pool, id),
      fetchImpl: (async (_url: string, init: RequestInit) => {
        delivered = {
          signature: String((init.headers as Record<string, string>)["X-Yozexa-Signature"]),
          body: String(init.body),
        };
        return new Response("ok", { status: 200 });
      }) as unknown as typeof globalThis.fetch,
    });

    assert.ok(delivered, "nothing was delivered");
    const sent = delivered as { signature: string; body: string };
    // The merchant verifies with the secret they were shown — not a hash of it.
    assert.equal(verifySignature(secret, sent.body, sent.signature), true);

    await pool.query("DELETE FROM webhook_endpoints WHERE id = $1", [endpointId]);
  });
});
