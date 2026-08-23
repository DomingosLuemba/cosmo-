# Operating a YOZEXA node

A node that has stopped looks, in every endpoint except one, exactly like a
node on a quiet chain. It answers `/v1/status`, serves balances, accepts
connections — and reports a height that never moves. That is the shape of every
failure here: nothing throws, the numbers simply stop being current, or stop
being true. These metrics exist to make that visible.

## Scraping

Each node serves `/metrics` on its API port in the Prometheus text format.
It is deliberately unversioned and outside `/v1`: it is an operational
surface, not part of the chain's API contract, and it may change without a
version bump.

```yaml
scrape_configs:
  - job_name: yozexa
    scrape_interval: 15s
    static_configs:
      - targets: ['validator-1:1717', 'validator-2:1717', 'validator-3:1717']
```

CometBFT publishes its own metrics for consensus, p2p and the mempool, on a
separate port. Turn them on in `config.toml` if you want them:

```toml
[instrumentation]
prometheus = true
prometheus_listen_addr = ":26660"
```

Those say whether the node is participating in consensus. They say nothing
about whether the money is right. The metrics below are the application's own.

## The one that matters

```
yozexa_invariant_ok{invariant="..."}
```

Eight series, one per protocol invariant, each checked by the node against its
own live state on every block. A zero means the chain's accounting no longer
holds, and every figure the node reports — balances included — is suspect until
someone works out why.

Alert on it at zero, with no `for:` delay. There is no threshold to tune and no
flapping to smooth: an invariant is either true or the chain is wrong.

When it fires, capture `/v1/invariants` and `/v1/supply/verify` **before**
restarting anything. A restart replays state and may hide what explains it.

## What is published

| Metric | |
|---|---|
| `yozexa_invariant_ok{invariant}` | one per invariant; 0 means broken |
| `yozexa_invariants_ok` | 0 if any of them is |
| `yozexa_supply_conservation_ok` | 0 when balances no longer sum to circulating supply |
| `yozexa_supply_minted_yzxa` | minted, burned, circulating, remaining mintable |
| `yozexa_supply_max_yzxa` | the hard cap, 10,000,000 |
| `yozexa_emission_emitted_yzxa` | paid out by the block reward schedule, and its reserve |
| `yozexa_vesting_locked_yzxa` | still locked by genesis schedules |
| `yozexa_block_height` | the latest committed block |
| `yozexa_peers` | zero means this node is isolated |
| `yozexa_catching_up` | 1 while replaying rather than following |
| `yozexa_validators_active` | and `_jailed`, `_tombstoned` |
| `yozexa_base_fee_ayzxa` | and the gas price of each fee tier |
| `yozexa_node_info{version,chain_id}` | always 1; the labels are the point |

### Why amounts are in YZXA and not base units

Prometheus stores every sample as a float64, which stops counting integers one
at a time past 2^53. A base-unit figure runs to 10^25, so publishing ayzxa
would quietly round the last eight digits of the supply.

Amounts are therefore published in whole YZXA, where a float64 has precision to
spare for anything a monitoring system needs to notice. `/v1/supply` serves the
exact integer. Reconcile there; alert here.

## Alerts

`alerts.yml` in this directory. Thirteen rules, in four groups:

- **money** — a broken invariant, conservation failing, supply approaching the
  cap, emission past its reserve
- **liveness** — the chain halted, a node isolated, too few peers, syncing for
  too long
- **validators** — a tombstoning (permanent, only ever from double signing),
  jailing, the active set shrinking past the point where consensus is at risk
- **build** — nodes on different versions, or on different chains

Nothing fires on a metric that is merely unusual. An alert that cries wolf is
worse than no alert, because it teaches whoever carries the pager to ignore the
one that matters.

## YOZEXA Pay

Pay serves `/metrics` on its own port, in the same format. Its failures are the
quiet kind: payments that never settle because the node is unreachable,
webhooks that pile up undelivered. Nothing throws — the merchant simply stops
being paid, and hears about it from a customer.

| Metric | |
|---|---|
| `yozexa_pay_database_up` | 0 means nothing can settle at all |
| `yozexa_pay_node_up` | 0 means customers can pay on-chain and never be credited |
| `yozexa_pay_node_height` | flat means settlement is not advancing |
| `yozexa_pay_payments{status}` | counts by status; a rising `expired` beside a flat `confirmed` is the shape of a settlement problem |
| `yozexa_pay_payments_value_yzxa{status}` | their value, in YZXA |
| `yozexa_pay_webhooks_pending` | still being retried |
| `yozexa_pay_webhooks_exhausted` | gave up — each one is a merchant who was never told |
| `yozexa_pay_webhooks_oldest_pending_seconds` | how far behind delivery is |
| `yozexa_pay_merchants` | registered merchants |

Five more alert rules cover them, in the `yozexa-pay` group.

## What this does not cover

No tracing, no per-endpoint latency, no request rate. The indexer and the web
apps publish nothing at all. Those are worth having before mainnet and are not
here yet.
