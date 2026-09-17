# PU Transit Firebase setup

This project uses the existing Realtime Database instance:

`https://pu-transit-f815d-default-rtdb.firebaseio.com`

The web Firebase configuration only connects the client to Firebase. It does
**not** deploy security rules. Publish the rules manually in the Firebase
Console before allowing the web client to use the database.

## Authoritative owner amendment — 13 Sep 2026

The product remains the web app **PU Transit**; native driver tracking is
later. The owner reports that the official Play app is being discontinued
(owner report, not independently verified here). The 12 Sep Rules publication
below is historical. The new access-model Rules payload is **not published**;
its owner walkthrough is in
`docs/evidence/2026-09-13-access-model.md`.

Sign-up offers student, staff, driver and admin. PU student/staff access is
approved immediately. Driver/admin requests are approved as student plus the
requested role until the office confirms the role in **Admin → Users**. A new
student may use a personal email for 30 days from membership `createdAt`;
Rules and the API enforce that grace period, and the student must switch to a
verified university email from **Account**. Existing memberships are never
wiped or recreated. No automatic suspensions are performed.

### Phase 3 Rules update

The project owner published the bundled Phase 3 Rules from the app's Setup
page on 12 Sep 2026 (evidence: `docs/evidence/2026-09-12-w0-01-rules-publish.md`).
This update removed the legacy `driverStatus` policy, added the append-only
administrator audit log, and permits the narrowly validated admin force-end
transition. The same rule applies to every future Rules change: until the
bundled file is published, the affected action fails closed — Firebase returns
`PERMISSION_DENIED` and the API returns a `502` provider error.

## One-time Firebase Console setup

1. Open the Firebase project that owns the database above.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. After QA, open the app's **Setup → Rules** page and confirm its complete
   payload matches both code mirrors:
   `firebase/database.rules.json` and
   `artifacts/pu-transit/public/firebase-database.rules.json`.
4. In **Realtime Database → Rules**, replace the entire editor with that one
   payload and select **Publish**. The new 13 Sep payload is not published as
   of this document update.
5. Do not add a temporary `allow: true` rule while bootstrapping. The default
   root policy is deny-by-default, and anonymous/root reads and writes must
   remain denied.

`firebase/firestore.rules` is an intentional deny-all policy for the unused
   Firestore product. It is not a migration target and must not be substituted
   for the Realtime Database rules.

### Established root and future privileged users

The protected root account is already established. Do not add a new Firebase
Console role-promotion step or create a replacement root membership. Existing
`uid`, email, membership and timestamps are preserved. Future driver/admin
confirmation is handled by an authorized administrator in **Admin → Users**;
the requested role in sign-up is not authority by itself.

## Realtime Database policy

The normal protected path requires an authenticated user whose Firebase token
has `email_verified == true`, whose email matches the exact lowercase
`@paruluniversity.ac.in` domain, and whose membership is active and approved.
A new student personal-email membership has a 30-day grace period measured from
its `createdAt`; Rules and the API enforce that deadline. The student must
switch to a verified university email from Account before the grace period
ends. After the deadline, protected access can be denied without changing the
membership to `suspended`; there are no automatic suspensions. Existing
memberships are retained.

Membership records use exactly these fields:

```text
memberships/<uid> = {
  uid: string,
  email: string,
  role: "student" | "staff" | "driver" | "admin",
  requestedRole?: "driver" | "admin",
  status: "pending" | "approved" | "rejected" | "suspended",
  active: boolean,
  assignedBusId: string,
  expiresAt?: number,   // IDN-01: UTC ms; absent = no expiry
  createdAt: number,
  updatedAt: number
}
```

- A user may read their own existing membership, including pending state and
  after its `expiresAt` has passed (so the app can say "expired").
- Only an active, approved admin whose own `expiresAt` has not passed may list
  memberships or change an existing membership; the same "not expired" clause
  sits on every protected read and write (routes, buses, tracking,
  assignments, notices, audit). An expired member stays `approved` and
  `active`; access returns the moment an admin extends or clears `expiresAt`.
- Only admins set, extend or clear `expiresAt` (a positive number). A member
  cannot create their record with one or change it, and an admin cannot give
  themself an expiry that has already passed.
- `uid`, `email`, and `createdAt` cannot be changed by an admin update.
- Non-approved memberships must be inactive. Non-driver assignments must be
  empty, and an active driver must have a non-empty `assignedBusId`.
- Memberships cannot be deleted or wiped as part of an email switch.

Routes retain the API shape
`{id, shift, busNumber, origin, destination, stops, pathData?}`. The route
key and `id` must be a UUID. Route strings are bounded, coordinates are
validated to latitude `[-90, 90]` and longitude `[-180, 180]`, and unknown
properties are rejected. Empty arrays are omitted because Realtime Database
strips empty arrays; non-empty stops and path points are validated element by
element. Active approved memberships may read routes. Only active approved
admins may create, edit, or delete routes.

### Phase 2 tracking policy

