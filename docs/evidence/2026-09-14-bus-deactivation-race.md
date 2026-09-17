# Start versus bus deactivation — 14 September 2026

## Result

The bus Rules now reject an active → out-of-service transition when the
post-write tracking feed holds a live heartbeat lease (active phase,
heartbeat greater than zero, age at most 90 seconds). This matches the API's
existing `liveTrip` policy, including permission to park offline or ended trips.

- Start commits first: deactivation fails; the bus stays active with its trip.
- Deactivation commits first: the existing Start Rule refuses the delayed Start;
  the bus stays out of service with no new trip.
- A root owner cannot combine Start and deactivation into one multi-location
  update. The bus guard reads the post-write tree, not the prior root.
- Label edits, reactivation, and reporting/End for an already parked session
  retain their existing behavior.

Bus ETag retries still protect competing fleet edits. RTDB operations still
use the caller's Firebase token. A confirmed trip-related Rules refusal maps
to `409 BUS_ACTIVE_TRIP` for the admin or `403 BUS_OUT_OF_SERVICE` for the driver.
Unclassified permission/provider failures remain errors; no failed edit is audited
as successful.

## Verification

- API suite: 127 tests passed, including stale-preflight refusal mapping, unchanged
  bus ETags, caller-token use, failed re-reads, and no audit of rejected writes.
- Isolated `demo-pu-transit` database emulator: 32 tests passed. Coverage includes
  both ordered writes after preflight reads, multi-location rejection, missing/
  ended/offline/live feeds, and byte equality of the Rules mirrors.
- API and scripts TypeScript checks passed.
- API and web workflows started cleanly; `/api/healthz` returned `{"status":"ok"}`.
  The home-page preview rendered without browser errors.

Commands:

```sh
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/scripts run firebase:rules:test
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/scripts run typecheck
```

## Publication boundary

No Firebase project configuration, demo isolation, live records, or deployed
Rules were changed. Both local Rules mirrors contain the fix:

- `firebase/database.rules.json`
- `artifacts/pu-transit/public/firebase-database.rules.json`

**The live guard is not active until the owner authorizes and publishes the
complete Rules payload.** Deploying the API alone does not close this race.