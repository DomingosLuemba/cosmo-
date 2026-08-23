/**
 * The YOZEXA Pay HTTP API.
 *
 * Built on `node:http` rather than a framework: a payments API's request path
 * is the place where a surprising middleware behaviour becomes a financial bug,
 * and this is small enough to read end to end.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

import { migrate, openPool, type Pool } from "@yozexa/indexer";
import { Indexer } from "@yozexa/indexer";
import { YozexaClient } from "@yozexa/sdk";

import { authenticate, AuthError, RateLimiter, requireScope, sha256Hex, type ApiKeyRecord } from "./auth.js";
import { loadConfig, type Config } from "./config.js";
import { collect as collectMetrics, render as renderMetrics } from "./metrics.js";
import { fingerprint, IdempotencyConflict, lookup, store } from "./idempotency.js";
import { PaymentError, PaymentsService, publicPayment } from "./payments.js";
import { HttpPriceSource, NoPriceSource, QuoteUnavailable, type PriceSource } from "./quotes.js";
import { deliverDue, enqueue, WEBHOOK_EVENTS, type WebhookEvent } from "./webhooks.js";
import { newWebhookId } from "./ids.js";
import { decryptSecret, encryptSecret, hasSigningKey } from "./secrets.js";
import { migrationsDir } from "./paths.js";

interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: string;
  json: Record<string, unknown>;
  apiKey: ApiKeyRecord;
  clientIp: string;
}

export class PayServer {
  readonly #limiter = new RateLimiter();
  #server: Server | null = null;
  #sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: Config,
    private readonly pool: Pool,
    private readonly payments: PaymentsService,
    private readonly chain: YozexaClient,
  ) {}

  start(): Promise<void> {
    this.#server = createServer((req, res) => {
      this.#handle(req, res).catch((err) => {
        // Nothing should reach here; if it does, do not leak internals to the
        // caller, and do log it so it is not invisible.
        console.error("[pay] unhandled error:", err);
        if (!res.headersSent) send(res, 500, { error: "internal error" });
      });
    });
    this.#sweeper = setInterval(() => this.#limiter.sweep(), 60_000);
    this.#sweeper.unref();

    return new Promise((resolve) => {
      this.#server!.listen(this.config.port, this.config.host, () => resolve());
    });
  }

  address(): string {
    const addr = this.#server?.address();
    if (addr && typeof addr === "object") return `${this.config.host}:${addr.port}`;
    return `${this.config.host}:${this.config.port}`;
  }

  async stop(): Promise<void> {
    if (this.#sweeper) clearInterval(this.#sweeper);
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const clientIp = clientAddress(req);

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");

    // Unauthenticated endpoints.
    if (url.pathname === "/v1/health") return send(res, 200, { status: "ok", environment: this.config.environment });
    // Prometheus scrape target. Unversioned and outside /v1: it is an
    // operational surface, not part of the API merchants integrate against.
    if (url.pathname === "/metrics") {
      const samples = await collectMetrics(this.pool, this.config.nodeUrl, this.config.environment);
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(renderMetrics(samples));
      return;
    }
    if (url.pathname.startsWith("/pay/")) return this.#handleCheckout(url, res);

    if (!url.pathname.startsWith("/v1/")) return send(res, 404, { error: "not found" });

    let body: string;
    try {
      body = await readBody(req, this.config.maxBodyBytes);
    } catch (err) {
      return send(res, 413, { error: String(err) });
    }

    let apiKey: ApiKeyRecord;
    try {
      apiKey = await authenticate(
        this.pool,
        req.headers.authorization,
        this.config.environment,
        clientIp,
      );
    } catch (err) {
      if (err instanceof AuthError) return send(res, err.status, { error: err.message });
      throw err;
    }

    const limit = this.#limiter.check(apiKey.id, apiKey.rateLimitPerMinute);
    res.setHeader("X-RateLimit-Limit", String(apiKey.rateLimitPerMinute));
    res.setHeader("X-RateLimit-Remaining", String(limit.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(limit.resetAt / 1000)));
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(Math.ceil((limit.resetAt - Date.now()) / 1000)));
      return send(res, 429, { error: "rate limit exceeded" });
    }

    // Optional request signing, for callers that want replay protection on top
    // of TLS. When a signature header is present it must be valid.
    if (req.headers["x-yozexa-signature"]) {
      const ok = await this.#verifyRequestSignature(apiKey.id, req, body);
      if (!ok) return send(res, 401, { error: "invalid request signature" });
    }

    let json: Record<string, unknown> = {};
    if (body.length > 0) {
      try {
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return send(res, 400, { error: "request body must be a JSON object" });
        }
        json = parsed as Record<string, unknown>;
      } catch {
        return send(res, 400, { error: "request body is not valid JSON" });
      }
    }

    const ctx: RequestContext = { req, res, url, body, json, apiKey, clientIp };

    // Idempotency wraps every mutating request.
    const idempotencyKey = header(req, "idempotency-key");
    if (req.method !== "GET" && idempotencyKey) {
      const hash = fingerprint(req.method ?? "", url.pathname, body);
      try {
        const previous = await lookup(this.pool, apiKey.merchantId, idempotencyKey, hash);
        if (previous) {
          res.setHeader("Idempotent-Replay", "true");
          return send(res, previous.status, previous.body);
        }
      } catch (err) {
        if (err instanceof IdempotencyConflict) return send(res, 409, { error: err.message });
        throw err;
      }
      const captured = captureResponse(res);
      await this.#route(ctx);
      const result = captured();
      if (result && result.status < 500) {
        await store(this.pool, apiKey.merchantId, idempotencyKey, hash, result);
      }
      return;
    }

    await this.#route(ctx);
  }

  async #route(ctx: RequestContext): Promise<void> {
    const { req, res, url, json, apiKey } = ctx;
    const method = req.method ?? "GET";
    const path = url.pathname;

    try {
      // --- Payments -----------------------------------------------------
      if (path === "/v1/payments" && method === "POST") {
        requireScope(apiKey, "payments:write");
        const payment = await this.payments.create({
          merchantId: apiKey.merchantId,
          ...optionalBigint(json, "amount", "amount"),
          ...optionalBigint(json, "fiat_amount", "fiatAmountCents"),
          ...optionalString(json, "currency", "fiatCurrency"),
          ...optionalString(json, "description", "description"),
          ...optionalString(json, "reference", "reference"),
          ...optionalNumber(json, "expires_in_seconds", "expiresInSeconds"),
          metadata: (json.metadata as Record<string, unknown>) ?? {},
        });
        return send(res, 201, publicPayment(payment));
      }

      if (path === "/v1/payments" && method === "GET") {
        requireScope(apiKey, "payments:read");
        const payments = await this.payments.list(apiKey.merchantId, {
          ...(url.searchParams.get("status")
            ? { status: url.searchParams.get("status") as never }
            : {}),
          ...(url.searchParams.get("limit") ? { limit: Number(url.searchParams.get("limit")) } : {}),
          ...(url.searchParams.get("before") ? { before: url.searchParams.get("before")! } : {}),
        });
        return send(res, 200, { payments: payments.map(publicPayment) });
      }

      const paymentMatch = /^\/v1\/payments\/([\w-]+)$/.exec(path);
      if (paymentMatch && method === "GET") {
        requireScope(apiKey, "payments:read");
        const payment = await this.payments.get(apiKey.merchantId, paymentMatch[1]!);
        return send(res, 200, publicPayment(payment));
      }

      // --- Payment links ------------------------------------------------
      if (path === "/v1/payment-links" && method === "POST") {
        requireScope(apiKey, "payments:write");
        const description = requireString(json, "description");
        const link = await this.payments.createLink({
          merchantId: apiKey.merchantId,
          description,
          ...optionalBigint(json, "amount", "amount"),
          ...optionalBigint(json, "fiat_amount", "fiatAmountCents"),
          ...optionalString(json, "currency", "fiatCurrency"),
          ...optionalNumber(json, "max_uses", "maxUses"),
          ...optionalString(json, "callback_url", "callbackUrl"),
          ...(typeof json.expires_at === "string" ? { expiresAt: new Date(json.expires_at) } : {}),
          metadata: (json.metadata as Record<string, unknown>) ?? {},
        });
        const slug = (link as { slug: string }).slug;
        return send(res, 201, { ...link, url: `/pay/${slug}` });
      }

      // --- Invoices -----------------------------------------------------
      if (path === "/v1/invoices" && method === "POST") {
        requireScope(apiKey, "payments:write");
        const invoice = await this.payments.createInvoice({
          merchantId: apiKey.merchantId,
          number: requireString(json, "number"),
          customerName: requireString(json, "customer_name"),
          ...optionalString(json, "customer_email", "customerEmail"),
          lineItems: (json.line_items as Array<{
            description: string;
            quantity: number;
            unitPriceCents: number;
          }>) ?? [],
          ...optionalBigint(json, "tax", "taxCents"),
          currency: requireString(json, "currency"),
          ...optionalString(json, "due_date", "dueDate"),
          ...optionalString(json, "notes", "notes"),
        });
        return send(res, 201, invoice);
      }

      const invoiceSend = /^\/v1\/invoices\/([\w-]+)\/send$/.exec(path);
      if (invoiceSend && method === "POST") {
        requireScope(apiKey, "payments:write");
        const result = await this.payments.sendInvoice(apiKey.merchantId, invoiceSend[1]!);
        return send(res, 200, { invoice: result.invoice, payment: publicPayment(result.payment) });
      }

      // --- Refunds ------------------------------------------------------
      if (path === "/v1/refunds" && method === "POST") {
        requireScope(apiKey, "payments:write");
        const refund = await this.payments.createRefund({
          merchantId: apiKey.merchantId,
          paymentId: requireString(json, "payment_id"),
          ...optionalBigint(json, "amount", "amount"),
          ...optionalString(json, "reason", "reason"),
        });
        return send(res, 201, refund);
      }

      const refundTx = /^\/v1\/refunds\/([\w-]+)\/transaction$/.exec(path);
      if (refundTx && method === "POST") {
        requireScope(apiKey, "payments:write");
        await this.payments.recordRefundTx(apiKey.merchantId, refundTx[1]!, requireString(json, "tx_hash"));
        return send(res, 200, { ok: true });
      }

      // --- Balances and reconciliation ----------------------------------
      if (path === "/v1/balances" && method === "GET") {
        requireScope(apiKey, "payments:read");
        return send(res, 200, await this.#balances(apiKey.merchantId));
      }

      if (path === "/v1/transactions" && method === "GET") {
        requireScope(apiKey, "payments:read");
        return send(res, 200, await this.#ledger(apiKey.merchantId, url));
      }

      // --- Webhooks -----------------------------------------------------
      if (path === "/v1/webhooks" && method === "POST") {
        requireScope(apiKey, "webhooks:write");
        return send(res, 201, await this.#createWebhook(apiKey.merchantId, json));
      }

      if (path === "/v1/webhooks" && method === "GET") {
        requireScope(apiKey, "webhooks:read");
        const { rows } = await this.pool.query(
          `SELECT id, url, events, active, created_at FROM webhook_endpoints
            WHERE merchant_id = $1 ORDER BY created_at DESC`,
          [apiKey.merchantId],
        );
        return send(res, 200, { webhooks: rows });
      }

      const deliveries = /^\/v1\/webhooks\/([\w-]+)\/deliveries$/.exec(path);
      if (deliveries && method === "GET") {
        requireScope(apiKey, "webhooks:read");
        const { rows } = await this.pool.query(
          `SELECT d.id, d.event_type, d.status, d.attempts, d.last_status_code,
                  d.last_error, d.delivered_at, d.created_at
             FROM webhook_deliveries d
             JOIN webhook_endpoints e ON e.id = d.endpoint_id
            WHERE d.endpoint_id = $1 AND e.merchant_id = $2
            ORDER BY d.created_at DESC LIMIT 100`,
          [deliveries[1], apiKey.merchantId],
        );
        return send(res, 200, { deliveries: rows });
      }

      return send(res, 404, { error: `no route for ${method} ${path}` });
    } catch (err) {
      if (err instanceof PaymentError) return send(res, err.status, { error: err.message });
      if (err instanceof AuthError) return send(res, err.status, { error: err.message });
      if (err instanceof QuoteUnavailable) return send(res, 503, { error: err.message });
      console.error("[pay] route error:", err);
      return send(res, 500, { error: "internal error" });
    }
  }

  /** The hosted checkout page a customer opens from a payment link. */
  async #handleCheckout(url: URL, res: ServerResponse): Promise<void> {
    const slug = url.pathname.slice("/pay/".length);
    if (!/^[a-z0-9]{4,32}$/.test(slug)) return send(res, 404, { error: "not found" });
    try {
      const { payment } = await this.payments.openLink(slug);
      return send(res, 200, {
        payment: publicPayment(payment),
        instructions: {
          pay_to: payment.expected_address,
          amount: payment.expected_amount,
          note: "Send exactly this amount, in base units (ayzxa), to the address above from any YOZEXA wallet.",
          quote_expires_at: payment.quote_expires_at,
        },
      });
    } catch (err) {
      if (err instanceof PaymentError) return send(res, err.status, { error: err.message });
      if (err instanceof QuoteUnavailable) return send(res, 503, { error: err.message });
      throw err;
    }
  }

  async #balances(merchantId: string): Promise<Record<string, unknown>> {
    const { rows } = await this.pool.query<{
      status: string;
      count: string;
      total: string | null;
    }>(
      `SELECT status, COUNT(*)::text AS count, SUM(COALESCE(received_amount, 0))::text AS total
         FROM payments WHERE merchant_id = $1 GROUP BY status`,
      [merchantId],
    );
    const byStatus: Record<string, { count: number; total: string }> = {};
    let settled = 0n;
    for (const row of rows) {
      byStatus[row.status] = { count: Number(row.count), total: row.total ?? "0" };
      if (row.status === "confirmed" || row.status === "finalized") settled += BigInt(row.total ?? "0");
    }

    const { rows: refundRows } = await this.pool.query<{ total: string | null }>(
      `SELECT SUM(amount)::text AS total FROM refunds WHERE merchant_id = $1 AND status <> 'failed'`,
      [merchantId],
    );
    const refunded = BigInt(refundRows[0]?.total ?? "0");

    // The on-chain balance is read from the chain, not from this database. If
    // the two ever disagree the chain is right and this service has a bug.
    const { rows: merchantRows } = await this.pool.query<{ settlement_address: string }>(
      "SELECT settlement_address FROM merchants WHERE id = $1",
      [merchantId],
    );
    let onChain: string | null = null;
    if (merchantRows[0]) {
      try {
        onChain = (await this.chain.account(merchantRows[0].settlement_address)).balance;
      } catch {
        onChain = null;
      }
    }

    return {
      settled_total: settled.toString(),
      refunded_total: refunded.toString(),
      net_settled: (settled - refunded).toString(),
      by_status: byStatus,
      on_chain_balance: onChain,
      note: "The chain is the source of truth. `on_chain_balance` is read live from the node; the other figures are this service's projection.",
    };
  }

  async #ledger(merchantId: string, url: URL): Promise<Record<string, unknown>> {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);
    const { rows } = await this.pool.query(
      `SELECT p.id, p.status, p.expected_amount, p.received_amount, p.tx_hash,
              p.from_address, p.block_height, p.confirmed_at, p.reference,
              p.fiat_amount_cents, p.fiat_currency, p.invoice_id, p.created_at
         FROM payments p
        WHERE p.merchant_id = $1
        ORDER BY p.created_at DESC
        LIMIT $2`,
      [merchantId, limit],
    );
    return { transactions: rows };
  }

  async #createWebhook(merchantId: string, json: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = requireString(json, "url");
    if (!/^https:\/\//.test(url) && !url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost")) {
      throw new PaymentError("a webhook URL must use https (http is allowed only for localhost in development)");
    }
    const events = Array.isArray(json.events) ? (json.events as string[]) : [];
    if (events.length === 0) throw new PaymentError("subscribe to at least one event");
    for (const event of events) {
      if (!WEBHOOK_EVENTS.includes(event as WebhookEvent)) {
        throw new PaymentError(`unknown event ${JSON.stringify(event)}`);
      }
    }
    if (!hasSigningKey()) {
      throw new PaymentError(
        "this service has no WEBHOOK_SIGNING_KEY configured, so it cannot sign deliveries; " +
          "webhooks are unavailable until an operator sets one",
        503,
      );
    }
    const secret = `whsec_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
    const id = newWebhookId();
    // Hashed for identification, encrypted so the service can actually sign
    // with it. See src/secrets.ts for why the two differ.
    await this.pool.query(
      `INSERT INTO webhook_endpoints (id, merchant_id, url, secret_hash, secret_encrypted, events)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, merchantId, url, sha256Hex(secret), encryptSecret(secret, id), events],
    );
    return {
      id,
      url,
      events,
      secret,
      note: "This signing secret is shown once. Store it now; it cannot be retrieved again, only rotated.",
    };
  }

  async #verifyRequestSignature(apiKeyId: string, req: IncomingMessage, body: string): Promise<boolean> {
    const signature = header(req, "x-yozexa-signature");
    const timestamp = header(req, "x-yozexa-timestamp");
    const nonce = header(req, "x-yozexa-nonce");
    if (!signature || !timestamp || !nonce) return false;

    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
    if (!Number.isFinite(age) || age > 300) return false;

    const { rows } = await this.pool.query<{ secret_hash: string }>(
      "SELECT secret_hash FROM api_keys WHERE id = $1",
      [apiKeyId],
    );
    if (rows.length === 0) return false;

    // The stored value is a hash of the secret, so the signature is computed
    // over that hash: the server never holds the plaintext secret either.
    const expected = createHmac("sha256", rows[0]!.secret_hash)
      .update(`${timestamp}.${nonce}.${body}`, "utf8")
      .digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

