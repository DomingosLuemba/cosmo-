# YOZEXA APIs

Two distinct APIs. Do not confuse them.

- **Node API** (`chain/rpc`, default `:1717`) — the network's own read and
  broadcast interface. Public, unauthenticated, no accounts. Anyone can run a
  node and serve it.
- **YOZEXA Pay API** (`pay/`) — a commercial service of YOZEXA Labs. Requires an
  API key, has merchant accounts, and is documented in the second half of this
  file.

## Node API

Base: `http://<node>:1717`

Every response is JSON. Monetary values are decimal **strings** in `ayzxa`
(10^-18 YZXA); fields suffixed `_yzxa` or `_yoz` are formatted for display only.

### Read

| Endpoint | Returns |
|---|---|
| `GET /v1/health` | liveness |
| `GET /v1/status` | chain id, height, version, supply, and `network_warning` on any non-mainnet chain |
| `GET /v1/supply` | max, minted, burned, circulating, remaining mintable |
| `GET /v1/supply/verify` | full audit report with a `supply_cap` verdict of `VALID` or `INVALID` |
| `GET /v1/params` | consensus parameters |
| `GET /v1/feemarket` | base fee and the three wallet fee tiers |
| `GET /v1/emission` | era, current block reward, reserve remaining |
| `GET /v1/invariants` | every invariant evaluated against live state |
| `GET /v1/account/{address}` | balance, spendable, locked, sequence, alias, vesting |
| `GET /v1/account/{address}/proof` | Merkle proof of the account row against the app hash |
| `GET /v1/validators` | the whole validator set with stake, commission and status |
| `GET /v1/validator/{operator}` | one validator |
| `GET /v1/delegations/{address}` | stake positions with pending rewards |
| `GET /v1/unbonding/{address}` | unbonding queue |
| `GET /v1/vesting` | every public vesting position |
| `GET /v1/proposals`, `GET /v1/proposal/{id}` | governance |
| `GET /v1/grants/{granter}` | delegated spending permissions |
| `GET /v1/alias/{name}` | resolve a YOZEXA ID |
| `GET /v1/blocks?limit=20`, `GET /v1/block/{height}` | blocks |
| `GET /v1/tx/{hash}` | a transaction with its finality state |

### Simulate — read this before building a signing screen

```
POST /v1/simulate
{ "tx": { …signed transaction… } }
```

Returns the plain-language effects, the gas required, the exact fee, the
signer's balance and spendable amount, and explicit warnings:

```json
{
  "valid": true,
  "signer": "yzx1…",
  "gas_required": 21568,
  "estimated_fee_yzxa": "0.000054384",
  "effects": [
    { "kind": "payment",
      "description": "Send 0.00025 YZXA to yzx1kem73…",
      "amount_yoz": "25.0" }
  ],
  "warnings": []
}
```

A wallet's job is to display these, not to summarise them away.

### Broadcast

```
POST /v1/tx
{ "tx": { … }, "mode": "sync" | "commit" }
```

`sync` returns once the mempool accepts it (`status: "pending"`). `commit` waits
for inclusion (`status: "confirmed"` or `"failed"`).

**`pending` is not settlement.** Poll `GET /v1/tx/{hash}` until `confirmed` or
`finalized`. The response carries an `explanation` field stating in words what
the state means, so an integration cannot accidentally treat mempool acceptance
as a settled payment.

## YOZEXA Pay API

Base: `https://api.yozexa.<tld>/v1` (self-hosted: `pay/`)

### Authentication

```
Authorization: Bearer yzk_live_…
```

Keys are `yzk_live_…` or `yzk_test_…`. **A test key can never touch mainnet and
a live key can never touch a test network** — the prefix is checked against the
service's configured chain.

Only a SHA-256 hash of each key is stored. A lost key cannot be recovered, only
rotated.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/payments` | create a payment intent |
| `GET` | `/v1/payments/{id}` | payment status |
| `GET` | `/v1/payments` | list and filter payments |
| `POST` | `/v1/payment-links` | create a reusable payment link |
| `GET` | `/v1/payment-links/{id}` | link details |
| `POST` | `/v1/invoices` | create an invoice |
| `POST` | `/v1/invoices/{id}/send` | mark an invoice sent |
| `POST` | `/v1/refunds` | refund a payment |
| `GET` | `/v1/balances` | merchant settlement balances |
| `GET` | `/v1/transactions` | ledger for reconciliation |
| `POST` | `/v1/webhooks` | register a webhook endpoint |
| `GET` | `/v1/webhooks/{id}/deliveries` | delivery attempts and responses |

### Idempotency

Every `POST` accepts `Idempotency-Key`. Replaying a request with the same key
returns the original response and does **not** create a second payment or a
second refund. Keys are scoped per merchant and retained 24 hours.

This is not optional for a payments API. A network timeout must never be able to
charge a customer twice.

### Request signing

For high-value operations, sign the request:

```
X-Yozexa-Timestamp: 1766000000
X-Yozexa-Nonce: 5f3a…
X-Yozexa-Signature: hex(HMAC_SHA256(secret, timestamp + "." + nonce + "." + body))
```

Timestamps outside a five-minute window are rejected; nonces are single-use, so
a captured request cannot be replayed.

### Webhooks

Events:

```
payment.created      payment.pending     payment.confirmed
payment.finalized    payment.failed      payment.refunded
invoice.paid         subscription.charged
```

Every delivery is signed:

```
X-Yozexa-Signature: t=<unix>,v1=<hex HMAC_SHA256(secret, t + "." + body)>
```

Verify the signature and reject timestamps older than five minutes **before**
parsing the body. Deliveries retry with exponential backoff. Handlers must be
idempotent — a webhook can arrive more than once, and treating a duplicate
`payment.confirmed` as a second payment is a way to lose money.

### Rate limits

Per API key, returned on every response:

```
X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
```

Exceeding them returns `429` with `Retry-After`.

## SDKs

- `@yozexa/sdk` — TypeScript, in `sdk/typescript`. Node API client, transaction
  builder and secp256k1 signer.
- Planned: Python, Swift, Kotlin, Go, Rust. The Go client already exists in
  `chain/client` and is used by the CLI.
