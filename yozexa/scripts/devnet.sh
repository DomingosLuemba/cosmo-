#!/usr/bin/env bash
#
# YOZEXA local development network.
#
# Brings up the whole stack against a single-validator chain: node, API,
# indexer, Pay, explorer, wallet and the developer portal.
#
#   scripts/devnet.sh up      start everything
#   scripts/devnet.sh down    stop everything
#   scripts/devnet.sh status  show what is running
#   scripts/devnet.sh reset   wipe the chain data and start fresh
#
# It is a development tool. It creates keys with a fixed passphrase and funds
# them, which is fine on a chain whose tokens have no value and unacceptable
# anywhere else.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${YOZEXA_DEV_DIR:-${TMPDIR:-/tmp}/yozexa-devnet}"
HOME_DIR="$RUN_DIR/node"
LOG_DIR="$RUN_DIR/logs"
PID_DIR="$RUN_DIR/pids"
BUILD_DIR="$RUN_DIR/bin"

NODE_API="${NODE_API:-127.0.0.1:1717}"
EXPLORER_PORT="${EXPLORER_PORT:-3001}"
WALLET_PORT="${WALLET_PORT:-3002}"
BUSINESS_PORT="${BUSINESS_PORT:-3003}"
DEVELOPER_PORT="${DEVELOPER_PORT:-3004}"
PAY_PORT="${PAY_PORT:-8080}"

# A fixed development passphrase. This network's tokens have no value.
export YOZEXA_PASSPHRASE="${YOZEXA_PASSPHRASE:-yozexa-devnet-passphrase}"
export DATABASE_URL="${DATABASE_URL:-postgres://yozexa:yozexa_dev@127.0.0.1:5432/yozexa_pay}"

mkdir -p "$LOG_DIR" "$PID_DIR" "$BUILD_DIR"

log()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# --- process control ----------------------------------------------------
# PIDs are tracked in files rather than matched by command line, because
# pattern-matching process lists is a good way to kill the wrong thing.

start_bg() {
  local name="$1"; shift
  if is_running "$name"; then
    warn "$name is already running (pid $(cat "$PID_DIR/$name.pid"))"
    return 0
  fi
  "$@" > "$LOG_DIR/$name.log" 2>&1 &
  echo $! > "$PID_DIR/$name.pid"
  log "started $name (pid $!) — log: $LOG_DIR/$name.log"
}

is_running() {
  local pidfile="$PID_DIR/$1.pid"
  [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

stop_bg() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  [[ -f "$pidfile" ]] || return 0
  local pid; pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 25); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "$pid" 2>/dev/null || true
    log "stopped $name"
  fi
  rm -f "$pidfile"
}

wait_for_http() {
  local url="$1" name="$2" tries="${3:-40}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf --noproxy '*' "$url" >/dev/null 2>&1; then
      log "$name is up"
      return 0
    fi
    sleep 1
  done
  warn "$name did not answer at $url — see $LOG_DIR"
  return 1
}

# --- commands -----------------------------------------------------------

build() {
  log "building the chain binaries"
  (cd "$ROOT/chain" && BUILD_DIR="$BUILD_DIR" make build >/dev/null)
}

init_chain() {
  if [[ -f "$HOME_DIR/config/genesis.json" ]]; then
    log "chain already initialised at $HOME_DIR"
    return 0
  fi
  log "initialising a single-validator localnet"
  mkdir -p "$HOME_DIR"
  "$BUILD_DIR/yozexa" keys create validator --home "$HOME_DIR" >/dev/null
  "$BUILD_DIR/yozexa" keys create merchant  --home "$HOME_DIR" >/dev/null
  "$BUILD_DIR/yozexa" keys create customer  --home "$HOME_DIR" >/dev/null
  "$BUILD_DIR/yozexad" init devnet-validator \
    --home "$HOME_DIR" --network localnet --with-genesis \
    --operator-key validator --passphrase "$YOZEXA_PASSPHRASE" >/dev/null
  log "genesis written to $HOME_DIR/config/genesis.json"
}