/**
 * Recover an endpoint's signing secret so a delivery can be signed with it.
 *
 * Returns null when the endpoint predates encrypted storage or the service key
 * is missing, which makes `deliverDue` mark the delivery failed with a clear
 * reason rather than sending an unverifiable payload.
 */
export async function webhookSecret(pool: Pool, endpointId: string): Promise<string | null> {
  const { rows } = await pool.query<{ secret_encrypted: string | null }>(
    "SELECT secret_encrypted FROM webhook_endpoints WHERE id = $1",
    [endpointId],
  );
  const stored = rows[0]?.secret_encrypted;
  if (!stored) return null;
  try {
    return decryptSecret(stored, endpointId);
  } catch {
    return null;
  }
}

// --- helpers ------------------------------------------------------------

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

/** Wrap `res` so an idempotent request's response can be stored. */
function captureResponse(res: ServerResponse): () => { status: number; body: unknown } | null {
  let captured: { status: number; body: unknown } | null = null;
  const originalEnd = res.end.bind(res);
  const originalWriteHead = res.writeHead.bind(res);
  let status = 200;

  res.writeHead = ((code: number, ...rest: unknown[]) => {
    status = code;
    return (originalWriteHead as (...a: unknown[]) => ServerResponse)(code, ...rest);
  }) as typeof res.writeHead;

  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string") {
      try {
        captured = { status, body: JSON.parse(chunk) };
      } catch {
        captured = null;
      }
    }
    return (originalEnd as (...a: unknown[]) => ServerResponse)(chunk, ...rest);
  }) as typeof res.end;

  return () => captured;
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function clientAddress(req: IncomingMessage): string {
  // Only trust a forwarded header when the deployment sets it; the default is
  // the socket address, which cannot be spoofed by the caller.
  return req.socket.remoteAddress ?? "unknown";
}

