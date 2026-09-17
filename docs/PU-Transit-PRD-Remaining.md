# PU Transit — Remaining Work PRD

**Version:** 2.0 (companion to PRD v1.1; sirf baaki kaam)  
**Last updated:** 13 September 2026
**Status:** Draft — for project-owner approval  
**Owner / final approver:** Project owner  
**Audience:** Project owner, implementation team, university transport administrators  
**Decision enabled:** PRD v1.1 mein jo maanga gaya tha aur abhi tak nahi bana, uska order, scope aur acceptance gates agree karna — agla code likhne se pehle.

## Authoritative owner amendment — 13 September 2026

The current product decision supersedes conflicting proposal defaults below;
the dated 12 September baseline and workstream history remain intact. PU
Transit continues as a web product and native driver tracking is later. The
owner reports that the official Play app is being discontinued (owner-reported,
not independently verified).

Sign-up has a student/staff/driver/admin picker. PU student/staff are approved
immediately. Driver/admin requests are approved as student plus
`requestedRole` until the office confirms the role in **Admin → Users**. New
students using personal email have a 30-day grace period from membership
`createdAt`, enforced by Rules/API, and must switch to a verified university
email from Account. Existing memberships are never wiped or recreated. There
are no automatic suspensions; denial after an uncorrected grace deadline does
not set `suspended`.

Add-ons use `toCampus` / `fromCampus` and a `full` flag. Route kind includes
`shuttle`. Admin notices are create/delete, at most 280 characters and 30
days. About/Help is included. Hindi/Gujarati driver UI awaits native-speaker
review. Payments and passes are out of scope. PU blue remains `#0A76D6`, not
indigo. The protected root account is established; future privileged-user
confirmation is in Users, not new Firebase Console promotion instructions.

The new access-model Rules payload is not published. Implementation versus
publication status and the exact post-QA publication walkthrough are in
`docs/evidence/2026-09-13-access-model.md`; this docs-only amendment claims no
test run.

W0-04 has a local implementation whose automated/build verification passed
([evidence](evidence/2026-09-13-w0-04-ors-proxy.md)). Server-secret/new-key
comparison and live-provider check passed 13 Sep; old-key revocation at ORS is
still pending (the old key was still accepted at the last check), so W0-04 is
not complete. No published rollout claim is made.

## 1. Executive summary

Web product ban chuka hai aur reviewed hai: verified students/staff bus dhundh kar uski honest live/delayed/offline state dekhte hain, driver browser se trip share karta hai, admin routes / users / fleet / audit manage karta hai. PRD v1.1 §6 ke **31 functional requirements mein 21 done, 7 partial, 1 not started, 2 deferred by decision** hain (detail: `README.md` §3).

Ye document **sirf bache hue kaam** ka PRD hai. Do gaps sabse bade hain:

1. **Native background driver tracking (PRD Stage C)** — bilkul shuru nahi hua. Browser tracking screen-on tak hi kaam karta hai; PRD v1.1 ka confirmed requirement ("phone locked / app backgrounded hone par bhi") iske bina poora nahi ho sakta. Ye **driver phone inventory** par blocked hai — PRD guess karne se mana karta hai.
2. **Operational readiness (Stages E–F)** — retention cleanup, backups, rate limits, monitoring, runbooks, named owners, migration rehearsal, controlled validation. Inke bina "university-wide daily use" ka gate pass nahi hota, chahe features kitne bhi ban jaayein.

Baaki gaps chhote aur clear hain: membership expiry, `buses` registry, route versions/publish/archive, dated assignments, "no service" state, admin MFA, W0-04's old-key revocation at ORS, and the new access-model Rules publication. The 12 Sep Rules publish remains historical; the new owner action is still pending.

Sab kuch aath workstreams (W0–W7) mein grouped hai, har ek ke saath requirements, acceptance criteria, size (S/M/L) aur exit gate. **This document is a proposal. It claims nothing as done, and it does not authorize destructive data migration, production rollout or store submission** — same rule as v1.1.

## 2. Baseline — kya already bana hua hai (reference only)

Ye section sirf context ke liye hai; status ka source of truth `docs/Delivery-Status.md` §2–§4 hai.

- **Identity:** Firebase email/password auth, email verification, exact-domain allowlist (`paruluniversity.ac.in`), membership `pending / approved / rejected / suspended` + `active`; teen jagah enforce — RTDB Rules, API middleware, web gate. Legacy shared-password login retired.
- **Tracking contract (v1.1 §7):** atomic `tracking/{busId}` node, single publisher, start / sample / heartbeat / end / force-end API, sample ~5 s, heartbeat 15 s, live ≤ 30 s aur ≤ 100 m, delayed 30–90 s, offline > 90 s, pending-end durability, idempotent retries, `SESSION_CONFLICT` par phone idle.
- **Student:** normalized search listing every match, text stop list, opt-in "my location", text-first states.
- **Driver (web):** preflight checklist, acquiring → live truthfully, battery guidance, wake lock; **background tracking explicitly unsupported in the browser.**
- **Admin:** users tab (approve/suspend/role/bus, conflict confirm before save), routes (geocoding, ORS routing, Vadodara bounds, search, lock during active trip, delete confirm), fleet with force-end + audit, System tab (audit log, Rules setup, legacy import preview).
- **Platform:** Express API forwards verified user ID tokens to RTDB REST (no Admin SDK in request path), OpenAPI contract + generated clients, Rules emulator tests, web + API unit tests, OpenFreeMap basemap locked to Vadodara, "Metro typographic tiles" design system (`artifacts/pu-transit/DESIGN.md`).

## 3. Scope of this PRD

### In scope — har open item, uska source aur workstream

