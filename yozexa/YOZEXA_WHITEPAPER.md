# YOZEXA — A Monetary Network for Payments

**Version 0.1 · Working draft**

This is a working document describing a system under construction. Sections
marked **Implemented** correspond to code in this repository with tests you can
run. Sections marked **Planned** do not exist yet. Nothing here is an offer, a
prospectus, or a promise of any return.

---

## Abstract

YOZEXA is a sovereign proof-of-stake Layer 1 built for payments, with a fixed
supply of 10,000,000 YZXA enforced by the protocol rather than by policy.

It is designed around three commitments. First, that the supply cap is a
property of the software and not a promise: one function creates currency, it
refuses to exceed the cap, and an invariant halts the network rather than let it
drift. Second, that a payment is settled or it is not — BFT finality means a
committed block cannot be replaced, and every interface distinguishes pending
from confirmed rather than blurring them. Third, that authority is always
bounded: an unlimited spending permission cannot be expressed on this network,
the founder cannot move locked tokens, and governance cannot mint.

On top of the network, YOZEXA Labs builds commercial products — a wallet, a
payments service, business tooling, developer APIs. The network does not depend
on the company. If YOZEXA Labs disappeared, the chain would keep producing
blocks and every wallet would keep working.

## 1. The problem

Moving money across borders is slow, expensive and unevenly available. A
remittance to Angola can cost several percent and take days. A merchant in
Luanda who wants to accept payment from a customer in Lisbon has few good
options. A developer who wants to charge $0.001 for an API call has none.

Existing crypto networks solve parts of this and create new problems:

- **Volatility** makes a currency hard to price in — a real limitation, not one
  this document will pretend away.
- **Fee unpredictability** makes small payments uneconomic.
- **Unclear finality** means merchants wait for confirmations and guess.
- **Unbounded approvals** mean a single careless signature can drain an account.
- **Opaque insider allocations** mean the people who built the system can often
  sell into it before anyone else can react.

YOZEXA does not solve volatility. It addresses the other four directly, in the
protocol.

## 2. Design commitments

**The supply cap is enforced, not promised.** 10,000,000 YZXA, as a compile-time
constant. Every unit that has ever existed passed through one `Mint` function
that checks the cap. An invariant re-checks it at the end of every block, in
production. A violated invariant stops the node — because a halted chain can be
diagnosed, while a chain that quietly created a coin has already paid it to
somebody.

**Nothing is invented that does not need to be.** Consensus is CometBFT.
Cryptography is secp256k1, Ed25519, SHA-256, BIP-39, scrypt, XChaCha20-Poly1305,
bech32. The parts YOZEXA writes are the parts specific to YOZEXA: the money.

**Authority is always bounded.** Every delegated spending permission has a total,
a rate, an expiry and an allow-list. The treasury has a per-epoch cap and a
timelock. The founder's allocation is locked by the transfer path itself.

**A payment is settled or it is not.** Every interface reports pending,
confirmed and finalized as distinct states, and says in words what each means.

## 3. Architecture — *Implemented*

```
Wallet · Pay · Business · Explorer      products
                 ↓ HTTPS
Node HTTP API (/v1/…)                    read, simulate, broadcast
                 ↓ ABCI 2.0
YOZEXA state machine                     money, staking, governance, invariants
                 ↓
CometBFT                                 consensus, p2p, evidence, mempool
```

State is authenticated by a sparse Merkle tree over SHA-256-hashed keys. The
root is in every block header, so divergence halts consensus instead of silently
forking balances, and a wallet can be given a proof that an account holds a
balance — or that a key does not exist — without trusting the node that served
it.

Transactions are canonical JSON under a restricted RFC 8785 profile. The chain
id is inside the signed payload, so a testnet signature is worthless on mainnet.
Signatures are fixed-width `r‖s` with low-S enforced, so one signed intent
cannot be re-encoded into a second valid transaction with a different hash.

## 4. Consensus — *Implemented*

CometBFT with proof of stake. Safety while under 1/3 of voting power is
Byzantine; liveness while over 2/3 is online. Blocks are final on commit.

Target block time is 2–4 seconds. **That figure will not be published as a
specification until it has been measured on a public testnet with independently
operated validators across multiple regions.** Numbers measured on one machine
are not network performance.

