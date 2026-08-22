/**
 * The payments service.
 *
 * The chain settles money; this service tracks the commercial context around a
 * settlement — who was charged, for what, against which invoice — and detects
 * when a payment has actually arrived.
 *
 * Nothing here can move money. It watches, records and notifies.
 */
import type { Pool } from "@yozexa/indexer";
import { withTransaction } from "@yozexa/indexer";
import { formatYZXA, type IndexedTransfer } from "./types.js";

import { newInvoiceId, newLinkId, newPaymentId, newRefundId, newSlug } from "./ids.js";
import { quoteFiat, type PriceSource } from "./quotes.js";
import { enqueue } from "./webhooks.js";

export type PaymentStatus =
  | "created"
  | "pending"
  | "confirmed"
  | "finalized"
  | "failed"
  | "expired"
  | "refunded";

export interface Payment {
  id: string;
  merchant_id: string;
  status: PaymentStatus;
  fiat_amount_cents: string | null;
  fiat_currency: string | null;
  expected_amount: string;
  expected_address: string;
  quote_rate: string | null;
  quote_source: string | null;
  quote_expires_at: Date | null;
  received_amount: string | null;
  tx_hash: string | null;
  from_address: string | null;
  block_height: string | null;
  confirmed_at: Date | null;
  description: string | null;
  reference: string | null;
  metadata: Record<string, unknown>;
  payment_link_id: string | null;
  invoice_id: string | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface CreatePaymentInput {
  merchantId: string;
  /** Either a fiat amount in minor units plus a currency, or an explicit YZXA amount. */
  fiatAmountCents?: bigint;
  fiatCurrency?: string;
  amount?: bigint;
  description?: string;
  reference?: string;
  metadata?: Record<string, unknown>;
  paymentLinkId?: string;
  invoiceId?: string;
  /** How long the customer has to pay, in seconds. */
  expiresInSeconds?: number;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

export class PaymentsService {
  constructor(
    private readonly pool: Pool,
    private readonly priceSource: PriceSource,
    private readonly quoteTtlSeconds: number,
  ) {}

  /** Create a payment intent, quoting it if it was priced in fiat. */
  async create(input: CreatePaymentInput): Promise<Payment> {
    const merchant = await this.#merchant(input.merchantId);

    let amount: bigint;
    let rate: string | null = null;
    let source: string | null = null;
    let quoteExpiresAt: Date | null = null;

    if (input.amount !== undefined) {
      if (input.amount <= 0n) throw new PaymentError("amount must be positive");
      amount = input.amount;
    } else if (input.fiatAmountCents !== undefined && input.fiatCurrency) {
      // A fiat-priced payment fails loudly when no rate is available, rather
      // than falling back to a made-up number.
      const quote = await quoteFiat(
        this.priceSource,
        input.fiatAmountCents,
        input.fiatCurrency,
        this.quoteTtlSeconds,
      );
      amount = quote.amount;
      rate = quote.rate;
      source = quote.source;
      quoteExpiresAt = quote.expiresAt;
    } else {
      throw new PaymentError("provide either `amount` in base units, or `fiat_amount` and `currency`");
    }

    // Make the amount unique among this merchant's outstanding payments, so
    // an exact-amount match can never be ambiguous. The adjustment is at most
    // a few thousand base units — under 10^-14 YZXA, economically nothing —
    // and it is what lets a merchant use one settlement address for everything
    // without risking crediting the wrong order.
    amount = await this.#uniqueAmount(merchant.settlement_address, amount);

    const id = newPaymentId();
    const expiresAt = new Date(Date.now() + (input.expiresInSeconds ?? 3_600) * 1000);

    const { rows } = await this.pool.query<Payment>(
      `INSERT INTO payments
         (id, merchant_id, status, fiat_amount_cents, fiat_currency, expected_amount,
          expected_address, quote_rate, quote_source, quote_expires_at, description,
          reference, metadata, payment_link_id, invoice_id, expires_at)
       VALUES ($1, $2, 'created', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        id,
        input.merchantId,
        input.fiatAmountCents?.toString() ?? null,
        input.fiatCurrency ?? null,
        amount.toString(),
        merchant.settlement_address,
        rate,
        source,
        quoteExpiresAt,
        input.description ?? null,
        input.reference ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.paymentLinkId ?? null,
        input.invoiceId ?? null,
        expiresAt,
      ],
    );
    const payment = rows[0]!;
    await enqueue(this.pool, input.merchantId, "payment.created", publicPayment(payment), `${id}:created`);
    return payment;
  }

  async get(merchantId: string, id: string): Promise<Payment> {
    const { rows } = await this.pool.query<Payment>(
      "SELECT * FROM payments WHERE id = $1 AND merchant_id = $2",
      [id, merchantId],
    );
    if (rows.length === 0) throw new PaymentError("payment not found", 404);
    return rows[0]!;
  }

  async list(
    merchantId: string,
    options: { status?: PaymentStatus; limit?: number; before?: string } = {},
  ): Promise<Payment[]> {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const { rows } = await this.pool.query<Payment>(
      `SELECT * FROM payments
        WHERE merchant_id = $1
          AND ($2::text IS NULL OR status = $2)
          AND ($3::text IS NULL OR created_at < (SELECT created_at FROM payments WHERE id = $3))
        ORDER BY created_at DESC
        LIMIT $4`,
      [merchantId, options.status ?? null, options.before ?? null, limit],
    );
    return rows;
  }

  /**
   * Match an on-chain transfer against an outstanding payment.
   *
   * This is the point where "somebody sent money" becomes "this order is
   * paid", so it must never credit the wrong order. A merchant settles many
   * payments to one address, so the address alone does not identify which one
   * a transfer belongs to.
   *
   * Matching, in order:
   *
   *   1. the memo names an outstanding payment id or reference;
   *   2. the amount matches an outstanding payment EXACTLY. Every payment is
   *      created with an amount that is unique among that merchant's
   *      outstanding payments (see `#uniqueAmount`), so an exact match is
   *      unambiguous by construction.
   *
   * An overpayment with no memo is deliberately NOT matched: crediting the
   * oldest payment whose amount happens to be smaller would silently mark the
   * wrong order paid. It is recorded as unmatched for the merchant to
   * reconcile, which is the honest outcome.
   *
   * The settling transaction hash is written under a unique index, so the same
   * transfer can never credit two payments or credit one twice.
   */
  async settleTransfer(transfer: IndexedTransfer): Promise<Payment | null> {
    const settled = await withTransaction(this.pool, async (client) => {
      const memo = (transfer.memo ?? "").trim();

      // 1. An explicit reference in the memo is the strongest signal.
      let candidate: Payment | undefined;
      if (memo !== "") {
        const { rows } = await client.query<Payment>(
          `SELECT * FROM payments
            WHERE expected_address = $1
              AND status IN ('created', 'pending')
              AND (id = $2 OR reference = $2)
              AND expected_amount <= $3::numeric
              AND (expires_at IS NULL OR expires_at > $4)
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
          [transfer.to, memo, transfer.amount, transfer.blockTime],
        );
        candidate = rows[0];
      }

      // 2. Otherwise, an exact amount match.
      if (!candidate) {
        const { rows } = await client.query<Payment>(
          `SELECT * FROM payments
            WHERE expected_address = $1
              AND status IN ('created', 'pending')
              AND expected_amount = $2::numeric
              AND (expires_at IS NULL OR expires_at > $3)
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
          [transfer.to, transfer.amount, transfer.blockTime],
        );
        candidate = rows[0];
      }

      if (!candidate) return null;

      const updated = await client.query<Payment>(
        `UPDATE payments
            SET status = 'confirmed',
                received_amount = $2::numeric,
                tx_hash = $3,
                from_address = $4,
                block_height = $5,
                confirmed_at = $6,
                updated_at = now()
          WHERE id = $1 AND status IN ('created', 'pending')
          RETURNING *`,
        [
          candidate.id,
          transfer.amount,
          transfer.txHash,
          transfer.from,
          transfer.blockHeight,
          transfer.blockTime,
        ],
      );
      if (updated.rows.length === 0) return null;
      const result = updated.rows[0]!;

      if (result.invoice_id) {
        await client.query(
          `UPDATE invoices SET status = 'paid', paid_at = $2, payment_id = $3, updated_at = now()
            WHERE id = $1 AND status <> 'paid'`,
          [result.invoice_id, transfer.blockTime, result.id],
        );
      }
      return result;
    });

    if (!settled) return null;

    await enqueue(
      this.pool,
      settled.merchant_id,
      "payment.confirmed",
      publicPayment(settled),
      `${settled.id}:confirmed`,
    );
    if (settled.invoice_id) {
      await enqueue(
        this.pool,
        settled.merchant_id,
        "invoice.paid",
        { invoice_id: settled.invoice_id, payment: publicPayment(settled) },
        `${settled.invoice_id}:paid`,
      );
    }
    return settled;
  }

  /** Mark payments whose window has closed, so they stop being watched. */
  async expireStale(): Promise<number> {
    const { rows } = await this.pool.query<Payment>(
      `UPDATE payments
          SET status = 'expired', updated_at = now()
        WHERE status IN ('created', 'pending') AND expires_at IS NOT NULL AND expires_at < now()
        RETURNING *`,
    );
    for (const payment of rows) {
      await enqueue(
        this.pool,
        payment.merchant_id,
        "payment.failed",
        { ...publicPayment(payment), reason: "expired before payment was received" },
        `${payment.id}:expired`,
      );
    }
    return rows.length;
  }

  // --- Payment links ----------------------------------------------------

  async createLink(input: {
    merchantId: string;
    description: string;
    fiatAmountCents?: bigint;
    fiatCurrency?: string;
    amount?: bigint;
    maxUses?: number;
    expiresAt?: Date;
    callbackUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    if (input.amount === undefined && (input.fiatAmountCents === undefined || !input.fiatCurrency)) {
      throw new PaymentError("a payment link needs either `amount` or `fiat_amount` and `currency`");
    }
    const id = newLinkId();
    const slug = newSlug();
    const { rows } = await this.pool.query(
      `INSERT INTO payment_links
         (id, merchant_id, slug, fiat_amount_cents, fiat_currency, amount, description,
          max_uses, expires_at, callback_url, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        id,
        input.merchantId,
        slug,
        input.fiatAmountCents?.toString() ?? null,
        input.fiatCurrency ?? null,
        input.amount?.toString() ?? null,
        input.description,
        input.maxUses ?? null,
        input.expiresAt ?? null,
        input.callbackUrl ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return rows[0] as Record<string, unknown>;
  }

  /**
   * Open a payment link: create the payment a customer will actually pay.
   *
   * The use count is incremented in the same statement that checks the cap, so
   * concurrent opens cannot both slip past a `max_uses` of one.
   */
  async openLink(slug: string): Promise<{ link: Record<string, unknown>; payment: Payment }> {
    const { rows } = await this.pool.query<{
      id: string;
      merchant_id: string;
      fiat_amount_cents: string | null;
      fiat_currency: string | null;
      amount: string | null;
      description: string;
      metadata: Record<string, unknown>;
    }>(
      `UPDATE payment_links
          SET use_count = use_count + 1
        WHERE slug = $1
          AND active = true
          AND (expires_at IS NULL OR expires_at > now())
          AND (max_uses IS NULL OR use_count < max_uses)
        RETURNING *`,
      [slug],
    );
    if (rows.length === 0) {
      throw new PaymentError("this payment link is not available: it may be inactive, expired or fully used", 404);
    }
    const link = rows[0]!;

    const payment = await this.create({
      merchantId: link.merchant_id,
      ...(link.amount ? { amount: BigInt(link.amount) } : {}),
      ...(link.fiat_amount_cents ? { fiatAmountCents: BigInt(link.fiat_amount_cents) } : {}),
      ...(link.fiat_currency ? { fiatCurrency: link.fiat_currency } : {}),
      description: link.description,
      paymentLinkId: link.id,
      metadata: link.metadata,
    });
    return { link: link as unknown as Record<string, unknown>, payment };
  }

  // --- Invoices ---------------------------------------------------------

  async createInvoice(input: {
    merchantId: string;
    number: string;
    customerName: string;
    customerEmail?: string;
    lineItems: Array<{ description: string; quantity: number; unitPriceCents: number }>;
    taxCents?: bigint;
    currency: string;
    dueDate?: string;
    notes?: string;
  }): Promise<Record<string, unknown>> {
    if (input.lineItems.length === 0) throw new PaymentError("an invoice needs at least one line item");

    let subtotal = 0n;
    for (const item of input.lineItems) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new PaymentError(`line item ${JSON.stringify(item.description)} has an invalid quantity`);
      }
      if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
        throw new PaymentError(`line item ${JSON.stringify(item.description)} has an invalid unit price`);
      }
      subtotal += BigInt(item.quantity) * BigInt(item.unitPriceCents);
    }
    const tax = input.taxCents ?? 0n;
    const total = subtotal + tax;

    const { rows } = await this.pool.query(
      `INSERT INTO invoices
         (id, merchant_id, number, customer_name, customer_email, line_items,
          subtotal_cents, tax_cents, total_cents, currency, due_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        newInvoiceId(),
        input.merchantId,
        input.number,
        input.customerName,
        input.customerEmail ?? null,
        JSON.stringify(input.lineItems),
        subtotal.toString(),
        tax.toString(),
        total.toString(),
        input.currency,
        input.dueDate ?? null,
        input.notes ?? null,
      ],
    );
    return rows[0] as Record<string, unknown>;
  }

  /** Move an invoice to `sent` and attach a payment for the customer to pay. */
  async sendInvoice(merchantId: string, invoiceId: string): Promise<{ invoice: Record<string, unknown>; payment: Payment }> {
    const { rows } = await this.pool.query<{
      id: string;
      status: string;
      total_cents: string;
      currency: string;
      number: string;
      customer_name: string;
    }>("SELECT * FROM invoices WHERE id = $1 AND merchant_id = $2", [invoiceId, merchantId]);
    if (rows.length === 0) throw new PaymentError("invoice not found", 404);
    const invoice = rows[0]!;
    if (invoice.status !== "draft") {
      throw new PaymentError(`invoice ${invoice.number} is already ${invoice.status}`);
    }

    const payment = await this.create({
      merchantId,
      fiatAmountCents: BigInt(invoice.total_cents),
      fiatCurrency: invoice.currency,
      description: `Invoice ${invoice.number} — ${invoice.customer_name}`,
      invoiceId: invoice.id,
      expiresInSeconds: 30 * 24 * 3_600,
    });

    const updated = await this.pool.query(
      `UPDATE invoices SET status = 'sent', sent_at = now(), payment_id = $2, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [invoice.id, payment.id],
    );
    return { invoice: updated.rows[0] as Record<string, unknown>, payment };
  }

  // --- Refunds ----------------------------------------------------------

  /**
   * Record a refund.
   *
   * A refund is a **new on-chain payment** from the merchant to the customer,
   * not a reversal: a settled payment on a BFT chain is settled. This records
   * the intent and links it to the original so reconciliation stays honest; the
   * merchant's own wallet or treasury service performs the transfer and reports
   * the hash back.
   */
  async createRefund(input: {
    merchantId: string;
    paymentId: string;
    amount?: bigint;
    reason?: string;
  }): Promise<Record<string, unknown>> {
    const payment = await this.get(input.merchantId, input.paymentId);
    if (payment.status !== "confirmed" && payment.status !== "finalized") {
      throw new PaymentError(
        `payment ${payment.id} is ${payment.status}; only a settled payment can be refunded`,
      );
    }
    if (!payment.from_address) {
      throw new PaymentError(`payment ${payment.id} has no known payer address to refund to`);
    }
    const received = BigInt(payment.received_amount ?? "0");

    const { rows: existing } = await this.pool.query<{ total: string | null }>(
      `SELECT SUM(amount)::numeric AS total FROM refunds
        WHERE payment_id = $1 AND status <> 'failed'`,
      [payment.id],
    );
    const alreadyRefunded = BigInt(existing[0]?.total ?? "0");
    const amount = input.amount ?? received - alreadyRefunded;

    if (amount <= 0n) throw new PaymentError("refund amount must be positive");
    if (alreadyRefunded + amount > received) {
      throw new PaymentError(
        `refunding ${formatYZXA(amount)} YZXA would exceed the ${formatYZXA(received)} YZXA received ` +
          `(${formatYZXA(alreadyRefunded)} already refunded)`,
      );
    }

    const { rows } = await this.pool.query(
      `INSERT INTO refunds (id, merchant_id, payment_id, amount, reason, to_address)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        newRefundId(),
        input.merchantId,
        payment.id,
        amount.toString(),
        input.reason ?? null,
        payment.from_address,
      ],
    );

    if (alreadyRefunded + amount === received) {
      await this.pool.query("UPDATE payments SET status = 'refunded', updated_at = now() WHERE id = $1", [
        payment.id,
      ]);
      await enqueue(
        this.pool,
        input.merchantId,
        "payment.refunded",
        publicPayment({ ...payment, status: "refunded" }),
        `${payment.id}:refunded`,
      );
    }
    return rows[0] as Record<string, unknown>;
  }

  /** Attach the on-chain transaction that fulfilled a refund. */
  async recordRefundTx(merchantId: string, refundId: string, txHash: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE refunds SET status = 'sent', tx_hash = $3 WHERE id = $1 AND merchant_id = $2 AND tx_hash IS NULL`,
      [refundId, merchantId, txHash],
    );
    if (rowCount === 0) throw new PaymentError("refund not found, or a transaction is already recorded", 404);
  }

  /**
   * Nudge an amount upwards until it is unique among the outstanding payments
   * to an address.
   *
   * Upwards, never downwards: the merchant must never be quoted less than the
   * price. If no unique value is found within the window the payment is
   * refused rather than created ambiguously.
   */
  async #uniqueAmount(address: string, desired: bigint): Promise<bigint> {
    const MAX_ADJUSTMENT = 4_096n;
    const { rows } = await this.pool.query<{ expected_amount: string }>(
      `SELECT expected_amount FROM payments
        WHERE expected_address = $1
          AND status IN ('created', 'pending')
          AND expected_amount >= $2::numeric
          AND expected_amount < ($2::numeric + $3::numeric)`,
      [address, desired.toString(), MAX_ADJUSTMENT.toString()],
    );
    const taken = new Set(rows.map((r) => r.expected_amount));
    for (let delta = 0n; delta < MAX_ADJUSTMENT; delta++) {
      const candidate = desired + delta;
      if (!taken.has(candidate.toString())) return candidate;
    }
    throw new PaymentError(
      "too many outstanding payments for the same amount; retry shortly or settle the existing ones",
      409,
    );
  }

  async #merchant(id: string): Promise<{ id: string; settlement_address: string; status: string }> {
    const { rows } = await this.pool.query<{ id: string; settlement_address: string; status: string }>(
      "SELECT id, settlement_address, status FROM merchants WHERE id = $1",
      [id],
    );
    if (rows.length === 0) throw new PaymentError("merchant not found", 404);
    if (rows[0]!.status !== "active") throw new PaymentError(`merchant is ${rows[0]!.status}`, 403);
    return rows[0]!;
  }
}

/**
 * The public shape of a payment.
 *
 * `expected_amount_yzxa` and friends are display conveniences. The
 * authoritative figure is always the base-unit string, and both are returned so
 * an integrator is never tempted to parse the formatted one.
 */
export function publicPayment(payment: Payment): Record<string, unknown> {
  const expected = BigInt(payment.expected_amount);
  const received = payment.received_amount ? BigInt(payment.received_amount) : null;
  return {
    id: payment.id,
    status: payment.status,
    expected_amount: payment.expected_amount,
    expected_amount_yzxa: formatYZXA(expected),
    expected_address: payment.expected_address,
    received_amount: payment.received_amount,
    received_amount_yzxa: received === null ? null : formatYZXA(received),
    fiat_amount_cents: payment.fiat_amount_cents,
    fiat_currency: payment.fiat_currency,
    quote_rate: payment.quote_rate,
    quote_source: payment.quote_source,
    quote_expires_at: payment.quote_expires_at,
    tx_hash: payment.tx_hash,
    from_address: payment.from_address,
    block_height: payment.block_height,
    confirmed_at: payment.confirmed_at,
    description: payment.description,
    reference: payment.reference,
    metadata: payment.metadata,
    invoice_id: payment.invoice_id,
    payment_link_id: payment.payment_link_id,
    expires_at: payment.expires_at,
    created_at: payment.created_at,
  };
}
