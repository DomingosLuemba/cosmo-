# YOZEXA Tokenomics

This document covers the *distribution* and the incentives around it. The rules
that constrain supply are in [MONETARY_POLICY.md](MONETARY_POLICY.md); the
vesting mechanics are in [VESTING.md](VESTING.md).

## Allocation

Total: **10,000,000 YZXA**, fixed forever.

| Category | % | YZXA | Custody | Unlock |
|---|---|---|---|---|
| Network emission | 50 | 5,000,000 | none — minted per block by the protocol | over ~60+ years, halving each 20M blocks |
| Ecosystem / developers | 15 | 1,500,000 | `ecosystem_fund` module account | governance |
| Liquidity | 10 | 1,000,000 | `liquidity_fund` module account | governance |
| Treasury | 10 | 1,000,000 | `treasury` module account | governance + 2-day timelock + per-epoch cap |
| Team | 8 | 800,000 | per-member vesting accounts | 1-year cliff, 6-year linear |
| Founder | 5 | 500,000 | vesting account | 2-year cliff, 8-year linear |
| Security | 2 | 200,000 | `security_fund` module account | governance |

At genesis, 5,000,000 YZXA is minted (everything except the emission share).
The other 5,000,000 does not exist yet and cannot be placed in any wallet.

## Circulating supply at launch

Only the ecosystem, liquidity and treasury allocations are liquid at genesis,
and each is governance-controlled rather than individually spendable. The
founder and team allocations are **zero percent liquid** for the first year
(team) and first two years (founder): the protocol will not move them.

The explorer's supply dashboard reports, live and continuously:

- maximum supply
- minted supply
- circulating supply
- locked supply (vesting)
- burned supply
- founder locked / team locked
- treasury balance
- future emission remaining

There is no figure in that dashboard that a human types in.

## Why 10 million

A small, fixed supply with 18 decimals gives:

- room for micropayments — 10^-18 YZXA is a real, addressable amount, so
  machine-to-machine and streaming payments do not need a separate unit;
- a retail-friendly sub-unit (`YOZ`) so a person can hold "25 YOZ" rather than
  "0.00025 YZXA" and read their balance without counting zeros;
- no ambiguity about what "all of it" means.

## Who can earn YZXA

Without promising anyone a return:

- **validators** earn block rewards and fee tips, minus what they pass to
  delegators, and lose stake if they misbehave;
- **delegators** earn a share of a validator's rewards and are slashed with it;
- **developers and ecosystem projects** may receive grants from the ecosystem
  fund by governance decision;
- **merchants and businesses** earn by selling goods and services;
- **security researchers** may be paid from the security fund for real
  findings.

Staking yield is **not guaranteed**. It depends on emission (which halves), on
fee revenue (which depends on real usage), on the total amount bonded, and on
the validator not being slashed. Every YOZEXA interface that shows a yield
figure shows it as an estimate with the slashing risk stated next to it.

## What YOZEXA will not do

- No referral rewards. No "bring five people and earn".
- No fixed-return offers. No "invest X, receive Y".
- No paying earlier participants out of later participants' money.
- No wash trading, no paid volume, no bot-generated liquidity. Any metric the
  project publishes separates organic volume from incentivised volume.
- No claim that a business is trustworthy merely because it accepts YOZEXA.

## The founder's two economics, kept separate

**Participation in YZXA.** 500,000 YZXA, locked for two years and then released
over eight. If the network becomes valuable, that stake becomes valuable. It is
exposure, not income, and it is not guaranteed to be worth anything.

**YOZEXA Labs.** A company that sells real services — payment processing, APIs,
business tooling, managed infrastructure, settlement. This is intended to be the
primary source of business revenue, and it is revenue earned from customers, not
from issuing or selling coins.

The two must not be confused, and their accounting is separate: **the YOZEXA
Treasury belongs to the ecosystem; YOZEXA Labs revenue belongs to the company**
under whatever legal structure applies. See [GOVERNANCE.md](GOVERNANCE.md).
