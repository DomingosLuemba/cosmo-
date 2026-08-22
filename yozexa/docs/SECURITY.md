# YOZEXA Security

If you believe you have found a vulnerability, **do not open a public issue**.
See "Reporting" at the end of this document.

## Principles

1. **Assume this will one day hold serious value.** Every change to supply,
   consensus, keys, signatures, bridges or the treasury is CRITICAL, whatever it
   looks like in the diff.
2. **Halt rather than drift.** Invariants run in production at the end of every
   block. A violated invariant stops the node. A halted chain can be diagnosed;
   a chain that quietly created a coin has already paid it to somebody.
3. **Don't invent cryptography.** secp256k1, Ed25519, SHA-256, BIP-39, scrypt,
   XChaCha20-Poly1305, bech32. All standard, all widely reviewed.
4. **Don't invent consensus.** CometBFT.
5. **No unlimited authority anywhere.** Every delegated permission has a total, a
   rate and an expiry; the treasury has a per-epoch cap and a timelock; the
   supply has a cap no vote can raise.
6. **Fail closed.** An unknown message type, an unknown parameter key, an
   undeterminable spend profile: all refused, never treated as "probably fine".

## Invariants checked every block

| Invariant | Property |
|---|---|
| `supply-cap` | minted ≤ 10,000,000 YZXA |
| `conservation` | sum of all balances = minted − burned |
| `bonded-pool` | bonded pool balance = sum of validator tokens |
| `unbonding-pool` | unbonding pool balance = sum of queued entries |
| `reward-pool` | reward pool ≥ undistributed + commission owed + all accrued rewards |
| `shares` | a validator has tokens iff it has shares |
| `vesting` | every vesting account's balance covers its still-locked amount |
| `emission` | total emitted ≤ the 5,000,000 reserve |

Anyone can run these against a live node: `yozexa query invariants`, or
`GET /v1/invariants`. `yozexa supply verify` runs them plus a full monetary
audit and exits non-zero on failure, so it can be wired into monitoring.

## Cryptography

| Purpose | Primitive | Notes |
|---|---|---|
| Account keys | secp256k1 ECDSA, RFC 6979 deterministic nonces | via the audited `decred` implementation CometBFT already depends on |
| Signature encoding | fixed-width `r‖s`, 64 bytes | no DER, so no encoding malleability |
| Signature canonicality | low-S enforced | a high-S twin of a valid signature is rejected, so one signed intent cannot become two valid transactions with different hashes |
| Consensus keys | Ed25519 | required by CometBFT |
| Hashing | SHA-256 | addresses, tree, transaction hashes |
| Addresses | `SHA-256(compressed pubkey)[:20]`, bech32 | prefixes `yzx`, `yzxvaloper`, `yzxvalcons` |
| Seed phrases | BIP-39, 24 words (256 bits) | from the OS CSPRNG |
| Key storage at rest | scrypt (N=2^17, r=8, p=1) + XChaCha20-Poly1305 | address bound as associated data |

## Transaction safety

- The **chain id is in the signed payload** — a testnet signature is worthless on
  mainnet.
- **Sequence numbers** make a signed transaction executable exactly once.
- **Optional timeout height** lets a payment that has not landed be safely
  reissued, with certainty the original can never land later.
- Every message's declared signer must equal the transaction's signer, so a
  transaction can never move funds from an account it does not control.
- Unknown message types are rejected outright: a node must never accept a
  transaction it cannot fully interpret, or it will disagree with upgraded peers
  about state.
- Size and count limits (`MaxTxBytes`, `MaxMsgsPerTx`, `MaxMultiSendOutputs`)
  bound the work an unauthenticated peer can force before any signature check.

## Delegated spending (session keys, subscriptions, AI agents)

A grant is a first-class protocol object, not an application convention:

- a **total** limit (mandatory — an unlimited grant cannot be expressed);
- a **per-period** limit with a rolling window anchored to the grant's start, so
  a grantee cannot extend its allowance by choosing when to transact;
- an optional **allow-list of recipients**;
- an explicit **allow-list of message types**, itself restricted to a protocol
  allow-list that excludes governance voting, validator creation, alias
  transfers and grant management — a session key must not be able to vote with
  someone's stake, give away their identity, or mint new permissions;
- an optional **per-transaction ceiling** above which the account holder must
  sign directly;
- a **mandatory expiry**, at most one year.

Authorisation and accounting are the same operation, so there is no path that
checks a limit and then forgets to charge it. Nested `exec` is refused, so a
grantee cannot launder permissions through a chain of grants.

An AI agent, a device, or a subscribing merchant therefore holds a key that is
*structurally incapable* of draining the account it acts for, whatever software
it runs. The main private key is never given to an agent.

## Testing

| Kind | Where |
|---|---|
| Unit | alongside each package |
| Integration / state machine | `chain/app/*_test.go` — real blocks through real ABCI |
| Adversarial | `chain/app/security_test.go` — cap breaks, grant abuse, double signing, governance capture, homograph aliases |
| Property / randomised | `TestRandomTrafficPreservesEveryInvariant` — 250 random transactions, invariants after every block |
| Fuzz | transaction parser, amount parser, canonical JSON, signature verification, Merkle proofs, the state machine |
| End-to-end | `tests/` — live localnet, real payment, real settlement |

Fuzzing has already found and fixed a real defect: the store represented a
deletion as a nil value, which made writing an empty value silently delete the
key. Regression test added.

## Release security

- Signed release binaries and published checksums.
- Reproducible builds (`-trimpath`, fixed build id) so a third party can rebuild
  a release and get the same bytes.
- Software bill of materials per release.
- Dependency scanning and static analysis in CI.
- No secret of any kind in the repository, in images, or in `.env` files that
  are committed. The `.gitignore` refuses key files by name.

## Key management for production

| Key | Storage |
|---|---|
| Validator consensus key | remote signer or HSM; never on a machine exposed to the internet |
| Validator operator key | hardware wallet, offline |
| Treasury | multisig, hardware-backed, with the timelock as a second gate |
| Release signing | hardware token, held by more than one person |
| Any service credential | a secret manager, rotated, never in git |

Never: GitHub, a committed `.env`, a chat message, a plain note, a screenshot.

## Reporting a vulnerability

Report privately to the security contact published in the repository's
`SECURITY.md` at the root (or, before that exists, to the maintainers directly).
Include what you found, how to reproduce it, and what you think the impact is.

Please do not test against mainnet. Use a local network or the public testnet.

Rewards are paid from the 200,000 YZXA security fund. See
[security/BUG_BOUNTY.md](../security/BUG_BOUNTY.md) for severity levels and
scope.
