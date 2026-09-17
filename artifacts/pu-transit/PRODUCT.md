# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The current product remains the **PU Transit web app**. Native driver tracking
is later work. The owner reports that the official Play app is being
discontinued; this is owner-reported and not independently verified here.

## Users

- **Students and staff of Parul University (Vadodara)** — at a bus stop or about to leave for one, on a phone, usually outdoors in daylight, often on a slow mobile connection. Job: "Where is my bus right now, and can I trust that answer?"
- **Bus drivers** — parked before and after a trip, phone in hand for a few seconds. Job: start sharing when duty begins, stop when it ends, and see that sharing is actually working. No interaction while driving.
- **Transport admins** — at a desk, sometimes on a phone. Job: keep routes, memberships, driver–bus assignments and the live fleet in order; unstick trips; answer "who changed what".

## Product Purpose

Show the current position and honest status of Parul University buses inside the Vadodara service area to verified university members. Success: a member finds their bus by shift and bus number, sees its stops in order, and knows within seconds whether the position shown is live, delayed, weak, offline, ended or not started — and how old it is. Drivers start and end a trip in one step each. Admins see fleet state and fix operational problems without touching the database by hand.

## Positioning

Every status the product shows is derived from server-validated data: sample freshness, GPS accuracy and trip ownership (one active publisher per bus, explicit Start/End). It never shows "Live" because a button was pressed. Access is normally gated by a verified `@paruluniversity.ac.in` email plus an approved membership, with the owner-approved 30-day personal-email grace for new students enforced by Rules/API.

## Operating Context

- Web app (React + Vite) used on phones by students and drivers, on desktop and phones by admins.
- Express API forwards verified Firebase ID tokens to Firebase Realtime Database; Rules enforce the same policy independently.
- Map: MapLibre vector basemap (OpenFreeMap), locked to the Vadodara bounds; raster OpenStreetMap fallback where WebGL2 is missing.
- Admin route creation uses the server-only OpenRouteService proxy; the browser has no ORS key and makes no provider calls. Local automated/build verification passed ([W0-04 evidence](../../docs/evidence/2026-09-13-w0-04-ors-proxy.md)); server-secret/new-key comparison and live-provider check passed 13 Sep; old-key revocation at ORS is still pending (the old key was still accepted at the last check), so W0-04 is not complete. No published rollout claim is made. Missing server configuration is a visible failure, and provider failure never synthesizes or substitutes road geometry.
- Shifts: "First Shift", "ADM / Medical Shift", "General Shift". Buses are identified by registration number (e.g. GJ-06-XX-1234).
- Tracking contract: sample every ~5 s, heartbeat every 15 s; Live = sample ≤30 s old with accuracy ≤100 m; no heartbeat for 90 s = Offline. Browser-based tracking only for now.
- W0-04 local contract: `POST /api/geo/geocode` accepts `{query}` (partial text) and returns `{places:[{name,detail,lat,lng}]}` — up to 8 Vadodara-boxed autocomplete suggestions, empty when nothing matches (14 Sep: replaced the single `{point|null}` answer so the route builder can suggest places while typing); `POST /api/geo/directions` accepts `{start:{lat,lng},end:{lat,lng}}` and returns `{path:[{lat,lng}]}`. Both are admin-only behind Firebase token, verified-email and approved-active-membership checks; finite coordinates, Vadodara bounds and provider timeouts are guarded, with 503 when the server secret is absent. Local automated/build verification passed ([evidence](../../docs/evidence/2026-09-13-w0-04-ors-proxy.md)); server-secret/new-key comparison and live-provider check passed 13 Sep; old-key revocation at ORS is still pending (the old key was still accepted at the last check), so W0-04 is not complete. Manual map-click routes remain allowed. No published rollout claim is made.

## Capabilities and Constraints

- Roles: visitor, pending/inactive member, student, staff, driver and admin. Sign-up offers all four requested roles; PU student/staff are approved immediately, while driver/admin requests remain student plus `requestedRole` until office confirmation in Admin → Users. A new personal-email student has a 30-day grace period from membership `createdAt`, must switch to a verified university email from Account, and never loses the existing membership. No automatic suspensions.
- Student: search by shift + bus number, route (origin, destination, ordered stops, road path), live marker only under the tracking contract, last-update age, explicit status states.
- Driver: sees only the assigned bus; Start / End trip; states: idle, starting, acquiring, live, delayed, weak GPS, GPS unavailable, offline, stopping, pending end, recovery, conflict.
- Admin: Fleet status (all bus feeds), Routes (create/edit/delete with map-click stops and server-proxied road geometry; route kind includes `shuttle`), Users (memberships and office confirmation), notices (create/delete, ≤280 characters and ≤30 days), System, About / Help.
- Add-ons use direction `toCampus` / `fromCampus` and a `full` flag. Payments and passes are excluded. Hindi/Gujarati driver UI is intended; native-speaker review is pending.
- No ETA claims. No historical GPS trails. No student location stored server-side; "my location" is on-device and opt-in.
- Phase 3 (operations completion): normalized bus search listing all matches, stop list always in text, opt-in "my location", admin force-end of a stuck trip, assignment from known bus numbers with duplicate warning, route edit/delete locked while a trip is active, route search, always-visible touch actions, append-only audit log, driver preflight checklist and battery hint; legacy `driverStatus` path removed.
- Later/pending: native background tracking and route versioning; data retention policy (needs university approval); native-speaker review of Hindi/Gujarati driver UI.

## Brand Commitments

- Name: **PU Transit**, tagline **"Find your bus. Every day."**, by and for Parul University. The university's round badge is the identity anchor: `public/logo.png` (256 px, cut from the owner's screenshot of the university's existing app on 12 Sep 2026 — no vector original exists; ask the owner for one before printing or scaling it up). It lives in the app bar (phone top band, desktop rail top) and the favicon, never inside page content.
- Palette is pinned to PU blue (owner's reference, 12 Sep 2026: blue app bar, white cards on a cool-grey ground, red errors), not indigo. Shipped as `#0A76D6` with white ink — the reference's lighter blues fail 4.5:1 for small white text — on a `#F6F7FB` ground with `#0F1B2D` ink; faults are crimson `#AE2338`. The owner chose colour only: Metro tile structure, type and motion stay.
- The login/account flow behaviour is approved and must not change; its look may.

## Evidence on Hand

- No ridership numbers, testimonials, photos, press or usage data exist. Do not fabricate any.
- Real routes and memberships live in the owner's Firebase project; the development database is empty. Demonstration data must be labelled synthetic.
- Specification: `docs/PU-Transit-PRD.md`; audit: `docs/PU-Transit-Audit.md`; tracking contract: `docs/Phase-2-Reliable-Tracking.md`; setup: `docs/Firebase-Setup.md`.

## Product Principles

1. Truth over reassurance: every status is derived from validated data and shows its age; never imply certainty the data does not have.
2. Glanceable outdoors: the answer to "where is my bus" is readable in one look on a phone in sunlight.
3. One-step duty: drivers start and end with one large action and can see that sharing works; nothing to type or confirm while driving.
4. Access by policy, not by interface: gating is enforced server-side; the interface explains the state (pending, suspended) instead of hiding features.
5. Small and boring where it can be: reuse the platform and existing pieces; add abstraction only when evidence demands it.

## Accessibility & Inclusion

Target WCAG 2.2 AA: status conveyed in text, never colour alone; touch targets ≥44×44 px; visible focus; keyboard-usable admin; 200% text zoom; reduced motion respected; mobile widths 360/390 px; a non-map equivalent for all route information. Many users are first-generation smartphone users reading English as a second or third language: short words, no idioms.
