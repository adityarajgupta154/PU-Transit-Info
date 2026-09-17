# PU Transit — Project Audit

**Date:** 11 September 2026  
**Status:** Findings complete; initial product decisions confirmed and PRD drafted  
**Scope:** Current React app, API, database schema, original import comparison, desktop/mobile screenshots  
**Changes in this audit:** Local skill installation and documentation only. Application code, data, Firebase configuration, secrets and workflows were not changed.

## 1. Executive summary

PU Transit ka React foundation reuse karna chahiye. Dobara framework rewrite se main problems solve nahi honge. Pehli priority trustworthy location data, authorized drivers, reliable maps aur clear failure states honi chahiye.

Current implementation **real-world rollout ke liye ready nahi hai**. UI render hona ya API ka HTTP 200 dena authentication, tracking accuracy aur data integrity prove nahi karta.

User ki requested direction: user-owned Firebase database. Abhi implementation PostgreSQL par hai; is audit ne database migrate nahi kiya. Firebase configuration, existing data aur access policies inspect karke hi migration design final hoga.

## 2. Installed skills and review method

Pinned upstream files project-local `.agents/skills/` mein installed hain:

| Source | Installed | Is project mein use |
| --- | --- | --- |
| [Ponytail](https://github.com/dietrichgebert/ponytail) | ponytail, ponytail-audit, ponytail-review, ponytail-debt, ponytail-gain, ponytail-help | Complexity, reuse, unnecessary dependencies |
| [Grilling](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling) | grilling | Product decisions ko evidence aur explicit questions se resolve karna |
| [Impeccable](https://github.com/pbakaus/impeccable) | impeccable and supporting references/scripts | UI/UX, accessibility, responsive layout, implementation truth |

Exact source revisions and entrypoint hashes: `.agents/skills/installed-sources.json`. Upstream licenses preserved hain. Native CLI binaries, automatic hooks, external installers aur shell plugins run nahi kiye gaye. Impeccable review manual source/screenshot-based hai, bundled automated detector run nahi hua.

## 3. Actual current state

| Area | Current state |
| --- | --- |
| Frontend | React + TypeScript + Vite; Tailwind/CSS and shared UI primitives |
| Navigation | Student, driver and admin screens; legacy `.html` aliases retained |
| Maps | Leaflet/React Leaflet; CARTO basemap URL; ORS road directions/geocoding |
| Backend | Express; server-side admin session checking |
| Persistence | PostgreSQL/Drizzle through shared API, not Firebase |
| Live updates | Route polling every 10 seconds; driver-status polling every 3 seconds |
| Original import | Static HTML/JS plus Firebase RTDB under `.migration-backup/` |
| Test coverage | Utility and mocked API tests; no verified full device-to-device tracking acceptance coverage |

**React vs HTML/CSS:** Separate legacy HTML pages ko component-based React replace karta hai. React bhi HTML output karta hai aur CSS styling use karta hai. CSS ko entirely remove karna goal nahi hona chahiye; duplicated global styles aur inline behavior ko organized components/tokens mein manage karna chahiye.

## 4. Pass one — Ponytail: what to simplify

### Keep

- Existing React/Vite workspace and working navigation.
- Compatibility aliases during migration; old links ko bina need break na karein.
- Reusable UI controls with keyboard/focus support.
- Real road-path generation and Vadodara geographic checks.
- Student, driver and admin responsibilities as distinct flows.

### Simplify, after correctness

1. **One data-access approach.** React Query provider exists, but transit hooks manage their own polling/state. Firebase integration ke waqt typed realtime subscriptions adopt karein; same data ke liye polling, custom cache aur query cache teeno na rakhein. Evidence: `artifacts/pu-transit/src/App.tsx:1-19,49-59`, `src/hooks/use-transit.ts:4-55`.
2. **One truthful API contract.** Generated OpenAPI currently only health check describes karta hai, transit endpoints nahi. Firebase ke baad retained API endpoints ka contract maintain karein; unused client imports/declarations simplify karein. Evidence: `lib/api-spec/openapi.yaml:13-36`, `artifacts/pu-transit/src/lib/storage.ts:18-61`, frontend package dependency declarations.
3. **Inventory unused UI dependencies.** Frontend declares 26 Radix packages; several generated UI modules are unreferenced. This is maintenance surface, not proof that all are bundled. Imports and other artifacts verify karke hi remove karein; bundle savings measure karein, invent na karein.
4. **Clear names and errors.** `storage.ts` is an API client, not browser storage; `legacy-admin.ts` calls server auth. Names should describe actual responsibility. Centralize consistent typed error handling instead of adding more adapters.
5. **Avoid unnecessary systems.** No microservices, custom realtime server, separate native student app, fleet analytics warehouse, billing, or multi-university tenancy without an actual requirement.

No speculative line-count or dependency savings are promised. Shared scaffold ko blindly delete karna recommendation nahi hai.

## 5. Pass two — Grilling: product decisions under stress

### Already clear

- Product is an improvement of existing PU Transit, not a different app.
- Student tracking, driver sharing and admin route management remain core.
- User will supply their Firebase project; no replacement database should be introduced as the target.
- A maintainable React-based implementation is preferred.
- PRD must explain priorities and acceptance behavior, not merely list features.

### Decisions confirmed after the audit

1. Full university daily use, not only a demo.
2. Live location restricted to verified university students/staff.
3. Driver tracking must support normal screen-off/background operation.
4. Student/staff verification requires university email verification plus approved membership.
5. Driver phone inventory is not yet confirmed; Android/iOS release coverage remains undecided.

These decisions are incorporated in `docs/PU-Transit-PRD.md`. University verification method is settled; exact approved email domains, membership approval ownership and driver platform coverage remain setup dependencies. Further questions should only cover real unresolved branches, not facts discoverable from source.

### Important tradeoffs

- **Browser-only driver tracking:** simpler pilot, but screen-off/background updates cannot be guaranteed. Do not promise continuous tracking.
- **Native driver tracker:** justified if background tracking is required; still needs OS permissions, battery handling and physical-device testing. A service worker/PWA alone does not make browser GPS continuous.
- **Public student access:** easier discovery, greater location exposure. Public schedules and authenticated live locations can be separated.
- **ETA:** only ship as an estimate with explicit method, timestamp and limitations. Until a validated method exists, do not advertise it.

## 6. Pass three — Impeccable: UI/UX findings

### P0: map reliability blocks the core experience

Mobile screenshot `screenshots/audit-student-mobile.jpg` visibly shows **API KEY REQUIRED** watermarks. The configured basemap is in `artifacts/pu-transit/src/components/map/map-view.tsx:120-123`.

This is not proof that ORS is the failing service. Basemap tiles and ORS directions are separate dependencies. Choose a properly provisioned tile provider, preserve required attribution, test actual rendered tiles, and provide a route/stop list when the map cannot load.

### P1: truthful states and copy

- Homepage advertises estimated arrival times without an implemented ETA contract.
- Student “live” state depends on the online flag, not sample freshness.
- Driver UI announces successful tracking before an acknowledged write.
- Distinguish loading, empty routes, no match, permission denied, GPS acquiring, reconnecting, stale and offline.
- Show last successful sample time; stale data must not look current.

Evidence: `src/pages/home.tsx:20-68`, `src/pages/student.tsx:31`, `src/pages/driver.tsx:73-113`.

### P1: mobile and accessibility

- Icon-only menu/search controls need accessible names.
- Some icon actions are approximately 32–36 CSS pixels; aim for comfortable 44×44 mobile targets.
- Mobile navigation needs keyboard focus management, Escape handling and focus restoration.
- Route edit/delete controls must not depend on hover.
- Every route should have a text stop list, not a map-only representation.
- GPS permission requests need purpose explanation, denied-state recovery and privacy copy.
- Respect reduced-motion preferences while keeping status changes visible.

Evidence: `src/components/layout/shell.tsx`, `src/pages/student.tsx:46-85`, `src/pages/admin.tsx:239-278`, `src/components/map/map-view.tsx:53-60,86-87`.

### Recommended UX direction, not yet an implemented redesign

- Student: compact route/shift search, saved bus if useful, readable route summary, stops, last-update status, list/map switch.
- Driver: assigned bus and trip; clear Start/Stop; GPS permission, connection and last successful sync status; minimal interaction while driving.
- Admin: searchable routes and assignments; visible edit actions; route preview; destructive-action confirmation; recoverable save failures.
- Home: prioritize the student task; retain clear driver/admin entry points without adding decorative features.

### Strengths to preserve

Clear transit vocabulary, consistent blue identity, readable desktop hierarchy, mobile stacking, shared visual tokens and existing focus styles. A new design system or animation overhaul is not needed to fix the actual product failures.

## 7. Security and data-integrity review

This is source review, not a penetration test or automated vulnerability scan. No credentials are reproduced.

| Priority | Confirmed issue / risk | Evidence | Required outcome |
| --- | --- | --- | --- |
| P0 | Driver status writes are public | `artifacts/api-server/src/routes/transit.ts:102-127` | Verified driver identity; write only assigned active bus/trip |
| P0 | Bus ID is treated as login | `artifacts/pu-transit/src/pages/driver.tsx:20-49` | Identity and bus assignment must be separate |
| P0 | Admin password is hardcoded in server and test source | `artifacts/api-server/src/routes/transit.ts:130-141`, `transit.test.ts:55-73` | Individual admin authentication; revoke exposed credential |
| P0 | ORS credential is embedded in browser configuration | `artifacts/pu-transit/src/lib/map-config.ts`, `src/lib/ors.ts:3-37` | Rotate exposed ORS credential; protected server-side proxy |
| P0 | Route and GPS mutation bodies lack validation | `artifacts/api-server/src/routes/transit.ts:35-56,102-127` | Schema validation, finite coordinates, bounded payloads, server-validated ownership |
| P1 | Old samples remain “live”; offline writes can fail silently | `src/pages/student.tsx:31`, `src/pages/driver.tsx:52-56,73-109` | Timestamp/heartbeat-based freshness and acknowledged lifecycle transitions |
| P1 | One status row per bus; no active-trip ownership | `lib/db/src/schema/driver_status.ts:3-7` | One authorized active publisher; explicit trip/shift identity |
| P1 | Route delete lacks confirmation and useful failure handling | `src/pages/admin.tsx:133-140,263-264` | Confirm, handle failure, do not falsely report success |
| P1 | Current sessions use default memory store; proxy trust not configured | `artifacts/api-server/src/app.ts:38-47` | If retained, durable sessions, trusted TLS proxy and production cookie tests |
| P1 | Public access policy and location retention are undefined | Public route/status read endpoints | Explicit audience rules, least privilege, retention/deletion policy |

**Correction to a superficial UI reading:** `legacy-admin.ts` is a server API wrapper. Current route mutations do have server-side admin checks; this is not purely a client-side admin gate. The blocking weaknesses are the shared hardcoded credential, session configuration and missing validation.

**Production session risk is not runtime-proven here:** `secure` cookies behind a TLS proxy may fail without correct trusted-proxy configuration. No production login/cookie test was performed during this audit.

**Firebase configuration distinction:** A Firebase web API key/project config is normally intended for client initialization; it is not authorization. Private service-account keys, ORS credentials and passwords must remain secret. Firebase access must be controlled through Auth, Security Rules and verified server operations, not by hiding the web config.

## 8. Recommended target architecture — pending product answers

- **Web:** retain React + TypeScript + Vite and existing compatible UI primitives.
- **Identity:** Firebase Auth for drivers/admins; student identity depends on the chosen access policy.
- **Primary data:** user-owned Firebase Realtime Database as the proposed default, because the original product uses realtime subscriptions/presence. Inspect the supplied project first; if it already uses Firestore, do not add or migrate to a second Firebase database without discussing the tradeoff.
- **Privileged operations:** one trusted backend using Firebase Admin SDK for assignments/admin operations and protected ORS requests. Reuse the Express API if appropriate; do not add both Express and Cloud Functions for identical responsibilities.
- **Authorization:** verified roles and assignment ownership, default-deny Rules, role changes unavailable to ordinary clients.
- **Realtime tracking:** separate route definitions from active trips, presence and location samples; subscribe only to relevant buses/routes.
- **Freshness:** trusted timestamp, accuracy, heartbeat and one-publisher ownership; stale/offline derived from freshness, not a permanent boolean.
- **Maps:** retain Leaflet unless a demonstrated requirement warrants changing it; basemap licensing/configuration and route provider are separate decisions.

Possible entities, not an approved database schema: users/roles, buses, route versions/stops, shifts, driver assignments, trips, live samples/presence and admin audit events.

Never trust a UID, role, bus assignment or timestamp merely because the client sends it. `onDisconnect` helps presence but is not a complete solution for delayed disconnects or offline mobile clients.

### Migration safeguards

1. Confirm Firebase product, owner, access method and whether existing records must be preserved.
2. Inventory original and current data without modifying it; obtain an authorized backup/export.
3. Map legacy route keys and normalize bus IDs; identify duplicate bus/shift records.
4. Design and test Security Rules, roles and migration transformations using isolated fixtures/emulators.
5. Rehearse import into a separate path/project, compare counts and route geometry, obtain approval.
6. Use a deliberate cutover and rollback plan with one authoritative store. Avoid indefinite dual writes.
7. Retire old writes only after acceptance; no blind deletes or automatic PostgreSQL teardown.

## 9. Priority order for the eventual PRD

### Now — release blockers

Identity and assignments; Firebase access rules; schema validation; route-data preservation; secure routing credentials; usable basemap; truthful GPS lifecycle; route CRUD failure handling.

### Next — reliable daily use

Mobile student flow, visible stops/last-seen information, accessible controls, driver reconnect/permission recovery, admin filtering and assignment workflow, real-device and cross-device acceptance tests.

### Later — only after evidence

ETA with measured accuracy, saved buses/stops, service notices, notifications, route import, fleet reporting. Native background driver tracking moves into the first release if that is a hard requirement.

Native student companion, promo video and pitch deck do not resolve current tracking reliability.

## 10. Verification performed and limitations

Performed during this audit:

- Verified all eight installed skill entrypoints, source revisions and licenses.
- Read-only comparison of current app and imported original.
- Desktop home screenshot at 1440×1000 and student mobile screenshot at 390×844.
- Read-only HTTP probes returned 200 for home, legacy page URLs, API health, routes and session endpoint. SPA HTTP 200 alone does not prove the correct page or functionality.

Not performed:

- No live Firebase access, database export/import, route writes or account/secret changes.
- No real GPS journey, concurrent driver simulation or screen-off tracking test.
- No production session, authorization abuse, assistive-technology, axe or Lighthouse test.
- No new unit-test run. Existing tests were inspected; previously reported passing tests are not evidence for the missing flows.
- No Impeccable native detector or hook execution.

The requirements proposal in `docs/PU-Transit-PRD.md` turns these decisions into role-specific journeys, a proposed data model, acceptance criteria, success metrics, non-goals and an implementation sequence. Recommendations remain distinct from approved requirements.