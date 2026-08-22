-- YOZEXA Pay schema.
--
-- The blockchain is the source of truth for money. This database is a
-- projection of it plus the commercial context the chain has no concept of:
-- who the merchant is, what the customer ordered, which invoice a payment
-- settles.
--
-- Two rules run through the whole schema:
--
--   1. Monetary values are NUMERIC(40,0) holding integer base units (ayzxa).
--      Never a float, never a money type with an implicit locale.
--   2. Anything that must not happen twice has a unique constraint enforcing
--      it, not application logic hoping for the best.

CREATE TABLE IF NOT EXISTS merchants (
    id              TEXT PRIMARY KEY,
    name            TEXT        NOT NULL,
    email           TEXT        NOT NULL,
    country         TEXT,
    -- The chain address this merchant settles to. Payments are watched
    -- against it; it is never derived from anything this service controls.
    settlement_address TEXT     NOT NULL,
    default_currency   TEXT     NOT NULL DEFAULT 'EUR',
    plan            TEXT        NOT NULL DEFAULT 'starter',
    status          TEXT        NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT merchants_status_valid CHECK (status IN ('active', 'suspended', 'closed')),
    CONSTRAINT merchants_plan_valid CHECK (plan IN ('starter', 'pro', 'business', 'enterprise'))
);

-- API keys. Only a SHA-256 hash of the key is stored: a leaked database does
-- not hand an attacker working credentials, and a lost key cannot be recovered,
-- only rotated.
CREATE TABLE IF NOT EXISTS api_keys (
    id              TEXT PRIMARY KEY,
    merchant_id     TEXT        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    -- The environment the key belongs to. A test key can never act on mainnet
    -- and a live key can never act on a test network; the prefix is checked
    -- against the service's configured chain on every request.
    environment     TEXT        NOT NULL,
    key_hash        TEXT        NOT NULL UNIQUE,
    key_prefix      TEXT        NOT NULL,
    -- The HMAC secret used to sign requests and verify webhooks.
    secret_hash     TEXT        NOT NULL,
    scopes          TEXT[]      NOT NULL DEFAULT ARRAY['payments:read','payments:write'],
    ip_allowlist    TEXT[],
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 300,
    last_used_at    TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT api_keys_env_valid CHECK (environment IN ('test', 'live'))
);
CREATE INDEX IF NOT EXISTS api_keys_merchant_idx ON api_keys(merchant_id);