Staking uses share accounting, so slashing reduces a validator's tokens without
touching shares and every delegator takes the loss pro rata. Downtime jails;
double signing burns 5% and **tombstones the consensus key permanently**,
including any unbonding stake that was in flight at the time. Redelegation is
queued through the unbonding period rather than instant, which removes an entire
class of accounting bug at the cost of convenience.

## 5. Economics — *Implemented*

| Category | % | YZXA |
|---|---|---|
| Network emission | 50 | 5,000,000 |
| Ecosystem / developers | 15 | 1,500,000 |
| Liquidity | 10 | 1,000,000 |
| Treasury | 10 | 1,000,000 |
| Team | 8 | 800,000 |
| Founder | 5 | 500,000 |
| Security | 2 | 200,000 |

The emission share is **not in anyone's wallet**. It is created one block reward
at a time: 0.125 YZXA per block, halving every 20,000,000 blocks. The geometric
sum converges to exactly 5,000,000, and integer flooring means it can only come
in under, never over.

Founder tokens vest over 8 years behind a 2-year cliff; team tokens over 6 years
behind a 1-year cliff. The lock lives inside the transfer path: the holder
cannot spend or stake a locked unit with full control of their private key, and
no message or governance proposal can shorten a schedule.

Fees follow EIP-1559: a base fee that adjusts towards a gas target and is
burned, plus a tip that orders transactions. The sender pays `gas_used ×
gas_price`, never the limit. A failed transaction still pays, which is what makes
spam expensive.

**YOZEXA is not a stablecoin, and this codebase contains no statement of what
one YZXA is worth.** Fiat figures in the products are market references from
external sources, labelled and timestamped.

## 6. Bounded authority — *Implemented*

The primitive behind subscriptions, device session keys and AI agent wallets is
a protocol-level **grant**:

- a mandatory total;
- an optional per-period cap, on a window anchored to the grant's start so a
  grantee cannot extend its allowance by choosing when to transact;
- an optional recipient allow-list;
- an explicit message-type allow-list, itself restricted so governance voting,
  validator creation, alias transfer and grant management can never be delegated;
- an optional per-transaction ceiling above which the holder must sign directly;
- a mandatory expiry, at most one year.

Authorisation and accounting are the same operation, so no path checks a limit
and forgets to charge it. Nested delegation is refused.

An AI agent therefore holds a key that is *structurally incapable* of draining
the account it acts for, whatever software it runs. It never holds the main key.

## 7. Identity — *Implemented*

YOZEXA IDs (`maria.yzx`) resolve to accounts. The character set is restricted to
lowercase ASCII with no doubled or edge hyphens and no all-numeric names, and
reserved names are blocked. This makes homograph impersonation **inexpressible**
rather than merely detectable — there is no Cyrillic "а" to register.

**No personal data goes on chain.** No message field takes a name, document,
phone number or address. Identity for regulated products stays off-chain and
encrypted.

## 8. Governance — *Implemented*

Voting power is bonded stake, not balance: the people who can lose money decide.
Deposit, quorum (33.4%), threshold (50% of non-abstain), veto (33.4%) and a
2-day timelock so a hostile proposal cannot execute faster than users can react.

There is no proposal type that mints and none that changes a balance directly. A
treasury spend moves existing funds, is capped per epoch, and fails if the
treasury cannot cover it. Parameters are re-validated at execution, and
governance may not set the double-sign slash to zero.

**Decentralisation is staged and measured**: core team → multisig → on-chain
governance → broad validator and community control, with published concentration
metrics gating each step.

## 9. Payments — *Partially implemented*

Settlement, atomic bulk payment (`MsgMultiSend`, up to 1,000 recipients),
spending grants and finality reporting are implemented in the chain. The
commercial layer — checkout, payment links, invoices, subscriptions, refunds,
signed webhooks, reconciliation — is built as a separate service in `pay/`.

A payment link is only "done" when a merchant can create it, a customer can pay
it, the chain confirms it, the indexer detects it, a signed webhook fires, the
dashboard updates, and the merchant can reconcile it without double-counting.
That is the standard applied throughout.

**YOZEXA Labs takes no cut of peer-to-peer transfers.** The network fee is the
only cost of sending YZXA to a person. Labs charges businesses for services.

## 10. Interoperability — *Planned*

The intended path is IBC, which verifies a counterparty chain's consensus with
light-client proofs rather than trusting a committee. Even so: one channel
first, adversarially tested, then more one at a time.