| Source (v1.1) | Item | State today | Workstream |
| --- | --- | --- | --- |
| 13 Sep owner amendment | New access-model Rules payload (grace, requested roles, membership preservation, no auto-suspension) | Not published; QA then owner publication | W0 |
| Phase 2/3 | Live driver rehearsal against the live database | Deferred by owner | W0 |
| §10 | ORS geocoding/directions must stay behind the admin-only server proxy; key lifecycle must be completed | Local automated/build verification passed; server-secret/new-key comparison and live-provider check passed 13 Sep; old-key revocation at ORS pending | W0 / W5 |
| DRV-03, §8 gate, AUTH-06 (native) | Native background tracking on the real device matrix | Not started | W1 |
| AUTH-02 | Membership expiry state | Built 14 Sep 2026 (IDN-01): `expiresAt` on memberships, Rules + API + both clients | W2 |
| §10 | Admin MFA / step-up | Not started | W2 |
| AC-18 | Revocation within 60 s | Measured 14 Sep 2026 (IDN-02): open tracker view clears and the gate closes 0.9–3.7 s after the suspension (`docs/evidence/2026-09-14-idn02-revocation.md`); live re-run after publishing | W2 |
| AC-32 | Email-change re-verification flow | Tested 14 Sep 2026 (IDN-04): Rules + API deny a changed or unverified claim; a verified university address is re-bound, a personal one is stopped with an explanation (`docs/evidence/2026-09-14-idn04-email-change.md`); owner run on the published app | W2 |
| ADM-01, DRV-01 | `buses` registry, uniqueness, deactivation, "serviceable bus" | Not started (assignment picks from route bus numbers) | W3 |
| ADM-02 | Explicit map-click/manual routes can be saved without provider road geometry (dashed straight line) | Closed 13 Sep 2026 (RTE-01: publish gate + rider-visible "path not verified") | W3 |
| ADM-03 | Route versions + publish; active trip keeps its version | Deferred; interim lock exists | W3 |
| ADM-04 | Archive; delete only unreferenced drafts | Built 13 Sep 2026 (RTE-03) | W3 |
| ADM-05 | Service date / route version on assignments | Built 13 Sep 2026 (ASG-01, `docs/assignments.md`) | W3 |
| ADM-06 | Explicit handover as one action | Built 13 Sep 2026 (ADM-10, `docs/assignments.md` → Handover) | W3 |
| §11 admin | Unsaved-edit warning in the route editor | Unverified | W3 |
| STU-04 | "No service" (holiday / no schedule) state | Admin-managed `serviceCalendar` (built 14 Sep 2026); per-route service days still unmodelled | W4 |
| STU-05 | Background-tab listener behaviour | Unverified | W4 |
| STU-07 | Preferred bus/stop | Deferred (evidence first) | W4 |
| §11, AC-24 | Screen-reader, 200 % zoom, 360 px audit | Audited and fixed 14 Sep 2026 (`docs/evidence/2026-09-14-a11y01-audit.md`); real screen-reader run pending | W4 |
| §10 | Rate limits, body size limits, CORS allowlist, security headers | Rate limits and request bounds done 14 Sep 2026 (`docs/ops-notes.md`); CORS allowlist and headers not implemented | W5 |
| §10 | Retention cleanup job, backups, restore rehearsal | Not implemented | W5 |
| §10 | App Check (optional supplement) | Not started | W5 |
| §12 | Metrics, capacity model, field measurements | Not instrumented | W6 |
| §16 | Alerts, runbooks, named owners, help contact | Not started | W6 |
| §14, AC-27, AC-28 | Migration inventory, staging rehearsal, cutover plan, production-like auth check | Preview/import only | W7 |
| Stage F | Controlled validation cohort, onboarding, phased expansion | Not started | W7 |
| §18 | Open decisions (inventory, owners, retention, scale, budgets, distribution, sign-off) | Open | §4 below |

### Out of scope (unchanged from v1.1 §4)

Student native app jab tak responsive web student flow ke liye kaafi hai; AI predictions, payments, attendance, ticketing, driver scoring, multi-university SaaS; har GPS point ka historical replay; guaranteed ETA bina validated method ke; automatic emergency response; covert/off-duty tracking; force-stop / permission-denied / phone-off ke baad tracking ka promise; promo video / pitch deck as a prerequisite. **Redesign phase closed hai:** naye screens `DESIGN.md` follow karenge, lekin koi aur decorative UI work native tracking proof se pehle nahi hoga (v1.1 §15 rule).

## 4. Decisions required before implementation

Ye inputs code se nahi nikal sakte. Jahan "none" likha hai wahan guess karna allowed nahi hai.

| Decision | Blocks | Who | Default if undecided |
| --- | --- | --- | --- |
| Driver phone inventory: models, OS versions, charging arrangement per bus | W1 sizing, device matrix, distribution | Transport owner | **None.** Android-only is not assumed; a spike on one loaner Android + one iOS device is allowed only as a feasibility check, not as the supported matrix |
| Membership approval owner inside the university + roster/records source | W2 (roster-assisted approval), W7 onboarding | University / owner | Manual admin approval continues as today |
| Fleet scale: buses, simultaneous trips, daily users, peak concurrent viewers, operating hours | W5 limits, W6 capacity model and budgets | Transport owner | **None** for sign-off; interim engineering limits may be set conservatively and stated |
| Retention and privacy policy + user-facing notices | W5 cleanup job, W7 launch | University / legal | v1.1 §10 proposals as the draft (live sample residual ≤ 24 h, trip metadata ≤ 30 d, audit ≤ 90 d) |
| Firebase billing plan (backups, higher limits), data region, provider budgets | W5 backups, W6 alerts | Owner | Current plan; backups then need a scheduled export instead |
| Native distribution ownership | W1 release | Owner | Native is later; internal/test distribution only; no Play-store promise. The owner reports the official Play app is being discontinued. |
| Admin MFA availability (Firebase Auth MFA needs the Identity Platform upgrade) | W2 | Owner | Compensating control: re-authentication before destructive admin actions |
| Service calendar source (holidays, no-service days, per-route service days) | W4 STU-04 | Transport owner | Built 14 Sep 2026 as the admin **calendar** tab (whole-day only); days without an entry keep today's honest state |
| Trusted server identity for the maintenance job (service account used only by the job, never in the request path) | W5 retention | Owner | Job is built (SEC-05, 14 Sep 2026) and runs as the service account; until the secret is valid and a daily trigger exists, retention stays manual (`retention:cleanup`) |
| Final acceptance sign-off role and the technical support owner | W6, W7 | Owner | **None** — university-wide launch cannot be declared |

## 5. Workstreams

Priority meanings unchanged: **P0** — must pass before real university use; **P1** — needed for usable first-release operations; **P2** — later unless evidence changes priority. Sizes S/M/L are relative, not dates.

### W0 — Immediate owner actions and live rehearsal (size S)

