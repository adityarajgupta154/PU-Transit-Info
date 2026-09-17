#!/usr/bin/env bash
# Secrets-hygiene sweep (SEC-04). Read-only. Never prints a secret value: store
# values reach grep as stdin patterns only (-f -), matches are reported as file
# counts, and xtrace is switched off first so `bash -x` cannot expand them.
#
# Prerequisites: build the outputs first —
#   PORT=22930 BASE_PATH=/ pnpm --filter @workspace/pu-transit run build
#   pnpm --filter @workspace/api-server run build
set +x
set -u
cd "$(dirname "$0")/.."
fail=0
say() { printf '%s\n' "$*"; }
verdict() { if [ "$1" -eq 0 ]; then say "  ok   $2"; else say "  FAIL $2"; fail=1; fi; }
# grep/git grep exit 1 = no match; anything above 1 is an error that must not read as clean.
counted() { local out status; out=$("$@" 2>/dev/null); status=$?; [ "$status" -le 1 ] || { say "  FAIL scan command failed (exit $status): $1"; fail=1; }; printf '%s\n' "$out" | grep -c .; }

# Credential shapes. Firebase web API keys are public identifiers by design and
# are only counted, further down. Both OpenRouteService key formats share a
# public org prefix (hex, or the same value base64-encoded).
ORS='5b3ce3597851110001cf6248|eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgi'
OTHER='-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"|private_key_id|client_email|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|sk_(live|test)_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}'
# Always pass patterns behind -e: OTHER starts with a dash. Only the owner-run
# service-account parser, its synthetic test key and this script may contain them.
ALLOW='^scripts/(src/firebase-admin-client(\.test)?\.ts|secrets-sweep\.sh):'
# History only, ORS pattern only: the browser key removed on 13 Sep 2026
# (docs/evidence/2026-09-13-w0-04-ors-proxy.md). It lived in these two files.
LEGACY_ORS='^(artifacts/pu-transit/src/lib/map-config\.ts|\.migration-backup/js/map-config\.js|js/map-config\.js):'

say "1. Working tree (tracked + untracked, not ignored; .agents/skills excluded)"
{ git ls-files -z; git ls-files -z --others --exclude-standard; } | sort -zu | grep -zv '^\.agents/skills/' > /tmp/sweep-files.z
tree() { xargs -0 -r -a /tmp/sweep-files.z grep -nIE -e "$1" -- 2>/dev/null | grep -vE "$ALLOW" | grep -c .; }
hits=$(tree "$OTHER|$ORS")
verdict "$hits" "$hits line(s) of credential-shaped material outside the allowed parser files"
envfiles=$(tr '\0' '\n' < /tmp/sweep-files.z | grep -cE '(^|/)\.env(\..*)?$')
verdict "$envfiles" "$envfiles .env file(s) in the tree"

say "2. Git history (every commit)"
hist() { git rev-list --all | xargs git grep -I -c -E -e "$1" 2>/dev/null | sed 's/^[0-9a-f]*://'; }
other=$(hist "$OTHER" | grep -vE "$ALLOW" | grep -c .)
verdict "$other" "$other file@commit(s) with private-key, service-account, JWT or vendor-token material"
orsall=$(hist "$ORS"); known=$(printf '%s\n' "$orsall" | grep -cE "$LEGACY_ORS"); orsother=$(printf '%s\n' "$orsall" | grep -vE "$LEGACY_ORS" | grep -c .)
say "  info $known file@commit(s) hold the known browser ORS key (removed 13 Sep 2026; STILL A LIVE CREDENTIAL until the owner revokes it at ORS)"
verdict "$orsother" "$orsother file@commit(s) with an ORS key anywhere else"
everadded=$(git log --all --diff-filter=A --name-only --pretty=format: | sort -u | grep -cE '(^|/)\.env(\..*)?$|\.pem$|\.p12$|service-?account.*\.json$')
verdict "$everadded" "$everadded .env / key / service-account file(s) ever committed"

say "3. Committed config"
extra=$(sed -n '/^\[userenv.shared\]/,/^\[/p' .replit | grep -E '^[A-Z_]+ *=' | grep -cvE '^(FIREBASE_PROJECT_ID|UNIVERSITY_EMAIL_DOMAINS|FIREBASE_DATABASE_URL) *=')
verdict "$extra" "$extra unexpected key(s) in .replit [userenv.shared] (only project id, database URL, email domain allowed)"