**No bridge exists in this repository, and nothing may be bridged** until
canonical supply accounting, replay protection, rate limits, circuit breakers,
monitoring and an independent audit are all in place. Bridges are where crypto
loses money, repeatedly and foreseeably.

## 11. Smart contracts — *Planned*

EVM compatibility via Cosmos EVM, so Solidity, Foundry, Hardhat, `ethers`,
`viem` and MetaMask work unchanged. Not implemented. The ordering is deliberate:
money that cannot be counterfeited, then payments that settle, then products
people use, then programmability. A chain with a VM and a broken supply
invariant is worth nothing.

Notably, session keys, spending limits, subscriptions and agent wallets already
work **without** a VM, because they are protocol primitives. The safety
properties that matter most for payments should not wait for a virtual machine.

## 12. Micropayments — *Planned*

**YOZEXA Flow**, a Layer 2 for streaming and per-call payments, is a design
target. It does not exist. No product should be sold on the basis that it does.

## 13. Risks

Stated plainly, because a whitepaper without a real risk section is marketing.

- **Volatility.** YZXA has no price floor and no stability mechanism. A merchant
  accepting it takes currency risk, mitigated only by quoting in fiat and
  settling quickly.
- **Adoption.** A payment network with no merchants is worth nothing. This is the
  dominant risk, and it is commercial, not technical.
- **Security budget after emission.** As the block reward halves, fee revenue
  must carry validator economics. That depends on real volume existing.
- **Stake concentration.** A cartel above 2/3 of voting power can commit whatever
  the state machine accepts. No BFT protocol survives that; the defence is
  distribution, monitoring and time to exit.
- **Regulation.** Custody, fiat exchange, cards and regulated settlement require
  licences that differ by jurisdiction. The base network is permissionless; the
  products on top are not automatically so, and a blockchain does not remove
  local law.
- **Bugs.** The code is young. It is tested, fuzzed and invariant-checked, and it
  has not been independently audited. Do not put real value on it yet.
- **Privacy.** Balances and transfers are public. Anyone who links an address to
  a person sees its history. Selective disclosure is a roadmap item, not a
  feature.

## 14. Roadmap

| Phase | Content | Status |
|---|---|---|
| 1 | Core chain: accounts, YZXA, supply cap, staking, RPC, CLI, localnet | **Done** |
| 2 | Wallet: create, import, balance, send, receive, QR, history | In progress |
| 3 | Explorer: blocks, transactions, addresses, validators, supply | In progress |
| 4 | Pay: merchant accounts, links, checkout, invoices, webhooks, refunds | In progress |
| 5 | Business: dashboard, analytics, employees, permissions, API keys | In progress |
| 6 | Smart contracts, developer RPC, faucet, SDKs, documentation | Partial — SDK and faucet built, VM planned |
| 7 | Public testnet with external validators | Not started |
| 8 | Security offensive: audits, fuzzing campaigns, bug bounty, adversarial testnet, chaos | Not started |
| 9 | Mainnet candidate: genesis review, validator onboarding, signed binaries, monitoring | Not started |
| 10 | Mainnet — only when every gate in MAINNET_CHECKLIST.md is met | Not started |

## 15. On money and the people building it

The founder's economics are two separate things, and confusing them is how
projects go wrong.

The founder holds 500,000 YZXA — 5% — locked for two years and released over
eight. If the network becomes valuable, that becomes valuable. It is exposure to
the network's success over years, not income, and it is not guaranteed to be
worth anything.

Separately, YOZEXA Labs is a company that sells services: payment processing,
business tooling, APIs, managed infrastructure. That is intended to be the
primary source of business revenue — money earned from customers, not from
issuing or selling coins.

The treasury belongs to the ecosystem and is spent by governance. Company
revenue belongs to the company. The accounting is separate and stays separate.

The way this project makes money is by building a wallet, a payments service and
business tools that people actually use. Not by printing, not by dumping, and
not by promising anybody a return.

---

*Further reading: [ARCHITECTURE.md](docs/ARCHITECTURE.md),
[MONETARY_POLICY.md](docs/MONETARY_POLICY.md),
[CONSENSUS.md](docs/CONSENSUS.md), [SECURITY.md](docs/SECURITY.md),
[THREAT_MODEL.md](docs/THREAT_MODEL.md),
[MAINNET_CHECKLIST.md](docs/MAINNET_CHECKLIST.md).*
