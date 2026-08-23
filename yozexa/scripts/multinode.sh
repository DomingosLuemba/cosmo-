#!/usr/bin/env bash
#
# A YOZEXA network with several validators, on one machine.
#
# A single-validator chain proves the state machine works. It cannot show that
# consensus does: it never disagrees, never loses a node, and never has to
# reach two thirds of anything. This builds a real validator set so those
# properties can be tested.
#
#   ./scripts/multinode.sh up [n]     build and start n validators (default 4)
#   ./scripts/multinode.sh status     heights and app hashes, side by side
#   ./scripts/multinode.sh stop <i>   stop validator i
#   ./scripts/multinode.sh start <i>  start it again
#   ./scripts/multinode.sh down       stop everything
#   ./scripts/multinode.sh reset      wipe and start over
#
# Ports: validator i listens on RPC 26650+i*10, P2P 26651+i*10, API 1720+i.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${YOZEXA_MULTINODE_DIR:-/tmp/yozexa-multinode}"
BUILD_DIR="$RUN_DIR/bin"
LOG_DIR="$RUN_DIR/logs"
PID_DIR="$RUN_DIR/pids"
PASSPHRASE="${YOZEXA_PASSPHRASE:-yozexa-multinode-passphrase}"
export YOZEXA_PASSPHRASE="$PASSPHRASE"

mkdir -p "$BUILD_DIR" "$LOG_DIR" "$PID_DIR"

log()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

home_of() { echo "$RUN_DIR/v$1"; }
rpc_port()  { echo $((26650 + $1 * 10)); }
p2p_port()  { echo $((26651 + $1 * 10)); }
api_port()  { echo $((1720 + $1)); }

count_file="$RUN_DIR/count"
node_count() { cat "$count_file" 2>/dev/null || echo 0; }

# Each validator runs in its own process group, and the group leader writes its
# own pid — see scripts/devnet.sh for why the obvious version does not work.
start_bg() {
  local name="$1"; shift
  local pidfile="$PID_DIR/$name.pid"
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    warn "$name is already running"; return 0
  fi
  setsid bash -c 'echo $$ > "$1"; shift; exec "$@"' _ "$pidfile" "$@" \
    > "$LOG_DIR/$name.log" 2>&1 &
  for _ in $(seq 1 20); do [[ -s "$pidfile" ]] && break; sleep 0.1; done
}

stop_bg() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  [[ -f "$pidfile" ]] || return 0
  local pid; pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 25); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

build() {
  log "building the chain binaries"
  (cd "$ROOT/chain" && BUILD_DIR="$BUILD_DIR" make build >/dev/null)
}

# Read a value out of a node's init output.
init_node() {
  local i="$1" home; home="$(home_of "$i")"
  mkdir -p "$home"
  "$BUILD_DIR/yozexa" keys create "operator$i" --home "$home" >/dev/null
  if [[ "$i" == "0" ]]; then
    "$BUILD_DIR/yozexad" init "v0" --home "$home" --network localnet --with-genesis \
      --operator-key "operator0" --passphrase "$PASSPHRASE" > "$LOG_DIR/init-0.log"
  else
    "$BUILD_DIR/yozexad" init "v$i" --home "$home" --network localnet > "$LOG_DIR/init-$i.log"
  fi
}

cons_key_of() { grep -oE 'consensus key: +\S+' "$LOG_DIR/init-$1.log" | awk '{print $3}'; }
node_id_of()  { grep -oE 'node id: +\S+'       "$LOG_DIR/init-$1.log" | awk '{print $3}'; }
operator_of() { "$BUILD_DIR/yozexa" keys show "operator$1" --home "$(home_of "$1")" | grep -oE 'yzx1[a-z0-9]+' | head -1; }

