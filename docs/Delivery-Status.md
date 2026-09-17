# PU Transit — Delivery status and grading notes

> Moved from the repository README on 17 Sep 2026; the README now describes the system, this file keeps the dated requirement-by-requirement status, run notes and decisions log. Relative links below are resolved from `docs/`.

Bus-route lookup and live tracking for Parul University, Vadodara.

**Delivered state — 14 September 2026:** this repository contains a React/Vite web
application, an Express API backed by Firebase Auth and Realtime Database, and an
Expo native-driver **feasibility build**. It is a code delivery, **not a completed
production rollout or a field-validated native release**.

| Delivered in the repository | Current boundary |
|---|---|
| **Student/staff web:** bus/shift search, published routes, ordered text stops, map, explicit tracking states and update age, opt-in personal location | Protected data requires an eligible Firebase account and matching membership; no ETA or historical trail is offered. |
| **Driver web:** assignment/preflight checks, Start/End, single-publisher tracking, GPS/network feedback and offline pending-End recovery | The browser must remain foregrounded. Screen-off/background tracking is not promised. |
| **Admin web/API:** bus registry, route drafts/publish/version/archive, retry-safe route creation, dated assignments, handover/force-end, memberships/expiry, notices, service calendar and audit | Newer Rules-dependent flows need the matching Rules payload published. Live force-end/audit observation is still pending. |
| **Native driver source:** shared tracking contract, permission/preflight flows, background-location integration and evidence export | No completed phone/screen-off rehearsal or supported-device matrix; this is not a shipped store app. |
| **Automated verification:** local API **97/97** and Rules emulator **26/26** on 14 Sep 2026 | [Individual results and AC-ID index](evidence/README.md); these do not establish device behavior or production readiness. |

**Not completed:** publication of the current 13–14 Sep Rules amendments; the
[W0-03 live web rehearsal](evidence/rehearsal-log-w0-03.md);
[NAT-01 screen-off rehearsal](evidence/rehearsal-log-nat01.md); production-auth
validation; old ORS-key revocation; and scheduled production retention/remaining
operational rollout gates. The [12 Sep Rules publication](evidence/2026-09-12-w0-01-rules-publish.md)
is a historical owner-reported event, not confirmation that today's payload is live.

