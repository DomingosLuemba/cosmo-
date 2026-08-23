# YOZEXA Monetary Policy

Status: implemented and enforced by the state machine. Every number in this
document is a constant or a rule that lives in code, not an intention.

## 1. The unit

| Name | Meaning | Value |
|---|---|---|
| `ayzxa` | base unit, the smallest indivisible amount | 1 |
| `YZXA` | the currency | 10^18 ayzxa |
| `YOZ` | retail sub-unit shown by wallets | 10^13 ayzxa = 0.00001 YZXA |

Balances, fees, supply figures and every intermediate value are integers in
`ayzxa`. No floating-point type touches a monetary value anywhere in this
codebase. Amounts cross JSON boundaries as **strings**, so no JavaScript parser
can round a balance through a `float64`.

`chain/types/denom.go` defines these; `chain/types/coin.go` enforces the string
encoding; `chain/types/math.go` provides checked arithmetic that returns an
error rather than a negative or wrapped result.

## 2. The hard cap

```
MAX_SUPPLY = 10,000,000 YZXA = 10^25 ayzxa
```

This is a compile-time constant (`types.MaxSupply`), deliberately **not** a
governance parameter. There is no message, no proposal type, no upgrade path
and no administrative key in this codebase that can raise it.

Every unit of YZXA that has ever existed passes through exactly one function:

```go
func (s *State) Mint(to types.Address, amount *big.Int) error
```

`Mint` computes the new total, calls `types.CheckSupplyCap`, and refuses the
operation if the result would exceed the cap. Genesis allocation and block
emission both call it. There is no second path.

The cap is additionally re-checked as an invariant at the end of **every
block**, in production, not only in tests. A violation returns an error from
`FinalizeBlock`, which halts the node. That is the intended behaviour: a halted
chain can be diagnosed and restarted, while a chain that quietly created a coin
has already paid it to somebody.

## 3. Distribution

| Category | Share | YZXA | Where it lives at genesis |
|---|---|---|---|
| Network emission | 50% | 5,000,000 | **nowhere** — created block by block |
| Ecosystem / developers | 15% | 1,500,000 | `ecosystem_fund` module account |
| Liquidity | 10% | 1,000,000 | `liquidity_fund` module account |
| Treasury | 10% | 1,000,000 | `treasury` module account |
| Team | 8% | 800,000 | vesting accounts, 1-year cliff, 6-year schedule |
| Founder | 5% | 500,000 | vesting account, 2-year cliff, 8-year schedule |
| Security | 2% | 200,000 | `security_fund` module account |

Module accounts have deterministic, key-less addresses derived from
`SHA-256("yozexa/module-account/" + name)`. **No private key exists that can
sign for them.** Their balances move only through protocol logic — treasury
spends require a passed governance proposal plus a timelock, and the emission
pool is spent only by the reward distribution code.

Genesis validation refuses any allocation that, added to the 5,000,000 emission
reserve, would exceed the cap.

## 4. Emission schedule

The 5,000,000 YZXA reserved for network security is created one block reward at
a time and paid to the validators and delegators that secured that block.

```
era length             20,000,000 blocks
era 0 block reward     0.125 YZXA          (= 1/8, exact in binary)
era n block reward     era 0 reward / 2^n  (integer division, so it floors)
```

At a 3-second target block time one era is about 1.902 years.

The geometric sum `0.125 × 20,000,000 × (1 + 1/2 + 1/4 + …)` converges to
exactly **5,000,000 YZXA**. Because each era's reward is floored to an integer
number of `ayzxa`, the realised total is very slightly *below* 5,000,000: the
schedule can never overshoot by construction.

Two independent ceilings guard the same number, deliberately:

1. the remaining emission reserve (`5,000,000 − total_emitted`), and
2. the remaining mintable amount under the hard cap (`MAX − minted`).

Each block's reward is the minimum of the scheduled amount and both ceilings. A
bug in the schedule cannot mint past the reserve, and a bug in the reserve
accounting cannot mint past the cap.

Emission is idempotent under replay: `EmissionState.LastRewardHeight` means a
height that has already been rewarded is never rewarded twice, even if CometBFT
re-delivers a block after a crash.

Why not copy Bitcoin's numbers? Because Bitcoin's halving interval and initial
reward were chosen for Bitcoin's block time, block subsidy and security budget.
YOZEXA picked numbers whose arithmetic is exact for a 10,000,000 cap and a
3-second block, and wrote down the reasoning rather than inheriting a constant.

### What happens when emission ends

Emission is a bootstrap, not a permanent subsidy. As the reward halves, fee
revenue must grow to carry validator economics. That is a real risk, stated
plainly in `THREAT_MODEL.md` rather than assumed away — the network's long-term
security budget depends on there being real payment volume, which is exactly
what YOZEXA Pay and the Business products exist to create.

## 5. Burning

`MsgBurn` destroys YZXA permanently. So does the burned share of every base fee
(`base_fee_burn_bps`, default 100%).

Burning **increases** `burned_supply` and **decreases** circulating supply. It
does **not** decrease `minted_supply`, and therefore does **not** create room to
mint more. This is the important part: if a burn reduced the minted counter, a
burn-and-remint loop could exceed the cap. Burning is a one-way reduction of
the money that will ever exist.

If 10 YZXA are burned, the economically available maximum permanently becomes
10 YZXA lower.

## 6. Fees

YZXA is the gas token. The fee market follows the EIP-1559 design:

- a **base fee** every transaction must pay, adjusted each block towards
  `target_block_gas` and bounded to a change of at most
  `1/base_fee_change_denominator` (default 1/8) per block;
- a **tip** on top, which is what actually orders transactions.

The base fee is burned; tips go to validators and their delegators. Burning the
base fee removes the incentive for a proposer to stuff its own blocks with
self-paid transactions to inflate its income.

The fee charged is `gas_used × gas_price`, never `gas_limit × gas_price`: a
sender is not billed for headroom they did not consume. Wallets show three
tiers — economy, normal, priority — each with the full price stated. There is no
hidden component, and **no YOZEXA Labs product adds a second fee to a plain
peer-to-peer transfer**.

A failed transaction still pays its fee. That is what makes spamming failures
expensive; it is charged before execution and survives the rollback of the
messages.

## 7. What this policy is not

It is not a price. YZXA is not a stablecoin and this codebase contains no
statement of what one YZXA is worth. Fiat figures anywhere in the products are
market references from external price sources, labelled as such.

The long-term *economic vision* discussed elsewhere in project material —
"0.00001 YZXA ≈ $1" — is an aspiration about a possible future state of a
market, not a promise, not a floor, not a forecast, and not something any part
of this system enforces or can enforce. Nothing in YOZEXA guarantees any
return to anybody.
