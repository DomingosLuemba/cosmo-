# YOZEXA Payments

Two layers, deliberately separate:

- **YOZEXA Network** settles payments. It charges a network fee. It is
  permissionless and does not know what a merchant, an invoice or a subscription
  is.
- **YOZEXA Pay** is a commercial product of YOZEXA Labs that gives businesses
  checkout, payment links, invoices, subscriptions, refunds, webhooks and
  reconciliation on top of that settlement.

**YOZEXA Labs does not take a cut of peer-to-peer transfers.** The network fee
is the only cost of sending YZXA to another person. Labs charges for the
services it actually provides to businesses.

## Payment states

| State | Meaning | Merchant action |
|---|---|---|
| `created` | Payment intent exists; nothing on chain | Show the payment screen |
| `pending` | A transaction has been broadcast, not yet in a block | Show "waiting"; do **not** release goods |
| `confirmed` | Included in a committed block | Safe to release goods — CometBFT commits are final |
| `finalized` | Confirmed with at least one block on top | Reconciled |
| `failed` | Executed and reverted, or expired | Nothing was transferred except the sender's fee |
| `refunded` | A separate on-chain payment returned the funds | — |

The distinction between `pending` and `confirmed` is not decoration. A mempool
acceptance is not a payment. Every YOZEXA interface and API reports these states
distinctly, and the node's `/v1/tx/{hash}` returns an `explanation` field
stating in words what the state means.

Note that YOZEXA has no `reorg` state. With BFT finality a committed block
cannot be replaced, so there is no "wait N confirmations" rule to get wrong.

## Quotes and exchange rate

A merchant prices in fiat: `€49.99`. The checkout converts to YZXA at a market
rate and **quotes it for a fixed window** (default 60 seconds), after which the
quote expires and is recalculated.

A quote is never guaranteed indefinitely. The rate source and the quote's expiry
are both shown to the payer, and both are recorded against the payment so a
dispute can be reconstructed.

## Definition of done for a payment link

A payment link is not "done" because a page renders. It is done when all ten of
these hold:

1. the merchant creates a link and it is persisted;
2. a customer opens it;
3. a quote is calculated and shown with its expiry;
4. the payment is sent from any YOZEXA wallet;
5. the chain confirms it;
6. the indexer detects it against the expected address and amount;
7. the webhook fires, signed, with retries;
8. the merchant dashboard updates;
9. the merchant can reconcile it against their own records;
10. the same payment cannot be counted twice.

The same standard applies to invoices, subscriptions and refunds.

## Subscriptions

A subscription is a **spending grant** on the chain, not a stored card:

```
allowed message types : bank/send
allowed recipients    : the merchant's settlement address
per period            : €15 equivalent
period                : 30 days
total                 : 12 × the per-period amount
expires               : 12 months
```

The merchant can charge up to the cap, at most that often, only to itself, and
only until the expiry. The customer can revoke instantly with one transaction.
Neither the merchant nor YOZEXA Labs can exceed the grant, whatever their
software does — the chain enforces it.

**An unlimited spending permission cannot be expressed on YOZEXA.**

## Refunds

A refund is a new on-chain payment from the merchant to the customer, linked to
the original payment in the merchant's records. There is no protocol-level
reversal, and there cannot be one: a settled payment on a BFT chain is settled.
The dashboard tracks refunds against originals so reconciliation stays honest.

## Escrow

Escrow is provided by a spending grant plus a release condition held by the Pay
service, or — when it exists — by a smart contract. It is listed here as a
product capability with the honest caveat that the contract-based version is not
built yet; see [SMART_CONTRACTS.md](SMART_CONTRACTS.md).

## Payroll and bulk payments

`MsgMultiSend` pays up to 1,000 recipients atomically in one transaction: either
every leg succeeds or the transaction fails and nobody is paid. That atomicity
is what makes it safe for payroll — there is no state where half the staff were
paid.

## Machine-to-machine and AI agents

The same grant primitive covers an EV paying a charging station, a robot paying
for cloud compute, an IoT sensor paying a data provider, and an AI agent paying
for an API:

```
maximum per transaction : $5 equivalent
daily limit             : $20 equivalent
allowed recipients      : the specific service addresses
expiry                  : 24 hours
approval required above : $10 equivalent
```

The agent never holds the account's main private key. It holds a key whose
authority is bounded by the chain.

## Micropayments and YOZEXA Flow

Very small, very frequent payments — streaming, per-second GPU rental, per-token
inference billing — are economically awkward on any Layer 1, because each
payment pays a network fee.

**YOZEXA Flow** is the planned Layer 2 for this. It does not exist yet. Nothing
in this repository implements payment channels, and no product should be sold on
the basis that it does. The design work belongs in `docs/` before any code.
