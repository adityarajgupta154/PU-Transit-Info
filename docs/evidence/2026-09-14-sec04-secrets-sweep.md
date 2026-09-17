# SEC-04 — secrets-hygiene sweep

Date: 14 September 2026  
Status: **Current secrets: clean everywhere** (working tree, every commit, web build, API build). **One live credential
remains in Git history**: the browser ORS key removed on 13 Sep 2026 still returns HTTP 200 from OpenRouteService, so
F0-4/W0-04 stays open until the owner revokes it in the ORS dashboard. SEC-04's acceptance is therefore not met yet;
everything the agent can verify without credentials is done and rerunnable.

## What was checked, and how

| Claim | Method (credential-free; no value is ever printed) | Result |
|---|---|---|
| ORS key is server-side only | Readers of `ORS_API_KEY` in source; direct-provider references; existing verifier `scripts/src/verify-ors-bundle.ts` against the pre-removal revision `3523a72b` and the rebuilt web output | Only `artifacts/api-server/src/lib/ors.ts` reads it (plus the verifier). Web build: 0 files with the historical key, the current key, the provider host, `orsApiKey` or `VITE_*ORS`. API build reads it from `process.env` at runtime, nothing inlined |
| No service-account material in any client bundle | Web build (with source maps) grepped for private-key blocks, service-account JSON field names, `firebase-admin` and `FIREBASE_SERVICE_ACCOUNT_JSON`; API build the same; **driver app: source-level scan only** (no Expo bundle is produced in this workspace) — every `process.env.*` read listed | 0 files. The API never loads the service account either — only the owner-run scripts (`scripts/src/firebase-admin-client.ts`) parse it |
| Secrets live only in the workspace store | Working tree (tracked + untracked, `.agents/skills` and git-ignored paths such as `dist`/`node_modules` excluded) and every commit scanned for private keys, service-account field names, both ORS key formats (public org prefix), 3-part JWTs, vendor token shapes and `.env` files; `.replit` `[userenv.shared]` allow-listed; the trimmed value of each of the four store secrets fed to `grep -F` over stdin against both builds, each secret reported separately and a missing value counted as a failure | 0 hits outside the allowed parser files; `.replit` holds only project id, database URL and the email domain; all four secrets present, 0 build files contain any of them |

Reproduce (read-only, about a minute after the builds):

```sh
PORT=22930 BASE_PATH=/ pnpm --filter @workspace/pu-transit run build
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/scripts run secrets:sweep
pnpm --filter @workspace/scripts exec tsx src/verify-ors-bundle.ts 3523a72b3754e3268711434b9e6fb7c88c1abd2d
```

## Sweep output (14 Sep 2026)

```text
1. Working tree (tracked + untracked, not ignored; .agents/skills excluded)
  ok   0 line(s) of credential-shaped material outside the allowed parser files
  ok   0 .env file(s) in the tree
2. Git history (every commit)
  ok   0 file@commit(s) with private-key, service-account, JWT or vendor-token material
  info 118 file@commit(s) hold the known browser ORS key (removed 13 Sep 2026; STILL A LIVE CREDENTIAL until the owner revokes it at ORS)
  ok   0 file@commit(s) with an ORS key anywhere else
  ok   0 .env / key / service-account file(s) ever committed
3. Committed config
  ok   0 unexpected key(s) in .replit [userenv.shared] (only project id, database URL, email domain allowed)
4. Who reads each secret (source, excluding tests and docs)
  ORS_API_KEY -> artifacts/api-server/src/lib/ors.ts scripts/src/verify-ors-bundle.ts 
  FIREBASE_SERVICE_ACCOUNT_JSON -> scripts/src/firebase-admin-client.ts 
  SESSION_SECRET -> no reader
  REPLIT_EXPO_SESSION_SECRET -> artifacts/pu-transit-driver/package.json 
  ok   0 client-side source file(s) referencing a server secret or firebase-admin
  client env reads: import.meta.env.BASE_URL import.meta.env.DEV process.env.EXPO_PUBLIC_DOMAIN 
5. Built outputs (web build incl. source maps, API build incl. source maps; the driver app has no bundle here — source scan only)
  ok   ORS_API_KEY (1 pattern line(s)): 0 file(s) in artifacts/pu-transit/dist/public contain it
  ok   ORS_API_KEY (1 pattern line(s)): 0 file(s) in artifacts/api-server/dist contain it
  ok   SESSION_SECRET (1 pattern line(s)): 0 file(s) in artifacts/pu-transit/dist/public contain it
  ok   SESSION_SECRET (1 pattern line(s)): 0 file(s) in artifacts/api-server/dist contain it
  ok   REPLIT_EXPO_SESSION_SECRET (1 pattern line(s)): 0 file(s) in artifacts/pu-transit/dist/public contain it
  ok   REPLIT_EXPO_SESSION_SECRET (1 pattern line(s)): 0 file(s) in artifacts/api-server/dist contain it
  ok   FIREBASE_SERVICE_ACCOUNT_JSON (1 pattern line(s)): 0 file(s) in artifacts/pu-transit/dist/public contain it
  ok   FIREBASE_SERVICE_ACCOUNT_JSON (1 pattern line(s)): 0 file(s) in artifacts/api-server/dist contain it
  ok   0 web build file(s) with server-secret names, service-account or key material, or a direct ORS client
  info 1 Firebase web API key(s) in the web build — a public project identifier; data access is decided by Rules and Auth (App Check optional), authorized domains only limit where sign-in may run
  info 3 distinct Firebase web API key(s) anywhere in the tree (1 live project; extras are legacy project configs under .migration-backup)
  ok   API build reads ORS_API_KEY at runtime (1 reference(s)), nothing inlined

SWEEP CLEAN (current secrets absent everywhere; see the history line for the old ORS key)
```

