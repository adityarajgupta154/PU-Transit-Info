# SEC-05 — retention cleanup job

Date: 14 September 2026  
Status: **Built and proven against the emulator; not yet running on a schedule in production.** The job needs the
service-account identity (`FIREBASE_SERVICE_ACCOUNT_JSON`, currently malformed) and a daily trigger — both owner
actions listed at the end. Until then retention stays manual (`retention:cleanup` by the owner).

## What the job does (`scripts/src/retention.ts`, run by `scripts/src/retention-cleanup.ts`)

| Data | Rule | Mechanism |
|---|---|---|
| `tracking/{busId}/feed/location` | Deleted when the feed is `phase: ended`, or is active but has not heartbeated for 1 h (public status is already `offline`; the stored fix is residual). Live and briefly-quiet feeds keep it. | One multi-path `PATCH` with `null` values — the key disappears |
| `audit/{id}` | Deleted when `at` ≤ now − 90 days | Query `orderBy="at"&startAt=1&endAt=cutoff&limitToFirst=500` (the published `.indexOn: ["at"]`), pages until empty; `startAt=1` keeps records without a numeric `at` (they sort first) from filling every page |
| `maintenance/retention` | Written every run: `lastRunAt`, `outcome` (`ok`/`failed`), `removed {feedLocations, auditRecords}`, `durationMs`, `error` on failure | Same identity; Rules give admins read and every client `.write: false` (14 Sep Rules mutation `2026-09-14-retention.py`, in the unpublished payload) |

Identity: the runner authenticates as the **service account** (OAuth access token via the existing
`createFirebaseClient()`, `Authorization: Bearer`, host allow-listed) — the API only ever holds user ID tokens. With
`FIREBASE_DATABASE_EMULATOR_HOST` set it uses the emulator's owner identity instead and says so. Daily at
02:30 IST satisfies "within 24 h": every ended feed found at run time is scrubbed, and a dead trip is scrubbed the
same night. A run that fails writes `outcome: failed` (best effort) and exits 1, so the scheduler shows it.

## Proof (emulator, 14 Sep 2026)

`pnpm --filter @workspace/scripts run retention:test` — seeds six feeds and four audit records, runs the job, reads
back through the same REST identity:

```text
✔ eligible feed locations and audit records are deleted, not marked; everything else stays (1078ms)
✔ audit trimming pages through more than one batch and is not blocked by records without a numeric at (241ms)
✔ a forced failure is recorded as failed and surfaces to the caller (32ms)
✔ selection rule is exact at the boundaries (8ms)
ℹ tests 4  ℹ pass 4  ℹ fail 0
```

What the first test asserts: `ENDED_LEGACY` (ended, still holding a fix), `DEAD_ACTIVE` (silent 25 h) and
`JUST_SILENT` (silent 1 h + 1 s) read back `location = null` with `heartbeatAt`, `sequence` and the rest untouched;
`LIVE` (heartbeat 30 s ago) and `RECENT_QUIET` (silent 59 min) keep their fix; `old-91d` and the exact 90-day
boundary record are gone, `keep-89d` and `keep-today` remain; `maintenance/retention` equals
`{lastRunAt, outcome: "ok", removed: {feedLocations: 3, auditRecords: 2}, durationMs}`; a second run removes 0
(deletion, not marking). The forced-failure test injects a write outage on the audit delete: the call rejects,
`maintenance/retention` reads `outcome: "failed"`, `error: "simulated write outage"`, `removed: {1, 0}` (the truthful
partial progress), and the blocked record is still present.

CLI rehearsal in the emulator (seed one ended feed with a fix, one 90-day-old and one fresh audit record):

```text
retention: emulator run against 127.0.0.1:9000
retention: ok; removed 1 feed location(s) and 1 audit record(s) in 119 ms
exit=0
after: tracking/BUS9/feed/location = null | audit keys = {"new":true}
       maintenance/retention = {"durationMs":119,"lastRunAt":1789335682084,"outcome":"ok","removed":{"auditRecords":1,"feedLocations":1}}
```

The pagination test seeds 505 expired records plus 501 records with no `at` at all: all 505 go, the 501 stay, one
fresh record stays.

Production path today (no emulator variable): `pnpm --filter @workspace/scripts run retention:cleanup` prints
`retention: failed`, the service-account parse reason, and exits 1 before any network call — the expected state
until the secret is fixed, and the same visibility a scheduled failure will have.

Guard rails on the production path (shown credential-free, each exits 1 with the reason): a database URL of another
project, or one carrying a path, is refused before any credential is read — the job only ever targets this
project's own database root.

Known limitation: eligibility comes from one `/tracking` snapshot and the deletes follow in a separate PATCH (RTDB
multi-path writes have no compare-and-set). A Start or sample landing in those milliseconds loses one fix, which
the next sample restores within seconds; at 02:30 IST the window is idle.

Rules: `firebase:rules:test` 25/25 including the new case — admin reads `maintenance/retention`, student and
anonymous cannot, admin cannot write or delete it.

## Owner actions

1. Re-paste the downloaded service-account JSON into `FIREBASE_SERVICE_ACCOUNT_JSON` (SEC-04 finding 6), then run
   `pnpm --filter @workspace/scripts run retention:cleanup` once by hand and check `maintenance/retention` in the console.
2. Schedule it daily at 02:30 IST (`30 21 * * *` UTC) with `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL` and
   `FIREBASE_SERVICE_ACCOUNT_JSON` in the job's environment — a Replit Scheduled Deployment, a GitHub Actions
   `schedule:` workflow, or a Cloud Scheduler-triggered Cloud Function wrapping `runRetention` with the same REST
   adapter (`docs/ops-notes.md` § Retention). Alert on a non-zero exit or `outcome: failed` (OPS-02).
3. Publish the 14 Sep Rules payload (adds the `maintenance` node); the job itself does not depend on it.