up() {
  command -v curl >/dev/null || die "curl is required"
  build
  init_chain

  start_bg node "$BUILD_DIR/yozexad" start --home "$HOME_DIR" --api "$NODE_API" --log-level error
  wait_for_http "http://$NODE_API/v1/health" "node API" || die "the node did not start"

  if pg_isready -q 2>/dev/null; then
    (cd "$ROOT" && npm run build --workspace @yozexa/sdk >/dev/null 2>&1) || true
    (cd "$ROOT" && npm run build --workspace @yozexa/indexer >/dev/null 2>&1) || true
    (cd "$ROOT" && npm run build --workspace @yozexa/pay >/dev/null 2>&1) || true
    start_bg pay env YOZEXA_NODE="http://$NODE_API" PAY_PORT="$PAY_PORT" \
      YOZEXA_ENVIRONMENT=test node "$ROOT/pay/dist/src/server.js"
    wait_for_http "http://127.0.0.1:$PAY_PORT/v1/health" "YOZEXA Pay" 20 || true
  else
    warn "PostgreSQL is not reachable — skipping YOZEXA Pay and the indexer"
  fi

  for app in "explorer:$EXPLORER_PORT:$ROOT/explorer" \
             "wallet:$WALLET_PORT:$ROOT/wallet/web" \
             "business:$BUSINESS_PORT:$ROOT/business" \
             "developer:$DEVELOPER_PORT:$ROOT/developer"; do
    IFS=: read -r name port dir <<< "$app"
    [[ -d "$dir" ]] || continue
    if [[ ! -d "$dir/.next" ]]; then
      log "building $name"
      (cd "$dir" && npx next build >/dev/null 2>&1) || { warn "$name failed to build"; continue; }
    fi
    start_bg "$name" env YOZEXA_NODE="http://$NODE_API" \
      PAY_API="http://127.0.0.1:$PAY_PORT" \
      npx --prefix "$dir" next start --dir "$dir" -p "$port"
  done

  echo
  log "YOZEXA devnet is up"
  echo "    node API    http://$NODE_API"
  echo "    explorer    http://127.0.0.1:$EXPLORER_PORT"
  echo "    wallet      http://127.0.0.1:$WALLET_PORT"
  echo "    business    http://127.0.0.1:$BUSINESS_PORT"
  echo "    developer   http://127.0.0.1:$DEVELOPER_PORT"
  echo "    pay API     http://127.0.0.1:$PAY_PORT"
  echo
  echo "    keys        $HOME_DIR/keyring   (passphrase: \$YOZEXA_PASSPHRASE)"
  echo "    logs        $LOG_DIR"
  echo
  warn "This is a local network. Its YZXA has NO REAL VALUE."
}

down() {
  for name in developer business wallet explorer pay indexer node; do
    stop_bg "$name"
  done
  log "devnet stopped"
}

status() {
  printf '%-12s %-10s %s\n' SERVICE STATE PID
  for name in node pay indexer explorer wallet business developer; do
    if is_running "$name"; then
      printf '%-12s \033[32m%-10s\033[0m %s\n' "$name" running "$(cat "$PID_DIR/$name.pid")"
    else
      printf '%-12s \033[90m%-10s\033[0m -\n' "$name" stopped
    fi
  done
  echo
  if curl -sf --noproxy '*' "http://$NODE_API/v1/status" >/dev/null 2>&1; then
    curl -s --noproxy '*' "http://$NODE_API/v1/status" |
      python3 -c 'import sys,json;d=json.load(sys.stdin);print(f"chain {d[\"chain_id\"]} at height {d[\"height\"]}")' 2>/dev/null || true
  fi
}

reset() {
  down
  log "wiping $RUN_DIR"
  rm -rf "$RUN_DIR"
  up
}

case "${1:-up}" in
  up)     up ;;
  down)   down ;;
  status) status ;;
  reset)  reset ;;
  *)      die "usage: $0 {up|down|status|reset}" ;;
esac
