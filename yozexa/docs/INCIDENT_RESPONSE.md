# YOZEXA Incident Response

## Severity

| Level | Definition | Response |
|---|---|---|
| **SEV-0** | Supply is wrong, funds can be stolen, or consensus has forked | Immediate. Halt first, investigate second |
| **SEV-1** | Chain halted, or a bug that could become SEV-0 | Within the hour |
| **SEV-2** | Degraded service — RPC, indexer, dashboard | Within the day |
| **SEV-3** | Cosmetic or non-urgent | Normal work |

## First five minutes of any SEV-0

1. **Do not push a fix yet.** Preserve state. Snapshot the node data
   directories of at least two independent validators.
2. **Establish the facts.** What does `yozexa supply verify` report? What do the
   invariants say? At what height did it start?
3. **Open the incident channel** and appoint one incident lead. One person
   decides; everyone else reports to them.
4. **Communicate early and honestly.** "We have halted the chain while we
   investigate a supply accounting error" is a better message than silence, and
   far better than a reassurance you have to retract.
5. **Do not delete anything.** Not logs, not databases, not branches.

## Playbooks

### Supply invariant violation

The node halts by design. That is the system working.

1. Confirm the violation on a second, independently operated node. A single-node
   failure is more likely to be local corruption than a protocol bug.
2. Identify the block and the transaction that broke it, from the node logs and
   by replaying the block against a snapshot.
3. Determine whether supply was actually created, or whether the accounting is
   wrong while the balances are right. These need different responses.
4. Do **not** restart nodes with invariant checks disabled to "get the chain
   moving". The flag exists for load testing and using it here would settle
   payments against state known to be wrong.
5. Fix, test the fix against the failing block, and coordinate a restart with a
   published, checksummed binary.

### Consensus failure or fork

1. Determine whether it is a halt (no 2/3 agreement) or a fork (two committed
   chains). A halt is recoverable; a fork means an equivocating supermajority
   and is far worse.
2. On a halt: identify whether validators are offline, partitioned, or
   disagreeing on app hash. An app-hash disagreement means non-determinism in
   the state machine — find it before restarting.
3. On a fork: stop all bridges and exchange deposits immediately. Collect
   evidence. The equivocating validators are slashable.
4. Publish the recovery height and the exact binary to run.

### Compromised validator key

1. If the consensus key is compromised, the validator must stop **immediately**
   — a second signer with that key means double signing and a permanent
   tombstone.
2. Do not restart it "just to unbond". Use the operator key from a different
   machine.
3. If the operator key is compromised, the stake is at risk and there is no
   recovery. Unbond what can be unbonded, and treat any delegation from others
   as an obligation to communicate immediately.

### Wallet exploit

1. Determine the blast radius: which versions, which platforms, which key
   storage path.
2. Publish an advisory **before** a fix if users can protect themselves by
   acting (moving funds, revoking a grant).
3. Users with an affected grant can revoke it in one transaction; say so
   explicitly with the exact command.
4. Pull the affected release from distribution channels.

### Bridge exploit

There is no bridge today. When there is: pause the affected route immediately,
reconcile supply across every connected chain, publish the numbers, and do not
resume until the accounting balances and an independent reviewer agrees.

### Frontend or domain compromise

1. Take the site down rather than serve a compromised page. A blank page is safe;
   a page that asks for a seed phrase is not.
2. Rotate every credential that could have been exposed.
3. Assume anything a user signed through the compromised page is hostile, and
   tell users which grants to revoke.

### Malicious dependency

1. Identify every release built with the affected version.
2. Rebuild from a clean toolchain and compare against the published checksums.
3. Publish an advisory with the affected versions and the safe version.
4. Add the specific version to the deny-list in CI.

### RPC or DDoS attack

1. Public RPC degradation is SEV-2, not SEV-0: the chain keeps producing blocks.
2. Rate-limit at the edge; scale read replicas; keep validators behind sentries
   and never expose them directly.

## After every incident

Write a public post-mortem within a week. It must state what happened, the
timeline, the root cause, what was lost, what was fixed, and what will change.
No blame on individuals, and no downplaying of impact. If funds were lost, say
how much.

Then add a regression test that would have caught it. An incident without a test
is an incident you have chosen to have again.
