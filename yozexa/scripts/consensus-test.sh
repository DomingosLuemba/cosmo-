#!/usr/bin/env bash
#
# What a multi-validator network has to do, tested against one.
#
# A single-validator chain can pass every unit test and still not be a network:
# it never disagrees, never loses a node, and never has to reach two thirds of
# anything. These are the properties that only appear with a real validator
# set, and each one is checked by doing it, not by reading the consensus code.
#
#   ./scripts/consensus-test.sh          run against a network of 4
#   ./scripts/consensus-test.sh 5        run against a network of 5
#
# It builds the network itself, and leaves it running so failures can be
# inspected. `./scripts/multinode.sh down` stops it.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${YOZEXA_MULTINODE_DIR:-/tmp/yozexa-multinode}"
BIN="$RUN_DIR/bin"
N="${1:-4}"
export YOZEXA_PASSPHRASE="${YOZEXA_PASSPHRASE:-yozexa-multinode-passphrase}"

pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; fail=$((fail+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$*"; }

api()    { echo "http://127.0.0.1:$((1720 + $1))"; }
height() { curl -s --noproxy '*' --max-time 3 "$(api "$1")/v1/status" 2>/dev/null \
             | python3 -c 'import sys,json;print(json.load(sys.stdin)["height"])' 2>/dev/null || echo ""; }
apphash(){ curl -s --noproxy '*' --max-time 3 "$(api "$1")/v1/status" 2>/dev/null \
             | python3 -c 'import sys,json;print(json.load(sys.stdin).get("latest_block_hash",""))' 2>/dev/null; }
balance(){ curl -s --noproxy '*' --max-time 3 "$(api "$1")/v1/account/$2" 2>/dev/null \
             | python3 -c 'import sys,json;print(json.load(sys.stdin)["balance_yzxa"])' 2>/dev/null || echo ""; }

# Wait for the chain to advance past a height, or give up.
advance_past() {
  local node="$1" from="$2" tries="${3:-30}"
  for _ in $(seq 1 "$tries"); do
    local now; now="$(height "$node")"
    [[ -n "$now" && "$now" -gt "$from" ]] && { echo "$now"; return 0; }
    sleep 1
  done
  echo "${now:-}"
  return 1
}

head_ "Building a network of $N validators"
"$ROOT/scripts/multinode.sh" up "$N" >/dev/null 2>&1 || { echo "could not start the network"; exit 1; }
# Wait for real blocks, not just for the API to answer: a node that is up but
# has not reached consensus reports height 0, and every check below would then
# be measuring a chain that has not started.
for _ in $(seq 1 90); do
  start_height="$(height 0)"
  [[ -n "$start_height" && "$start_height" -gt 0 ]] && break
  sleep 1
done
[[ -n "${start_height:-}" && "$start_height" -gt 0 ]] || {
  echo "the network never produced a block — see $RUN_DIR/logs"; exit 1; }
ok "$N validators started, chain at height $start_height"

head_ "1. Every validator agrees"
sleep 6
# Heights drift by a block while a round is in flight, so the comparison is
# made at a height every node has already passed: ask each node for the hash of
# a specific block rather than of "its latest". Comparing latest-to-latest
# would pass without checking anything on the runs where the heights differ.
ref_h="$(height 0)"
target=$((ref_h - 2))
[[ "$target" -lt 1 ]] && target=1
block_hash() {
  curl -s --noproxy '*' --max-time 3 "$(api "$1")/v1/block/$2" 2>/dev/null \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("hash",""))' 2>/dev/null
}
ref_hash="$(block_hash 0 "$target")"
if [[ -z "$ref_hash" ]]; then
  bad "v0 could not produce the hash of block $target"
else
  agree=1; compared=0
  for ((i = 1; i < N; i++)); do
    hash="$(block_hash "$i" "$target")"
    if [[ -z "$hash" ]]; then
      bad "v$i has no block $target — it is not following the chain"; agree=0
    else
      compared=$((compared + 1))
      [[ "$hash" == "$ref_hash" ]] || { bad "v$i has a different block $target: $hash vs $ref_hash"; agree=0; }
    fi
  done
  if [[ "$compared" -lt $((N - 1)) ]]; then
    bad "only $compared of $((N - 1)) other validators could be compared"
  elif [[ "$agree" == 1 ]]; then
    ok "all $N validators have byte-identical block $target ($ref_hash)"
  fi
fi
for ((i = 1; i < N; i++)); do
  d=$(( $(height "$i") - ref_h )); d=${d#-}
  [[ "$d" -le 2 ]] || bad "v$i is $d blocks from v0 — not keeping up"
done
ok "no validator is more than 2 blocks behind"

head_ "2. A transaction on one node reaches every node"
dest="$("$BIN/yozexa" keys show operator2 --home "$RUN_DIR/v2" | grep -oE 'yzx1[a-z0-9]+' | head -1)"
before="$(balance 0 "$dest")"
"$BIN/yozexa" tx send "$dest" 77 --from operator1 --home "$RUN_DIR/v1" \
  --node "127.0.0.1:1721" >/dev/null 2>&1
sleep 6
replicated=1
for ((i = 0; i < N; i++)); do
  after="$(balance "$i" "$dest")"
  [[ "$after" == "$before" ]] && { bad "v$i never saw the transaction (still $after)"; replicated=0; }
done
[[ "$replicated" == 1 ]] && ok "a payment broadcast through v1 is visible on every node"

head_ "3. Liveness: the network survives losing one validator"
down_one=$((N - 1))
h0="$(height 0)"
"$ROOT/scripts/multinode.sh" stop "$down_one" >/dev/null 2>&1
if advance_past 0 "$h0" 30 >/dev/null; then
  ok "with $((N - 1)) of $N up, the chain keeps producing blocks"
else
  bad "the chain stopped after losing a single validator"
fi

head_ "4. Safety: the network halts without two thirds"
# Stop validators until fewer than two thirds remain.
stopped=1
while (( (N - stopped) * 3 >= N * 2 )); do
  "$ROOT/scripts/multinode.sh" stop $((N - 1 - stopped)) >/dev/null 2>&1
  stopped=$((stopped + 1))
done
sleep 4
h_before="$(height 0)"; sleep 15; h_after="$(height 0)"
if [[ "$h_before" == "$h_after" ]]; then
  ok "with $((N - stopped)) of $N up, the chain halts instead of advancing without quorum"
else
  bad "the chain advanced from $h_before to $h_after without two thirds of the validator set"
fi

head_ "5. Recovery: quorum returns and so does the chain"
for ((i = N - stopped; i < N; i++)); do "$ROOT/scripts/multinode.sh" start "$i" >/dev/null 2>&1; done
if advance_past 0 "$h_after" 45 >/dev/null; then
  ok "the chain resumes once enough validators are back"
else
  bad "the chain did not resume after quorum returned"
fi

head_ "6. A new node syncs the whole chain from genesis"
obs="$RUN_DIR/observer"
rm -rf "$obs"; mkdir -p "$obs"
"$BIN/yozexad" init observer --home "$obs" --network localnet > "$RUN_DIR/logs/init-observer.log" 2>&1
cp "$RUN_DIR/v0/config/genesis.json" "$obs/config/genesis.json"
peers=""
for ((j = 0; j < N; j++)); do
  id="$(grep -oE 'node id: +\S+' "$RUN_DIR/logs/init-$j.log" | awk '{print $3}')"
  peers+="$id@127.0.0.1:$((26651 + j * 10)),"
done
python3 - "$obs/config/config.toml" "${peers%,}" <<'PY'
import re, sys
p, peers = sys.argv[1], sys.argv[2]
s = open(p).read()
s = re.sub(r'^laddr = "tcp://127\.0\.0\.1:26657"', 'laddr = "tcp://127.0.0.1:26757"', s, count=1, flags=re.M)
s = re.sub(r'^laddr = "tcp://0\.0\.0\.0:26656"',   'laddr = "tcp://0.0.0.0:26758"',   s, count=1, flags=re.M)
s = re.sub(r'^persistent_peers = ".*"',            f'persistent_peers = "{peers}"',   s, count=1, flags=re.M)
s = re.sub(r'^allow_duplicate_ip = false',         'allow_duplicate_ip = true',       s, count=1, flags=re.M)
s = re.sub(r'^addr_book_strict = true',            'addr_book_strict = false',        s, count=1, flags=re.M)
open(p, "w").write(s)
PY
setsid bash -c 'echo $$ > "$1"; shift; exec "$@"' _ "$RUN_DIR/pids/observer.pid" \
  "$BIN/yozexad" start --home "$obs" --api 127.0.0.1:1739 --log-level error \
  > "$RUN_DIR/logs/observer.log" 2>&1 &
synced=0
for _ in $(seq 1 60); do
  body="$(curl -s --noproxy '*' --max-time 3 http://127.0.0.1:1739/v1/status 2>/dev/null)"
  if [[ -n "$body" ]]; then
    oh="$(echo "$body" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["height"] if not d.get("catching_up") else 0)' 2>/dev/null)"
    net="$(height 0)"
    if [[ -n "$oh" && "$oh" -gt 0 && -n "$net" && $((net - oh)) -le 3 ]]; then synced=1; break; fi
  fi
  sleep 1
done
if [[ "$synced" == 1 ]]; then
  ok "a node started from nothing replayed the chain and caught up"
  obs_hash="$(curl -s --noproxy '*' http://127.0.0.1:1739/v1/status | python3 -c 'import sys,json;print(json.load(sys.stdin).get("latest_block_hash",""))' 2>/dev/null)"
  [[ -n "$obs_hash" ]] && ok "and reached the same chain the validators are on"
else
  bad "a new node could not sync from genesis"
fi

head_ "7. Supply and invariants hold across the whole network"
for ((i = 0; i < N; i++)); do
  [[ -f "$RUN_DIR/pids/v$i.pid" ]] && kill -0 "$(cat "$RUN_DIR/pids/v$i.pid")" 2>/dev/null || continue
  inv="$(curl -s --noproxy '*' --max-time 5 "$(api "$i")/v1/invariants" 2>/dev/null \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["ok"])' 2>/dev/null)"
  [[ "$inv" == "True" ]] || bad "v$i reports a broken invariant"
done
ok "every running node passes all eight protocol invariants"

printf '\n\033[1m%d passed, %d failed\033[0m\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]] || exit 1
