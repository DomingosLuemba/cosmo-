# YOZEXA

A sovereign proof-of-stake Layer 1 for payments, with a fixed supply of
**10,000,000 YZXA** enforced by the protocol, plus the wallet, payments,
business and explorer products built on top of it.

> **Status: pre-mainnet.** The chain runs, settles payments and passes its
> invariants. It has **not** been independently audited. Do not put real value
> on it. Every network is a test network until [the mainnet
> gates](docs/MAINNET_CHECKLIST.md) are met.

---

## Run it in two minutes

```bash
cd yozexa
make devnet          # chain, API, indexer, Pay, explorer, wallet, business, docs
make devnet-status
make devnet-down
```

Or the chain alone:

```bash
cd yozexa/chain
make build                                    # builds ../build/yozexad and yozexa

export YOZEXA_PASSPHRASE='choose-something-long'
export YOZEXA_HOME=/tmp/yozexa-localnet

../build/yozexa keys create validator
../build/yozexad init my-node --network localnet --with-genesis \
    --operator-key validator --passphrase "$YOZEXA_PASSPHRASE"
../build/yozexad start &

../build/yozexa keys create maria
../build/yozexa tx send $(../build/yozexa keys show maria | awk '/address/{print $2}') \
    25 --unit YOZ --from validator

../build/yozexa supply verify
```

## What is here

| Directory | What it is | Status |
|---|---|---|
| [`chain/`](chain) | The Layer 1: state machine, consensus integration, node, CLI, HTTP API, keyring | **Working** |
| [`sdk/`](sdk) | `@yozexa/sdk` — TypeScript client, transaction builder, signer | **Working** |
| [`explorer/`](explorer) | Blocks, transactions, accounts, validators, supply dashboard | **Working** |
| [`wallet/`](wallet) | YOZEXA Wallet (web) | **Working** |
| [`pay/`](pay) | Merchant API: payments, links, invoices, refunds, signed webhooks | **Working** |
| [`business/`](business) | Business dashboard and analytics | **Working** |
| [`indexer/`](indexer) | Chain → PostgreSQL projection | **Working** |
| [`developer/`](developer) | Documentation site and testnet faucet | **Working** |
| [`contracts/`](contracts) | EVM smart contracts | **Planned** — see [SMART_CONTRACTS.md](docs/SMART_CONTRACTS.md) |
| [`bridge/`](bridge) | Interoperability | **Planned, and gated** — see [BRIDGE_SECURITY.md](docs/BRIDGE_SECURITY.md) |
| [`security/`](security) | Bug bounty, audit scope | Policy |
| [`docs/`](docs) | Everything below | — |

Nothing in this table is aspirational. "Planned" means there is no code, and the
corresponding document says so in its first line.

## The parts that matter

**The supply cap is code, not policy.** Every unit of YZXA that has ever existed
passed through one function that checks the 10,000,000 cap. An invariant
re-checks it at the end of every block **in production**. A violation halts the
node — a halted chain can be diagnosed; a chain that quietly created a coin has
already paid it to somebody.

**Founder tokens are locked by the transfer path.** 500,000 YZXA, 2-year cliff,
8-year schedule. The holder cannot spend or stake a locked unit with full
control of their private key, and no message or governance proposal can shorten
a schedule. [Tested.](chain/app/app_test.go)

**Unlimited spending permissions cannot be expressed.** Every delegated
permission — a subscription, a device session key, an AI agent wallet — carries a
mandatory total, an expiry, and optional per-period and recipient limits.
Governance voting can never be delegated. [Tested.](chain/app/security_test.go)

**A payment is settled or it is not.** `pending`, `confirmed` and `finalized`
are distinct states everywhere, and the API returns an `explanation` field
stating in words what each one means.

**Nothing invented that did not need to be.** CometBFT for consensus.
secp256k1, Ed25519, SHA-256, BIP-39, scrypt, XChaCha20-Poly1305, bech32 for
cryptography.

## Documentation

| | |
|---|---|
| [Whitepaper](YOZEXA_WHITEPAPER.md) | What this is and why, with an honest risk section |
| [Architecture](docs/ARCHITECTURE.md) | How the layers fit together |
| [Monetary policy](docs/MONETARY_POLICY.md) | Units, cap, emission, burning, fees |
| [Tokenomics](docs/TOKENOMICS.md) | Distribution and incentives |
| [Consensus](docs/CONSENSUS.md) | Staking, slashing, attack resistance |
| [Vesting](docs/VESTING.md) | Founder and team locks, and why they hold |
| [Governance](docs/GOVERNANCE.md) | Proposals, treasury, decentralisation stages |
| [Validators](docs/VALIDATORS.md) | How to run one without losing money |
| [Security](docs/SECURITY.md) | Invariants, cryptography, testing, reporting |
| [Threat model](docs/THREAT_MODEL.md) | What is defended, what is not |
| [Payments](docs/PAYMENTS.md) | States, quotes, subscriptions, refunds |
| [Wallet security](docs/WALLET_SECURITY.md) | Key handling, signing screens, anti-phishing |
| [API](docs/API.md) | Node API and Pay API |
| [Smart contracts](docs/SMART_CONTRACTS.md) | Plan, and why it is not first |
| [Bridge security](docs/BRIDGE_SECURITY.md) | Requirements before anything is bridged |
| [Incident response](docs/INCIDENT_RESPONSE.md) | Playbooks |
| [Mainnet checklist](docs/MAINNET_CHECKLIST.md) | The gates |

## Tests

```bash
make test    # 98 tests: 48 Go, 50 JavaScript
make fuzz    # a short pass over the parsers, proofs and the state machine
make check   # what CI runs
```

Tests that need PostgreSQL skip themselves when `DATABASE_URL` is unset.

The suite runs real blocks through the real ABCI interface, and includes
adversarial tests for supply-cap breaks, grant abuse, double signing,
governance capture and homograph aliases, plus a randomised traffic test that
asserts every invariant after each of 250 blocks. The Pay tests run against a
real PostgreSQL rather than a mock, because the properties they check —
double-crediting, transactional settlement, idempotency — live in the schema.

Fuzzing and a restart test have each already found a real defect. That is what
they are for; both are described in the git history alongside their fix.

### What has been demonstrated end to end

On a live single-validator localnet, not in a mock:

| | |
|---|---|
| Emission | exactly 0.125 YZXA per block, matching the schedule |
| Payment | 25 YOZ sent from the CLI, settled in a committed block |
| Restart | node stopped at height 24, resumed at 59, kept producing |
| Supply audit | `VALID`, every invariant passing |
| SDK interop | TypeScript signatures accepted by the Go chain, byte for byte |
| Merchant flow | link → checkout → on-chain payment → settled in ~1s → balances reconcile against the chain |
| Webhooks | `payment.created` and `payment.confirmed` delivered signed, and verified by an independent receiver |
| Faucet | proof-of-work required, 10 YZXA paid on chain, replay refused |

## What YOZEXA will not do

No referral rewards. No fixed-return offers. No paying earlier participants with
later participants' money. No wash trading or paid volume — every published
metric separates organic from incentivised. No claim that a business is
trustworthy merely because it accepts YOZEXA. No personal data on chain.

## Naming

`YOZEXA` and the ticker `YZXA` remain **configurable** until trademark review is
final. They are not hard-coded assumptions in the protocol beyond the bech32
prefixes and denom constants, which are collected in `chain/types/denom.go` and
`chain/types/address.go`.

## Licence

See [LICENSE](LICENSE).
