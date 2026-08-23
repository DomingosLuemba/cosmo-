# YOZEXA Bug Bounty

Funded from the 200,000 YZXA security fund, which is a protocol account with no
private key and is spent by governance.

## Report privately

Do not open a public issue. Do not test against mainnet.

Send the report to the security contact published in the repository root, with:

- what you found;
- how to reproduce it, ideally as a failing test;
- what you believe the impact is;
- whether you have told anyone else.

You will get an acknowledgement within 3 working days and an assessment within
10. If a fix takes longer than that, you will be told why.

## Severity

| Level | Definition | Examples |
|---|---|---|
| **Catastrophic** | The currency or the network is broken | Mint beyond the 10,000,000 cap · double spend · consensus takeover below 1/3 stake · mass theft from the treasury or from user accounts |
| **Critical** | Funds can be stolen or permanently lost | Spend without a valid signature · bypass a vesting lock · exceed a spending grant · steal staked funds · forge a Merkle proof of a balance |
| **High** | Significant loss or a chain halt | Remotely halt the chain · exceed the treasury per-epoch cap · make a validator double sign · defeat webhook signature verification · bypass Pay idempotency to double-charge |
| **Medium** | Real harm, bounded | Denial of service against a node · credit a payment to the wrong merchant order · rate-limit bypass on the faucet · leak a merchant's data across accounts |
| **Low** | A weakness worth fixing | Missing security headers · information disclosure with no direct impact · a UI that could mislead a user into a mistake |

Reward amounts are set per report against these levels and published with the
fix. The fund is finite and public; a report's reward is a judgement about
impact, not a formula, and it will be explained.

## In scope

- `chain/` — the state machine, consensus integration, node, CLI, keyring.
- `sdk/`, `indexer/`, `pay/` — anything that moves or accounts for value.
- `wallet/`, `business/`, `explorer/`, `developer/` — anything that could cause
  a user to sign something they did not intend, or that leaks key material.
- The published Docker images and release binaries.

## Especially wanted

The properties the whole system rests on. A break in any of these is
catastrophic or critical by definition:

1. **Any path that increases minted supply without going through `state.Mint`,**
   or any way to make `Mint` accept a total above the cap.
2. **Any way to move a vesting-locked balance** — transfer, stake, governance,
   a module account, anything.
3. **Any way to exceed a spending grant's total, rate, recipient list,
   per-transaction ceiling or expiry**, or to nest delegation.
4. **Any way to make a signature verify for a transaction the signer did not
   author**, including malleability, chain-id confusion and replay.
5. **Any non-determinism in the state machine** — two honest nodes producing
   different app hashes from the same blocks.
6. **Any way to forge a Merkle proof** of a balance or an absence.
7. **Any way to double-credit a payment in Pay**, or to make a webhook verify
   with the wrong secret.

## Out of scope

- Anything requiring a validator cartel above 2/3 of stake. No BFT protocol
  survives that, and the threat model says so.
- The market price of YZXA, or its volatility.
- Social engineering of users or staff.
- Denial of service by simply sending a lot of traffic to a public RPC.
- Findings that consist only of automated scanner output, with no demonstrated
  impact.
- Best-practice suggestions with no security consequence.
- Anything already documented as unbuilt: smart contracts, bridges, the L2.
  They cannot have vulnerabilities, because they do not exist.

## Rules

- Test on a local network or the public testnet. Never mainnet.
- Do not access, modify or exfiltrate data belonging to anyone else.
- Do not run denial-of-service tests against shared infrastructure.
- Give a reasonable window to fix before disclosing — normally 90 days, less
  if a fix ships sooner, more only by agreement.
- One report per issue. Report a chain of bugs as a chain, not as a queue.

## After a fix

Every fixed report gets a public write-up: what it was, what the impact would
have been, and the regression test that now covers it. Reporters are credited
unless they ask not to be.

An incident without a test is an incident you have chosen to have again.
