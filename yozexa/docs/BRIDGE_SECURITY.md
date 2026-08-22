# YOZEXA Bridge Security

## Status: nothing is bridged, and nothing may be

There is no bridge in this repository. `bridge/` contains this policy and
nothing that moves value. This document exists to state the requirements
**before** any code is written, because bridges are where crypto loses money —
by a wide margin, and repeatedly, and in ways that were all foreseeable.

Until every requirement below is met and independently audited, no asset may
cross into or out of YOZEXA.

## The one rule

**Global supply must be conserved.**

If 100 YZXA leave chain A for chain B, there must not be 100 spendable on A
*and* 100 on B. Exactly one representation is live at any moment, and the total
across all chains must equal what YOZEXA itself has minted.

Every bridge design must state, in one paragraph, how it makes double-minting
impossible — not unlikely, impossible — and that paragraph must survive review
by someone who did not write it.

## Requirements before any bridge ships

| Requirement | Why |
|---|---|
| Canonical supply accounting | A single authoritative record of how much is locked, minted and burned per route, reconciled continuously and checked as an invariant |
| Message verification | Cryptographic proof of the source event. Never a trusted API call, never "an oracle said so" |
| Replay protection | Each cross-chain message executes at most once, with an explicit nonce and a record of consumed messages |
| Rate limits | Per-route caps per time window, so an exploit drains a bounded amount before anyone notices |
| Circuit breakers | Automatic halt when flows or supply reconciliation deviate from expectation |
| Emergency pause | Limited in scope and time, held by a multisig, with the pause itself visible on chain. A pause must never be able to move funds |
| Monitoring | Real-time supply reconciliation across every connected chain, alerting on any mismatch, however small |
| Independent audit | Of the bridge specifically. A chain audit does not cover it |
| Adversarial testnet | The bridge must be attacked on a testnet where losing everything costs nothing |

## IBC first, and slowly

The intended path is **IBC**, because it verifies the counterparty chain's
consensus with light-client proofs rather than trusting a committee of signers.
That is a materially stronger security model than most bridges use.

Even so:

- start with **one** channel to **one** well-understood counterparty;
- run it on testnet under adversarial conditions before mainnet;
- add channels one at a time, each with its own review;
- never launch a dozen routes at once because an integration list looks good.

## What will not be done

- No multisig bridge where a small committee can mint on the destination chain.
- No bridge whose security rests on an off-chain service being honest.
- No bridge launched to make a listing deadline.
- No wrapped YZXA on another chain without the accounting invariant above
  running in production and alerting.