Reliable tracking uses only `tracking/<busId>`. Existing memberships and routes
are retained. The legacy `driverStatus` node is absent from Phase 3 Rules and
therefore denied by the default policy.

Each bus has one atomic record:

```text
tracking/<busId> = {
  driverUid: string,
  publisherId: UUID,
  sequence: non-negative integer,
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

The complete bus node is written atomically with an ETag/If-Match or an
equivalent compare-and-set retry. Do not write ownership and `feed` as
separate requests. Every write requires a verified university email, an
active approved `driver` membership, and that driver's current
`assignedBusId`. The rules independently validate the lifecycle, generation,
publisher and trip ownership, strictly increasing sample/heartbeat sequences,
server timestamps, immutable fields, coordinate bounds, report age, future
clock skew, accuracy, and the shape above.

- A first Start creates generation 1. A new Start is exactly the previous
  generation plus one; ended generations cannot be reopened.
- Start is accepted only when `requestedAt` is no more than 30 seconds old or
  5 seconds in the future. A prior ended tombstone permits an older
  `requestedAt` for its next generation. A recent active owner blocks another
  Start; an owner may be replaced only after its heartbeat is older than 90
  seconds.
- Good samples (accuracy at most 100 metres) replace the location and valid
  fix timestamps. Weak samples retain the last valid fix and update only the
  report fields. Heartbeats advance the sequence and heartbeat timestamp but
  cannot change report fields or coordinates. End removes `location`
  immediately.
- An End may close its active generation or create an ended tombstone for the
  next generation while the bus is absent, ended, or expired. A recent active
  owner makes that cancellation pending rather than acknowledging it.

Reads are intentionally split: an assigned active driver may read its own
whole bus node, including an absent node for a preflight read; an active
approved admin may read the `tracking` collection; and any active approved
university member may read only `tracking/<busId>/feed`. Students and other
members cannot read the parent bus node, `driverUid`, or `publisherId`.

The project owner must publish the complete new access-model contents only
after QA confirms that `firebase/database.rules.json` and
`artifacts/pu-transit/public/firebase-database.rules.json` are byte-identical.
Use Setup to copy/download that one payload, then replace the entire contents
in **Realtime Database → Rules** and select **Publish**. The new payload is not
published as of this amendment. Never open the database, add a temporary
`true` rule, use a live credential, or fall back to legacy tracking while the
full policy has not been published. The exact owner walkthrough is in
`docs/evidence/2026-09-13-access-model.md`.

To confirm the publication without any credential, sign in as an active
approved admin and open **Admin Portal → Fleet Status**. Under the published
Phase 2 policy the tab loads (showing "No active fleet feeds found" until a
driver starts a trip); under the previous policy the `tracking` read is denied
and the tab shows "Firebase tracking is unavailable". With a valid
service-account credential configured, `pnpm --filter @workspace/scripts
firebase:inspect` also reports `publishedRulesMatchRepository` for the live
database by comparing the published Rules structurally against
`firebase/database.rules.json`.

## Local rules regression tests

The emulator configuration is isolated to the demo project ID
`demo-pu-transit`; it starts only the Realtime Database emulator on port 9000
and has no live-database fallback. `firebase/firebase.json` points the
emulator at `firebase/database.rules.json`, while `firebase/.firebaserc`
pins the default project ID.

Requirements:

- Java 21+ (the Firebase Database emulator requires Java; this environment
  currently provides OpenJDK 21)
- Firebase CLI (`firebase-tools`)
- `@firebase/rules-unit-testing`, Firebase client SDK 12.19.0, and `tsx` in
  `@workspace/scripts`

From the repository root, run the isolated emulator test pass:

```sh
pnpm --filter @workspace/scripts firebase:rules:test
```

The equivalent explicit command is:

```sh
pnpm --dir scripts exec firebase emulators:exec \
  --config ../firebase/firebase.json \
  --project demo-pu-transit \
  "pnpm exec tsx --test src/firebase-rules.test.ts"
```

The test deliberately requires `FIREBASE_DATABASE_EMULATOR_HOST`; if the
emulator is not running, it fails instead of connecting to a live database.
Fixtures use only emulator-local fake UIDs and fake university-domain emails.
The suite covers unauthenticated, unverified, wrong-domain, pending, inactive,
and suspended denial; verified self-create with role requests but no elevation; approved student/staff
read/no-write; assigned-driver and wrong-bus status writes; server timestamp
and location validation; admin membership approval; admin route create, edit,
and delete; and Phase 2 tracking reads and writes against the local
`demo-pu-transit` emulator. Tracking coverage includes preflight reads on
absent nodes, the atomic Start/sample/weak/heartbeat/End lifecycle, stale-owner
replacement, generation and sequence protection, malformed and impossible
transitions, parent/private-read denial, and the disabled legacy write path.

The existing PostgreSQL data remains authoritative for the current server
integration. Any admin UI import is additive, skips Firebase collisions, and
does not migrate old live statuses. Browser JavaScript also cannot guarantee
background location tracking after the browser is suspended or closed.