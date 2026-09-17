# Phase 2 — Reliable bus tracking

## Current owner amendment — 13 Sep 2026

PU Transit remains a web product; native driver tracking is later. The owner
reports that the official Play app is being discontinued (not independently
verified here). The 12 Sep Rules publication is historical. The new
access-model Rules payload is not published and must not be described as live.

The current access direction adds a student/staff/driver/admin sign-up picker,
immediate PU student/staff approval, and driver/admin requests represented as
student plus `requestedRole` until office confirmation in Admin → Users. New
personal-email students have a 30-day grace period from membership `createdAt`,
enforced by Rules/API, and must switch to a verified university email from
Account. Existing memberships are never wiped; no automatic suspensions occur.
The protected root account is already established and future privileged-user
confirmation belongs in Users.

Current product add-ons are `toCampus` / `fromCampus` and `full`; route kind
`shuttle`; admin notices capped at 280 characters and 30 days; About/Help; and
Hindi/Gujarati driver UI pending native-speaker review. Payments and passes are
excluded. PU blue is pinned to `#0A76D6`, not indigo. See
`docs/evidence/2026-09-13-access-model.md` for implementation/publication
status and the owner walkthrough. This docs-only amendment claims no test run.

Scope approved: reliable browser trip lifecycle and a platform-neutral API for the later native driver app. Keep the accepted Firebase login/membership flow unchanged. This is not a claim of screen-off tracking or university-wide production readiness.

## Required behavior

- Explicit Start and End, with one current publisher per bus, enforced by Firebase conditional writes and Rules.
- All writes require verified university identity, active approved driver membership and the current bus assignment.
- Start is idempotent. Each new trip advances a bus generation; old generations cannot publish or restart.
- A different publisher may explicitly start after the previous heartbeat is older than 90 seconds. The old publisher is then rejected. No automatic handover or automatic off-duty start.
- Valid capture/receipt age at most 30 seconds and accuracy at most 100 metres are required for Live. Heartbeat every 15 seconds does not refresh GPS capture time. Upload at approximately 5-second intervals.
- Samples include sequence, capture timestamp and accuracy. Reject old/repeated sequences, older captures, non-finite/out-of-range coordinates and materially future timestamps (over 5 seconds).
- A recent low-accuracy report produces Weak GPS without replacing the last valid position/timestamps. Once that report ages past 30 seconds, show Delayed if a last valid fix exists, otherwise GPS unavailable. A heartbeat cannot keep an old weak report current. No heartbeat for over 90 seconds produces Offline. Ended/offline feeds expose no coordinates.
- End stops collection immediately. Persist only session/stop-command metadata, never a trail of locations or tokens. Retry pending End before any new Start, scoped to the signed-in UID and bus.
- No automatic GPS restart after reload. An existing local session offers recovery/End, not automatic sharing.
- Keep route information available without fresh GPS. Students see timestamps, quality and explicit errors; live status must age even between polls.

Timing values are initial PRD engineering defaults, not measured fleet guarantees.

## Atomic RTDB model

Use a new additive `tracking/{busId}` node. Do not migrate/delete existing records or memberships.

```
{
  driverUid: string,
  publisherId: UUID,
  sequence: integer,
  feed: {
    protocolVersion: 2,
    busId: string,
    tripId: UUID,
    generation: positive integer,
    phase: "active" | "ended",
    requestedAt: epoch milliseconds,
    startedAt: server timestamp,
    endedAt: 0 | server timestamp,
    heartbeatAt: server timestamp,
    gpsQuality: "acquiring" | "good" | "weak" | "unavailable",
    lastReportCapturedAt: 0 | epoch milliseconds,
    lastReportReceivedAt: 0 | server timestamp,
    reportedAccuracy: number,
    lastValidCapturedAt: 0 | epoch milliseconds,
    lastValidReceivedAt: 0 | server timestamp,
    location?: { lat: number, lng: number, accuracy: number }
  }
}
```

The entire node is changed with ETag/If-Match, never separate ownership and feed writes. Drivers may read their assigned bus node, including an absent node; admins may read the collection. Approved members may read only the public `feed` child, not publisher/driver identifiers. Rules independently constrain every transition, timestamp and immutable field. Legacy `driverStatus` data is retained but its writes are disabled.

New generation = previous generation + 1 (empty bus = generation 0). A Start carries the expected previous generation and a stable requestedAt/tripId/publisherId. Retry returns the original session only if it is still active and the entire attempt matches. Start attempts expire after 30 seconds; Rules enforce this at commit time. Ended generations cannot be reopened.