ORS verifier, same builds:

```text
Exact ORS-key grep: exit 1 — 0 matching build files.
Keys checked: 1 legacy; server key included and distinct.
Direct ORS URL/client-key grep: exit 1 — 0 matching build files.
```

Old-key probe (one geocode request with the historical key read from Git in-process; only the status is printed):
`old exposed key -> 200 STILL ACCEPTED (not revoked)`.

Negative controls, so that "clean" means the scan can see: a synthetic private-key header planted in a file whose name
contains spaces and parentheses, plus a dummy store value planted in the web build, made the sweep report
`FAIL 3 line(s)` / `FAIL 1 file(s)` and exit 1; an unset secret made it report that secret as `FAIL … no usable value`;
`bash -x` printed no secret expansion. The first draft passed its pattern positionally and grep read the leading dash
as an option — the control caught that, which is why the pattern now always travels behind `-e`. This document
deliberately avoids spelling the marker strings, so the sweep stays clean against its own evidence.

## Findings

| # | Finding | Severity | Owner action |
|---|---|---|---|
| 1 | The historical browser ORS key (removed from source on 13 Sep 2026; 118 file@commit entries of history still hold it) **still returns HTTP 200** from ORS on 14 Sep 2026. A key in Git history is a committed secret until the provider rejects it | **Open — the only live exposure** | Delete the old token in the ORS dashboard, then rerun the old-key probe (recipe in `docs/evidence/2026-09-13-w0-04-ors-proxy.md`) and expect 401/403 |
| 2 | On 14 Sep 2026 a shell command run by the agent echoed part of the *current* `ORS_API_KEY` into the workspace chat log (not into the repo or any build) | Low | Mint a new key at ORS, update the secret, restart the API, rerun the verifier — and delete both old tokens in the same dashboard visit, which also closes finding 1 |
| 3 | The Firebase **web** API key (`AIza…`) is in the web build and the driver app | Info — by design | It identifies the project; data access is decided by Rules and Auth (App Check optional), and the authorized-domain list only limits where sign-in may run. Optionally restrict the key to the production and workspace domains under Google Cloud → APIs & Services → Credentials |
| 4 | `.migration-backup/js/firebase-config.js` carries two legacy Firebase web configs from earlier projects | Info | No secret. Delete `.migration-backup/` when the legacy Postgres import is no longer needed |
| 5 | `SESSION_SECRET` has no reader anywhere (left over from the pre-Firebase session API) | Info | Delete it from the workspace secrets |
| 6 | `FIREBASE_SERVICE_ACCOUNT_JSON` is stored but malformed (known); only the owner-run scripts consume it | Info | Re-paste the downloaded file when those scripts are next needed |

Nothing in this sweep changes application code. The sweep script is `scripts/secrets-sweep.sh`; run it with the ORS
verifier before every publish.
