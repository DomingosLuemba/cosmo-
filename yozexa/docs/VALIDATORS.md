# Running a YOZEXA Validator

## Before you start

A validator that misbehaves loses money, and so do its delegators. Read
[CONSENSUS.md](CONSENSUS.md) for the slashing rules. The two that will cost you
most:

- **Double signing burns 5% of your stake and bans your consensus key forever.**
  The most common cause is running two nodes with the same
  `priv_validator_key.json`. Never copy that file to a second machine. Never
  restore a validator from a snapshot without wiping its state.
- **Downtime jails you** and burns a small amount. You return with `MsgUnjail`
  after the jail expires.

## Hardware

| | Testnet | Mainnet |
|---|---|---|
| CPU | 4 cores | 8+ cores, modern |
| RAM | 8 GB | 32 GB |
| Disk | 200 GB SSD | 1 TB NVMe, monitored for growth |
| Network | 100 Mbit | 1 Gbit, low latency to peers |

Disk speed matters more than core count: consensus is I/O sensitive and a slow
disk shows up as missed blocks.

## Setup

```bash
# 1. Build
git clone <repo> && cd yozexa/chain && make build

# 2. Create an operator key. This controls your stake — put it on a
#    hardware wallet for mainnet, not in a file on the validator.
export YOZEXA_PASSPHRASE='...'          # or omit and pass --passphrase
./build/yozexa keys create operator

# 3. Initialise the node
./build/yozexad init my-validator --network testnet

# 4. Fetch the network genesis and place it at
#    ~/.yozexa/config/genesis.json, then verify it:
./build/yozexad genesis validate

# 5. Add persistent peers in ~/.yozexa/config/config.toml, then start
./build/yozexad start
```

Once synced, create the validator:

```bash
./build/yozexa tx create-validator \
  --moniker "my-validator" \
  --self-delegation 100000 \
  --commission 10 --max-commission 20 \
  --from operator
```

## Sentry architecture (required for mainnet)

Do not expose a validator's p2p port to the public internet.

```
   internet ──► sentry 1 ─┐
   internet ──► sentry 2 ─┼──► validator (private network only)
   internet ──► sentry 3 ─┘
```

- Validator: `pex = false`, `persistent_peers` = your sentries only,
  `private_peer_ids` = your sentries.
- Sentries: public, full peer exchange, `private_peer_ids` = the validator, so
  they never gossip its address.

This is the defence against targeted DDoS and eclipse attacks on your validator.

## Key handling

| Key | Where it must live |
|---|---|
| `priv_validator_key.json` (consensus) | An HSM or a remote signer. Never on more than one machine. Never in a backup that could be restored alongside a running node |
| Operator key | Hardware wallet, offline. It controls the stake and the commission |
| `node_key.json` | On the node; it is only a p2p identity |

If you must keep the consensus key as a file, keep exactly one copy and treat
restoring it as a dangerous operation. Also back up
`priv_validator_state.json` — restoring an old copy is one of the ways
operators accidentally double sign.

## Monitoring

Alert on, at minimum:

- missed blocks in the signing window approaching the jail threshold;
- your validator's jailed or tombstoned status changing;
- peer count falling;
- block time rising or the node falling behind the network;
- disk usage growth;
- **the node process exiting with an invariant violation** — that is a network
  emergency, not a local one. See [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

`yozexa supply verify` exits non-zero if any invariant fails on your node; run
it from monitoring.

## Commission

You declare `max_commission_bps` when you create the validator and can never
exceed it afterwards. Choose it honestly: delegators are choosing you partly on
that promise, and the protocol will hold you to it.

## Upgrades

A `software_upgrade` proposal schedules a coordinated halt at a height. Have the
new binary ready before that height, verify its checksum and signature, and
restart promptly — the chain does not resume until enough voting power is back.
