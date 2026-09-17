# Operations notes

Running notes for whoever operates PU Transit: limits, knobs and what to look at when something is refused.
Runbooks for incidents (OPS-03) and alerting (OPS-02) will be added here as they are built.

## API rate limits (SEC-01, 14 Sep 2026)

Sized for a small demo fleet (≤ 30 buses, a handful of admins). Fixed one-minute windows, counted in memory by the
single API process (`artifacts/api-server/src/middleware/rate-limit.ts`); a restart clears every counter. The limits
below are the source of truth — change them here and in the code together.

| Group | Endpoints | Per uid / min | Per client / min | Why this size |
|---|---|---|---|---|
| `tracking` | `POST /api/tracking/:busId/start`, `/sample`, `/heartbeat`, `/end` | 60 | 600 | A bus reports at most about once a second. Normal cadence is 12 samples + 4 heartbeats a minute, so 60 leaves room for retries after a network gap. One client key may front a whole depot. |
| `membership` | `POST /api/auth/membership` | 5 | 60 | One membership per account; the extra attempts cover retries after an error. A cohort signing up together shares campus Wi-Fi. |
| `routes` | `POST /api/routes`, `PATCH /api/routes/:id`, `DELETE /api/routes/:id`, `POST /api/routes/:id/archive` | 30 | 60 | Admin-only; every write also appends an audit entry. One save every two seconds is faster than anyone edits. |
| `geo` | `POST /api/geo/geocode`, `/directions` | 30 | 30 | Admin-only proxy to OpenRouteService. All admins share one ORS key whose free tier allows 40 directions calls a minute and about 1 000 geocoding calls a day (the route builder searches once per pause in typing, never per keystroke, and not at all for pasted coordinates); with the shared client key (below) the 30 is also the fleet-wide ceiling, so the key stays under its quota. |

What a refused request sees:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 41            ← whole seconds until the window ends (1…60)
{"error":"Too many requests, slow down","code":"RATE_LIMITED"}
```

How it behaves:

- The limiter runs right after the Firebase token is verified and before anything reads the database, so a flood is
  refused before it costs a membership lookup. Requests without a valid token never reach it — they stop at `401`.
- The uid bucket is checked first, then the client bucket; both are charged for a request that gets through. An
  account that is already refused never touches the client bucket, so one runaway phone cannot drain the ceiling
  everybody else shares.
- Each refusal logs one `WARN Rate limit exceeded` line with `group` and `uid` — never the payload.
- The client key is Express's `req.ip`. Nothing sets `trust proxy`, so that is the socket peer — behind Replit's
  proxy the same address for every caller. Consequence: **the per-client column is a fleet-wide ceiling per group**
  (workspace and published app alike) until `trust proxy` is configured; it is never a key a caller can choose, and
  a forged `X-Forwarded-For` changes nothing. The sizes above are chosen to hold as ceilings for the demo fleet.
  To make the column truly per client on the published app: log one request's `X-Forwarded-For` there (the
  workspace proxy rewrites it to three internal hops and drops the caller's address, so it cannot be measured
  here), count the trusted hops, set `app.set("trust proxy", <hops>)` in `artifacts/api-server/src/app.ts`, and
  confirm a `429` for one phone does not hit the others.
- Windows are fixed, not sliding: a client can spend a full minute's allowance in the first second of the window
  and again in the first second of the next. Acceptable at this fleet size; a token bucket is the upgrade if it
  ever matters.
- Counters live in one process. Running more than one API instance (autoscale beyond one) multiplies every limit by
  the instance count; a shared store is the fix, not lower numbers.

Verified 14 Sep 2026 (`artifacts/api-server/src/middleware/rate-limit.test.ts`: uid limit, `Retry-After`, window
reset, independence between two drivers, client ceiling across 13 accounts, route-write limit, no count without a
token; and a live run against a second API
process on port 4310 with the Auth emulator issuing the token): 62 heartbeats in 0.57 s — requests 1–60 answered
`403` (the emulator account has no membership, so they passed the limiter and stopped at the membership check),
requests 61 and 62 answered `429`; 10 s later `Retry-After` had dropped from `60` to `41`; the log held one
`Rate limit exceeded` warning per refusal with `group: "tracking"` and the uid.

## Request bounds (SEC-02, 14 Sep 2026)

Every request body is capped three ways before a handler runs, and every handler validates the whole body before
its first database write, so oversized or malformed input never leaves a partial record.

| Bound | Value | Where | Refused with |
|---|---|---|---|
| JSON body, any endpoint | 32 kB (tracking, membership, notice and calendar bodies are under 1 kB) | `artifacts/api-server/src/app.ts` | `413` `PAYLOAD_TOO_LARGE` — before authentication, so a flood costs no token check |
| JSON body, `/api/routes*` | 512 kB (a 5000-point road path is about 230 kB) | `app.ts` | `413` `PAYLOAD_TOO_LARGE` |
| Malformed JSON, wrong top-level type | — | `app.ts` (body-parser errors) | `400` `INVALID_REQUEST` |
| Route arrays | `stops` ≤ 500, `pathData` ≤ 5000 points, each a finite lat/lng | `routes/transit.ts` `parseRouteInput` (mirrored in `lib/api-spec/openapi.yaml`) | `400` `INVALID_REQUEST` |
| Route strings | `shift`, `busNumber`, `origin`, `destination`, stop `name` ≤ 200; `id` ≤ 128 path-safe characters; unknown keys refused | `parseRouteInput` | `400` |
| Membership fields | `role`, `status`, `requestedRole` enumerated; `assignedBusId` ≤ 128 path-safe; `expiresAt` a plausible epoch or null; unknown keys refused | `transit.ts` membership handlers | `400` |
| Database keys taken from requests | membership uid, route id, bus id, assignment `driverUid` / handover `nextDriverUid` (body and path) must match `^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$` — no `/ . # $ [ ]`, so a request can never name a different node | `transit.ts`, `assignments.ts`, spec `pattern` → zod | `400` |
| Everything else | Zod schemas generated from the OpenAPI spec — bus label 64, notice text 280, calendar note 140, geo query 200, `via` ≤ 48 stops, uuid and date patterns | `lib/api-spec/openapi.yaml` → `@workspace/api-zod` | `400` |

