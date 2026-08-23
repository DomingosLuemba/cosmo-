# YOZEXA Governance

## Voting power is stake at risk

An account holding YZXA in a wallet has no say. An account that has bonded it to
a validator does. The people who can lose money from a bad decision are the ones
who decide.

Governance messages can never be delegated to a session key or an agent.

## Proposal lifecycle

```
submit ─► deposit period ─► voting period ─► passed ─► [timelock] ─► executed
             │                    │             │                        │
             └► expired           ├► rejected   └► failed (execution error)
                (deposit burned)  └► vetoed
                                     (deposit burned)
```

| Parameter | Default | Meaning |
|---|---|---|
| `min_deposit` | 100 YZXA | Needed to enter the voting period |
| `deposit_period_seconds` | 14 days | Time to reach the deposit |
| `voting_period_seconds` | 7 days | Time to vote |
| `timelock_seconds` | 2 days | Delay between passing and executing |
| `quorum_bps` | 3,340 (33.4%) | Minimum share of bonded stake that must vote |
| `threshold_bps` | 5,000 (50%) | Yes share of non-abstain votes needed |
| `veto_bps` | 3,340 (33.4%) | No-with-veto share that rejects and burns the deposit |

Abstain counts towards quorum but not towards the yes/no ratio. Re-voting
replaces a previous vote rather than adding to it.

Deposits are refunded when a proposal passes or is rejected normally, and
**burned** when it expires or is vetoed — which is what makes spamming hostile
proposals expensive.

## The timelock exists for one reason

So that a governance capture attack cannot be executed faster than users can
react to it. Two days is enough to notice a hostile proposal has passed, and to
withdraw, unbond, or raise an alarm before it takes effect.

## Proposal kinds

| Kind | Effect |
|---|---|
| `text` | Signalling only, no payload |
| `param_change` | Change consensus parameters |
| `treasury_spend` | Pay out of the treasury |
| `software_upgrade` | Schedule a coordinated halt at a height |

**There is no proposal type that mints, and no proposal type that changes a
balance directly.** A treasury spend moves existing funds and fails if the
treasury cannot cover it.

Parameter proposals are validated twice: at submission, so nobody wastes a
voting period on values that could never apply, and again at execution, so a
proposal that passed against a since-changed baseline fails rather than bricking
the network. `slash_fraction_double_sign_bps = 0` is refused at both points:
governance may not disable equivocation slashing.

The supply cap is a compile-time constant. It is not in the parameter set at
all, so there is nothing for a proposal to change.

## Treasury

1,000,000 YZXA in a module account with no private key. Spending requires:

1. a proposal that reaches quorum and threshold without a veto;
2. the 2-day timelock to elapse;
3. the per-epoch cap (`treasury_max_spend_per_epoch`, default 50,000 YZXA per
   30 days) not to be exceeded;
4. the treasury to actually hold the funds.

Every spend states a purpose, which is stored on chain. Every spend is visible
in the explorer.

## Progressive decentralisation

YOZEXA Labs will lead early development. The network must not depend on it.

| Stage | Control | Exit criteria |
|---|---|---|
| 0 — Core team | Core developers run the initial validators and propose upgrades | Public testnet stable; external validators onboarded |
| 1 — Multisig | Protocol-critical actions move behind a multisig with named holders | Multisig operating; treasury under multisig + timelock |
| 2 — Governance | On-chain governance controls parameters, treasury and upgrades | Governance has executed real proposals; quorum consistently met |
| 3 — Broad control | Validator set and stake genuinely distributed; no single party can pass a proposal alone | No entity above the veto threshold; validator set geographically and organisationally diverse |

Progress is measured, not declared. The concentration metrics that gate each
stage are published by the explorer.

## Separation of money

**The YOZEXA Treasury belongs to the ecosystem.** It is spent by governance for
the network's benefit.

**YOZEXA Labs revenue belongs to the company** under its legal structure. It
comes from selling services to customers.

They are separate accounts, separate accounting, and separate decision-making.
Company operating expenses are not paid from the treasury, and treasury grants
are not company revenue. Any change to that separation would itself be a
governance matter, and would be visible on chain.
