# YOZEXA Consensus

## Summary

YOZEXA runs **CometBFT** (Tendermint BFT) with **proof of stake**. Blocks are
final the moment they are committed: more than two thirds of voting power has
signed, and no longer chain can replace them.

- Safety holds while less than 1/3 of voting power is Byzantine.
- Liveness holds while more than 2/3 is online and able to communicate.
- Target block time: **2–4 seconds**. The precise figure is a property of the
  deployed validator set and network topology, and will be published only from
  measurements on a real testnet — see the benchmarking note below.

## Validator set

- Active set size: `max_validators`, default 100, changeable by governance.
- Selection: the top N by bonded stake, excluding jailed and tombstoned
  validators, ordered by stake with **operator address as the tie-break** so the
  ordering is total and identical on every node.
- Voting power: one unit per whole YZXA bonded. A validator below one whole
  YZXA has no power, which is also the network's minimum self-delegation.

## Staking

| Concept | Rule |
|---|---|
| Delegation | Tokens move to the `bonded_pool`; the delegator receives *shares* |
| Shares | Slashing reduces a validator's tokens without touching shares, so every delegator takes the loss pro rata |
| Commission | Set at creation, capped by a `max_commission_bps` the validator commits to and can never exceed later |
| Unbonding | 21 days by default. Stake stays **slashable** for the whole period |
| Redelegation | Queued, not instant — see below |
| Min self-delegation | Declared per validator, at least the network minimum; falling below it jails the validator automatically |

### Why redelegation is queued

Some networks let a delegator move stake between validators instantly. Doing so
safely requires a second ledger of redelegation entries, purely so that stake
which has already moved can still be slashed for the source validator's earlier
misbehaviour. That ledger is a well-known source of accounting bugs.

YOZEXA takes the conservative path: a redelegation leaves the source validator,
waits out the full unbonding period in the unbonding pool where it remains
slashable, and then bonds to the destination **automatically**. The delegator
does not have to come back and re-stake by hand, and there is no second ledger
to get wrong.

Cost: redelegation is not instant. That is the trade, stated openly.

## Rewards

Per block:

1. the emission reward is minted into the `reward_pool`;
2. transaction tips (and any non-burned share of base fees) are added;
3. the pool is allocated across active validators in proportion to bonded stake;
4. each validator takes its commission; the remainder raises its **reward
   accumulator** (an F1-style cumulative reward-per-share, scaled by 10^27);
5. a delegator's claimable reward is `shares × (accumulator − their debt) / scale`.

Integer division leaves a remainder. It is carried in an explicit
`undistributed` counter and paid out in a later block, rather than being lost or
double-counted. An invariant checks every block that the reward pool holds at
least what it owes: undistributed remainder plus unwithdrawn commission plus
every delegator's accrued reward.

## Slashing

| Infraction | Penalty | Recoverable |
|---|---|---|
| Downtime | `slash_fraction_downtime_bps` (default 1 bp = 0.01%) + jail for `downtime_jail_seconds` | Yes, via `MsgUnjail` after the jail expires |
| Double signing (equivocation) | `slash_fraction_double_sign_bps` (default 500 bp = 5%) + **permanent tombstone** | **Never** |

Slashed stake is **burned**, not redistributed. Redistributing it would give
other validators a reason to want their competitors slashed.

Tombstoning is recorded against the **consensus address**, not just the
validator record, so the same key cannot be re-registered under a fresh operator
account to escape the penalty. `MsgUnjail` explicitly refuses a tombstoned
validator, and governance has no proposal type that can reverse it.

Equivocation also slashes **unbonding entries that were in flight at the time of
the infraction**. Without that, a validator could double-sign and then simply
wait out the unbonding period with its stake untouched.

Liveness is tracked with a sliding window (`signed_blocks_window`, default
10,000 blocks) held as a bitmap plus an incremental missed counter, so it costs
O(1) state per validator per block. A validator is only judged once it has had
a full window to perform in.

## Attack resistance

| Attack | Defence |
|---|---|
| Double signing | Evidence gossiped by CometBFT; 5% slash and permanent tombstone |
| Equivocation after unbonding | Unbonding entries created at or after the infraction time are slashed too |
| Long-range attack | 21-day unbonding keeps historical stake at risk; new nodes use a trusted block hash for state sync (weak subjectivity) |
| Validator collusion below 1/3 | Safety holds by construction |
| Collusion above 1/3 | Not preventable by any BFT protocol. Mitigations are economic and social: stake distribution, validator diversity, monitoring that alerts on concentration, and governance timelocks that give users time to exit |
| Sybil | Voting power is stake, not identity — a Sybil must buy stake |
| Eclipse | CometBFT peer diversity, persistent peers, seed nodes; validators SHOULD run behind sentry nodes |
| Network partition | Neither side reaches 2/3, so neither commits. The chain halts rather than forking, which is the correct choice for money |
| Censorship by a proposer | Any honest proposer includes the transaction in the next block; persistent censorship is visible on-chain and is a governance and social matter |
| DDoS | Fee market prices block space; a non-zero minimum base fee keeps flooding from becoming free; `max_block_gas` bounds work per block; `MaxTxBytes` bounds work per transaction before any signature check |

## Benchmarking

This repository contains a load-testing harness (`tests/load`). No throughput or
latency figure will be published as a YOZEXA specification until it has been
measured on a public testnet with independently operated validators across
multiple regions. Numbers measured on one machine are not network performance,
and publishing them as if they were is how projects end up quoting figures they
cannot reproduce.

What will be measured and published:

- sustained TPS at 100 / 1,000 / 5,000 / 10,000 transaction-per-second offered
  load, and where it breaks;
- block time distribution and time to finality under each load;
- CPU, memory, disk I/O and block propagation delay per validator;
- behaviour under chaos: 30% of validators offline, 50% added latency, packet
  loss, slow disks, a region outage.
