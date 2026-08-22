# YOZEXA Vesting

## What "locked" means here

It does not mean a promise in a document. It does not mean a smart contract the
holder can upgrade. It means the state machine will not move the tokens.

The lock lives inside `state.Transfer`, the single path user funds take between
accounts, and inside the staking path. A vesting account holder with full
control of their private key cannot spend, stake, or otherwise move a locked
unit. There is **no message, no parameter and no governance proposal** in this
codebase that shortens a schedule or releases a locked balance early.

## Schedules

| Position | Allocation | Cliff | Total duration | Shape |
|---|---|---|---|---|
| Founder | 500,000 YZXA | 2 years | 8 years | linear after the cliff |
| Team (per member) | 800,000 YZXA total | 1 year | 6 years | linear after the cliff |

Mechanics:

- Before the cliff: **zero** vested.
- At the cliff: the elapsed portion vests at once (2 of 8 years = 25% for the
  founder; 1 of 6 = 16.67% per team member).
- After the cliff: continuous linear vesting, computed as
  `total × elapsed / duration` with a **single** floor division, so no value is
  lost to repeated rounding.
- After the duration: fully vested.

Time is **block time**, taken from the block header. It is deterministic across
nodes and cannot be advanced by a node operator's clock.

## Public accounting

Every vesting position is public. The explorer and `yozexa query vesting` show,
per position:

- allocation
- vested to date
- still locked
- cliff date
- schedule end
- next unlock

Positions are labelled by category (`founder`, `team`, `ecosystem`) so the
supply dashboard can report founder-locked and team-locked separately.

## The founder cannot change this unilaterally

Concretely, all of the following are true and tested:

1. `MsgSend` from a founder account for more than the vested amount fails.
2. `MsgDelegate` for more than the vested amount fails — staking is not a way
   around the lock.
3. Genesis validation refuses a vesting position that is also a genesis
   validator operator, so a locked allocation cannot be self-delegated at
   launch.
4. No governance proposal kind can write a vesting schedule.
5. An invariant checks every block that each vesting account's balance still
   covers its locked amount. If it did not, the node halts.

Test: `TestVestedAllocationCannotBeSpentBeforeTheCliff` funds a founder account
with the full 500,000 YZXA allocation plus 1 YZXA of unlocked balance for fees,
then confirms that the account cannot spend 1,000 YZXA the day before its cliff,
can spend it the day after, and still cannot spend 200,000 YZXA — because only
25% has vested.

## A note on fees

A vesting account needs some unlocked balance to pay transaction fees, or it
cannot even claim its own status. Genesis therefore allows an address to hold
both a plain balance and a vesting position; it may not appear twice within
either list, which would double an allocation.

## Claiming

There is nothing to claim. Vested tokens are already in the account's balance;
they simply stop being locked as the schedule progresses. `MsgClaimVested`
exists so a wallet can surface the current position on chain, and it fails
loudly on an account with no schedule.