An End can close its active generation, or write an ended tombstone for a not-yet-created next generation when the bus is unclaimed/ended/expired. This cancels a delayed Start without resurrecting it. If another active generation prevents that tombstone, return pending until the Start deadline expires or a newer generation makes it impossible. Never acknowledge a timed-out Start as cancelled merely because a read temporarily found no record.

## API contract

All under `/api`, existing Firebase middleware/errors. Keep `/healthz` and unrelated routes unchanged. Define these shapes in OpenAPI before implementation and regenerate the existing clients.

- `GET /tracking/:busId` → `LiveTrackingFeed`.
- `GET /tracking` → admin-only map of bus IDs to `LiveTrackingFeed`.
- `POST /tracking/:busId/start` — `TripStartInput {tripId, publisherId, expectedGeneration, requestedAt}` → `TripSession`.
- `POST /tracking/:busId/sample` — `TripSampleInput {tripId, publisherId, generation, sequence, capturedAt, lat, lng, accuracy}` → `TripSession`.
- `POST /tracking/:busId/heartbeat` — `TripHeartbeatInput {tripId, publisherId, generation, sequence, gpsUnavailable?: boolean}` → `TripSession`.
- `POST /tracking/:busId/end` — `TripEndInput {tripId, publisherId, generation, requestedAt}` → `TripEndResult`.

`TripSession {tripId, publisherId, generation, sequence, feed: LiveTrackingFeed}`.

`TripEndResult {acknowledged: boolean, outcome: "ended" | "superseded" | "cancelled" | "pending", feed: LiveTrackingFeed}`.

`LiveTrackingFeed` contains all stored feed fields, plus:
- phase also permits `not_started`; tripId is nullable, numeric dates/generation use 0 for not-started.
- location is always present in the DTO, nullable.
- `status`: `not_started | acquiring | live | delayed | weak_gps | gps_unavailable | offline | ended`.
- `serverTime`, `freshUntil`, `offlineAfter`: computed by the API. `freshUntil` uses the weak-report deadline for Weak GPS and the valid-fix deadline for Live. Frontends use a monotonic elapsed timer from response receipt to age status, not the device wall clock.
- No driverUid or publisherId.

Start returns 201 (or 200 for the same active retry, even if the original attempt deadline has passed); ownership/replay conflicts return 409 with a machine-readable code; invalid input returns 400; authentication/membership failures remain 401/403. Firebase setup/provider failure is explicit 503. Legacy driverStatus GET/POST endpoints return 410 rather than leave a competing write path or expose stale boolean status.

## Frontend controller contract

Keep `createDriverTracker` as the tested lifecycle controller, using injected geolocation, transport, persistence and clock where useful.

The driver view consumes:
- `phase`: `idle | starting | acquiring | live | delayed | weak_gps | gps_unavailable | offline | stopping | pending_end | recovery | conflict`.
- `error: string | null`, `feed: LiveTrackingFeed | null`, `lastSyncAt: number | null`.
- Controller methods `start()`, `stop()`, `reconnect()`, `disconnect()`, `dispose()`.

Transport methods: `getFeed()`, `start(input)`, `sample(input)`, `heartbeat(input)`, `end(input)`, each using the authenticated API and a bounded request timeout.

Persist local sequence before dispatch. Coalesce GPS to one latest sample, never an unbounded queue. Discard queued GPS on disconnect and require a new acceptable capture on reconnect. Serialize heartbeat/sample writes; End has priority and cannot be followed by an online write. Persist pending End before network calls and before returning from teardown. Account changes must never dispatch an old session with the new account's token. A pending/cancelled Start must not later become Live.

## Activation and verification

No production writes, migrations, test users or credential changes are authorized as part of testing. API tests use an isolated in-memory transport with fail-closed network stubs; Firebase policy tests run only against `demo-pu-transit` in the local emulator.

Rules changes require the project owner to publish the new full policy from
Setup after QA confirms both code mirrors contain one byte-identical payload.
Until that happens, the new access-model policy and affected endpoints fail
closed; do not fall back to legacy public/boolean tracking. The 12 Sep
publication remains history, and the exact owner walkthrough is in
`docs/evidence/2026-09-13-access-model.md`.

Verify concurrent starts, idempotent retries, delayed Start cancellation, sample-vs-End races, stale/future/weak samples, expired ownership replacement, pending-stop reload/reconnect, protected reads and sanitized feed. Route versioning, native background proof, fleet administration/handover and operational retention remain separate PRD work.