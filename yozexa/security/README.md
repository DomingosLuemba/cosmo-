# Security

- [Bug bounty](BUG_BOUNTY.md) — severity levels, scope, and what is especially
  wanted.
- [Threat model](../docs/THREAT_MODEL.md) — what is defended, what is
  partially defended, and what is not defended at all.
- [Security overview](../docs/SECURITY.md) — invariants, cryptography, testing.
- [Incident response](../docs/INCIDENT_RESPONSE.md) — playbooks.
- [Mainnet checklist](../docs/MAINNET_CHECKLIST.md) — the gates.

## Audit scope, when the time comes

An external audit should be pointed at these, in this order:

1. **`chain/types` and `chain/state/supply.go`** — the cap, the single mint
   path, and the checked arithmetic everything else depends on.
2. **`chain/app/invariants.go`** — the properties asserted every block. If an
   invariant is wrong, everything it "proves" is worthless.
3. **`chain/store`** — the sparse Merkle tree, the working-root/commit split,
   and proof verification.
4. **`chain/tx` and `chain/crypto`** — sign bytes, canonical encoding,
   signature verification, low-S enforcement.
5. **`chain/app/staking.go` and `chain/state/staking.go`** — share accounting,
   slashing, the unbonding queue.
6. **`chain/state/vesting.go` and its enforcement inside `state.Transfer`.**
7. **`chain/state/grant.go` and `chain/app/handler.go`'s exec path** —
   delegated spending.
8. **`chain/app/gov.go`** — that nothing in governance can mint, and that the
   timelock and per-epoch cap hold.
9. **`chain/keyring` and `wallet/web/lib/vault.ts`** — key handling at rest.
10. **`pay/`** — idempotency, settlement matching, webhook signing.

A finding in 1–3 is catastrophic almost by construction. Budget accordingly.