function requireString(json: Record<string, unknown>, key: string): string {
  const value = json[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new PaymentError(`${key} is required`);
  }
  return value;
}

function optionalString<K extends string>(
  json: Record<string, unknown>,
  key: string,
  as: K,
): Partial<Record<K, string>> {
  const value = json[key];
  return typeof value === "string" && value !== "" ? ({ [as]: value } as Record<K, string>) : {};
}

function optionalNumber<K extends string>(
  json: Record<string, unknown>,
  key: string,
  as: K,
): Partial<Record<K, number>> {
  const value = json[key];
  return typeof value === "number" && Number.isFinite(value)
    ? ({ [as]: value } as Record<K, number>)
    : {};
}

/**
 * Read a monetary field.
 *
 * Accepts a string of digits only. A JSON *number* is rejected outright,
 * because a client that sends 10^18 as a number has already lost precision
 * before the request left their process.
 */
function optionalBigint<K extends string>(
  json: Record<string, unknown>,
  key: string,
  as: K,
): Partial<Record<K, bigint>> {
  const value = json[key];
  if (value === undefined || value === null) return {};
  if (typeof value === "number") {
    throw new PaymentError(
      `${key} must be a string of digits, not a JSON number: a number cannot carry a base-unit amount without losing precision`,
    );
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new PaymentError(`${key} must be a string of digits in the smallest unit`);
  }
  return { [as]: BigInt(value) } as Record<K, bigint>;
}