**Grading / local run:** follow [§8 — Running the project](#8-running-the-project).
Run **`pnpm demo`** for isolated local student/driver/admin sign-in with synthetic
Firebase Auth + RTDB emulator data and no owner credentials. Live-system checks
still require approved accounts and published Rules; the demo does not alter them.

Requirements and future work are tracked separately in the
[PRD](PU-Transit-PRD.md) and [Remaining-Work PRD](PU-Transit-PRD-Remaining.md).
Historical counts below are labelled by date and are not a current release-completion score.

---

## Contents

1. [What the product does](#1-what-the-product-does)
2. [Progress at a glance](#2-progress-at-a-glance)
3. [Requirement-by-requirement status (PRD §6)](#3-requirement-by-requirement-status-prd-6)
4. [Status of the other PRD sections](#4-status-of-the-other-prd-sections)
5. [What is remaining](#5-what-is-remaining)
6. [Architecture](#6-architecture)
7. [Repository layout](#7-repository-layout)
8. [Running the project](#8-running-the-project)
9. [Firebase setup and Rules publication](#9-firebase-setup-and-rules-publication)
10. [Testing and verification](#10-testing-and-verification)
11. [Decisions log](#11-decisions-log)
12. [Documents](#12-documents)

---

## Current owner amendment — 13 Sep 2026

This amendment is authoritative for current access and product direction; dated
12 Sep entries remain history. Sign-up has a student/staff/driver/admin role
picker. PU student/staff are approved immediately. Driver/admin requests are
approved as student plus the requested role until the office confirms them in
**Admin → Users**. A new student may use a personal email for 30 days from
membership `createdAt`, enforced by Rules/API, then must switch to a verified
university email from **Account**. Existing memberships are never wiped or
recreated, and there are no automatic suspensions.

The established root account remains protected; future privileged-user
confirmation is handled in Users, not by new Firebase Console promotion
instructions. Current add-ons are `toCampus` / `fromCampus` and a `full` flag;
route kind includes `shuttle`; admins create/delete notices no longer than 280
characters and 30 days; About/Help is included. Hindi/Gujarati driver UI
awaits native-speaker review. Payments and passes are excluded. PU blue stays
`#0A76D6`, not indigo. Implementation/publication distinctions and pending
owner actions are recorded in the dated evidence file.

## 1. What the product does

| Role | What they can do today |
|---|---|
| **Student / staff** (approved membership; university email normally required, with the new-student personal-email grace policy) | Pick a shift (First / ADM-Medical / General), enter a bus number, see the route (origin, destination, road path) on a Vadodara-locked map, and see the bus marker **only when the tracking contract is satisfied**, with the age of the last update and an explicit state (not started, acquiring, live, delayed, weak GPS, GPS unavailable, offline, ended, conflict, data-load failure). |
| **Driver** (membership with `role = driver` and an eligible assignment) | Selects an eligible standing/dated assigned bus before Start; cannot change the bus mid-trip. **Start trip** / **End trip**. The page shows GPS quality, connection state, last successful sync, and truthful states (acquiring before "live", pending-end when offline, conflict when another device owns the trip). Tracking runs in the foreground browser. |
| **Admin** (membership with `role = admin`) | **Fleet** (registry, feeds, force-end/handover), **Routes** (draft/edit/publish/version/archive, map-click stops and server-proxied road geometry; delete only never-published drafts), **Users / Assignments** (role confirmation, membership expiry, standing/dated assignment), **Notices / Calendar**, **System** (audit and legacy import), plus Rules helper on `/setup`. |

What it deliberately does **not** claim: no ETA, no historical trails, no "Live" just because Start was pressed, no student location stored on the server, and no background tracking when the driver's phone screen is off (that needs the native app — see Phase 4).

---

## 2. Progress at a glance

| Phase | Scope | Status |
|---|---|---|
| **Phase 1 — Port to Replit** | Imported Vercel/static React app, pnpm monorepo, Express API, React + Vite web artifact | ✅ Done |
| **Audit + PRD** | `docs/PU-Transit-Audit.md`, `docs/PU-Transit-PRD.md` v1.1 | ✅ Done |
| **Identity and data foundation** (PRD Stage B) | Firebase email auth, email verification, approved-domain check, membership lifecycle, RTDB Rules, token-forwarding API, admin Users tab, legacy shared-password login retired | ✅ Existing foundation; 13 Sep access-model amendment (personal-email grace, requested roles and no auto-suspension) is not yet published |
| **Phase 2 — Reliable bus tracking** | Atomic `tracking/{busId}` model, single publisher per bus, start / sample / heartbeat / end API, freshness- and accuracy-derived states, pending-end durability, student and fleet views | ✅ Done — Rules published 12 Sep 2026. ⚠️ A real driver Start → Live → End on a phone against the live database has **not** been rehearsed yet (owner deferred it). |
| **Map provider** | OpenFreeMap vector tiles (MapLibre inside Leaflet), raster OSM fallback, map locked to Vadodara bounds | ✅ Done |
| **Phase 3 — Operations completion + redesign** (PRD Stage D) | Scope agreed 12 Sep 2026 (see §5). Built 12 Sep 2026: normalized search, text stop list, opt-in location, driver preflight checklist, force-end with audit, assignment conflict confirm, route locks/search/confirm, append-only `audit` node, "Metro typographic tiles" redesign (`artifacts/pu-transit/DESIGN.md`) | ✅ Built and reviewed; bundled Rules published 12 Sep 2026. Live driver rehearsal (including the first real force-end) still pending |
| **Phase 4 — Native driver tracking** (PRD Stage C) | Feasibility source, shared contract, permissions, indicators, preflight and evidence tooling | Built as a feasibility app; real-device/background acceptance **not run**, build/device path pending |
| **Operational hardening, rehearsal, rollout** (PRD Stages E–F) | Rate/request limits, security checks, retention code, then observability/backups/rehearsal/rollout | Partially implemented and locally tested; scheduled retention, remaining operations gates and production rollout pending |

**Historical counts — 12 Sep 2026 baseline only.** Later additions and partial
implementation are recorded in the dated evidence and requirement rows, not
recounted in this table:

| Area | Total | Done | Partial | Not started |
|---|---|---|---|---|
| Access and identity (AUTH) | 6 | 5 | 1 | 0 |
| Student / staff (STU) | 7 | 4 | 2 | 0 (+1 deferred) |
| Driver (DRV) | 9 | 8 | 0 | 1 |
| Admin (ADM) | 9 | 4 | 4 | 0 (+1 deferred) |
| **Total** | **31** | **21** | **7** | **1 (+2 deferred)** |

---

## 3. Requirement-by-requirement status (PRD §6)

This is the dated implementation ledger, not a production acceptance checklist.
The delivered-state summary above and [evidence index](evidence/README.md)
distinguish built code from publication and device verification.

Legend: ✅ Done · 🟡 Partial · ❌ Not started · ⏸ Deferred by decision

### 3.1 Access and identity

| ID | Pri | Requirement (short) | Status | Notes / where |
|---|---|---|---|---|
| AUTH-01 | P0 | Authenticated identity + approved membership; verified university email is required normally, with the owner-approved 30-day personal-email grace for new students | 🟡 | The 13 Sep amendment requires grace from membership `createdAt`, Account email switching, and matching Rules/API enforcement. New payload is not published. |
| AUTH-02 | P0 | Pending / active / suspended / expired membership states; verification-pending ≠ approval-pending | ✅ | `pending`, `approved`, `rejected`, `suspended` + `active` flag, the two "pending" reasons shown separately, and **expiry** (IDN-01, 14 Sep 2026): optional `expiresAt` (UTC ms) on the membership; Rules and API refuse protected access once it passes (403 `MEMBERSHIP_EXPIRED`), clients show **expired** with the same way back as suspended; only admins set, extend or clear it (Users tab "access until"). |
| AUTH-03 | P0 | Drivers/admins confirmed by an authorized operator only | 🟡 | Signup can request a role, but driver/admin remains student + requested role until office confirmation in Users; the amendment's Rules/API publication is pending. |
| AUTH-04 | P0 | Membership and role changes apply to backend and database rules, not just UI; no automatic suspensions | 🟡 | Existing enforcement remains; the amended grace deadline may deny protected access without silently setting `suspended`. New payload is unpublished. Revocation reaches an open tracker view within one poll (AC-18 measured at 0.9–3.7 s, IDN-02, [`docs/evidence/2026-09-14-idn02-revocation.md`](evidence/2026-09-14-idn02-revocation.md)); live re-run after publishing. |
| AUTH-05 | P1 | Sign-out, session-expired handling, provider-appropriate recovery | ✅ | Sign-out, token-refresh/expired handling (`api-session.test.ts`), password reset and re-send verification on the Account page. |
| AUTH-06 | P1 | Consistent web/native auth; verified tokens on API calls; retire shared-password and browser-storage login | ✅ (web) 🟡 (native) | All API calls send Firebase ID tokens. Legacy `/auth/login` and `/auth/session` answer **401 `LEGACY_AUTH_DISABLED`**; the legacy `driverStatus` endpoints are removed (404); no shared password or browser-storage session exists any more. Native (NAT-06, 13 Sep 2026): same Firebase project, same `Authorization: Bearer` header through the shared client, same server gate; native preflight now blocks unverified emails and foreign uids like the web `AuthGate`; sign-out clears the Firebase session, the cached account record and this uid's saved trip / pending-End keys. Credential-free negative cases (no token, forged, expired, unsigned) **pass from the native transport against the live API**; unverified / suspended / sign-out **not run on a phone** — `docs/rehearsal-log-nat06.md`. |

### 3.2 Student / staff

| ID | Pri | Requirement (short) | Status | Notes / where |
|---|---|---|---|---|
| STU-01 | P0 | Normalized bus/route search by shift; consistent spaces/case; list distinct matches, never pick the first duplicate silently | ✅ | Plates are normalized (case, spaces, dashes) before matching; every match is listed as a result tile and only a single match auto-opens. Shift is an optional filter, not a gate (`lib/shifts.ts`, `pages/student.tsx`). |
| STU-02 | P0 | Origin, destination, ordered stops, shift, planned road path; map failure must not remove text route info | ✅ | Origin, destination, shift and the ordered stop list are always rendered as text rows under the map; the map is additive. |
| STU-03 | P0 | Live marker only when ownership, freshness and coordinate quality satisfy the contract; always show last update | ✅ | Live = accepted sample ≤ 30 s old with accuracy ≤ 100 m from the current trip owner; the age of the last update is always shown (`status-aging.ts`). |
| STU-04 | P1 | Distinguish no service, no matching route, not started, acquiring, weak GPS, delayed, offline, ended, data-load failure | 🟡 | All tracking-derived states plus "no matching route" and load failure are distinct and text-based. "No service" comes only from the admin-managed service calendar (`serviceCalendar/{yyyy-mm-dd}`, admin **calendar** tab, 14 Sep 2026): a marked IST date shows riders "no bus service today" with the office's reason and date; days without an entry keep the plain tracking states. Per-route service days are not modelled; the calendar Rules block is part of the unpublished 13/14 Sep payload. |
| STU-05 | P1 | Subscribe only to needed data; release on sign-out/navigation; no duplicate listeners from background tabs | 🟡 | Listeners are scoped to the selected bus / fleet and released on unmount and sign-out (`hooks/use-transit.ts`). Behaviour across multiple background tabs has **not** been verified. |
| STU-06 | P1 | "My location" only on explicit action, on-device only, denial does not block tracking | ✅ | Nothing asks for the phone's location until the "my location" tile on the map is pressed; the position stays on-device; denial shows a message and leaves tracking untouched. |
| STU-07 | P2 | Save a preferred bus/stop | ⏸ | Explicitly deferred until user feedback justifies it. |

### 3.3 Driver

| ID | Pri | Requirement (short) | Status | Notes / where |
|---|---|---|---|---|
| DRV-01 | P0 | Driver sees only authorized assignment(s); Start needs active account, current assignment and serviceable bus | ✅ | Assignment comes from `memberships/<uid>.assignedBusId`; Start is driver-only and bound to that bus in API and Rules. Serviceable bus (FLT-03, 13 Sep 2026): `POST /api/tracking/{busId}/start` answers **403 `BUS_OUT_OF_SERVICE`** (with the reason) or **403 `BUS_NOT_REGISTERED`**, and the Rules Start branch requires `buses/{busId}.status == active` (heartbeats and End of a running trip are untouched). Web and native preflight show a *bus in service* row fed by `/api/auth/me.bus`. Rules payload unpublished. |
| DRV-02 | P0 | Preflight: identity, network, assignment, location services, permissions; actionable failure instructions | ✅ | A checklist (account, bus assignment, network, location services/permission, battery) is shown before Start with a one-line fix for each red item; Start is held until the red lines clear. Native app has the same list plus background permission, a real battery-optimisation check and Android 13+ notifications (NAT-04, not yet run on a phone). |
| DRV-03 | P0 | Native background tracking on the supported device/OS matrix with indicators and disclosures | ❌ | Browser tracking only. Native app is Phase 4 and blocked on the phone inventory. |
| DRV-04 | P0 | One active publisher per bus/trip; concurrent starts cannot both succeed; handover is explicit | ✅ | Single `tracking/{busId}` node with trip ownership (`driverUid`, `tripId`); Rules and the API reject writes from a non-owner; the losing device shows **conflict**. |
| DRV-05 | P0 | "Live" is not shown merely because Start was pressed | ✅ | **acquiring** until the backend has accepted a usable sample. |
| DRV-06 | P0 | End trip stops local collection immediately; acknowledged server transition; offline → "stopped on this phone, sync pending" | ✅ | Local collection stops at once; **pending end** is persisted in localStorage and retried first on reconnect. |
| DRV-07 | P0 | Reconnects, refresh, reload and retries are idempotent; no duplicate or revived trips | ✅ | Idempotent start / heartbeat / end keyed by `tripId`; ended trips cannot be revived (`api-server/src/lib/tracking.test.ts`, `pu-transit/src/lib/driver-tracking.test.ts`). |
| DRV-08 | P1 | Driver sees GPS quality, connection state, last sync, battery guidance; parked use with minimal steps | ✅ | GPS quality, connection state and last sync are on the state tile; the checklist carries the battery/keep-screen-on guidance; Start/End remain single actions. |
| DRV-09 | P0 | Sharing only during explicit active duty; no off-duty tracking; no interaction while driving | ✅ | Tracking exists only between Start and End; nothing else asks for input. |

### 3.4 Admin

| ID | Pri | Requirement (short) | Status | Notes / where |
|---|---|---|---|---|
| ADM-01 | P0 | Create / edit / deactivate buses; validate registration uniqueness and normalized IDs | 🟡 | `buses/{busId}` registry built 13 Sep 2026 (FLT-01/02, [`docs/buses-registry.md`](buses-registry.md)): canonical key = normalized registration, label, `active`/`out_of_service` + reason, duplicate → 409 naming the existing record, deactivation refused (409) while the bus has a live trip, audit row per change, students stop seeing routes of parked buses. Assignment and route pickers read the registry. **Not live:** the Rules payload is unpublished and the migration (`buses:migrate`, report before apply) has not been run. |
| ADM-02 | P0 | Route drafts with origin, destination, ordered stops and ORS road geometry; provider errors cannot silently become straight lines | ✅ | ORS proxy verified 13 Sep ([W0-04 evidence](evidence/2026-09-13-w0-04-ors-proxy.md)); old-key revocation at ORS still pending. RTE-01 (13 Sep 2026, `docs/route-publishing.md`): routes carry `status` (`draft` / `published`) and `pathSource` (`ors` / `manual`); *plot road path* routes through **every stop in order** (`via` waypoints); publishing needs an `ors` path that passes within 150 m of each stop (API + Rules, else **409 `ROUTE_PATH_UNVERIFIED`**) or the admin's *manual path* acknowledgement; drafts are admin-only; riders see **path not verified** on manual and pre-RTE-01 routes. Provider failure still never synthesizes geometry. Rules payload unpublished. |
| ADM-03 | P0 | Preview and publish route versions; active trips keep their version | ✅ | RTE-02 (13 Sep 2026, [`docs/route-publishing.md`](route-publishing.md)): every publish writes an immutable `routeVersions/{id}/{n}` snapshot and bumps `publishedVersion`; edits of a published route wait in admin-only `routeDrafts` until published; Start pins `feed.routeVersions` and Rules freeze it for the trip; riders on that trip see the pinned version (*showing the route this trip started with (vN)*), everyone else the current one (AC-19: API, Rules and web tests). The interim edit lock is retired except for two publishes during a live trip: a route that predates versioning, or one that moves to another bus (409 `ROUTE_LOCKED_ACTIVE_TRIP`). Rules payload unpublished; no device run yet. |
| ADM-04 | P0 | Archive published routes; reject deletion while referenced by an active trip; confirm before deleting drafts | ✅ | RTE-03 (13 Sep 2026, `docs/route-publishing.md`): published routes are archived (`POST /routes/{id}/archive`; hidden from riders, versions and pending draft kept; publish again to restore) and can no longer be deleted (409 `ROUTE_PUBLISHED`, Rules enforce it too); archiving is refused while the bus has a live trip (409 `ROUTE_LOCKED_ACTIVE_TRIP` with the reason); permanent delete only for never-published drafts, behind the consequence-stating inline confirmation. |
| ADM-05 | P0 | Assign driver, bus, route version, service date, shift; detect conflicting assignments | ✅ | Standing bus on the Users tab (conflict confirm names the other driver) plus dated assignments on the **assignments** tab: driver, active bus, published route (sets shift + records the version), service date in IST. Same bus twice or one driver on two buses for a date/shift is refused before saving with the other driver/bus named; today's assignment shows in the driver preflight and admits Start on that bus (`docs/assignments.md`). |
| ADM-06 | P0 | Fleet list/map with live/delayed/GPS-unavailable/offline; force-end or handover only with authorization, confirmation and audit | ✅ | Fleet tiles show every state; admin force-end needs a confirmation with an optional reason, is written server-side, audited, and the driver's phone drops to idle on its next upload (`SESSION_CONFLICT`). **Handover** (ADM-10, 13 Sep 2026) is one confirmed action: `POST /tracking/{busId}/handover` ends the trip and authorizes the named driver (standing bus, or a dated assignment for today) with one audit naming both drivers (`docs/assignments.md`). Rules published 12 Sep 2026; not yet exercised against a real trip (W0-03). |
| ADM-07 | P1 | Search/filter routes, buses, assignments; edit/delete visible on touch and usable by keyboard | ✅ | Routes tab has a text filter (bus number, place, shift); edit/delete are always-visible labelled tile buttons, keyboard reachable. |
| ADM-08 | P1 | Approve/deactivate memberships, provision drivers; show errors, duplicates and expiry clearly | ✅ | Users tab: approve / reject / suspend / reactivate, driver role, bus assignment; API errors are shown. Duplicates cannot occur (one membership per Firebase UID); expiry is the "access until" date on each approved member (AUTH-02). |
| ADM-09 | P1 | Audit: actor, action, target, outcome, server time for privileged changes; no credentials or unnecessary location in logs | ✅ | Append-only `audit` node written server-side for membership changes, route save/delete and force-end (actor, action, target, bounded summary, server time); admin-only read, listed in the System tab. Summaries never contain credentials or coordinates. Rules published 12 Sep 2026. |

---

## 4. Status of the other PRD sections

| PRD section | Status |
|---|---|
| §5 People, responsibilities, access | Roles and gating implemented as specified. Membership approval owner inside the university is still not named (§18). |
| §7 Tracking contract ("what live means") | ✅ Implemented: sample ~5 s, heartbeat 15 s, Live ≤ 30 s with accuracy ≤ 100 m, Delayed 30–90 s, Offline after 90 s without heartbeat, explicit Ended, single owner, pending end. Contract text: `docs/Phase-2-Reliable-Tracking.md`. |
| §8 Architecture | React + Vite frontend and Express API: Firebase Admin Auth verifies ID tokens; RTDB REST requests forward the **user's token**, so Rules still apply. No service-account secret is required by this web/API path or included in the client. Native feasibility source exists; device validation is pending. |
| §9 Firebase data model | `memberships`, `routes`, `tracking` and append-only `audit` exist under the published Rules. `buses`, `assignments` (as separate records) and `routeVersions` do not. Legacy `driverStatus` is gone from the code, the built bundle and the published Rules (denied for every role); the stale node itself is deleted by the owner from the console (W0-02). |
| §10 Security, privacy, lifecycle | Rules and API deny-by-default; only the `@paruluniversity.ac.in` domain; no student location stored; ORS calls and the `ORS_API_KEY` are server-only through the admin-gated geo proxy. **Local automated/build verification passed; server-secret/new-key comparison and live-provider check passed 13 Sep; old-key revocation at ORS is still open (the old key was still accepted at the last check), along with retention policy, backups and data-region decisions.** |
| §11 UX and accessibility spec | Met for the web: text states, touch-visible admin actions, opt-in location, text stop list, confirm-with-consequence before irreversible actions, reduced-motion support. Visual system recorded in `artifacts/pu-transit/DESIGN.md` (product record: `artifacts/pu-transit/PRODUCT.md`); palette re-pinned to PU blue on 12 Sep 2026 from the owner's reference, structure unchanged. Assistive audit of the student flow done 14 Sep 2026 (AC-24: axe clean, one status announcer, focus management, 200 % text / 360 px reflow; [evidence](evidence/2026-09-14-a11y01-audit.md)); real screen-reader run pending. |
| §12 Success metrics and capacity gates | Not instrumented. No analytics or usage counters yet. |
| §13 Acceptance scenarios | Contract scenarios (single publisher, offline end, idempotent retries, state aging, session expiry) are covered by automated tests. **Real-device acceptance (driver phone, screen-off) is not done** and cannot pass until the native app exists. |
| §14 Migration and cutover | An admin-only preview/import of the legacy PostgreSQL routes exists (System tab); it never overwrites RTDB records. No destructive migration and no cutover has been performed or approved. |
| §15 Roadmap | A ✅ (except device inventory) · B ✅ · C ⏳ (Phase 4) · D 🔄 (Phase 3) · E, F ⏳. Note: the PRD advises against decorative UI work before native tracking is proven; the owner chose to run the redesign in Phase 3 anyway — a recorded, deliberate deviation. |
| §16 Operational readiness | Not started (no runbook, on-call owner, quota alerts or incident procedure yet). |
| §18 Open decisions | Still open: driver phone inventory; membership approval owner; retention/privacy policy; fleet size and peak users; provider budgets and data region; native distribution ownership; final acceptance sign-off. Settled: verification method (email + membership), RTDB as the database, Vadodara-only service area, OpenFreeMap basemap. |

---

## 5. What is remaining

### Phase 3 — Operations completion + redesign (historical baseline, agreed and built 12 Sep 2026)

Student
- [x] Normalized bus search (case/spaces) that lists **all** matching routes instead of silently using the first (STU-01)
- [x] Ordered stop list always shown as text next to the map (STU-02)
- [x] "My location" becomes an explicit opt-in button; no automatic permission prompt (STU-06)

Driver
- [x] Preflight checklist before Start with actionable failure instructions (DRV-02)
- [x] Battery / charging guidance on the trip screen (DRV-08)

Admin
- [x] Fleet: **force-end** a stuck trip with confirmation and an audit record (ADM-06) — requires a Rules change
- [x] Assignment picker from existing route bus numbers + warning when two drivers hold the same bus (ADM-05)
- [x] Fleet: **hand over** a live trip to a named driver in one confirmed action — force-end + today's authorization + one audit naming both (ADM-10 / ADM-06) — audit action `tracking.handover` is in the unpublished 13 Sep Rules payload
- [x] Dated assignments (ADM-05 / ASG-01): `assignments/{driverUid}/{date_shift_bus}`, conflict refusal with names, driver preflight/picker on web and native, Rules override branch (`docs/assignments.md`)
- [x] Archive for published routes, permanent delete only for never-published drafts, archive refused while that bus has an active trip; inline confirmation for both (ADM-04 / RTE-03)
- [x] Route versions and publishing (RTE-02 / ADM-03): immutable `routeVersions`, admin-only `routeDrafts`, trips pin their versions, riders see the pinned one (`docs/route-publishing.md`)
- [x] Bus registry (FLT-01/FLT-02): API + Rules + admin Fleet UI + migration planner/report; live migration and Rules publication pending (`docs/buses-registry.md`)
- [x] Start requires a serviceable bus (FLT-03): API 403 + Rules Start branch + *bus in service* preflight row on web and native (`docs/buses-registry.md`)
- [x] Route publish gate (RTE-01): draft vs publish, road path through every stop, *manual path* acknowledgement, rider-visible *path not verified* (`docs/route-publishing.md`)
- [x] Routes search box; edit/delete always visible and keyboard/touch accessible (ADM-07)
- [x] Append-only `audit` node for privileged actions, admin-read-only, shown in the System tab (ADM-09)

Platform
- [x] Remove legacy `driverStatus` (Rules, API stubs, `storage.ts` helpers, tests, System-tab migration import path)
- [x] **One bundled Rules publish** by the owner (force-end permission + `audit` node + `driverStatus` removal) — historical publication on 12 Sep 2026 from the Setup → Rules copy; emulator suite 11/11 on the published file (`docs/evidence/2026-09-12-w0-01-rules-publish.md`). First real force-end + audit row: W0-03 rehearsal
- [ ] **13 Sep access-model Rules amendment** — new payload remains unpublished; after QA the owner publishes the complete payload represented by both code mirrors (see `docs/evidence/2026-09-13-access-model.md`).
- [ ] **W0-04 ORS proxy close-out** — local automated/build verification passed ([evidence](evidence/2026-09-13-w0-04-ors-proxy.md)); server-secret/new-key comparison and live-provider check passed 13 Sep; old-key revocation at ORS is still pending (the old key was still accepted at the last check), so W0-04 is not complete. No published rollout claim is made.
- [x] Redesign of student, driver, admin and login/account surfaces in the chosen visual world ("Metro typographic tiles"; login **behaviour** unchanged); `artifacts/pu-transit/DESIGN.md` written from the built result
- [x] Retheme to the owner's reference (12 Sep 2026): PU blue / white / cool-grey palette, university badge + tagline in the app bar, light basemap; colours and logo only

Explicitly **not** in Phase 3: full route versioning/publish workflow, a separate `buses` registry, preferred stops.

### Phase 4 — Native driver tracking (PRD Stage C; feasibility build only)

- [x] NAT-01 feasibility build: `artifacts/pu-transit-driver` (Expo, single screen, no polish) reusing the shared state machine `lib/driver-tracking` and the unchanged tracking contract; on-device evidence export + `scripts/src/nat01-coverage.ts` report. **Not run on a device yet** — protocol and empty results in `docs/rehearsal-log-nat01.md` (single-device feasibility proof, not a device matrix)
- [x] NAT-02 platform permission flow: Android foreground-service notification + background-location steps, iOS Always + background mode + indicator, in-app purpose statement before each OS location prompt, Start gated on a fresh permission check. **Not reviewed on a device yet** — checklist and empty results in `docs/permission-review-nat02.md`
- [x] NAT-04 native preflight: driver account, bus assignment, server reachability, location services, precise + background location, Android battery-optimisation exemption (`expo-battery`), Android 13+ notifications — one fix line per red row, all rows re-run when Start is tapped, Trip status never says *live* while a row is red. **Not run on a device yet** — section D of `docs/permission-review-nat02.md`
- [x] NAT-05 ownership/idempotency parity: desk protocol for AC-08, 09, 12, 15, 16, 17 on the native build (web driver page as the second publisher, admin force end, airplane mode; AC-08 through the app's *Arm Start timeout* fault injection), per-scenario evidence export analysed by `scripts/src/nat05-parity.ts` (trip attempts, six ownership invariants, timeline). Writing the protocol surfaced a shared-tracker race — Start → End → Start faster than the OS starts collection let the second Start reach the server without a GPS watch — now fixed with a regression test. **Not run on a device yet** — protocol and empty results in `docs/rehearsal-log-nat05.md`
- [x] NAT-06 auth parity: token path, server gate and client gate compared side by side (`docs/rehearsal-log-nat06.md`); native preflight gained the *email not verified* and *account mismatch* rows, `/api/auth/me` is cached per uid, and Sign out now clears the account record and this account's saved trip / pending-End keys (`lib/tracking.ts` `clearTrackingState`). Negative auth cases: `scripts/src/nat06-auth-parity.ts` sends no-token / forged / expired / unsigned tokens through the native transport (**5/5 pass against the live workspace API**), `lib/account-steps.test.ts` covers the membership cases. **Device steps (unverified account, suspended driver, sign-out on a shared phone) not run** — same build-path block
- Confirm the driver phone inventory (Android / iOS / both) — the PRD forbids guessing
- Background location with platform permissions, foreground-service / background-mode indicators and disclosures (DRV-03)
- Screen-off, reconnect and end-of-trip lifecycle proven on real devices (PRD §13 scenarios)
- Same tracking contract and auth tokens as the web (AUTH-06)

### Later (PRD Stages E–F and "Next/Later")

- Observability, quota/budget alerts, retention policy, backups, runbook and incident handling (§10, §12, §16)
- Live rehearsal of a real trip against the live database (deferred by the owner), then migration rehearsal, driver onboarding, controlled validation and university-wide rollout
- ETA work, service notices, preferred stops, notifications, bulk route import, reporting — only with real usage evidence

---

## 6. Architecture

```
Phone / desktop browser
  └─ PU Transit web app (React 19, Vite 7, TypeScript, Tailwind 4, Leaflet + MapLibre)
       ├─ Firebase Auth (email/password, email verification)  ──►  Firebase project pu-transit-f815d
       └─ Express API (artifacts/api-server) ── forwards the user's ID token ──►  RTDB REST
             • web live views poll API feeds; there is no direct web RTDB subscription
             • verifies token + domain + membership on every request
             • tracking start / sample / heartbeat / end (single owner, idempotent)
             • routes CRUD (admin), memberships (admin), legacy-route import (admin)
             • admin-only `/api/geo/geocode` (Vadodara-boxed place suggestions) and `/api/geo/directions` proxying ORS with `ORS_API_KEY`
```

Key properties
- **Policy in three places, database last word:** RTDB Rules (`artifacts/pu-transit/public/firebase-database.rules.json`, mirrored in `firebase/database.rules.json`) are the independent authority; the API and UI re-check but cannot bypass them.
- **Admin Auth verification, user-token database access.** The API uses `firebase-admin` Auth to verify ID tokens, then forwards the user's token for RTDB REST requests; it does not use an Admin database bypass for normal app data. Separate maintenance/migration tools can use service-account credentials. Those credentials are not required by the web/API grading path and must never be included in client code.
- **Tracking model:** one atomic `tracking/{busId}` node with `tripId`, `driverUid`, last sample, accuracy, heartbeat and `endedAt`; states are derived on the client from server timestamps (`status-aging.ts`).
- **Map:** OpenFreeMap "Liberty" vector style rendered by MapLibre GL inside Leaflet (`vector-basemap.tsx`); raster OpenStreetMap fallback when WebGL2 is unavailable; `maxBounds` and a dynamic minimum zoom lock the map to Vadodara (`map-config.ts` → `vadodaraBounds`). Admin geocoding and directions use the server-only ORS proxy; finite coordinates and Vadodara bounds are enforced, provider failure is visible, and no road geometry is synthesized or substituted. Manual map-click routes remain allowed.
- **PostgreSQL** (Drizzle, `lib/db`) still exists from Phase 1 for the legacy `routes` table and the one-time import; it is not the product database.

---

## 7. Repository layout

```
artifacts/
  pu-transit/            Web app (preview path /pu-transit)
    src/pages/           home, account (sign in / sign up / verify), student, driver, admin, setup, not-found
    src/components/      auth-gate, layout/shell, map/{map-view,vector-basemap}, firebase-connection-status, ui/*
    src/lib/             api (token-forwarding client), driver-tracking (re-export of lib/driver-tracking), status-aging,
                         storage (routes API + legacy helpers), ors (geocoding/routing), map-config, firebase
    src/hooks/           use-transit (RTDB subscriptions + aging timers)
    public/              firebase-database.rules.json (canonical Rules), favicon
    PRODUCT.md           Product record for the Phase 3 design process
  api-server/            Express 5 API (port from PORT; 5000 in dev)
    src/routes/          transit (routes, memberships, auth/me, migration), tracking, health
    src/lib/             firebase (token verification, RTDB REST, domain check), tracking (trip transitions), logger
    src/middleware/      firebase-auth (memberOnly / driverOnly / adminOnly)
  pu-transit-driver/     Native driver app, NAT-01 feasibility build (Expo; app/index.tsx, lib/tracking + evidence)
  mockup-sandbox/        Design canvas preview server (not part of the product)
lib/
  api-spec/  api-zod/  api-client-react/   OpenAPI spec and generated clients (Orval)
  driver-tracking/                         Shared tracking state machine (web + native), DOM-free
  db/                                      Drizzle schema for the legacy PostgreSQL routes table
firebase/                database.rules.json (copy), firebase.json (emulator config), firestore.rules (locked down)
docs/                    PRD, audit, Phase 2 tracking contract, Firebase setup guide, NAT-01 / NAT-05 / NAT-06 rehearsal logs, bus registry runbook
scripts/                 workspace scripts (Rules tests, ORS verifier, nat01:coverage)
replit.md                Working notes and decisions for collaborators
```

---

## 8. Running the project

### 8.1 Prerequisites and grading scope

Use **Node.js 24** and **pnpm 10** (checked here with Node 24.13.0 / pnpm 10.26.1).
The commands below use Bash on Linux/macOS or Windows WSL. Start from the repository
root, the directory containing `pnpm-workspace.yaml`.

- **Java 21+** is required for the local Firebase Realtime Database emulator.
- Keep **5173** (web), **3001** (API), **9099** (Auth) and **9000** (RTDB) free.
  Firebase CLI also uses its local hub/logging ports (normally 4400/4500).
- Internet is needed for installation, the CLI's first emulator download and
  map tiles. Demo sign-in and transit data use only the local emulators.
- No PostgreSQL server, `DATABASE_URL`, Firebase cloud login, service-account
  credential, ORS key, owner approval or published Rules are needed for the demo.

Use the **explicitly opt-in, disposable local demo** below for authenticated
grading. It exercises the existing student, driver and admin screens, token
verification, API permissions and checked-in RTDB Rules against synthetic data.
It neither copies live data nor changes the managed Firebase project.

### 8.2 Install and prepare shared packages

```bash
# If pnpm is not installed:
npm install --global pnpm@10.26.1

pnpm install --frozen-lockfile
pnpm run typecheck:libs
```

Use pnpm, not npm/yarn, for this workspace's dependencies. Generated API clients
are checked in; no code generation, Drizzle schema push, Firebase publication or
data migration is required for this local start.

### 8.3 Start the isolated local demo

From the repository root:

```bash
pnpm demo
```

Open **http://127.0.0.1:5173/** after startup. The command starts the existing
Firebase CLI Auth + RTDB emulators under the non-cloud project
**`demo-pu-transit`**, seeds synthetic accounts/data, and runs the web and API.
No `firebase login`, `.env` file, local Vite config, migration or Rules
publication is required. Do not enter real account credentials in the demo.

Vite forwards same-origin **`/api`** requests to the local API on port 3001.
Firebase browser Auth connects to `127.0.0.1:9099` before any sign-in or token
refresh. The API verifies emulator ID tokens with the Firebase SDK, then sends
the user's token to RTDB on `127.0.0.1:9000` in the
`demo-pu-transit-default-rtdb` namespace. The checked-in
`firebase/database.rules.json` still decides read/write access; only the
one-time synthetic seed uses emulator administration privileges.

The launcher supplies the explicit flags `PU_TRANSIT_DEMO=1` and
`VITE_PU_TRANSIT_DEMO=1`, `NODE_ENV=development`, the demo project and fixed
loopback emulator addresses. It does not pass application secrets to its
children. Missing/mismatched configuration is rejected, not replaced with live
Firebase. Demo builds/previews and non-local browser hosts are rejected.

**Stop/reset:** press Ctrl+C. Nothing is exported or persisted to disk; start
`pnpm demo` again for fresh data. The seed refuses an already populated
namespace instead of overwriting it. Do not run another demo or Rules-test
emulator on the same ports at the same time.

### 8.4 Demonstrate all three roles

These are **public, synthetic emulator-only accounts**, not live credentials.
All use the demo password **`DemoTransit123!`**.

| Role | Sign-in email | What to try |
|---|---|---|
| Student | `student@paruluniversity.ac.in` | Open `/student`, find BUS1 and inspect its published route. |
| Driver | `driver@paruluniversity.ac.in` | Open `/driver`; BUS1 is assigned and serviceable. Allow local browser location access, start a trip, then end it. |
| Admin | `admin@paruluniversity.ac.in` | Open `/admin`; inspect Users, Fleet and Routes, edit a synthetic record, and confirm it after reload. |

Use Account → sign out between roles, or separate browser profiles. Demo
sessions are tab-local and cannot reuse a live-project login. A student must
not gain admin/driver actions just by entering their URLs. The initial data
includes verified approved memberships, buses and a published manual route.
The bus is initially idle: a live location appears only after the driver
shares one. Desktop GPS availability is device-dependent; this is not a
native/background-tracking rehearsal.

For a routing sanity check from another terminal:

```bash
curl -i http://127.0.0.1:5173/api/healthz
# HTTP 200, {"status":"ok"}
curl -i http://127.0.0.1:5173/api/routes
# HTTP 401, code AUTH_REQUIRED (no token)
```

A 200 HTML response instead of JSON is not a passing API check. Health only
proves HTTP routing. If either emulator becomes unavailable, protected
operations fail; the app does not reconnect to production Firebase.

### 8.5 Firebase accounts and optional services

**Without the demo opt-in**, the managed app remains pinned to the owner's Firebase project
`pu-transit-f815d`: the public client config is in
`artifacts/pu-transit/src/lib/firebase.ts`, and the API validates the exact
project ID/database URL in `artifacts/api-server/src/lib/firebase.ts`.
Changing just the project/database environment variables does **not** switch
the managed project. Emulator-host variables without demo opt-in are rejected.

Live-system verification, unlike local demo grading, still requires
**owner-approved accounts**. The owner must confirm Email/Password sign-in,
authorized domains, applicable published Rules and suitable test memberships:

- Student/staff: verified eligible email and current approved/active membership;
  the documented new-student personal-email grace policy is enforced.
- Driver: driver role plus an eligible registered, serviceable assigned bus.
- Admin: an existing admin must grant authority through Users; requesting an
  admin role at sign-up is **not** admin access. Do not replace/promote the
  established root account merely to grade the app.

**Normal, non-demo API processes use real Firebase.** Authorized mutations can
change shared data. Do not run imports, cleanup, retention jobs or Rules
publication as demo setup steps. The current 13–14 Sep Rules amendments remain
recorded as **unpublished**; running this demo does not publish them or prove
the live deployment works.

| Variable | Local requirement / behavior |
|---|---|
| `PORT` | Supplied by the demo launcher: 3001 API / 5173 web. Managed workflows retain their existing ports. |
| `BASE_PATH` | Required by Vite; launcher sets `/`. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL` | Demo: `demo-pu-transit`, `http://127.0.0.1:9000`. Managed: the existing exact production allowlist. |
| `FIREBASE_AUTH_EMULATOR_HOST`, `FIREBASE_DATABASE_EMULATOR_HOST` | Demo only: exactly `127.0.0.1:9099` and `127.0.0.1:9000`. |
| `UNIVERSITY_EMAIL_DOMAINS` | API defaults to `paruluniversity.ac.in`; arbitrary changes can disagree with client/Rules policy. |
| `DATABASE_URL` | Required only when a non-demo admin explicitly invokes a legacy PostgreSQL preview/import endpoint. Never required for ordinary startup. Legacy endpoints are disabled in demo mode. |
| `ORS_API_KEY` | Not passed to the demo. Admin geocoding/directions return 503; use the seeded/manual route. Ordinary basemap tiles still work with internet access. In managed use this is a server-only secret, never a `VITE_` variable. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Not required for the web/API grading path; separate maintenance/migration tooling may require it. Do not run those jobs as part of setup. |
| `SESSION_SECRET` | Unused by the token-based API; do not create one for this setup. |

The API reads process environment variables; it does not automatically load an
arbitrary `.env` file. No secret is required for demo sign-in or role operations.

### 8.6 Build and test the submitted web/API

```bash
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/pu-transit run typecheck
pnpm --filter @workspace/api-server run build
PORT=5173 BASE_PATH=/ NODE_ENV=production \
pnpm --filter @workspace/pu-transit run build

pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/pu-transit run test

# Optional: Java 21+, port 9000 free; isolated demo project, no cloud login:
pnpm --filter @workspace/scripts run firebase:rules:test
```

With `pnpm demo` running in another terminal, this repeatable integration check
uses real emulator sign-ins and refreshes, verifies all three API roles, denies
cross-role and direct RTDB mutations, and restores its synthetic bus-label edit:

```bash
pnpm demo:check
```

The demo is development-only, not a publishable build. The build commands above
must run without demo flags. A normal built web preview still needs the managed
same-origin `/api` service; it is not an isolated authenticated grading mode.

Web output is `artifacts/pu-transit/dist/public`; API output is
`artifacts/api-server/dist`. The root `pnpm run build` also visits the other
artifacts, including native/design tooling, so the scoped commands above are the
web/API grading path. Native build/rehearsal instructions are separate in
[NAT-01](evidence/rehearsal-log-nat01.md); an Expo Go preview is not evidence
of background tracking.

The earlier documentation-only check is retained in
[DOC-04 setup evidence](evidence/2026-09-14-doc04-local-setup.md); it predates
this opt-in demo and did not verify emulator sign-in. It is not evidence of live
Firebase publication or a device rehearsal.
The new demo's role, isolation, outage and shutdown results are recorded in
[isolated local demo evidence](evidence/2026-09-14-isolated-local-demo.md).

### 8.7 Troubleshooting / managed workspace

| Symptom | Check |
|---|---|
| `PORT` / `BASE_PATH` missing | Use `pnpm demo`; the launcher supplies both. |
| `DATABASE_URL must be set` | A legacy import was invoked outside demo. Ordinary pages do not need a placeholder URL. |
| `/api` returns HTML / 404 / proxy connection refused | Use `pnpm demo`, not a bare Vite command. Confirm local API startup on 3001. |
| Demo login/protected routes fail | Check that both emulators started and use the synthetic accounts above. Check the launcher log; never add live credentials or weaken Rules. |
| Demo config rejected | Remove manual overrides and run `pnpm demo`. Do not set demo flags on managed workflows or production builds. |
| Geo request returns 503 | ORS may be unconfigured/unavailable; no silent road-path fallback is expected. |
| Emulator cannot start | Install Java 21+, free ports 9000/9099/4400/4500, and allow the CLI's initial emulator download. Startup fails rather than falling back to cloud Firebase. |

Inside this repository's managed Replit workspace, use the existing
`artifacts/pu-transit: web` and `artifacts/api-server: API Server` workflows
for normal development. Their configured preview paths are **`/` for the
web app and `/api` for the API**, with service environment supplied by the
artifacts. The demo does not edit those workflows or their environment. It is
intended for a local checkout opened on loopback, not the managed preview iframe.

---

## 9. Firebase setup and Rules publication

Full guide: [`docs/Firebase-Setup.md`](Firebase-Setup.md).

1. Firebase project `pu-transit-f815d` with **Email/Password** sign-in enabled and the Realtime Database at the URL above.
2. **Rules must be published by the project owner** from the Firebase console. The canonical file is `artifacts/pu-transit/public/firebase-database.rules.json`; the in-app `/setup` page lets an admin download or copy it. Local edits to that file change nothing until published.
3. The protected root account is already established; do not repeat console role-promotion instructions. Future driver/admin confirmation is handled by authorized admins in the Users tab.
4. Rules history: initial policy (memberships + routes) → Phase 2/Phase 3 policy (published 12 Sep 2026). The 13 Sep access-model payload is a new, unpublished amendment; after QA the owner publishes the complete payload represented by both code mirrors via Setup → Console. See [`docs/evidence/2026-09-13-access-model.md`](evidence/2026-09-13-access-model.md).

Rules can be tested offline with the Firebase emulator (`firebase/firebase.json`, database emulator on port 9000, JDK is available in the workspace).

---

## 10. Testing and verification

```bash
pnpm --filter @workspace/pu-transit run test     # web: vitest
pnpm --filter @workspace/api-server run test     # api: vitest
pnpm --filter @workspace/scripts run firebase:rules:test  # isolated Rules emulator
pnpm run typecheck
```

**Evidence collection (DOC-03, 14 Sep 2026):** [AC-ID / requirement index](evidence/README.md)
maps the acceptance scenarios referenced in §4 (PRD §13) to actual reports and gaps.
Fresh local results: [Rules 26/26 and API 97/97](evidence/2026-09-14-doc03-test-results.md),
with individual test results and source hashes. Canonical rehearsal logs are now
under `docs/evidence/`: [W0-03](evidence/rehearsal-log-w0-03.md),
[NAT-01](evidence/rehearsal-log-nat01.md), [NAT-05](evidence/rehearsal-log-nat05.md)
and [NAT-06](evidence/rehearsal-log-nat06.md). **W0-03 and NAT-01 remain NOT RUN**;
collecting their protocols does not satisfy device acceptance or publish new Rules.

Automated coverage
- API: trip transitions (start / sample / heartbeat / end, single owner, idempotency, ended trips cannot revive) — `artifacts/api-server/src/lib/tracking.test.ts`; auth/membership/domain gating and route endpoints — `src/routes/transit.test.ts`.
- Web: driver state machine including offline pending-end — `src/lib/driver-tracking.test.ts`; state aging (Live / Delayed / Offline windows) — `status-aging.test.ts`; token/session expiry handling — `api-session.test.ts`; ORS bounds rejection — `ors.test.ts`; routes storage — `storage.test.ts`.
- W0-04 local verification: backend geo tests **12/12**, frontend geo helper + rendered route-editor tests **11/11**, relevant typechecks, codegen and API/web builds passed; bundle scans found no exposed key or direct ORS reference. Full evidence: [`docs/evidence/2026-09-13-w0-04-ors-proxy.md`](evidence/2026-09-13-w0-04-ors-proxy.md).

Manual / not yet done
- ✅ Owner confirmed in-app that an approved admin can read `tracking` after the Phase 2 Rules publish.
- ✅ Historical: Phase 3 Rules published 12 Sep 2026; Rules emulator suite 11/11 on the published file, live anonymous reads of `driverStatus` / `audit` / `tracking` denied. The in-app force-end and audit-row observation is folded into the live rehearsal below (owner decision).
- ⚠️ No real driver trip (phone GPS → Live on a student's screen → End) has been run against the live database yet.
- ⚠️ No real-device background/screen-off test (needs the native app).
- ⚠️ Pending manual checks: delete the old test fixture with approval; import legacy routes before the live rehearsal; revoke the old ORS key (it was still accepted at the last check); production-auth smoke check remains blocked because the app is not published, with protocol and pre-publish checks in [`docs/evidence/w0-05-production-auth-check.md`](evidence/w0-05-production-auth-check.md); publish the new Rules payload after QA. Local automated/build verification passed, and the new-key comparison/live-provider check passed 13 Sep; see [`docs/evidence/2026-09-13-w0-04-ors-proxy.md`](evidence/2026-09-13-w0-04-ors-proxy.md).
- Map verification note: headless screenshots without WebGL only show the raster fallback; verify the vector map in a WebGL-capable browser.

---

## 11. Decisions log

| Date | Decision |
|---|---|
| Sep 2026 | Target database is the owner's Firebase **Realtime Database** (`pu-transit-f815d`); Firestore locked down; no destructive migration. |
| Sep 2026 | Access = verified university email **and** approved membership; domain `paruluniversity.ac.in`; login/membership flow accepted as-is. |
| Sep 2026 | Reliable tracking chosen as Phase 2; contract in `docs/Phase-2-Reliable-Tracking.md`; Rules published 12 Sep 2026. |
| 12 Sep 2026 | Basemap switched from CARTO (watermarked) to OpenFreeMap vector tiles; map locked to Vadodara bounds. |
| 12 Sep 2026 | Phase 3 scope = operations completion (PRD Stage D cut list in §5) + full visual redesign; route versioning, `buses` registry and preferred stops deferred; legacy `driverStatus` to be removed with one bundled Rules publish. |
| 12 Sep 2026 | Live driver rehearsal deferred by the owner; native app deferred to Phase 4 until the phone inventory is known. |
| 12 Sep 2026 | Redesign constraints: university name/logo are the identity anchor, palette free (current blue is a framework default), login behaviour unchanged, code-first build path. |
| 12 Sep 2026 | W0-01: bundled Phase 3 Rules published by the owner; in-app force-end/audit-row acceptance folded into the W0-03 live rehearsal instead of a separate driver session. Test evidence is collected under `docs/evidence/` from now on. |
| 12 Sep 2026 | Palette re-pinned by the owner from a screenshot of the university's existing app: PU blue on a light ground, colours and logo only — Metro tile structure, type, motion and login behaviour unchanged. Name stays **PU Transit**, tagline "Find your bus. Every day."; logo cut from the screenshot (`artifacts/pu-transit/public/logo.png`, no vector original). |
| 13 Sep 2026 | Owner amendment: web PU Transit continues and native is later; owner reports the official Play app is being discontinued (not independently verified); role-picker onboarding, personal-email 30-day grace from membership `createdAt`, Account email switch, membership preservation, no auto-suspension, Users confirmation, add-ons/notices/shuttle/About/Help and Hindi/Gujarati driver UI direction recorded. New Rules payload is not published; PU blue remains `#0A76D6`. |
| 13 Sep 2026 | W0-04 local implementation and automated/build verification passed ([evidence](evidence/2026-09-13-w0-04-ors-proxy.md)): admin-only Firebase-token + verified-email + approved-active-membership geo proxy for geocoding and directions; finite/bounded inputs, timeout and visible provider errors; no browser ORS key/calls and no geometry fallback. Server-secret/new-key comparison and live-provider check passed 13 Sep; old-key revocation at ORS remains pending because the old key was still accepted at the last check; W0-04 is not complete. |

---

## 12. Documents

| Document | Purpose |
|---|---|
| [`docs/PU-Transit-Final-Report.md`](PU-Transit-Final-Report.md) | DOC-01 submission draft: problem, architecture, v1.1/v2.0 requirements, v2.1 scope triage, security, evidence, limitations and W6/W7 designed-but-not-built future work |
| [`docs/PU-Transit-Demo-Script.md`](PU-Transit-Demo-Script.md) | DOC-02 recording script/checklist: role setup, live/delayed/offline, native or foreground-web branch, End verification and truthful office-audit demonstration; video not yet recorded |
| [`docs/PU-Transit-PRD.md`](PU-Transit-PRD.md) | Product requirements v1.1 — the reference for the status tables above |
| [`docs/PU-Transit-PRD-Remaining.md`](PU-Transit-PRD-Remaining.md) | Remaining-work PRD v2.0 — everything v1.1 asks for that is not built yet: workstreams W0–W7, decisions register, data-model deltas, open acceptance scenarios, delivery order |
| [`docs/PU-Transit-Audit.md`](PU-Transit-Audit.md) | Audit of the imported application before the rebuild |
| [`docs/Phase-2-Reliable-Tracking.md`](Phase-2-Reliable-Tracking.md) | Tracking contract: model, API, frontend controller, activation steps |
| [`docs/Firebase-Setup.md`](Firebase-Setup.md) | Firebase project, Rules publication and bootstrap steps |
| [`docs/ops-notes.md`](ops-notes.md) | Operations notes: API rate limits (sizes, behaviour, verification); incident runbooks and alerting to follow |
| [`docs/evidence/README.md`](evidence/README.md) | AC-ID / requirement index of dated test results, publication records and canonical rehearsal logs; local passes separated from pending device/production acceptance |
| [`artifacts/pu-transit/PRODUCT.md`](../artifacts/pu-transit/PRODUCT.md) | Confirmed product truth used by the Phase 3 design process |
| [`replit.md`](../replit.md) | Working notes, gotchas and architecture decisions for collaborators |
