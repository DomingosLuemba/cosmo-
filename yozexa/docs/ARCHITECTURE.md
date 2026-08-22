# YOZEXA Architecture

## Layers

```
                       ┌──────────────────────────────────────────┐
   people & business   │ Wallet · Pay · Business · Explorer · Docs │
                       └────────────────────┬─────────────────────┘
                                            │ HTTPS
                       ┌────────────────────┴─────────────────────┐
   YOZEXA Labs         │ Pay API · Indexer · Business dashboard   │
   (commercial)        │ PostgreSQL · webhooks · API keys          │
                       └────────────────────┬─────────────────────┘
                                            │ HTTP  (/v1/…)
                       ┌────────────────────┴─────────────────────┐
   node API            │ chain/rpc — read state, simulate,         │
                       │ broadcast signed transactions             │
                       └────────────────────┬─────────────────────┘
                                            │ in-process ABCI
                       ┌────────────────────┴─────────────────────┐
   state machine       │ chain/app — accounts, YZXA, staking,      │
   (consensus)         │ slashing, emission, governance, vesting,  │
                       │ grants, fee market, invariants            │
                       └────────────────────┬─────────────────────┘
                                            │ ABCI 2.0
                       ┌────────────────────┴─────────────────────┐
   consensus           │ CometBFT — BFT consensus, p2p, mempool,   │
                       │ evidence, block store                     │
                       └───────────────────────────────────────────┘
```

The dashed line matters: **everything above the node API is replaceable, and
everything below it is the network.** If YOZEXA Labs disappeared tomorrow, the
chain keeps producing blocks, wallets keep working against any node, and anyone
can run `yozexad`. The commercial layer is a customer of the network, not a
component of it.

## Why CometBFT and not a new consensus

Consensus is the part of a blockchain where a subtle bug means either a halted
network or a double spend. CometBFT is a deployed, audited, adversarially tested
BFT implementation with instant finality, evidence handling and double-sign
detection already solved. YOZEXA does not invent a consensus algorithm and does
not invent cryptography. It writes the part that is actually specific to YOZEXA:
the money.

Instant finality also matters commercially. A merchant needs to know when a
payment is settled. With CometBFT a committed block is final — there is no
"wait six confirmations in case of a reorg", because a longer chain cannot
replace a committed one.

## The state machine

`chain/app` is a deterministic program driven by ABCI 2.0:

| ABCI call | What YOZEXA does |
|---|---|
| `InitChain` | validate and apply genesis, mint the allocation through the cap check |
| `CheckTx` | authenticate, verify the sender can pay the fee; mempool gate |
| `PrepareProposal` | select transactions that fit the block gas ceiling |
| `ProcessProposal` | reject a proposal whose transactions are invalid or over gas |
| `FinalizeBlock` | slashing → liveness → emission → reward distribution → transactions → unbonding → governance → fee market → **invariants** |
| `Commit` | atomically persist the block's writes, return the new app hash |
| `Query` | serve state, proofs and the supply audit |

### State

State is a key/value map authenticated by a **sparse Merkle tree** over
SHA-256-hashed keys (`chain/store`). The root goes into the block header, so:

- two honest nodes that processed the same blocks provably hold the same state,
  and divergence halts consensus rather than silently forking balances;
- a wallet or auditor can be handed a proof that an account holds a balance —
  or that a key does *not* exist — without trusting the node that served it.

The tree uses leaf compression, so an empty subtree costs nothing and lookups
are logarithmic in the number of live keys rather than a fixed 256 levels. The
root is proven (by test) to depend only on the *set* of live key/value pairs,
never on insertion order — without that property two validators could commit
different app hashes from identical state.

Keys are human-readable (`acct/…`, `val/…`, `gov/proposal/…`) on purpose: an
auditor reading a raw database dump should be able to tell what every row is.

### Atomicity

Writes stage in memory and become durable only at `Commit`, in one database
batch. Within a block, each transaction snapshots the staged write set at entry
and restores it on failure, so a failing transaction cannot undo earlier
payments in the same block — while the fee it already paid still sticks.

## Modules

Rather than a plugin framework, YOZEXA keeps the data model in `chain/state`
and the transitions in `chain/app`. The module boundaries are by file:

| Concern | State | Logic |
|---|---|---|
| accounts, balances | `state/account.go` | `app/handler.go` |
| supply, mint, burn | `state/supply.go` | `app/lifecycle.go` |
| vesting | `state/vesting.go` | enforced inside `state.Transfer` |
| staking, delegation | `state/staking.go` | `app/staking.go` |
| slashing, liveness | `state/slashing.go` | `app/lifecycle.go` |
| emission | `state/emission.go` | `app/lifecycle.go` |
| governance, treasury | `state/gov.go` | `app/gov.go` |
| spending grants | `state/grant.go` | `app/handler.go` |
| fee market | `state/feemarket.go` | `app/lifecycle.go` |
| YOZEXA ID | `state/alias.go` | `app/handler.go` |
| invariants | — | `app/invariants.go` |

This is a deliberate trade: fewer moving parts and no dependency-injection
plumbing, at the cost of the modularity a plugin system would give. Revisit it
when the first genuinely optional module arrives.

## Transactions

A transaction is canonical JSON: a body (chain id, messages, memo, optional
timeout height) and auth (public key, sequence, fee), plus one secp256k1
signature.

Signed bytes are produced by a restricted RFC 8785 profile — sorted keys, no
insignificant whitespace, integers only, monetary values as strings. Canonical
encoding matters twice over: a signature is only meaningful if signer and
verifier agree bit for bit, and non-canonical encodings are a malleability bug
waiting to happen.

The **chain id is inside the signed payload**. A transaction signed on the
testnet can never be valid on mainnet, and vice versa.

## Repository layout

```
yozexa/
├── chain/          the Layer 1: types, crypto, codec, store, state, app,
│                   node, rpc, client, keyring, cmd/yozexad, cmd/yozexa
├── sdk/            @yozexa/sdk — TypeScript client and signer
├── explorer/       YOZEXA Explorer
├── wallet/         YOZEXA Wallet (web)
├── pay/            YOZEXA Pay — merchant API, payment links, invoices,
│                   webhooks, refunds
├── business/       YOZEXA Business dashboard
├── indexer/        chain → PostgreSQL projection powering Pay and Explorer
├── developer/      docs site and testnet faucet
├── contracts/      smart contract work (see SMART_CONTRACTS.md for status)
├── bridge/         interoperability (see BRIDGE_SECURITY.md for status)
├── infrastructure/ Docker, localnet, deployment
├── monitoring/     metrics, alerts, dashboards
├── security/       threat model, bug bounty, audit scope
├── fuzz/           fuzzing corpus and long-running campaigns
├── formal/         formal specifications of the critical properties
├── tests/          cross-component end-to-end tests
├── docs/           this documentation
└── scripts/        developer tooling
```

## Determinism rules

Anything that runs inside `FinalizeBlock` must be identical on every node:

- **No wall-clock time.** Block time comes from the block header.
- **No map iteration order.** Every iteration that affects state goes through
  the store's ordered `Iterate`, or sorts explicitly.
- **No floating point.** Anywhere. Not even for display inside consensus code.
- **No randomness** that is not derived from committed state.
- **No network or filesystem access** outside the state store.
- **Total ordering with explicit tie-breaks.** The active validator set sorts by
  stake and breaks ties by operator address, because a partial order would let
  two nodes compute different sets from identical state.