-- Payments.
--
-- expected_address + expected_amount is what the indexer watches for. The
-- unique index on the settling transaction hash is what makes double-crediting
-- impossible even if a webhook or an indexer pass runs twice.
CREATE TABLE IF NOT EXISTS payments (
    id              TEXT PRIMARY KEY,
    merchant_id     TEXT        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    status          TEXT        NOT NULL DEFAULT 'created',
    -- What the merchant charged, in their own currency.
    fiat_amount_cents BIGINT,
    fiat_currency   TEXT,
    -- What the customer must send, in base units, and the quote that fixed it.
    expected_amount NUMERIC(40,0) NOT NULL,
    expected_address TEXT       NOT NULL,
    quote_rate      NUMERIC(30,10),
    quote_source    TEXT,
    quote_expires_at TIMESTAMPTZ,
    -- What actually arrived.
    received_amount NUMERIC(40,0),
    tx_hash         TEXT,
    from_address    TEXT,
    block_height    BIGINT,
    confirmed_at    TIMESTAMPTZ,
    description     TEXT,
    reference       TEXT,
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    payment_link_id TEXT,
    invoice_id      TEXT,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payments_status_valid CHECK (
        status IN ('created', 'pending', 'confirmed', 'finalized', 'failed', 'expired', 'refunded')
    ),
    CONSTRAINT payments_expected_positive CHECK (expected_amount > 0),
    CONSTRAINT payments_received_non_negative CHECK (received_amount IS NULL OR received_amount >= 0)
);
CREATE INDEX IF NOT EXISTS payments_merchant_idx ON payments(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments(status) WHERE status IN ('created', 'pending');
CREATE INDEX IF NOT EXISTS payments_watch_idx ON payments(expected_address) WHERE status IN ('created', 'pending');
-- One on-chain transaction can settle at most one payment.
CREATE UNIQUE INDEX IF NOT EXISTS payments_tx_hash_unique ON payments(tx_hash) WHERE tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_links (
    id              TEXT PRIMARY KEY,
    merchant_id     TEXT        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    slug            TEXT        NOT NULL UNIQUE,
    fiat_amount_cents BIGINT,
    fiat_currency   TEXT,
    amount          NUMERIC(40,0),
    description     TEXT        NOT NULL,
    -- NULL means unlimited uses; a number caps how many payments it can create.
    max_uses        INTEGER,
    use_count       INTEGER     NOT NULL DEFAULT 0,
    active          BOOLEAN     NOT NULL DEFAULT true,
    expires_at      TIMESTAMPTZ,
    callback_url    TEXT,
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_links_uses_valid CHECK (max_uses IS NULL OR max_uses > 0),
    CONSTRAINT payment_links_amount_present CHECK (amount IS NOT NULL OR fiat_amount_cents IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS payment_links_merchant_idx ON payment_links(merchant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invoices (
    id              TEXT PRIMARY KEY,
    merchant_id     TEXT        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    number          TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'draft',
    customer_name   TEXT        NOT NULL,
    customer_email  TEXT,
    -- Line items live in JSONB because their shape is the merchant's business,
    -- not this service's. The totals below are authoritative.
    line_items      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    subtotal_cents  BIGINT      NOT NULL,
    tax_cents       BIGINT      NOT NULL DEFAULT 0,
    total_cents     BIGINT      NOT NULL,
    currency        TEXT        NOT NULL,
    due_date        DATE,
    payment_id      TEXT,
    notes           TEXT,
    sent_at         TIMESTAMPTZ,
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoices_status_valid CHECK (
        status IN ('draft', 'sent', 'pending', 'paid', 'expired', 'refunded', 'void')
    ),
    CONSTRAINT invoices_totals_add_up CHECK (total_cents = subtotal_cents + tax_cents),
    CONSTRAINT invoices_number_unique UNIQUE (merchant_id, number)
);
CREATE INDEX IF NOT EXISTS invoices_merchant_idx ON invoices(merchant_id, created_at DESC);

-- Refunds are new on-chain payments, not reversals: a settled payment on a BFT
-- chain is settled. This table links a refund to what it refunds so that
-- reconciliation stays honest.
CREATE TABLE IF NOT EXISTS refunds (
    id              TEXT PRIMARY KEY,
    merchant_id     TEXT        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    payment_id      TEXT        NOT NULL REFERENCES payments(id),
    amount          NUMERIC(40,0) NOT NULL,
    reason          TEXT,
    status          TEXT        NOT NULL DEFAULT 'pending',
    tx_hash         TEXT,
    to_address      TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    CONSTRAINT refunds_status_valid CHECK (status IN ('pending', 'sent', 'confirmed', 'failed')),
    CONSTRAINT refunds_amount_positive CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS refunds_payment_idx ON refunds(payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_tx_hash_unique ON refunds(tx_hash) WHERE tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id              TEXT PRIMARY KEY,
    merchant_id     TEXT        NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    url             TEXT        NOT NULL,
    secret_hash     TEXT        NOT NULL,
    events          TEXT[]      NOT NULL,
    active          BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_merchant_idx ON webhook_endpoints(merchant_id);

-- Every delivery attempt is recorded, including the response, so a merchant
-- can see exactly why a webhook did not arrive rather than guessing.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              TEXT PRIMARY KEY,
    endpoint_id     TEXT        NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    event_type      TEXT        NOT NULL,
    payload         JSONB       NOT NULL,
    -- Deduplicates: one event is delivered to one endpoint at most once.
    idempotency_key TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending',
    attempts        INTEGER     NOT NULL DEFAULT 0,
    last_status_code INTEGER,
    last_error      TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT webhook_deliveries_status_valid CHECK (status IN ('pending', 'delivered', 'failed', 'exhausted'))
);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_idem
    ON webhook_deliveries(endpoint_id, idempotency_key);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
    ON webhook_deliveries(next_attempt_at) WHERE status = 'pending';

-- Idempotency. A payments API without this can charge a customer twice on a
-- network timeout, which is not an edge case: it is the normal behaviour of
-- the internet.
CREATE TABLE IF NOT EXISTS idempotency_keys (
    merchant_id     TEXT        NOT NULL,
    key             TEXT        NOT NULL,
    -- The request fingerprint, so replaying a key with a *different* body is
    -- an error rather than silently returning the wrong response.
    request_hash    TEXT        NOT NULL,
    response_status INTEGER     NOT NULL,
    response_body   JSONB       NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (merchant_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx ON idempotency_keys(created_at);

-- An append-only record of every authenticated mutation.
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    merchant_id     TEXT,
    api_key_id      TEXT,
    action          TEXT        NOT NULL,
    resource_type   TEXT,
    resource_id     TEXT,
    ip_address      TEXT,
    detail          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_merchant_idx ON audit_log(merchant_id, created_at DESC);

-- The indexer's view of the chain. Blocks and transfers are stored so that
-- payment detection, the explorer and reconciliation all read the same data.
CREATE TABLE IF NOT EXISTS indexed_blocks (
    height          BIGINT PRIMARY KEY,
    hash            TEXT        NOT NULL,
    block_time      TIMESTAMPTZ NOT NULL,
    tx_count        INTEGER     NOT NULL DEFAULT 0,
    proposer        TEXT,
    app_hash        TEXT,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS indexed_transfers (
    id              BIGSERIAL PRIMARY KEY,
    tx_hash         TEXT        NOT NULL,
    block_height    BIGINT      NOT NULL REFERENCES indexed_blocks(height) ON DELETE CASCADE,
    block_time      TIMESTAMPTZ NOT NULL,
    -- A transaction can contain several transfers (a multisend); the index
    -- within the transaction disambiguates them.
    transfer_index  INTEGER     NOT NULL,
    from_address    TEXT        NOT NULL,
    to_address      TEXT        NOT NULL,
    amount          NUMERIC(40,0) NOT NULL,
    memo            TEXT,
    CONSTRAINT indexed_transfers_unique UNIQUE (tx_hash, transfer_index),
    CONSTRAINT indexed_transfers_amount_positive CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS indexed_transfers_to_idx ON indexed_transfers(to_address, block_height DESC);
CREATE INDEX IF NOT EXISTS indexed_transfers_from_idx ON indexed_transfers(from_address, block_height DESC);

CREATE TABLE IF NOT EXISTS indexer_state (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    last_indexed_height BIGINT  NOT NULL DEFAULT 0,
    chain_id            TEXT    NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
