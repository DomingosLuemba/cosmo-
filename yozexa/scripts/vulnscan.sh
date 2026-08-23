#!/usr/bin/env bash
#
# Scan the Go dependency tree for known vulnerabilities.
#
# `govulncheck` normally fetches its database from vuln.go.dev. Where that host
# is unreachable — a restricted network, an air-gapped build — the scan is
# usually skipped, and a skipped scan reads in a report exactly like a clean
# one. It is not: running this for the first time turned up 38 vulnerabilities
# reachable from this code.
#
# The OSV archive that vuln.go.dev is built from lives in a public bucket, and
# builds into the layout govulncheck consumes. This fetches it, assembles the
# database, and runs the scan against it — with reachability analysis, so what
# it reports is what this code actually calls.
#
#   ./scripts/vulnscan.sh            scan, using a cached database if it is fresh
#   ./scripts/vulnscan.sh --refresh  fetch the advisories again first
#
# Exit 0 when nothing reachable is found, 1 otherwise.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${YOZEXA_VULNDB_DIR:-/tmp/yozexa-vulndb}"
OSV_URL="https://osv-vulnerabilities.storage.googleapis.com/Go/all.zip"
MAX_AGE_HOURS=24

log()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v go >/dev/null || die "go is required"

if ! command -v govulncheck >/dev/null 2>&1; then
  export PATH="$PATH:$(go env GOPATH)/bin"
fi
if ! command -v govulncheck >/dev/null 2>&1; then
  log "installing govulncheck"
  go install golang.org/x/vuln/cmd/govulncheck@latest 2>&1 | tail -2 ||
    die "could not install govulncheck"
  export PATH="$PATH:$(go env GOPATH)/bin"
fi

# Try the real database first. When it works there is no reason to use a
# locally assembled copy, which can only ever be as fresh as the last fetch.
if [[ "${1:-}" != "--offline" ]] &&
   curl -sf --max-time 10 -o /dev/null "https://vuln.go.dev/index/db.json" 2>/dev/null; then
  log "vuln.go.dev is reachable — scanning against it"
  ( cd "$ROOT/chain" && govulncheck ./... )
  exit $?
fi

log "vuln.go.dev is not reachable — building a local database from OSV"

stale=1
if [[ -f "$CACHE/db/index/db.json" ]]; then
  age=$(( ($(date +%s) - $(stat -c %Y "$CACHE/db/index/db.json" 2>/dev/null || echo 0)) / 3600 ))
  [[ "$age" -lt "$MAX_AGE_HOURS" ]] && stale=0
  [[ "$stale" == 0 ]] && log "using the cached database (${age}h old)"
fi

if [[ "${1:-}" == "--refresh" || "$stale" == 1 ]]; then
  mkdir -p "$CACHE"
  log "fetching the Go advisory archive"
  curl -sS --max-time 180 -o "$CACHE/all.zip" "$OSV_URL" ||
    die "could not fetch $OSV_URL — no scan was run, and that is not the same as a clean one"

  rm -rf "$CACHE/db"
  python3 - "$CACHE" <<'PY'
"""Assemble the govulncheck v1 database layout from the OSV archive."""
import collections, json, os, sys, zipfile

cache = sys.argv[1]
z = zipfile.ZipFile(f"{cache}/all.zip")
out = f"{cache}/db"
os.makedirs(f"{out}/index", exist_ok=True)
os.makedirs(f"{out}/ID", exist_ok=True)

modules = collections.defaultdict(list)
vulns, newest, kept = [], "1970-01-01T00:00:00Z", 0

for name in z.namelist():
    if not name.endswith(".json"):
        continue
    entry = json.loads(z.read(name))
    # govulncheck indexes by GO-id; OSV keeps it in `id` or among the aliases.
    go_id = entry.get("id", "")
    if not go_id.startswith("GO-"):
        go_id = next((a for a in entry.get("aliases", []) if a.startswith("GO-")), "")
    if not go_id:
        continue
    entry["id"] = go_id
    modified = entry.get("modified", "1970-01-01T00:00:00Z")
    newest = max(newest, modified)

    with open(f"{out}/ID/{go_id}.json", "w") as f:
        json.dump(entry, f)
    vulns.append({"id": go_id, "modified": modified, "aliases": entry.get("aliases", [])})

    for aff in entry.get("affected", []):
        path = aff.get("package", {}).get("name", "")
        if not path:
            continue
        fixed = ""
        for r in aff.get("ranges", []):
            for ev in r.get("events", []):
                if "fixed" in ev:
                    fixed = ev["fixed"]
        modules[path].append({"id": go_id, "modified": modified, "fixed": fixed})
    kept += 1

with open(f"{out}/index/db.json", "w") as f:
    json.dump({"modified": newest}, f)
with open(f"{out}/index/modules.json", "w") as f:
    json.dump([{"path": p, "vulns": v} for p, v in sorted(modules.items())], f)
with open(f"{out}/index/vulns.json", "w") as f:
    json.dump(vulns, f)

print(f"    {kept} advisories, {len(modules)} affected modules")
PY
  [[ -f "$CACHE/db/index/db.json" ]] || die "the database was not assembled"
fi

log "scanning"
report="$(mktemp)"
# `cd` rather than `-C`: govulncheck reports standard-library vulnerabilities
# against whichever Go toolchain resolved before it started, and the toolchain
# directive in chain/go.mod only applies inside that module. Running from the
# repository root — where there is no go.mod — silently scans against the
# system Go instead, and reports vulnerabilities the shipped binary does not
# have. Measured: 32 from the root, 0 from inside the module, for the same code.
( cd "$ROOT/chain" && govulncheck -db "file://$CACHE/db" ./... ) 2>&1 | tee "$report"
found="$(grep -cE '^Vulnerability #' "$report" || true)"
rm -f "$report"

echo
if [[ "$found" -gt 0 ]]; then
  warn "$found vulnerabilities are reachable from this code"
  exit 1
fi
log "nothing reachable from this code"
printf '    scanned with %s\n' "$(cd "$ROOT/chain" && go version | awk '{print $3}')"