Goal: 13 Sep access policy ko QA ke baad publish karna, jo ban chuka hai use
live database par asli phone ke saath prove karna, ORS ko server-side rakhna, aur
pre-existing manual checks complete karna. The 12 Sep publish is historical, not
this workstream's new publication.

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| W0-01 | P0 | After QA, owner publishes the complete 13 Sep access-model Rules payload from Setup → Firebase Console | New grace/requested-role policy is live; existing memberships remain intact; publication is recorded only after the owner confirms it |
| W0-02 | P1 | Owner deletes the stale `driverStatus` node from the live database with approval | Node absent; nothing in the app references it; no existing membership is deleted |
| W0-03 | P0 | Live rehearsal on the web app: real driver phone, real student device, after legacy routes import | Start → acquiring → live → (network off) delayed → offline → (network on) reconnect → End; student sees each state with timestamps; result recorded in `docs/` with device, browser, timings and defects. **Pending: device intake was skipped.** |
| W0-04 | P0 | Keep OpenRouteService geocoding and directions behind the local admin-only API proxy (`POST /api/geo/geocode` and `POST /api/geo/directions`); store a newly generated key as a server secret and revoke the old key | Local implementation requires Firebase token + verified email + approved active membership + admin role. Geocode `{query}` → `{places:[{name,detail,lat,lng}]}` (Vadodara-boxed autocomplete suggestions, ≤ 8, empty when nothing matches — 14 Sep); directions `{start:{lat,lng},end:{lat,lng}}` → `{path:[{lat,lng}]}`. Request bounds and finite coordinates, provider timeout and safe visible errors are enforced; missing secret returns 503. Route editor and manual map-click routes remain allowed; provider failure never synthesizes or falls back to road geometry. Local automated/build verification passed ([evidence](evidence/2026-09-13-w0-04-ors-proxy.md)); server-secret/new-key comparison and live-provider check passed 13 Sep; old-key revocation at ORS is still pending (the old key was still accepted at the last check), so W0-04 is not complete. No published rollout claim is made. |
| W0-05 | P0 | Production-like auth check on the published app (AC-28) | Sign-in, token refresh and one authorized mutation work through the real domain/proxy. Blocked on 13 Sep: app not published; protocol and pre-publish checks in `docs/evidence/w0-05-production-auth-check.md` |

Exit gate remains W0-01 and W0-03 recorded; W0-03 is currently pending because device intake was skipped. W0-04 additionally requires old-key revocation at ORS. Depends on: owner availability, one driver phone, approved fixture deletion, legacy routes import, ORS key lifecycle completion and production-auth smoke check (app not published; protocol and pre-publish checks are in `docs/evidence/w0-05-production-auth-check.md`).

### W1 — Native driver app and background tracking (size L; PRD Stage C)

Goal: DRV-03 — supported driver phones screen-off / backgrounded hone par bhi share karte rahen, platform ke required indicators aur disclosures ke saath. Same tracking contract, same API, same identity as the web.

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| NAT-01 | P0 | **Feasibility gate first.** A minimal native build (development/production build — Expo Go is not evidence) on each device class from the inventory proves screen-off tracking on a representative route (≥ 45 min), through a token refresh and one network loss/recovery, before any UI polish | ≥ 95 % of trip minutes have a valid ≤ 30 s sample on the healthy segment; outages listed with causes. **13 Sep 2026:** feasibility build exists (`artifacts/pu-transit-driver`, shared state machine `lib/driver-tracking`, evidence export + `scripts/src/nat01-coverage.ts`); run protocol and empty results in `docs/rehearsal-log-nat01.md`, labelled single-device feasibility proof per Addendum §3 — **not run: blocked**, owner has no Android Studio machine or Apple Developer account yet (13 Sep 2026) |
| NAT-02 | P0 | Platform-required background behaviour: Android foreground service with persistent notification and background-location permission flow; iOS "Always" location with background mode and the system indicator; a purpose statement before the OS prompt | Permission review checklist passes on each OS version in the matrix; no tracking without the visible indicator. **13 Sep 2026:** implemented in `artifacts/pu-transit-driver` (`lib/permissions.ts`, `components/PurposeSheet.tsx`, `app.json`); Start re-checks every permission at tap time. Checklist with empty results: `docs/permission-review-nat02.md` — **not walked through on any phone yet** (same build-path block as NAT-01) |
| NAT-03 | P0 | Reuse the tracking contract unchanged: `/api/tracking/{busId}/start\|sample\|heartbeat\|end`, publisher session + sequence numbers, capture vs receive timestamps, pending-end on device storage, `SESSION_CONFLICT` → idle | The existing API contract tests pass unchanged against native traffic; no native-only endpoint added |
| NAT-04 | P0 | Native preflight (DRV-02): identity, assignment, network, location services, precise location, background permission, battery-optimisation exemption (Android), notification permission (Android 13+); one actionable fix line per red item | AC-07: missing background permission blocks Start with instructions and never claims live. **13 Sep 2026:** implemented in `artifacts/pu-transit-driver` (`lib/preflight.ts` account/network rows + Trip status line, `lib/permissions.ts` device rows incl. a real Android battery-optimisation check via `expo-battery`); all eight rows re-run at the moment Start is tapped, and the Trip card never says *live* while any row is red. Device checklist section D in `docs/permission-review-nat02.md` — **not run on a phone yet** (same build-path block as NAT-01) |
| NAT-05 | P0 | Ownership and idempotency parity with the web client (single publisher, replay-safe retries, ended trips cannot revive) | Real-device runs of AC-08, AC-09, AC-12, AC-15, AC-16, AC-17 recorded. Protocol, on-demand Start-timeout fault injection and `nat05:parity` report ready 13 Sep 2026 (`docs/rehearsal-log-nat05.md`); **not run on a phone yet** |
| NAT-06 | P0 | Consistent auth (AUTH-06): Firebase ID tokens, same membership gate, sign-out clears device-held private state | Same negative tests as web pass from the native client. **13 Sep 2026:** parity table, sign-out inventory and protocol in `docs/rehearsal-log-nat06.md`; native preflight blocks unverified emails / foreign uids like the web gate, sign-out clears the cached account record and this uid's trip keys; no-token / forged / expired / unsigned cases pass through the native transport against the live API (`scripts/src/nat06-auth-parity.ts`); unverified, suspended and sign-out steps **not run on a phone yet** (same build-path block as NAT-01) |
| NAT-07 | P1 | Battery and mobile-data measurement per device class over representative routes; transport owner approves a budget | Measured numbers in the rehearsal log; no unmeasured claim |
| NAT-08 | P1 | Distribution route agreed (internal track / TestFlight or internal distribution); store submission not promised | Signed build installable on the fleet's phones without developer tooling |
| NAT-09 | P1 | Driver onboarding material per OS: permission walkthrough, "do not force-stop", vendor battery-saver guidance (common Indian Android vendors kill background apps aggressively), charging | Used in W7 onboarding; drivers complete Start without help after training |