Rules keep their own (coarser) string and enum checks; the API limits are always at least as strict, so a body the
API accepts is never refused by Rules for size. Raising a route array limit means checking the 512 kB body cap and
the ORS response cap (`lib/ors.ts`) together.

Verified 14 Sep 2026 (`artifacts/api-server/src/routes/request-bounds.test.ts`, and live against the workspace API):
33 kB heartbeat → `413` with no token verification and no database call; malformed JSON → `400`; a 5000-point route
saves (`201`) while 5001 points, 501 stops, a 201-character field, an empty field and an unknown stop key each →
`400` with the write count unchanged; a 600 kB route body → `413` before validation; over-long or wrongly typed
membership fields → `400` with the record byte-identical afterwards; a `driverUid` such as `driver/../admin` in an
assignment body, a handover body or a delete path → `400` with zero writes.

Bodies validated by the generated schemas ignore unknown keys (zod strips them); the hand-written route and
membership parsers refuse them. Both are deliberate: only the hand parsers write records whose exact key set Rules
check.

## Secrets (SEC-04, 14 Sep 2026)

| Secret | Read by | Notes |
|---|---|---|
| `ORS_API_KEY` | `artifacts/api-server/src/lib/ors.ts` only (Authorization header, never a query string; never logged) | Absent → geo proxy answers 503. Rotation: new key at ORS → update the secret → restart the API → `verify-ors-bundle.ts` → confirm ORS rejects the old key |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Owner-run `scripts/` only; the API and both clients never load it | Currently malformed; fix by re-pasting the downloaded file when a script needs it |
| `REPLIT_EXPO_SESSION_SECRET` | The driver app's `dev` shell script (Replit-provided, dev only) | Never referenced by app code |
| `SESSION_SECRET` | Nobody | Legacy; safe to delete |

Public by design and therefore committed: the Firebase web config (`apiKey`, `authDomain`, `databaseURL`, `projectId`)
in both clients, and `.replit` `[userenv.shared]` (project id, database URL, university email domain). Data access is
decided by Rules, Auth and the API, never by these identifiers (authorized domains only limit where sign-in may run).

Git history still holds the browser ORS key removed on 13 Sep 2026; it is a live credential until the owner deletes it
in the ORS dashboard. The sweep reports it on its own line and fails on any other key in history.

Before a publish: build both outputs, then `pnpm --filter @workspace/scripts run secrets:sweep` (must end in
`SWEEP CLEAN`) and the ORS verifier. Latest run and the open finding (old ORS key not yet revoked):
`docs/evidence/2026-09-14-sec04-secrets-sweep.md`.

## Retention (SEC-05, 14 Sep 2026)

RTDB has no TTL. `pnpm --filter @workspace/scripts run retention:cleanup` (`scripts/src/retention.ts`) deletes —
not marks — the residual `feed/location` of ended feeds and of active feeds silent for 1 h, trims `audit` past
90 days (500 per batch, oldest first), and writes `maintenance/retention` (`lastRunAt`, `outcome`, `removed`,
`durationMs`, `error`). It authenticates as the **service account** from `FIREBASE_SERVICE_ACCOUNT_JSON` — the job's
own identity; the API never holds it — and needs `FIREBASE_PROJECT_ID` and `FIREBASE_DATABASE_URL`. With
`FIREBASE_DATABASE_EMULATOR_HOST` set it runs against the emulator as owner (rehearsal).

Run it **daily at 02:30 IST** (`30 21 * * *` UTC) from any scheduler that can hold the three variables: a Replit
Scheduled Deployment, a GitHub Actions `schedule:` job, or a Cloud Scheduler-triggered Cloud Function that calls
`runRetention(restDb(databaseUrl, fetchWithServiceAccountToken))`. Daily is enough for "within 24 h": every ended
feed present at run time is scrubbed. A failed run exits 1 and (best effort) records `outcome: failed` with the
reason; alert on either (OPS-02). Admins may read `maintenance/retention`; no client may write it (`.write: false`
in the 14 Sep Rules payload). Proof and rehearsal transcript: `docs/evidence/2026-09-14-sec05-retention.md`;
tests: `retention:test` (emulator) and `firebase:rules:test`.

## Email changes (IDN-04, 14 Sep 2026)

A member's access follows the account **only** to a verified `@paruluniversity.ac.in` address: the
next sign-in re-binds the record with the same role and dates, no office action needed. A personal or
unverified address gets nothing — the member sees "email changed / verify your email" and must switch
back from the account page; the office cannot edit a member's email (admin PATCH excludes it) and
there is no audit entry for the rebind (the members list shows the current email and `updatedAt`).
Flow matrix and tests: `docs/evidence/2026-09-14-idn04-email-change.md`.