// --- entry point --------------------------------------------------------

export async function main(): Promise<void> {
  const config = loadConfig();
  const pool = openPool({ connectionString: config.databaseUrl });
  const ran = await migrate(pool, migrationsDir());
  if (ran.length > 0) console.log(`[pay] applied migrations: ${ran.join(", ")}`);

  const chain = new YozexaClient(config.nodeUrl);
  const status = await chain.status();
  console.log(`[pay] chain ${status.chain_id} at ${config.nodeUrl}`);
  if (status.network_warning) console.log(`[pay] ${status.network_warning}`);

  // A live Pay instance must not be pointed at a test chain, or the reverse.
  const chainIsMainnet = status.chain_id === "yozexa-1";
  if (config.environment === "live" && !chainIsMainnet) {
    throw new Error(
      `refusing to start: YOZEXA_ENVIRONMENT=live but the node reports ${status.chain_id}, which is not mainnet`,
    );
  }
  if (config.environment === "test" && chainIsMainnet) {
    throw new Error("refusing to start: YOZEXA_ENVIRONMENT=test but the node is mainnet");
  }

  const priceSource: PriceSource =
    process.env.PRICE_SOURCE_URL
      ? new HttpPriceSource(config.priceSource, process.env.PRICE_SOURCE_URL)
      : new NoPriceSource();
  if (priceSource.name === "none") {
    console.log(
      "[pay] no price source configured: payments must be priced in YZXA. " +
        "Fiat-denominated payments will be refused rather than quoted at an invented rate.",
    );
  }

  if (!hasSigningKey()) {
    const message =
      "WEBHOOK_SIGNING_KEY is not set: webhook endpoints cannot be created and deliveries cannot " +
      "be signed. Generate one with `openssl rand -base64 32` and put it in your secret manager.";
    if (config.environment === "live") {
      throw new Error(`refusing to start in live mode — ${message}`);
    }
    console.log(`[pay] ${message}`);
  }

  const payments = new PaymentsService(pool, priceSource, config.quoteTtlSeconds);

  // Follow the chain and settle payments as transfers arrive.
  const indexer = new Indexer({
    pool,
    client: chain,
    onTransfer: async (transfer) => {
      const settled = await payments.settleTransfer(transfer);
      if (settled) {
        console.log(`[pay] payment ${settled.id} settled by ${transfer.txHash}`);
      }
    },
  });
  void indexer.run().catch((err) => console.error("[pay] indexer stopped:", err));

  // Deliver webhooks and expire stale payments on a timer.
  const worker = setInterval(() => {
    void payments.expireStale().catch((err) => console.error("[pay] expiry sweep:", err));
    void deliverDue(pool, { secretFor: (id) => webhookSecret(pool, id) }).catch((err) =>
      console.error("[pay] webhook delivery:", err),
    );
  }, 5_000);
  worker.unref();

  const server = new PayServer(config, pool, payments, chain);
  await server.start();
  console.log(`[pay] listening on http://${server.address()} (${config.environment})`);

  const shutdown = async (): Promise<void> => {
    indexer.stop();
    await server.stop();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export { enqueue };

// Run the service when this module is the entry point, so it can also be
// imported by tests without starting a listener.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[pay] fatal:", err);
    process.exit(1);
  });
}
