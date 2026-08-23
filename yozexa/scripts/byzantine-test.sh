#!/usr/bin/env bash
#
# A validator that equivocates, on a live network.
#
# Crash faults — a node stopping — are covered by consensus-test.sh. This is
# the other half: a validator that stays up and signs two conflicting things
# for the same height. It is the infraction the whole slashing design exists
# for, and until it has actually happened on a running chain, the handling of
# it is only unit-tested.
#
# The double sign is produced the way real ones are: the same consensus key
# running on two nodes, with the second one's signing state reset so it does
# not know what the first already signed. That is an operator restoring a
# backup and starting the node again — the commonest cause of a real slashing,
# and no more contrived than the thing it models.
#
#   ./scripts/byzantine-test.sh
#
# Builds its own 4-validator network, equivocates, and checks the consequences.
# Leaves everything running so a failure can be inspected.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${YOZEXA_MULTINODE_DIR:-/tmp/yozexa-multinode}"
BIN="$RUN_DIR/bin"
N=4
VICTIM=3   # the validator whose key gets cloned
export YOZEXA_PASSPHRASE="${YOZEXA_PASSPHRASE:-yozexa-multinode-passphrase}"

pass=0; fail=0
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; pass=$((pass+1)); }
bad()   { printf '  \033[31m✗\033[0m %s\n' "$*"; fail=$((fail+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$*"; }

API=http://127.0.0.1:1720
validators() { curl -s --noproxy '*' --max-time 5 "$API/v1/validators" 2>/dev/null; }
field_of() {  # field_of <moniker> <field>
  validators() { curl -s --noproxy '*' --max-time 5 "$API/v1/validators" 2>/dev/null; }
  validators | python3 -c "
import sys, json
want, field = sys.argv[1], sys.argv[2]
for v in json.load(sys.stdin).get('validators', []):
    if v.get('moniker') == want:
        print(v.get(field, '')); break
" "$1" "$2" 2>/dev/null
}
height() { curl -s --noproxy '*' --max-time 5 "$API/v1/status" 2>/dev/null \
             | python3 -c 'import sys,json;print(json.load(sys.stdin)["height"])' 2>/dev/null; }

head_ "Building a network of $N validators"
"$ROOT/scripts/multinode.sh" reset >/dev/null 2>&1
"$ROOT/scripts/multinode.sh" up "$N" >/dev/null 2>&1 || { echo "could not start the network"; exit 1; }
for _ in $(seq 1 90); do h="$(height)"; [[ -n "$h" && "$h" -gt 0 ]] && break; sleep 1; done
[[ -n "${h:-}" && "$h" -gt 0 ]] || { echo "the network never produced a block"; exit 1; }

stake_before="$(field_of "v$VICTIM" tokens)"
[[ -n "$stake_before" ]] || { echo "could not read v$VICTIM's stake"; exit 1; }
ok "network at height $h; v$VICTIM holds $stake_before ayzxa, not jailed"

head_ "Cloning v$VICTIM's consensus key onto a second node"
twin="$RUN_DIR/twin"
rm -rf "$twin"; mkdir -p "$twin"
"$BIN/yozexad" init "twin-of-v$VICTIM" --home "$twin" --network localnet \
  > "$RUN_DIR/logs/init-twin.log" 2>&1
cp "$RUN_DIR/v0/config/genesis.json" "$twin/config/genesis.json"
cp "$RUN_DIR/v$VICTIM/config/priv_validator_key.json" "$twin/config/priv_validator_key.json"
# Reset the signing state: without this the twin refuses to sign a height its
# other copy already signed, which is the protection being modelled as absent.
printf '{"height":"0","round":0,"step":0}\n' > "$twin/data/priv_validator_state.json"

peers=""
for ((j = 0; j < N; j++)); do
  id="$(grep -oE 'node id: +\S+' "$RUN_DIR/logs/init-$j.log" | awk '{print $3}')"
  peers+="$id@127.0.0.1:$((26651 + j * 10)),"
done
python3 - "$twin/config/config.toml" "${peers%,}" <<'PY'
import re, sys
p, peers = sys.argv[1], sys.argv[2]
s = open(p).read()
s = re.sub(r'^laddr = "tcp://127\.0\.0\.1:26657"', 'laddr = "tcp://127.0.0.1:26797"', s, count=1, flags=re.M)
s = re.sub(r'^laddr = "tcp://0\.0\.0\.0:26656"',   'laddr = "tcp://0.0.0.0:26798"',   s, count=1, flags=re.M)
s = re.sub(r'^persistent_peers = ".*"',            f'persistent_peers = "{peers}"',   s, count=1, flags=re.M)
s = re.sub(r'^allow_duplicate_ip = false',         'allow_duplicate_ip = true',       s, count=1, flags=re.M)
s = re.sub(r'^addr_book_strict = true',            'addr_book_strict = false',        s, count=1, flags=re.M)
# CometBFT's own guard against starting with a key already voting on the
# network. Disabling it is what makes the equivocation possible to stage; it is
# the app's response being tested here, not that guard.
s = re.sub(r'^double_sign_check_height = \d+',     'double_sign_check_height = 0',    s, count=1, flags=re.M)
open(p, "w").write(s)
PY

a="$(python3 -c "import json;print(json.load(open('$RUN_DIR/v$VICTIM/config/priv_validator_key.json'))['pub_key']['value'])")"
b="$(python3 -c "import json;print(json.load(open('$twin/config/priv_validator_key.json'))['pub_key']['value'])")"
[[ "$a" == "$b" ]] && ok "the twin carries the same consensus key as v$VICTIM" \
                   || bad "the keys differ — nothing would equivocate"

head_ "Equivocating"
setsid bash -c 'echo $$ > "$1"; shift; exec "$@"' _ "$RUN_DIR/pids/twin.pid" \
  "$BIN/yozexad" start --home "$twin" --api 127.0.0.1:1749 --log-level info \
  > "$RUN_DIR/logs/twin.log" 2>&1 &

tombstoned=""
for _ in $(seq 1 90); do
  tombstoned="$(field_of "v$VICTIM" tombstoned)"
  [[ "$tombstoned" == "True" ]] && break
  sleep 1
done

if grep -q "DuplicateVoteEvidence" "$RUN_DIR/logs/twin.log" 2>/dev/null; then
  ok "the network formed DuplicateVoteEvidence against v$VICTIM"
else
  bad "no duplicate-vote evidence was produced — the equivocation did not reach consensus"
fi

head_ "Consequences"
if [[ "$tombstoned" == "True" ]]; then
  ok "v$VICTIM is tombstoned"
else
  bad "v$VICTIM was not tombstoned (tombstoned=$tombstoned)"
fi
[[ "$(field_of "v$VICTIM" jailed)" == "True" ]] && ok "v$VICTIM is jailed" || bad "v$VICTIM is not jailed"
[[ "$(field_of "v$VICTIM" active)" == "False" ]] && ok "v$VICTIM is out of the active set" \
                                                 || bad "v$VICTIM is still validating"

stake_after="$(field_of "v$VICTIM" tokens)"
python3 - "$stake_before" "$stake_after" <<'PY' && ok "slashed exactly 5%, to the base unit" || bad "the slash was not exactly 5%"
import sys
before, after = int(sys.argv[1]), int(sys.argv[2])
expected = before * 500 // 10_000          # 500 bps
burned = before - after
print(f"      {before:,} → {after:,} ayzxa")
print(f"      burned {burned:,}, expected {expected:,}")
sys.exit(0 if burned == expected else 1)
PY

# Losing one of four still leaves more than two thirds, so the chain must run on.
h1="$(height)"; sleep 8; h2="$(height)"
[[ -n "$h2" && "$h2" -gt "$h1" ]] && ok "the network kept producing blocks without it" \
                                  || bad "the chain stopped after the slashing"

inv="$(curl -s --noproxy '*' --max-time 5 "$API/v1/invariants" 2>/dev/null \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["ok"])' 2>/dev/null)"
[[ "$inv" == "True" ]] && ok "all eight invariants still hold after the slash" \
                       || bad "an invariant broke when the stake was slashed"

head_ "The removal is permanent"
kill -TERM "-$(cat "$RUN_DIR/pids/twin.pid")" 2>/dev/null; sleep 2

out="$("$BIN/yozexa" tx unjail --from "operator$VICTIM" --home "$RUN_DIR/v$VICTIM" \
        --node 127.0.0.1:1720 2>&1)"
echo "$out" | grep -qi "can never be unjailed" && ok "it cannot unjail itself" \
                                               || bad "unjail was not refused: $(echo "$out" | tail -1)"

conskey="$(python3 -c "import json;print(json.load(open('$RUN_DIR/v$VICTIM/config/priv_validator_key.json'))['pub_key']['value'])")"
"$BIN/yozexa" keys create recycler --home "$RUN_DIR/v$VICTIM" >/dev/null 2>&1
recycler="$("$BIN/yozexa" keys show recycler --home "$RUN_DIR/v$VICTIM" | grep -oE 'yzx1[a-z0-9]+' | head -1)"
"$BIN/yozexa" tx send "$recycler" 5000 --from operator0 --home "$RUN_DIR/v0" \
  --node 127.0.0.1:1720 >/dev/null 2>&1
sleep 3
out="$("$BIN/yozexa" tx create-validator 1000 --from recycler --home "$RUN_DIR/v$VICTIM" \
        --node 127.0.0.1:1720 --consensus-pubkey "$conskey" --moniker "recycled" 2>&1)"
echo "$out" | grep -qi "may never validate again" \
  && ok "the tombstoned key cannot be reused by a different operator" \
  || bad "a new operator was allowed to reuse the key: $(echo "$out" | tail -1)"

# A refusal proves nothing unless the same path accepts a legitimate case.
head_ "…and only for that key"
rm -rf "$RUN_DIR/v9"; mkdir -p "$RUN_DIR/v9"
"$BIN/yozexad" init "v9" --home "$RUN_DIR/v9" --network localnet > "$RUN_DIR/logs/init-9.log" 2>&1
newkey="$(grep -oE 'consensus key: +\S+' "$RUN_DIR/logs/init-9.log" | awk '{print $3}')"
"$BIN/yozexa" keys create operator9 --home "$RUN_DIR/v9" >/dev/null 2>&1
newop="$("$BIN/yozexa" keys show operator9 --home "$RUN_DIR/v9" | grep -oE 'yzx1[a-z0-9]+' | head -1)"
"$BIN/yozexa" tx send "$newop" 3000 --from operator0 --home "$RUN_DIR/v0" \
  --node 127.0.0.1:1720 >/dev/null 2>&1
sleep 3
"$BIN/yozexa" tx create-validator 2000 --from operator9 --home "$RUN_DIR/v9" \
  --node 127.0.0.1:1720 --consensus-pubkey "$newkey" --moniker "v9-fresh" >/dev/null 2>&1
sleep 6
[[ "$(field_of "v9-fresh" active)" == "True" ]] \
  && ok "a validator with its own key still joins — the refusal is about the key, not the path" \
  || bad "a legitimate validator could not join either, so the refusals prove nothing"

printf '\n\033[1m%d passed, %d failed\033[0m\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]] || exit 1
