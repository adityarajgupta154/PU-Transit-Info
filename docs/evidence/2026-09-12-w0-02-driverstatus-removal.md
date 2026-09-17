# Evidence — W0-02 legacy `driverStatus` removal (12 Sep 2026)

Requirement: Remaining-Work PRD v2.0 §5 W0-02 — after W0-01, the owner deletes the stale `driverStatus` node from the live database; nothing in the app references it.

## Live database node

- **No node to delete.** On 12 Sep 2026 the owner opened Realtime Database → Data in the console: the root of `pu-transit-f815d-default-rtdb` contained only `memberships` (two records). No `driverStatus`, and no `routes` / `tracking` / `audit` yet (routes not imported, no trips, no audited actions so far). W0-02 is closed by observation; nothing was deleted.
- Side finding from the same view: `memberships/firebase-user` is an approved active admin record keyed by the API test-fixture identity (`uid: firebase-user`, `student@paruluniversity.ac.in`), created 12 Sep 2026 00:35 IST — 38 minutes before the owner's real admin record. No Firebase Auth user can have that uid, so it is unusable without the project's service account, but it is not a real person. Recommended to the owner for deletion from the console (the owner's own record `hqKU3amnTzVBT3yF3p4DMRnirDq1` must stay).
- Under the published Rules the path has no rule, so it is unreadable and unwritable for every role regardless of whether the node still exists (emulator test "legacy driverStatus is denied for every role"; live anonymous read → 401).

## Code references (12 Sep 2026)

Command (repository root, excludes `node_modules`, `dist`, `build`, `.git`, `coverage`):

```
grep -rn -i "driverstatus\|driver_status\|driver-status" . \
  --include=*.ts --include=*.tsx --include=*.js --include=*.mjs --include=*.json \
  --include=*.html --include=*.toml --include=*.yaml --include=*.yml
```

Result — the only source matches are the Rules regression tests that assert the path is denied:

```
scripts/src/firebase-rules.test.ts:150:  await assertFails(suspended.database().ref("driverStatus").once("value"));
scripts/src/firebase-rules.test.ts:204:  test("legacy driverStatus is denied for every role", async () => {
scripts/src/firebase-rules.test.ts:210:    await assertFails(context.database().ref("driverStatus").once("value"));
scripts/src/firebase-rules.test.ts:211:    await assertFails(context.database().ref(`driverStatus/${BUS_ID}`).set({ value: true }));
scripts/src/firebase-rules.test.ts:412:  await assertFails(driver.database().ref(`driverStatus/${BUS_ID}`).set({
```

No matches in `artifacts/pu-transit/src`, `artifacts/api-server/src`, `lib/*` (OpenAPI spec, zod, generated client), `firebase/*.json` or `artifacts/pu-transit/public/*`. The remaining `.html` hits are rendered copies of the audit and PRD documents (history), and the Markdown mentions (`README.md`, `docs/*.md`, `replit.md`, `PRODUCT.md`) describe the removal itself.

## Built web bundle

`PORT=5173 BASE_PATH=/pu-transit/ pnpm --filter @workspace/pu-transit run build` → `grep -rl -i driverstatus dist/` → no matches across the 10 emitted files.

## Legacy endpoints

The former `driverStatus` API endpoints are removed (404); `/api/auth/login` and `/api/auth/session` answer `401 LEGACY_AUTH_DISABLED` (see README §3.1 AUTH-06).

## Recheck — 13 Sep 2026

The owner requested W0-02 again and reported W0-01 complete. The 12 Sep
observation above remains historical evidence, not a new live verification.

### Fresh source check

Executed from the repository root:

```sh
grep -RniE 'driver[ _-]?status' \
  artifacts/{pu-transit,api-server,mockup-sandbox}/src \
  artifacts/pu-transit/public lib/*/src \
  lib/api-spec/openapi.yaml firebase/database.rules.json
```

Output:

```text
Exit code: 1
No matches — 0 app/source/contract/Rules references.
```

The case-insensitive pattern covers `driverStatus`, `driver_status`,
`driver-status` and `driver status`. Exit 1 means no matches, not a search error.

Fourteen obsolete, ignored generated declaration/map files were removed from
the local `lib/api-zod/dist` and `lib/db/dist` outputs. Their source definitions
are already gone; these packages export their current `src`, not those old
declarations. No runtime source, package exports or live records were changed.

The subsequent built-output check also returned no matches:

```sh
grep -RIlEi 'driver[ _-]?status' \
  artifacts/pu-transit/dist artifacts/api-server/dist lib/*/dist
```

```text
Exit code: 1
No matches — 0 built-output references.
```

Five intentional references remain in `scripts/src/firebase-rules.test.ts`,
asserting that legacy reads/writes are denied. Historical documentation also
retains the name. These are not app runtime readers/writers and were preserved.

### Direct live check unavailable; owner Console evidence received

An exact-node, read-only check was attempted through the existing guarded
Firebase admin helper. Credential validation failed before any network request:
the configured service-account value was not valid JSON. No credential value
was printed, no DELETE was sent, and no memberships/routes/current tracking
data were touched. This attempt cannot establish the current node state or
whether today's bundled Rules match the published Rules.

The owner subsequently supplied a fresh Console Data-tree view on 13 Sep 2026
for the configured RTDB. The shared view shows `memberships` and no top-level
`driverStatus`. Membership values and identities are deliberately not copied
into this recheck record.

**W0-02 is complete on the basis of owner-provided Console evidence plus the
verified source/built-output checks above.** There was no legacy node to
delete, and no deletion was performed. All existing memberships were preserved.
This is not an independent Admin SDK verification and does not establish
whether the latest access-model Rules payload has been published.
