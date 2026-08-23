-- Three races that only appear under concurrent load.
--
-- Each one was reachable with two simultaneous requests, and each one costs
-- somebody money: a payment charged twice, a payment credited to the wrong
-- order, or a signed request replayed.

-- 1. Idempotency was recorded only *after* the request ran, so two concurrent
--    requests with the same key both found nothing and both executed. The
--    second insert lost the race harmlessly — the second charge did not.
--
--    The key is now claimed before the work starts, which makes the primary
--    key do the excluding. These columns describe a claim that has not
--    finished yet.
ALTER TABLE idempotency_keys
    ALTER COLUMN response_status DROP NOT NULL,
    ALTER COLUMN response_body   DROP NOT NULL;

ALTER TABLE idempotency_keys
    ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'completed'
        CHECK (state IN ('in_progress', 'completed')),
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- A claim whose request died leaves a row nobody will ever complete. Finding
-- them cheaply is what lets the sweeper release them.
CREATE INDEX IF NOT EXISTS idempotency_keys_in_progress_idx
    ON idempotency_keys (claimed_at) WHERE state = 'in_progress';

-- 2. Every payment is created with an amount unique among that merchant's
--    outstanding payments, because settlement matches an incoming transfer by
--    exact amount. That uniqueness was chosen by reading the table and then
--    inserting — two concurrent creates read the same rows, picked the same
--    amount, and both inserted. Settlement then had two candidates for one
--    transfer and could credit the wrong order.
--
--    Reading with a lock does not fix it: row locks cannot lock rows that do
--    not exist yet. The database enforces it instead, so the invariant holds
--    even against a code path that forgets to be careful.
CREATE UNIQUE INDEX IF NOT EXISTS payments_outstanding_amount_idx
    ON payments (expected_address, expected_amount)
    WHERE status IN ('created', 'pending');

-- 3. A signed request carries a nonce that nothing recorded, so the same
--    signed body could be replayed for the whole five-minute signature window.
--    Idempotency does not cover it: a replay without an Idempotency-Key is a
--    second payment.
CREATE TABLE IF NOT EXISTS used_nonces (
    api_key_id TEXT        NOT NULL,
    nonce      TEXT        NOT NULL,
    used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (api_key_id, nonce)
);
-- Nonces older than the signature window can never be accepted again, so they
-- are swept rather than kept forever.
CREATE INDEX IF NOT EXISTS used_nonces_used_at_idx ON used_nonces(used_at);

-- 4. Request signing computed its HMAC over the *hash* of the API secret while
--    the client signs with the secret itself, so a signature could never
--    verify and any caller that opted into signing was locked out with 401.
--
--    The secret is stored encrypted, exactly as webhook secrets are: the hash
--    stays for identification, and the encrypted copy is what the server signs
--    with. Making the client sign with the hash would have "fixed" the
--    mismatch by turning a stored value into a bearer credential.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS secret_encrypted TEXT;