say "4. Who reads each secret (source, excluding tests and docs)"
for name in ORS_API_KEY FIREBASE_SERVICE_ACCOUNT_JSON SESSION_SECRET REPLIT_EXPO_SESSION_SECRET; do
  readers=$(grep -rlE "process\.env\.$name|\\\$$name|env\.$name" artifacts lib scripts --include=*.ts --include=*.tsx --include=*.mts --include=*.js --include=*.mjs --include=*.json --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.expo 2>/dev/null | grep -v '\.test\.' | tr '\n' ' ')
  say "  $name -> ${readers:-no reader}"
done
clientreaders=$(grep -rlE 'ORS_API_KEY|FIREBASE_SERVICE_ACCOUNT_JSON|SESSION_SECRET|firebase-admin' artifacts/pu-transit/src artifacts/pu-transit-driver/app artifacts/pu-transit-driver/lib lib 2>/dev/null | grep -c .)
verdict "$clientreaders" "$clientreaders client-side source file(s) referencing a server secret or firebase-admin"
clientenv=$(grep -rhoE 'import\.meta\.env\.[A-Z_]+|process\.env\.[A-Z_]+' artifacts/pu-transit/src artifacts/pu-transit-driver/app artifacts/pu-transit-driver/lib lib --include=*.ts --include=*.tsx --exclude-dir=db 2>/dev/null | sort -u | tr '\n' ' ')
say "  client env reads: $clientenv"

say "5. Built outputs (web build incl. source maps, API build incl. source maps; the driver app has no bundle here — source scan only)"
web=artifacts/pu-transit/dist/public
api=artifacts/api-server/dist
[ -f "$web/index.html" ] || { say "  FAIL web build missing ($web) — build first"; fail=1; }
[ -f "$api/index.mjs" ]  || { say "  FAIL api build missing ($api) — build first"; fail=1; }
# Each store secret separately: trimmed like its consumer, split into lines,
# lines under 20 chars dropped so a brace or blank line cannot match. A secret
# that yields no usable pattern is a FAIL: no clean claim without it.
for name in ORS_API_KEY SESSION_SECRET REPLIT_EXPO_SESSION_SECRET FIREBASE_SERVICE_ACCOUNT_JSON; do
  patterns=$(printf '%s\n' "${!name-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | awk 'length($0) >= 20')
  lines=$(printf '%s\n' "$patterns" | grep -c .)
  if [ "$lines" -eq 0 ]; then say "  FAIL $name: no usable value in this environment, so its absence from the builds cannot be claimed"; fail=1; continue; fi
  for dir in "$web" "$api"; do
    [ -d "$dir" ] || continue
    exact=$(printf '%s\n' "$patterns" | counted grep -rlF -f - -- "$dir")
    verdict "$exact" "$name ($lines pattern line(s)): $exact file(s) in $dir contain it"
  done
done
[ -d "$web" ] && {
  markers=$(counted grep -rlE -e "ORS_API_KEY|FIREBASE_SERVICE_ACCOUNT_JSON|SESSION_SECRET|firebase-admin|$OTHER|$ORS|api\.openrouteservice\.org|orsApiKey" -- "$web")
  verdict "$markers" "$markers web build file(s) with server-secret names, service-account or key material, or a direct ORS client"
  webkeys=$(grep -rhoE 'AIza[0-9A-Za-z_-]{35}' "$web" | sort -u | grep -c .)
  say "  info $webkeys Firebase web API key(s) in the web build — a public project identifier; data access is decided by Rules and Auth (App Check optional), authorized domains only limit where sign-in may run"
}
legacykeys=$(xargs -0 -r -a /tmp/sweep-files.z grep -hoE 'AIza[0-9A-Za-z_-]{35}' -- 2>/dev/null | sort -u | grep -c .)
say "  info $legacykeys distinct Firebase web API key(s) anywhere in the tree (1 live project; extras are legacy project configs under .migration-backup)"
[ -d "$api" ] && {
  runtime=$(grep -c 'process\.env\.ORS_API_KEY' "$api/index.mjs")
  verdict "$(( runtime == 0 ))" "API build reads ORS_API_KEY at runtime ($runtime reference(s)), nothing inlined"
}

say ""
if [ "$fail" -eq 0 ]; then say "SWEEP CLEAN (current secrets absent everywhere; see the history line for the old ORS key)"; else say "SWEEP FOUND PROBLEMS"; exit 1; fi