configure() {
  local i="$1" n="$2" home; home="$(home_of "$i")"
  local cfgfile="$home/config/config.toml"
  # Every other validator is a persistent peer, so the mesh forms without a
  # seed node. On one machine that is the whole set; on real hosts it would be
  # a handful of addresses.
  local peers=""
  for ((j = 0; j < n; j++)); do
    [[ "$j" == "$i" ]] && continue
    peers+="$(node_id_of "$j")@127.0.0.1:$(p2p_port "$j"),"
  done
  peers="${peers%,}"

  python3 - "$cfgfile" "$(rpc_port "$i")" "$(p2p_port "$i")" "$peers" <<'PY'
import re, sys
path, rpc, p2p, peers = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
s = open(path).read()
s = re.sub(r'^laddr = "tcp://127\.0\.0\.1:26657"', f'laddr = "tcp://127.0.0.1:{rpc}"', s, count=1, flags=re.M)
s = re.sub(r'^laddr = "tcp://0\.0\.0\.0:26656"',   f'laddr = "tcp://0.0.0.0:{p2p}"',   s, count=1, flags=re.M)
s = re.sub(r'^persistent_peers = ".*"',            f'persistent_peers = "{peers}"',    s, count=1, flags=re.M)
# One machine, many nodes: without this every peer looks like a duplicate IP.
s = re.sub(r'^allow_duplicate_ip = false',         'allow_duplicate_ip = true',        s, count=1, flags=re.M)
s = re.sub(r'^addr_book_strict = true',            'addr_book_strict = false',         s, count=1, flags=re.M)
open(path, "w").write(s)
PY
}

up() {
  local n="${1:-4}"
  command -v curl >/dev/null || die "curl is required"
  [[ "$n" -ge 2 ]] || die "a multi-validator network needs at least 2 validators"
  build

  if [[ ! -f "$(home_of 0)/config/genesis.json" ]]; then
    log "initialising $n validators"
    for ((i = 0; i < n; i++)); do init_node "$i"; done

    log "assembling a genesis with all $n validators"
    local genesis; genesis="$(home_of 0)/config/genesis.json"
    for ((i = 1; i < n; i++)); do
      "$BUILD_DIR/yozexad" genesis add-validator \
        --genesis "$genesis" \
        --operator "$(operator_of "$i")" \
        --consensus-pubkey "$(cons_key_of "$i")" \
        --moniker "v$i" >/dev/null
    done
    "$BUILD_DIR/yozexad" genesis validate "$genesis" | sed 's/^/    /'

    for ((i = 1; i < n; i++)); do cp "$genesis" "$(home_of "$i")/config/genesis.json"; done
    for ((i = 0; i < n; i++)); do configure "$i" "$n"; done
    echo "$n" > "$count_file"
  else
    n="$(node_count)"
    log "network already initialised with $n validators"
  fi

  for ((i = 0; i < n; i++)); do
    start_bg "v$i" "$BUILD_DIR/yozexad" start --home "$(home_of "$i")" \
      --api "127.0.0.1:$(api_port "$i")" --log-level error
  done

  log "waiting for the network to produce blocks"
  for _ in $(seq 1 60); do
    if curl -sf --noproxy '*' "http://127.0.0.1:$(api_port 0)/v1/status" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  status
}

status() {
  local n; n="$(node_count)"
  [[ "$n" -gt 0 ]] || die "no network here — run: $0 up"
  printf '\n  %-4s %-8s %-9s %-10s %s\n' node state height peers "app hash"
  for ((i = 0; i < n; i++)); do
    local pidfile="$PID_DIR/v$i.pid" state="stopped"
    [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null && state="running"
    local body; body="$(curl -s --noproxy '*' --max-time 3 "http://127.0.0.1:$(api_port "$i")/v1/status" 2>/dev/null || true)"
    if [[ -z "$body" ]]; then
      printf '  %-4s %-8s %-9s %-10s %s\n' "v$i" "$state" "—" "—" "—"
    else
      python3 - "$i" "$state" <<PY
import json, sys
d = json.loads('''$body''')
print("  v%-3s %-8s %-9s %-10s %s" % (
    sys.argv[1], sys.argv[2], d.get("height", "?"),
    d.get("peers", "?"), (d.get("latest_block_hash") or "")[:16]))
PY
    fi
  done
  echo
}

case "${1:-up}" in
  up)     up "${2:-4}" ;;
  status) status ;;
  stop)   [[ -n "${2:-}" ]] || die "which validator? e.g. $0 stop 3"; stop_bg "v$2"; log "stopped v$2" ;;
  start)  [[ -n "${2:-}" ]] || die "which validator? e.g. $0 start 3"
          start_bg "v$2" "$BUILD_DIR/yozexad" start --home "$(home_of "$2")" \
            --api "127.0.0.1:$(api_port "$2")" --log-level error
          log "started v$2" ;;
  down)   for ((i = 0; i < $(node_count); i++)); do stop_bg "v$i"; done; log "network stopped" ;;
  reset)  for ((i = 0; i < $(node_count); i++)); do stop_bg "v$i"; done
          rm -rf "$RUN_DIR"; log "wiped $RUN_DIR" ;;
  *)      die "unknown command ${1}" ;;
esac