Proposed design: new artifact (Expo, React Native) alongside the web app; the pure tracking state machine from the web (`driver-tracking.ts`) is extracted into a shared workspace library with a platform adapter interface (browser `watchPosition` today; `expo-location` + background task tomorrow); the generated OpenAPI client is shared. Screens follow `DESIGN.md` (tiles, Work Sans, states in text). Hard limit stays: no anti-spoof guarantee, no tracking promise after force-stop or phone off (AC-25 must expire the feed honestly).

Exit gate: NAT-01 met per device class; AC-10 passes. Depends on: phone inventory (§4), W0-03 baseline, distribution ownership.

### W2 — Identity and access completeness (size M)

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| IDN-01 | P0 | **Built 14 Sep 2026.** Membership expiry (AUTH-02): optional `expiresAt` (UTC ms) on memberships; Rules deny protected reads/writes when server time ≥ `expiresAt` (`2026-09-14-membership-expiry.py`, unpublished); API mirrors it (403 `MEMBERSHIP_EXPIRED`; expired drivers are not eligible for assignments or handover; expired admins are no admins); web gate / account page / Users tab and the driver app show **expired** distinct from suspended, same recovery path; admins set/extend/clear via "access until" (`PATCH /memberships/{uid}` `expiresAt`, audited `membership.update`); self-expiry refused. No default term: a member with no `expiresAt` never expires — the university sets terms by hand | Rules test `firebase-rules.test.ts` (IDN-01): approved+active member with past `expiresAt` denied on `routes` and `tracking`, self cannot touch it, admin extension restores access; API `membership-expiry.test.ts`; web `auth-gate.test.tsx`; driver `account-steps.test.ts` |
| IDN-02 | P1 | **Built 14 Sep 2026.** Revocation propagation (AC-18): the web tracker is a 5 s poll, not a database listener, so the client's *permission denied* is the API's 403; any 403 now makes the auth context re-read `/auth/me` at once and a 403 on the feed drops the live state instead of ageing it out. Measured on the emulator-backed stack in a real browser: feed gone and gate closed 0.86 s after the suspension (feed poll first), 1.7–3.7 s (routes poll first); before the fix the gate took up to the 20 s membership poll (13.5 s observed) | `docs/evidence/2026-09-14-idn02-revocation.md`; unit tests `api-session.test.ts`, `use-transit.test.tsx`; owner repeats the two-browser run after publishing |
| IDN-03 | P1 | Admin step-up: Firebase MFA if the Identity Platform upgrade is approved; otherwise re-authentication required before role changes, force-end and route delete, and audited | Destructive admin action without recent re-auth is refused by the API (server checks `auth_time`) |
| IDN-04 | P1 | **Done 14 Sep 2026.** Email-change path (AC-32): the approval is bound to uid + email; an unverified or personal claim gets nothing (Rules) / 403 `EMAIL_UNVERIFIED` or `MEMBERSHIP_EMAIL_MISMATCH` (API); a verified university claim is re-bound by `/auth/me` with role and dates intact (approval by the same rule as sign-up). Web gate and account page name both addresses and the way back; driver app row says the same. Not done: no audit of the rebind (member cannot write `audit`), elevated roles carry over | Rules test (changed university / personal / unverified tokens, 26/26) and API test (403 codes, `/auth/me` shape, rebind PUT) with a changed `email` claim; copy reviewed in `docs/evidence/2026-09-14-idn04-email-change.md` |
| IDN-05 | P2 | Roster-assisted approval: admin uploads an approved roster (emails/roll numbers); pending members show "matches roster" / "not on roster"; approval remains a manual click | No automatic activation; roster stored admin-only |

Exit gate: negative role matrix (v1.1 §13 AC-01/02/29–32 + expiry) passes in Rules and API tests.

### W3 — Fleet and route operations completion (size L)

