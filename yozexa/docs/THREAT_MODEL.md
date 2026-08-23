# YOZEXA Threat Model

What we are defending, from whom, and what we are *not* claiming to defend.

## Assets

| Asset | Worst case if compromised |
|---|---|
| The supply cap | The currency is worthless; nothing else matters |
| User balances | Theft |
| Validator stake | Theft, or loss of network security |
| The treasury | Ecosystem funding drained |
| Vesting locks | Founder or team allocation released early, destroying trust |
| Consensus liveness | Network halts; payments stop |
| Merchant settlement records | Businesses cannot reconcile; disputes |
| User privacy | Physical risk to individuals in some jurisdictions |

## Adversaries

1. **A remote attacker with no access.** Can send arbitrary bytes to any node's
   p2p and RPC ports.
2. **A malicious validator with under 1/3 of stake.** Can equivocate, censor,
   propose invalid blocks, go offline.
3. **A cartel with over 1/3 of stake.** Can halt the chain. Over 2/3, can commit
   whatever the state machine will accept.
4. **A malicious dapp or website.** Can ask a wallet to sign something.
5. **A compromised AI agent or device key.** Runs software the user does not
   control.
6. **A malicious dependency.** Ships code into a build.
7. **An insider.** A maintainer with commit access, or an operator with key
   access.
8. **A phishing attacker.** Targets users, not code.
9. **A state-level actor.** Legal compulsion, infrastructure seizure.

## Threats and current status

Legend: **Mitigated** — implemented and tested. **Partial** — mitigated for what
exists today, incomplete for planned functionality. **Open** — not yet
addressed; do not rely on it.

### Supply

| Threat | Status | Mitigation |
|---|---|---|
| Mint past the cap through a bug in a module | **Mitigated** | One `Mint` function; cap checked inside it; invariant re-checks every block and halts |
| Mint past the cap through governance | **Mitigated** | No proposal type can mint; the cap is a constant, not a parameter |
| Mint past the cap through emission arithmetic | **Mitigated** | Two independent ceilings (reserve and cap); fuzzed |
| Burn-and-remint to exceed the cap | **Mitigated** | Burning never reduces the minted counter |
| Double emission on block replay | **Mitigated** | `LastRewardHeight` makes emission idempotent |
| Bridge double-mint | **Open — no bridge exists.** Nothing may be bridged until [BRIDGE_SECURITY.md](BRIDGE_SECURITY.md)'s requirements are met |

### Funds

| Threat | Status | Mitigation |
|---|---|---|
| Spend without a valid signature | **Mitigated** | Signature verified against sign bytes that include every field; tampering tested |
| Replay a transaction | **Mitigated** | Per-account sequence; tested |
| Replay across networks | **Mitigated** | Chain id inside the signed payload; tested |
| Signature malleability | **Mitigated** | Low-S enforced; fixed-width `r‖s`; tested |
| Spend someone else's account | **Mitigated** | Every message's signer must equal the transaction signer |
| Negative or overflowing amounts | **Mitigated** | Checked integer arithmetic; amounts are unsigned by type |
| Partial multisend | **Mitigated** | Atomic: a failing leg reverts the whole transaction |
| Free spam | **Mitigated** | Fee charged before execution and retained on failure |
| Front-running / MEV | **Partial** | No mempool auction, no proposer-builder market. Ordering is still proposer-controlled; a proposer can reorder within its block. Encrypted mempools are a research item, not a claim |

### Vesting and insiders

| Threat | Status | Mitigation |
|---|---|---|
| Founder spends locked tokens | **Mitigated** | Lock enforced inside the transfer path; tested against the key holder |
| Founder stakes locked tokens to route around the lock | **Mitigated** | Delegation checks spendable, not balance |
| Founder shortens their own schedule | **Mitigated** | No message or proposal type modifies a schedule |
| Vesting account is also a genesis validator | **Mitigated** | Genesis validation refuses it |
| A maintainer ships a malicious upgrade | **Partial** | Signed releases, reproducible builds, review. Ultimately social: run the code you reviewed, and diff releases |

### Governance

| Threat | Status | Mitigation |
|---|---|---|
| Whale passes a hostile proposal | **Partial** | Quorum, threshold, 33.4% veto, and a 2-day timelock so users can react. A sufficiently large stakeholder still wins a vote — that is what stake-weighted governance means |
| Governance drains the treasury at once | **Mitigated** | Per-epoch spend cap plus timelock; execution re-checks the balance |
| Governance disables slashing | **Mitigated** | Parameter validation refuses a zero double-sign slash, at submission and again at execution |
| Governance bricks the chain with bad parameters | **Mitigated** | Parameters re-validated at execution; a passed proposal fails rather than applying |
| Vote with tokens not at risk | **Mitigated** | Voting power is bonded stake only; tested |
| Session key votes on the owner's behalf | **Mitigated** | Governance messages cannot be delegated |

### Users

| Threat | Status | Mitigation |
|---|---|---|
| Homograph / lookalike YOZEXA ID | **Mitigated** | ASCII-only, lowercase, no doubled or edge hyphens, no all-numeric names, reserved names blocked. The attack is inexpressible, not merely detected |
| Address poisoning | **Partial** | Alias resolution shows the true destination before signing; wallet-side poisoning detection is specified in [WALLET_SECURITY.md](WALLET_SECURITY.md) and not yet implemented |
| Blind signing | **Mitigated for the API** | `/v1/simulate` returns plain-language effects, the exact fee and explicit warnings. Each wallet must actually display them |
| Unlimited approval | **Mitigated** | Unlimited grants cannot be expressed |
| Lost seed phrase | **Accepted** | Self-custody means nobody can recover it. Social recovery is designed, not built — see [WALLET_SECURITY.md](WALLET_SECURITY.md) |
| Phishing site | **Open** | Domain hygiene, wallet warning lists, user education. Not solvable in the protocol |

### Infrastructure

| Threat | Status | Mitigation |
|---|---|---|
| Node crash from malformed input | **Mitigated** | Parser fuzzed over a million executions per run; size limits before parsing |
| RPC abuse | **Partial** | Timeouts and body limits in the API. Rate limiting belongs at the edge and is an operator responsibility |
| Validator key theft | **Partial** | Documented HSM/remote-signer practice. Not enforceable by the protocol |
| Eclipse / partition | **Partial** | CometBFT peer management; sentry architecture documented. Not eliminated |
| Malicious dependency | **Partial** | Pinned versions, SBOM, scanning. Supply-chain risk is never zero |
| Region outage | **Open until tested** | Chaos testing is specified in `tests/chaos` and must run before mainnet |

### Privacy

| Threat | Status | Mitigation |
|---|---|---|
| Personal data on chain | **Mitigated** | Nothing in the protocol carries identity. No message field takes a name, document, phone number or address |
| Transaction graph analysis | **Open, and inherent** | Balances and transfers are public. Anyone who links an address to a person can see its history. Selective-disclosure work is on the roadmap, and until it ships this is a real limitation users must be told about |
| Off-chain KYC data leak | **Partial** | Regulated products keep identity data off-chain and encrypted; scope and controls per product |

## What YOZEXA does not defend against

Stated plainly, because a threat model that claims everything is worthless:

- A cartel controlling over 2/3 of stake. No BFT protocol survives it.
- Loss of a user's seed phrase.
- A user signing a transaction they were tricked into wanting.
- Malware on a user's device with access to an unlocked key.
- Legal compulsion in any jurisdiction.
- The market price of YZXA.
