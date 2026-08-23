# YOZEXA Smart Contracts

## Status

**Not implemented.** `contracts/` contains this plan and no virtual machine.
The chain today executes a fixed set of typed messages, not user-supplied code.

This is stated plainly because a roadmap item presented as a feature is the
thing this project is trying not to do. Nothing in YOZEXA currently runs a
Solidity contract, and no product should be sold on the basis that it does.

## Plan

Add EVM compatibility so that existing tooling works unchanged:

- Solidity, Foundry, Hardhat;
- `ethers` and `viem`;
- an Ethereum-compatible JSON-RPC endpoint, so MetaMask and every EVM wallet
  connect without a custom integration;
- YZXA as the gas token, with the same fee market.

The intended route is **Cosmos EVM** rather than a new virtual machine, for the
same reason YOZEXA uses CometBFT rather than a new consensus: a VM is where
subtle bugs become other people's money.

## Why it is not first

The order of work is deliberate:

1. money that cannot be counterfeited;
2. payments that settle;
3. products people actually use;
4. programmability.

A chain with a VM and a broken supply invariant is worth nothing. A chain with a
sound ledger and no VM is worth something to a merchant today.

## What the VM must not be able to do

When it lands, the following must remain true, and must be covered by the
per-block invariants:

- **A contract cannot mint.** The supply cap is enforced below the VM, not by
  it.
- **A contract cannot bypass a vesting lock.** The transfer path is the transfer
  path.
- **A contract cannot exceed a spending grant.** Grants are enforced at the
  message layer, above any contract call.
- **Gas metering must bound execution**, and an out-of-gas contract must revert
  cleanly with the fee still charged.
- **Determinism must hold.** No floating point, no wall-clock time, no
  randomness that is not derived from committed state.

## What will be built on top, once the VM exists

| Capability | Depends on |
|---|---|
| Smart accounts / account abstraction | VM + a validated account model |
| Social recovery with guardians | Smart accounts |
| Gas sponsorship (a merchant paying a customer's fee) | Smart accounts |
| Contract-based escrow | VM |
| YOZEXA DEX | VM, and liquidity that is real rather than incentivised into existence |
| Zero-knowledge selective disclosure | VM + circuit work |

Some of these — session keys, spending limits, subscriptions, agent wallets —
are already available **without** a VM, because they are implemented as protocol
primitives in `chain/state/grant.go`. That was a deliberate choice: the safety
properties that matter most for payments should not wait for a virtual machine.