Goal: ADM-01/02/03/04/05 ko poora karna bina Phase 3 ke working flows ko todhe.

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| FLT-01 | P0 | `buses/{busId}` registry: canonical key = normalized registration; display label; status `active` / `out_of_service`; created/updated metadata; uniqueness by normalized registration (ADM-01) | Duplicate registration rejected with the existing record named; one canonical key used by `memberships.assignedBusId`, `routes` and `tracking/{busId}`; existing values migrated by script with a collision report — **Built 13 Sep 2026** (`docs/buses-registry.md`): API + Rules + Fleet UI + `buses:migrate` report/apply; Rules publication and the live migration are pending, nothing applied yet |
| FLT-02 | P0 | Deactivation preserves references: a bus with an active trip cannot be deactivated; deactivated buses leave student search but keep history | 409 with reason; audit row — **Built 13 Sep 2026**: 409 `BUS_ACTIVE_TRIP` with the trip named, `bus.deactivate` audit with reason, parked buses filtered from non-admin `GET /routes` |
| FLT-03 | P0 | Start requires a serviceable bus (DRV-01 remainder): API and Rules check `buses/{busId}.status == active` | Driver of an out-of-service bus sees the reason in preflight; API and Rules deny Start — **Built 13 Sep 2026** (`docs/buses-registry.md`): API 403 `BUS_OUT_OF_SERVICE` / `BUS_NOT_REGISTERED`, Rules Start branch, preflight row on web + native with the reason; Rules payload unpublished |
| RTE-01 | P0 | No silent straight lines (ADM-02): publish requires road geometry for every leg, or an explicit admin-acknowledged "manual path" flag that students see as "path not verified" | Saving a draft without geometry stays allowed; publishing it is refused unless flagged; the flag is visible on the student route — **Built 13 Sep 2026** (`docs/route-publishing.md`): `status` draft/published + `pathSource` ors/manual, API 409 `ROUTE_PATH_UNVERIFIED` (ors geometry checked within 150 m of every stop), Rules publish gate (`2026-09-13-route-publish.py`, unpublished), drafts admin-only, "path not verified" badge in rider list + detail; `status` is the field RTE-02 extends with `archived`; drafts are hidden by the API only (Rules still let members read `routes` directly — fold query-scoped reads into RTE-02); PostgreSQL import now creates drafts |
| RTE-02 | P0 | Route versions + publish (ADM-03): `routes/{id}` keeps identity, `status` (`draft` / `published` / `archived`), `publishedVersion`; `routeVersions/{routeId}/{n}` immutable (stops, path, createdAt, createdBy); Start snapshots `routeId` + `routeVersion` into the feed; students see the version the active trip uses, otherwise the published one | AC-19: editing and publishing during an active trip leaves that trip on its version; later trips pick the new one; interim lock retired only after this ships — **Built 13 Sep 2026** (`docs/route-publishing.md`): `routeVersions/{id}/{n}` immutable snapshots, `publishedVersion` on the node, admin-only `routeDrafts` for edits of published routes, `GET /routes/{id}/versions/{n}`, Start pins `feed.routeVersions` (map of the bus's published versioned routes; Rules freeze it per trip), student page renders the pinned snapshot with a note; lock retired except publishing a pre-versioning route or moving a route to another bus during a live trip; Rules mutation `2026-09-13-route-versions.py` (unpublished); AC-19 covered by API + Rules + web tests, device run pending |
| RTE-03 | P0 | Archive and protected delete (ADM-04): archive published routes (hidden from search, history kept); permanent delete only for never-published drafts with the existing consequence-stating confirm; anything referenced by an active trip cannot be archived/deleted | AC-20, AC-22 pass; deletion of a referenced route denied with explanation — **Built 13 Sep 2026** (`docs/route-publishing.md`): `POST /routes/{id}/archive` (hidden from riders, versions + pending draft kept, republish restores), `DELETE` only for never-published drafts (409 `ROUTE_PUBLISHED` otherwise, Rules mirror it via `2026-09-13-route-archive.py`, unpublished), archive refused during a live trip (409 `ROUTE_LOCKED_ACTIVE_TRIP`), editor shows archive/delete per status behind the inline confirmation |
| RTE-04 | P1 | **Done 14 Sep 2026.** Route editor: preserve the draft when geocoding/ORS/save fails (AC-21) and warn before leaving with unsaved edits (v1.1 §11). New routes are created with a client UUID through the idempotent `PUT /routes/{id}` (an unchanged replay answers 200, adds no version, is audited as `(replayed, unchanged)`); the draft is only cleared on success or reset; a dirty form asks before an admin tab switch, in-app link, back/forward (spare history entry — wouter has no blocker), reload or tab close, and never when clean | Failure leaves the form populated; retry creates no duplicate; navigation prompt appears only when dirty — API (16) + web (10) tests, back/forward proven in a real Chromium; device check pending (`docs/evidence/2026-09-14-rte04-route-editor.md`) |
| ASG-01 | P1 | Dated assignments (ADM-05): `assignments/{id}` = driver, bus, route, route version, service date (Asia/Kolkata), shift; the standing `assignedBusId` remains the default; a dated assignment overrides it for that date/shift; conflicts (same bus+date+shift, or a driver on two buses) are shown before saving with names | Conflict cases rejected or confirmed before persistence; driver preflight shows the assignment for today; no automatic trip start from a schedule — **Built 13 Sep 2026** (`docs/assignments.md`): `assignments/{driverUid}/{date_shiftKey_busId}` (route sets the shift and records its version; IST day window), API 409 `ASSIGNMENT_CONFLICT` names the other driver/bus and the admin tab shows the same message before saving with the button disabled, `/auth/me.assignments` feeds the preflight and a bus picker on web and native, Start on the override bus pins `feed.assignmentId` (Rules branch in `2026-09-13-assignments.py`, unpublished); the standing bus stays allowed alongside the override |
| ADM-10 | P1 | Explicit handover as one authorized action (ADM-06): force-end the current publisher and pre-authorize the named next driver's Start, with confirmation and a single audit record | AC-23 with handover: previous phone drops to idle on its next upload; the new driver's Start succeeds; audit names both — **Built 13 Sep 2026** (`docs/assignments.md` → Handover): `POST /tracking/{busId}/handover` authorizes the next driver first (standing bus, or a dated assignment for today on the chosen route; refusals change nothing), then force-ends, then writes one `tracking.handover` audit naming both drivers; Fleet tile *hand over* form with inline confirm; API tests cover the old phone's 409 `SESSION_CONFLICT` and the new driver's immediate Start; Rules enum entry in `2026-09-13-handover.py` (unpublished); not yet run on devices |

Exit gate: AC-19–AC-23 pass; Rules tests extended for `buses`, `routeVersions`, `assignments`; Phase 3 flows unchanged for admins.

### W4 — Student experience completion (size S–M)

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| STU-04b | P1 | "No service" state from an admin-managed service calendar (`serviceCalendar/{yyyy-mm-dd}` holidays, optional per-route service days); without a calendar entry the app keeps today's honest "no schedule information" | Holiday shows "no service today" with the source date; never shown by guess. **Built 14 Sep 2026**: `GET /service-calendar` (members), `PUT`/`DELETE /service-calendar/{date}` (admin, audited `calendar.save`/`calendar.delete`), admin **calendar** tab, student banner keyed on the IST date; API vitest, web vitest and emulator Rules tests pass. Per-route service days not modelled; Rules block unpublished until the owner publishes the 13/14 Sep payload. |
| STU-05b | P1 | Background tabs: subscription pauses when the tab is hidden for more than 60 s and resumes with a fresh read; two open tabs never multiply writes and each holds at most one listener per view | Verified with the Firebase connection counter and a two-tab test; recorded |
| STU-07 | P2 | Preferred bus/stop stored on-device only, and only if controlled-validation feedback asks for it | Not built without evidence |
| A11Y-01 | P1 | Assistive audit (AC-24): screen-reader pass of search → result → status, `aria-live` announcements for state changes, focus moves to the selected route, keyboard access to map overlay controls, 200 % zoom and 360 px checks | Findings fixed or recorded with reason; no map-only information. **Done 14 Sep 2026**: 13 findings fixed (pinch-zoom unblocked, one non-ticking status announcer, focus to heading / count / result tile, markers out of the tab order, named map region, no horizontal overflow at 200 % text on 360 px), axe 0 violations in every view, 6 limitations recorded; real screen-reader walkthrough left to the owner ([evidence](evidence/2026-09-14-a11y01-audit.md)) |
| PERF-01 | P2 | Load map code only on pages that show a map, based on a measured bundle/route timing, not speculation | Measured before/after numbers in the log |

Exit gate: A11Y-01 done; STU-05b recorded.

### W5 — Security, privacy and data lifecycle hardening (size M; before any cohort)

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| SEC-01 | P0 | Rate limits sized to the fleet: per-uid and per-IP on tracking (sample/heartbeat ≤ 1 per second per bus), membership creation, route mutations, geo proxy; `429` with `Retry-After`; limits stated in the ops doc | Load test at the agreed fleet size passes; abuse pattern is throttled and logged without payloads  **Done 14 Sep 2026**: one shared limiter (fixed 1-min windows, per uid + per client, mounted after token verification and before any database read) on tracking 60/600, membership 5/60, route writes 30/60, geo 30/30 (per uid / per client; the client key is a fleet-wide ceiling until `trust proxy` is set on the published app); `429` + `Retry-After` + `RATE_LIMITED`; one `WARN` per refusal without payload. Limits and the live 62-request proof in [`docs/ops-notes.md`](ops-notes.md); load test at fleet size still to run on the published app |
| SEC-02 | P0 | Request bounds: JSON body limit (tracking payloads are small — tens of bytes; a 32 kB limit is generous), array limits (stops, path points), string limits on every route/membership field (audit already bounded) | Oversized or malformed input rejected with 400/413 and no partial write | **Done 14 Sep 2026**: JSON bodies capped at 32 kB (512 kB on `/api/routes*` for 5000-point paths) → `413` `PAYLOAD_TOO_LARGE` before auth; malformed JSON → `400`; route and membership fields were already bounded (stops 500, path 5000, strings 200/128, enums, unknown keys refused), assignment/handover driver uids now key-safe, and validation precedes every write; bounds table and proof in [`docs/ops-notes.md`](ops-notes.md) |
| SEC-03 | P0 | CORS allowlist (production origin + development domain) and baseline security headers | Cross-origin request from an unknown origin is rejected; headers verified on the published app |
| SEC-04 | P0 | Secrets hygiene: ORS key server-side only (W0-04); no service-account material in any bundle; secrets managed in the workspace secrets store | **Sweep done 14 Sep 2026** ([evidence](evidence/2026-09-14-sec04-secrets-sweep.md), rerunnable `pnpm --filter @workspace/scripts run secrets:sweep`): current secrets absent from tree, full git history, web build and API build (driver app: source scan only); ORS key read only by the API; service account read only by owner-run scripts; `.replit` holds public identifiers only. **Still not met until the old key is revoked at ORS** — it returned HTTP 200 again on 14 Sep; owner deletes it in the ORS dashboard, then the old-key probe must return 401/403 |
| SEC-05 | P0 | Retention cleanup job (RTDB has no TTL): remove the residual `location` from ended feeds within 24 h, trim `audit` beyond 90 d, record `maintenance/{job}` (last run, outcome); runs on a schedule with a trusted job-only identity; failure is alertable | **Job built and proven 14 Sep 2026** ([evidence](evidence/2026-09-14-sec05-retention.md)): `pnpm --filter @workspace/scripts run retention:cleanup` deletes ended/dead-feed `location` and audit past 90 d, writes `maintenance/retention`, exits 1 and records `outcome: failed` on error; emulator tests read the deleted records back as null (AC-26 met in the emulator; forced failure visible). **Not met in production until** the owner fixes `FIREBASE_SERVICE_ACCOUNT_JSON` and schedules the daily run (02:30 IST) |
| SEC-06 | P1 | Backups: automated RTDB backups if the plan allows, else scheduled export to protected storage; one restore rehearsal into an isolated project | Restore procedure documented and executed once |
| SEC-07 | P1 | Log hygiene review: no tokens, no coordinates, no raw GPS payloads in logs; redaction paths configured | Sample of production logs reviewed |
| SEC-08 | P2 | Firebase App Check for web and native after compatibility verification; never a replacement for auth/Rules | Enforced only after monitoring shows no legitimate rejects |
| PRIV-01 | P1 | Driver-facing purpose statement and visible active-tracking indicator (web and native); privacy notice text approved by the university | Copy approved; indicator present whenever a session is active |
| PRIV-02 | P1 | Sign-out clears app-held private state (feed cache, pending end of another user is never reused) | Test: pending end from user A is not sent after user B signs in |

Exit gate: security checklist passes on the published app before the W7 cohort.

### W6 — Observability, capacity and operational readiness (size M; before any cohort)

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| OPS-01 | P0 | Metrics: active trips, sample age distribution, heartbeat gaps, stale/offline share, ingest validation failures, 401/403 counts, API latency and error rate — as structured events plus an admin/internal summary endpoint | Dashboard shows the v1.1 §12 metrics during a rehearsal |
| OPS-02 | P0 | Alerts: API down, Firebase quota approaching, geo-proxy quota, retention job failure, unusual 403 spikes | Each alert fired once in a drill and reached the named owner |
| OPS-03 | P0 | Runbooks for the six v1.1 §16 incidents: bus appears offline, basemap/ORS outage, lost driver phone, wrong assignment/duplicate device, data/Rules regression, credential exposure | Written, tabletop-tested with the transport owner |
| OPS-04 | P0 | Named owners: transport operations owner, technical support owner; in-app help contact (Account page) and a documented fallback (timetable / manual dispatch) | Names recorded in `README.md`; contact visible in the app |
| OPS-05 | P1 | Capacity model signed: fleet numbers → RTDB connections/egress, API ingest rate (≈ active buses ÷ interval), viewer fan-out; budgets and alert thresholds set from it | Signed by owner; thresholds configured |
| OPS-06 | P1 | Availability check: synthetic `/api/healthz` plus an authenticated read with a monitor account during transport hours | Target ≥ 99.5 % measured over the cohort period |
| OPS-07 | P1 | Field measurement of the §12 targets: p95 capture→render ≤ 15 s; ≥ 95 % fresh minutes; End hidden ≤ 5 s; revocation ≤ 60 s; web result ≤ 3 s on 4G | Numbers reported with the setup; misses listed, not hidden |

Exit gate: production-readiness checklist (v1.1 §19) items for monitoring, budgets, retention, support ownership ticked.

### W7 — Migration rehearsal, controlled validation and rollout (size M–L; Stage F)

| ID | Pri | Requirement | Acceptance |
| --- | --- | --- | --- |
| MIG-01 | P0 | Inventory and comparison: legacy PostgreSQL routes vs RTDB routes — counts, IDs, normalized bus numbers, geometry presence; per-record diff and collision report (today's import preview counts only) | Report reviewed; collisions resolved before any import |
| MIG-02 | P0 | Staging rehearsal in an isolated project/emulator: import, Rules, every role exercised (AC-27) | Expected records match; mismatches block cutover |
| MIG-03 | P0 | Cutover plan: write-freeze window, final import, single authoritative store, rollback = restore an approved backup (never the legacy public-write backend) | Plan approved by owner; rollback rehearsed |
| ROL-01 | P0 | Controlled validation cohort: e.g. 2–3 buses, one shift, two weeks; §12 targets as success criteria; incident log | Go/no-go review held with the transport owner |
| ROL-02 | P0 | Onboarding: driver permission training and device guidance (NAT-09), student/staff communication, help contact, fallback communicated | Drivers start unaided; support requests logged |
| ROL-03 | P1 | Phased expansion by route groups with a go/no-go review after each phase | Each phase's metrics recorded |

Exit gate: transport owner accepts daily operations; project owner approves university-wide rollout.

## 6. Proposed data-model changes

Conceptual; exact paths, indices and limits validated against the live project before implementation. Every new node is default-deny, read by role, and written only through the API (the API forwards the acting user's verified token, so Rules remain the enforcement layer, as today). Two copies of the Rules exist (`firebase/database.rules.json` and the served copy under `artifacts/pu-transit/public/`); they are changed by script, tested in the emulator, and published by the owner.

| Node | Change | Readers / writers | Migration |
| --- | --- | --- | --- |
| `memberships/{uid}` | + `expiresAt` (UTC ms, optional) | As today; Rules and API add the time check | None; missing value = no expiry until the university sets a term |
| `buses/{busId}` | New: `registration`, `label`, `status`, `createdAt`, `updatedAt`; key = normalized registration | Read: approved active members (safe directory); write: admin | Seed from existing route bus numbers; script maps `assignedBusId` and route `busNumber` to the canonical key; collision report first |
| `routes/{id}` | + `status`, + `publishedVersion`, + `busId` (keep `busNumber` for display) | As today | Existing routes become `published` version 1 |
| `routeVersions/{routeId}/{n}` | New, immutable: `stops`, `pathData`, `pathSource` (`ors` / `manual`), `createdAt`, `createdBy` | Read: approved active members; write: admin (append-only, as `audit`) | Version 1 copied from each existing route |
| `assignments/{id}` | New (P1): `driverUid`, `busId`, `routeId`, `routeVersion`, `serviceDate`, `shift`, `createdBy`, `createdAt` | Read: the assigned driver and admins; write: admin | None; standing `assignedBusId` stays the default |
| `tracking/{busId}.feed` | + `routeId`, + `routeVersion` snapshot at Start | As today | Old feeds without the fields read as "version unknown" |
| `serviceCalendar/{yyyy-mm-dd}` | Built 14 Sep 2026: `date` (== key), `noService: true`, optional `note` (1–140), `updatedBy`, `updatedAt` | Read: approved active unexpired members; write: admin (re-writable, key must be a real yyyy-mm-dd) | None |
| `maintenance/{job}` | Built 14 Sep 2026: `maintenance/retention` = `lastRunAt`, `outcome` (`ok`/`failed`), `removed {feedLocations, auditRecords}`, `durationMs`, `error?` | Read: admin; write: no client (`.write: false`) — the job's service account bypasses Rules | None |
| `audit` | + actions: `bus.*`, `route.publish`, `route.archive`, `assignment.*`, `tracking.handover`, `membership.extend` | As today | None |

Invariants carried from v1.1 §9 and unchanged: one active publisher per bus; conditional (transactional) ownership on Start/handover; no acknowledgement of End before the feed is updated; idempotency by trip/session/sequence; UTC storage, Asia/Kolkata display; no schedule-driven automatic Start; no listeners on the whole database.

## 7. Acceptance scenarios still open (v1.1 §13)

**DOC-03 — evidence collection completed 14 Sep 2026:** [AC-ID / requirement index](evidence/README.md)
collects Rules emulator results (26/26), API unit results (97/97), and the canonical
W0-03 / NAT-01 / NAT-05 / NAT-06 rehearsal logs. W0-03 and NAT-01 remain **NOT RUN**;
documentation completion does not close their acceptance gates.

| AC | Status today | Remaining | Workstream |
| --- | --- | --- | --- |
| AC-01, 02, 29, 30, 31 | Denied in Rules and API tests | Re-run on the published app (AC-28 conditions) | W0-05 |
| AC-03, 04, 05 | Verified on the web in review | Re-run during the cohort on real 4G devices | W7 |
| AC-06, 14 | API + Rules tests | Real-device run from the native client | W1 |
| AC-17 | API + Rules tests | Native run per `docs/rehearsal-log-nat05.md` (replaced + force-ended variants) — protocol ready, not run | W1 |
| AC-07 | Web preflight covers location permission | Native background-permission preflight | W1 |
| AC-08, 09 | API concurrency tests | Native run per `docs/rehearsal-log-nat05.md` (phone + web driver page as second publisher; AC-08 via in-app Start-timeout injection) — protocol ready, not run | W1 |
| AC-10 | Not possible on the web | Native screen-off route | W1 |
| AC-11, 13 | State-aging and client tests | Field run with a real network loss | W0-03 / W1 |
| AC-12 | State-aging and client tests | Native airplane-mode walk per `docs/rehearsal-log-nat05.md` — protocol ready, not run | W1 |
| AC-15, 16 | Client tests (pending end) | Native run per `docs/rehearsal-log-nat05.md` — protocol ready, not run | W1 |
| AC-18 | Rules deny on the next read; UI clear measured at 0.9–3.7 s in a real browser against the emulator-backed stack (14 Sep 2026) | Two-browser re-run on the published app | W2 |
| AC-19 | Built 13 Sep 2026 (API, Rules, web tests) | Device run once the 13 Sep Rules are published | W3 |
| AC-20, 22 | Re-verified 13 Sep 2026 with RTE-03 (API + web tests: archive/delete refused with the reason during a live trip; cancelled confirmation changes nothing) | Device run pending | W3 |
| AC-21 | Done 14 Sep 2026 (RTE-04: draft kept on failure, same-UUID retry, unsaved-changes prompt) | Android hardware-back check on a phone | W3 |
| AC-23 | Built (force-end and one-action handover, 13 Sep 2026); blocked on the Rules publish | Verify after W0-01 with two phones | W0 / W3 |
| AC-24 | Audited and fixed 14 Sep 2026 (axe clean, one announcer per state change, focus management, 200 %/360 px reflow) | Owner run with TalkBack/VoiceOver/NVDA | W4 |
| AC-25 | Heartbeat expiry implemented | Force-stop / power-off drill on native | W1 |
| AC-26 | Nothing | Retention job | W5 |
| AC-27 | Import preview only | Staging rehearsal with comparison | W7 |
| AC-28 | Not run | Published-app auth check | W0-05 |
| AC-32 | Email binding in Rules + API; flow tested on the emulator and in vitest, UI copy reviewed (14 Sep 2026) | Owner run on the published app | W2 |

## 8. Delivery order, sizes and gates

| Step | Scope | Size | Depends on | Exit gate |
| --- | --- | --- | --- | --- |
| R0 | W0 owner actions, live web rehearsal, ORS proxy, published-app auth check | S | Owner, one driver phone | Force-end works; rehearsal log written |
| R1 | §4 decisions batch (inventory, owners, retention, scale, budgets, distribution) | S | University input | Decisions recorded in `README.md` |
| R2 | Native feasibility spike (NAT-01) per device class | M | R1 inventory | Screen-off proof met, or an explicit alternative decided (other native approach or vehicle GPS hardware) — never a quiet downgrade to browser tracking |
| R3 | Native driver app (rest of W1) | L | R2 | AC-10 and NAT-05 field runs pass |
| R4 | W3 fleet/route operations | L | R0 | AC-19–AC-23 pass; can run in parallel with R3 (separate code areas) |
| R5 | W2 identity completeness | M | R0 | Negative matrix passes; parallel with R3/R4 |
| R6 | W5 hardening + W4 student completion | M | R0 | Security checklist and A11Y-01 done before any cohort |
| R7 | W6 observability and ops readiness | M | R1 owners | Alert drill and runbook tabletop done |
| R8 | W7 migration rehearsal + controlled cohort | M–L | R3, R4, R6, R7 | Transport owner go decision |
| R9 | Phased university-wide expansion | M | R8 | Owner approval per phase |

The v1.1 rule stands: decorative UI work waits until R2/R3 prove background tracking and R5 completes authorization.

## 9. Definition of done — university-wide daily use (v1.1 §19, current state)

- [ ] All P0 requirements and core first-release P1 workflows implemented — **open** (DRV-03, ADM-01/02/03/04 remainder, SEC-01–05, OPS-01–04)
- [x] Full role matrix and Rules tests for the built scope pass — extend for every new node
- [ ] Screen-off / background trials pass on each supported real device class — **not started**
- [ ] Cross-device Start → Live → Delayed/Offline → Reconnect → End passes — **web rehearsal pending (W0-03); native pending**
- [ ] No public GPS writes, no hardcoded privileged credentials, working map provider — **W0-04 local automated/build verification passed; server-secret/new-key comparison and live-provider check passed 13 Sep; old-key revocation at ORS remains open (old key still accepted at the last check), so W0-04 is not complete**
- [ ] Migration rehearsal, route data comparison and recovery procedure accepted — **not started**
- [ ] Monitoring, budget alerts, retention cleanup and support ownership ready — **not started**
- [ ] Accessibility/core responsive checks and real driver onboarding completed — **responsive checks done at 390/1440; screen-reader audit and onboarding open**
- [ ] Transport owner validates field operation; project owner approves rollout — **open**

## 10. Risks specific to the remaining work

| Risk | Mitigation / gate |
| --- | --- |
| Driver phone inventory never arrives | R2 spike on loaner devices as feasibility only; no supported-matrix claim; launch decision explicitly blocked |
| OS background restrictions and vendor battery savers on the fleet's Android phones | NAT-02/NAT-09 onboarding, measured trials per device class, visible indicator, honest heartbeat expiry |
| Rules complexity grows with buses, versions, assignments | Emulator test matrix as a gate; both Rules copies edited by script; publish only after tests |
| Retention job needs a trusted identity that the request path deliberately does not have | Job-only service identity, never loaded by the API request path; documented in the runbook |
| Canonical bus key migration touches memberships, routes and tracking at once | Script with a dry-run collision report; run during a no-trip window; rollback = restore |
| Scope creep into "Later" items (ETA, notifications) before gates | This document is the Now list; changes recorded here, not slipped in |
| New screens drift from the design system | `DESIGN.md` is normative for every new surface; review captures at 390 and 1440 |

## 11. Sources

- `docs/Delivery-Status.md` §2–§5 — current status, requirement matrix and decisions log
- `docs/PU-Transit-PRD.md` v1.1 — original requirements, tracking contract, security and rollout policy
- `docs/Phase-2-Reliable-Tracking.md` — implemented tracking contract
- `docs/Firebase-Setup.md` — Rules publication procedure
- `artifacts/pu-transit/DESIGN.md`, `artifacts/pu-transit/PRODUCT.md` — visual system and product truth for new surfaces

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 2.0 | 2026-09-12 | First remaining-work PRD after Phase 3: eight workstreams, decisions register, data-model deltas, open acceptance scenarios, delivery order and current definition-of-done state |
| 2.0 | 2026-09-13 | W0-04 local automated/build verification passed ([evidence](evidence/2026-09-13-w0-04-ors-proxy.md)); server-secret/new-key comparison and live-provider check passed 13 Sep; old-key revocation at ORS remains pending (old key still accepted at the last check); W0-03 remains pending after skipped device intake |

*PU Transit — Remaining Work PRD · 13 September 2026 · Proposal/status record; nothing here is a claim of published or fully complete functionality.*
