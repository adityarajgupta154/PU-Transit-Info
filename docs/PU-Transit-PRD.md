# PU Transit — Product Requirements Document

**Version:** 1.1  
**Last updated:** 11 September 2026  
**Status:** Draft — core scope and student/staff verification confirmed; native platform coverage and launch dependencies pending  
**Owner / final approver:** Project owner  
**Audience:** Project owner, implementation team and university transport administrators  
**Decision enabled:** Agree the release scope, architecture, acceptance criteria and implementation order before changing the application or migrating data.

## Authoritative owner amendment — 13 September 2026

This amendment is the current owner decision record. The 11 September PRD
remains history where it conflicts with this section; it is not silently
rewritten into a claim that the proposal was implemented. The product
continues as the **PU Transit web app**. Native driver tracking is later work.
The owner reports that the official Play app is being discontinued; that is
owner-reported and not independently verified in this document.

Current access direction:

- Sign-up has a role picker for **student, staff, driver and admin**.
- PU student/staff sign-ups are approved immediately.
- Driver/admin sign-ups are approved as student plus `requestedRole` until the
  office confirms the requested role in **Admin → Users**. A requested role
  cannot grant authority before that confirmation.
- A new student may use a personal email for 30 days from membership
  `createdAt`. Rules and the API enforce the grace period. The student must
  switch to a verified university email from **Account**; existing memberships
  are preserved and never wiped or recreated.
- There are no automatic suspensions. Protected access may be denied after an
  uncorrected grace deadline without changing membership status to `suspended`.
- The root account is already established and protected. Future driver/admin
  confirmation is handled in Users; this PRD adds no Firebase Console
  promotion procedure.

Current product additions are `toCampus` / `fromCampus` direction and a
`full` flag, route kind `shuttle`, admin-managed notices (create/delete,
maximum 280 characters and 30 days), and About/Help. Hindi and Gujarati driver
UI is intended, pending native-speaker review. Payments and passes are
excluded. The visual primary remains PU blue `#0A76D6`, not indigo.

The implementation/publication distinction and exact post-QA Rules publication
walkthrough are recorded in
`docs/evidence/2026-09-13-access-model.md`. The new Rules payload is not
published as of this amendment; no test run is claimed for this docs-only
update.

## 1. Executive summary

PU Transit ko university ke daily transport use ke liye reliable banana hai: verified students/staff apni bus ki actual available location dekhein, authorized drivers active duty ke dauran location share karein, aur transport admins routes, assignments aur service status manage karein.

Existing React frontend reuse hoga. User-owned Firebase target data platform hai. **Reliable background driver tracking ke liye native driver app required hai; browser/PWA-only tracking is requirement ko satisfy nahi karti.**

Phone lock aur normal background operation supported devices par acceptance-tested honge. Force-stop, permissions revoked, phone off, GPS unavailable aur network loss ke dauran uninterrupted GPS ka promise nahi hoga. App ko in situations mein truthful stale/offline state dikhani hogi.

This document is a proposal for implementation, not a claim that these features already exist. This PRD does not authorize destructive data migration, production rollout or store submission.

## 2. Confirmed decisions vs proposed defaults

| Item | Decision | Status |
| --- | --- | --- |
| Release purpose | Puri university ke daily use ke liye | User confirmed |
| Live-location access | Sirf verified university students/staff | User confirmed |
| Driver tracking | Phone locked / app backgrounded hone par bhi | User confirmed |
| Database ownership | User ka supplied Firebase project | User requested |
| Frontend approach | Existing React app reuse; maintainable component-based UI | Recommended; consistent with request |
| Driver technology | React Native + Expo, with native builds and background-location support | Recommended |
| Firebase services | Firebase Auth + Realtime Database; inspect supplied project first | Recommended, not yet connected |
| University verification | University email verification + approved active membership; both required for student/staff access | User confirmed |
| Driver OS coverage | Actual driver phone list is not yet known | User confirmed unknown; Android-only is not assumed |
| Rollout | Controlled validation followed by phased university-wide expansion | Recommended rollout method, not a reduced product scope |

**Important:** React HTML output aur CSS styling use karta hai. Legacy standalone pages/DOM scripts ko React components replace karte hain; CSS ko entirely remove karna objective nahi hai.

## 3. Problem, evidence and alternatives

### Problem

Student ko “bus abhi kahan hai?” ka trustworthy answer chahiye. Driver ko safe, low-interaction sharing chahiye. Admin ko authorized, accurate and maintainable fleet information chahiye.

Current implementation mein driver login bus ID save karne tak limited hai; GPS writes public hain; old coordinates live reh sakte hain; basemap tiles visibly API-key warnings show karti hain; admin credential source mein hai. Existing tests do not establish real background or cross-device tracking.

Full source references and screenshots: **docs/PU-Transit-Audit.md**.

### Alternatives — hypotheses, not claimed user research

| Alternative | It can cover | Remaining gap |
| --- | --- | --- |
| Timetable / phone calls | Planned schedule and manual updates | Current bus state is not consistently visible |
| Generic location sharing | Ad-hoc position sharing | University roles, route/shift assignment and fleet operations are not inherently covered |
| Existing GPS/fleet provider, if university has one | Potential vehicle-grade continuous tracking | Availability, API access, contracts and integration are unknown |
| PU Transit | University-specific authorized tracking and route operations | Must first prove reliability and operational ownership |

No competitor pricing, user counts or research interviews are claimed.

## 4. Outcomes and non-goals

### Required outcomes

- **G1 — Trustworthy tracking:** show current, delayed, unavailable or ended state honestly.
- **G2 — Controlled access:** unauthenticated, inactive and unapproved users cannot read protected location data or write operational records.
- **G3 — Background reliability:** supported driver phones continue sharing during normal screen-off/background use.
- **G4 — Operational control:** transport admins can manage routes, users, assignments and active-trip problems.
- **G5 — Safe transition:** preserve authorized existing data and retire insecure paths without a silent data-loss event.
- **G6 — Maintainability:** reuse React and Firebase capabilities instead of unnecessary custom infrastructure.

### Not in the first release

- Student native app when a responsive web app satisfies the student flow.
- AI predictions, payments, attendance, ticketing, driver scoring or multi-university SaaS.
- Historical replay of every GPS point.
- Guaranteed arrival times or traffic-aware ETA without a validated method.
- Automatic emergency response, accident detection or safety-critical dispatch.
- Covert, off-duty or student background tracking.
- Guaranteed tracking after app force-stop, permission denial or phone shutdown.
- Promo video or pitch deck as a prerequisite for operational readiness.

## 5. People, responsibilities and access

| Role | Can do | Cannot do |
| --- | --- | --- |
| Visitor | See public product/help/login information | Read protected routes, fleet locations or member data |
| Pending/inactive account | See its own access status and support instructions | Access protected transit data |
| Verified student/staff | Search published service, view authorized bus location and stops, optionally locate themselves locally | Publish GPS, change routes, read driver personal information |
| Driver | Sign in, see own assignment, start/end authorized trip, publish from the active device | Choose arbitrary bus identity, edit routes, publish for another driver |
| Transport admin | Manage operational accounts, buses, routes, assignments and fleet exceptions | Read passwords, silently track drivers off duty |
| Backend service | Validate identities, enforce operations, write trusted records and protected routing requests | Trust client-provided role/ownership assertions |

Sign-up is a role picker (student, staff, driver, admin), not a privilege
grant. PU student/staff access is approved immediately. Driver/admin requests
remain student plus the requested role until an office-confirmed administrator
uses Admin → Users to confirm the privileged role.

Proposed ownership:

- **Driver of delivery:** implementation lead / project owner.
- **Approver:** project owner, one final approval role.
- **Contributors:** transport operations representative, engineering/security representative and driver representative.
- **Informed:** participating students/staff and university IT.

Operational contacts are not yet assigned. University-wide launch requires an accountable transport owner and technical support owner.

## 6. Core journeys and functional requirements

Priority **P0** means must pass before real university use. **P1** means necessary for usable first-release operations. **P2** means later unless evidence changes priority.

### A. Identity and university access

| ID | Priority | Requirement |
| --- | --- | --- |
| AUTH-01 | P0 | Student/staff access requires authenticated identity and active approved membership; verified university email is the normal requirement, with the owner-approved personal-email grace for a new student. A typed roll number, selected role, domain suffix or authenticated token alone is not sufficient. |
| AUTH-02 | P0 | Support pending, active, suspended and expired membership states. Distinguish email verification pending from membership approval pending; neither grants protected access. |
| AUTH-03 | P0 | Drivers/admins are confirmed by an authorized operator. Signup role requests do not grant authority; office confirmation occurs in Admin → Users. |
| AUTH-04 | P0 | Grace deadlines and role changes affect backend authorization and database read rules, not just hidden UI buttons; no automatic suspension is performed. |
| AUTH-05 | P1 | Provide sign-out, session-expired handling and provider-appropriate recovery. Do not expose account existence unnecessarily. |
| AUTH-06 | P1 | Keep web/native authentication consistent. Use verified tokens for retained API calls; retire shared-password and browser-storage “login” paths. |

**Confirmed membership method:** verified university email **and** approved
membership is the normal path. A new student personal email may use the
owner-approved 30-day grace from membership `createdAt`, enforced by Rules/API,
then must switch from Account. Existing SSO is not a first-release
requirement, and an email switch never wipes the existing membership.

### Student/staff onboarding and access lifecycle

1. User registers/signs in and selects a requested role. A new student may begin with a personal email under the 30-day grace policy; the normal long-term path uses a university email checked against an explicit approved allowlist. Do not infer domains from the product name or use loose suffix matching.
2. User completes the identity provider's email-verification flow. Expired links, resend cooldowns and verification failures have clear recovery states.
3. PU student/staff access is approved immediately under the current owner policy. A driver/admin request is approved as student plus `requestedRole` until the office confirms it in Admin → Users.
4. A personal-email student has 30 days from membership `createdAt` to switch from Account to a verified university email. Rules and API enforce the deadline; existing memberships are retained.
5. After an uncorrected deadline, protected access may be denied, but no automatic suspension is performed. A changed email must be reverified and matched before access resumes.
6. A requested driver/admin role never authorizes itself; office confirmation in Users is required.

The exact approved email domains and responsible membership approver are setup dependencies, not guessed values. Phone-platform uncertainty does not block the web/Firebase requirements, but native release scope cannot be finalized without the device inventory.

### B. Student/staff journey

Sign in → access check → select/search bus or route and shift → see route summary/stops → track selected service → receive clear stale/offline information.

| ID | Priority | Requirement |
| --- | --- | --- |
| STU-01 | P0 | Search published routes using normalized bus registration/route identifiers and shift. Handle spaces/case consistently and present distinct matches rather than choosing the first duplicate silently. |
| STU-02 | P0 | Show origin, destination, ordered stops, shift/direction and planned road path. Map failure must not remove the useful text route information. |
| STU-03 | P0 | Show a live marker only when trip ownership, sample freshness and coordinate quality satisfy the tracking contract. Always provide last-update information. |
| STU-04 | P1 | Distinguish no service, no matching route, not started, acquiring GPS, weak GPS, delayed, offline, ended and data-load failure. |
| STU-05 | P1 | Subscribe only to needed route/fleet data; release subscriptions on sign-out or navigation. Background tabs must not create duplicate listeners. |
| STU-06 | P1 | “My location” is optional, requested on an explicit action, remains on-device and is not stored in Firebase. Denial does not block bus tracking. |
| STU-07 | P2 | Save a preferred bus/stop on-device or per account if user feedback justifies it. |

No ETA claim appears in first-release copy unless an implemented, tested estimation method and limitations are provided.

### C. Driver journey

Admin provisions account and assignment → driver signs in → checks assigned bus/shift → reviews permissions → starts trip → background sharing → ends trip and stops collection.

| ID | Priority | Requirement |
| --- | --- | --- |
| DRV-01 | P0 | Driver sees only authorized assignment(s), not an unrestricted bus-ID login. Starting requires an active account, current assignment and serviceable bus. |
| DRV-02 | P0 | Preflight checks identity, network, assignment, location services and required foreground/background permissions. Show actionable failure instructions. |
| DRV-03 | P0 | Native background tracking runs on the supported device/OS matrix with platform-required indicators and permission disclosures. |
| DRV-04 | P0 | One active publisher owns a bus/trip. Concurrent starts cannot both succeed. Cross-device handover requires an explicit controlled action. |
| DRV-05 | P0 | “Live” is not shown merely because Start was pressed. Show acquiring/connecting until the backend acknowledges a usable position. |
| DRV-06 | P0 | End trip stops local collection immediately and completes an acknowledged server transition. If offline, show “Stopped on this phone; sync pending” and prioritize the pending stop on reconnect. |
| DRV-07 | P0 | Reconnects, token refresh, reloads and retries are idempotent and cannot create duplicate trips or revive an ended trip. |
| DRV-08 | P1 | Driver can see GPS quality, connection state, last successful sync and battery guidance. Core actions must be usable while parked with minimal steps. |
| DRV-09 | P0 | Sharing is limited to explicit active duty. No automatic off-duty tracking and no interaction required while driving. |

### D. Admin journey

Sign in → manage authorized people/fleet → create and preview route → publish → assign driver/bus/shift → monitor active trips → handle exceptions.

| ID | Priority | Requirement |
| --- | --- | --- |
| ADM-01 | P0 | Create, edit and deactivate buses; validate registration uniqueness and normalized IDs. Preserve referenced records. |
| ADM-02 | P0 | Create/edit route drafts with origin, destination, ordered stops and ORS road geometry. Invalid inputs or provider errors cannot silently become straight-line road routes. |
| ADM-03 | P0 | Preview and publish valid route versions. Active trips keep their selected version; editing a route does not silently alter a trip already underway. |
| ADM-04 | P0 | Archive published routes; reject destructive deletion while records are referenced by an active trip. Unreferenced drafts can be deleted with confirmation. |
| ADM-05 | P0 | Assign driver, bus, route version, service date and shift/direction. Detect conflicting assignments and reject invalid active-trip ownership. |
| ADM-06 | P0 | View a fleet list/map with live, delayed, GPS unavailable and offline states. Force-end or hand over an active trip only with authorization, confirmation and audit record. |
| ADM-07 | P1 | Search/filter routes, buses and assignments. Edit/delete actions remain visible on touch devices and usable by keyboard. |
| ADM-08 | P1 | Approve/deactivate memberships and provision drivers using the agreed university verification method. Show processing errors, duplicates and expiry clearly. |
| ADM-09 | P1 | Record actor, action, target, outcome and server time for privileged changes; keep credentials and unnecessary location data out of logs. |

All save/delete operations show pending, success and recoverable error states. Failed saves preserve form input; destructive confirmations identify the affected object.

## 7. Tracking contract: what “live” means

These numerical values are **initial engineering targets**, not measured performance or final policy. Validate them on the real routes/device fleet before approval.

### Data recorded per accepted sample

Trip ID, publisher session ID, sequence number, latitude/longitude, reported accuracy, device capture time, trusted server receive time, and optional speed/heading if valid.

- Driver identity and bus ownership are derived from verified auth and active assignment, not accepted from the payload.
- Server receive time is authoritative for arrival; it does not prove when the GPS fix was captured.
- Validate device capture age/clock skew as well as receive time. Fresh receipt of an old queued sample is not fresh GPS.
- Validate finite numbers, latitude −90…90, longitude −180…180, bounded payload size and accuracy. Reject stale/out-of-order samples and writes for ended trips.
- Keep the configured route-planning service area; allow admin-reviewed changes if actual university routes extend beyond it.
- Do not reject a real GPS point solely because the bus is off-route. Flag an anomaly for review; do not automatically accuse the driver.

### Initial timing and quality defaults

| Parameter | Proposed starting value / rule |
| --- | --- |
| Moving GPS sampling/upload | Aim for about every 5 seconds, subject to OS delivery and field measurements |
| Stationary update / heartbeat | About every 15 seconds; a heartbeat must not change the GPS capture timestamp |
| Good-enough positional accuracy | Reported accuracy ≤100 m for a normal live badge; tune after route tests |
| Fresh location window | Valid capture age ≤30 seconds and recent server receipt |
| Delayed location | Last valid position older than 30 seconds; never green “live” |
| Disconnected/offline | No acknowledged heartbeat for more than 90 seconds, or explicitly ended/revoked |
| Clock anomalies | Reject materially future or replayed timestamps; show a recoverable clock/GPS error rather than fabricate freshness |

### Derived states

| State | Condition | Student view |
| --- | --- | --- |
| Not started | Published service without active trip | Schedule/route available; no bus location claim |
| Acquiring / GPS unavailable | Active trip, recent heartbeat, no acceptable fix | Clear status; no fabricated moving marker |
| Live | Active authorized publisher + valid fresh position | Marker, last update and quality information |
| Delayed | Valid sample has aged beyond freshness, connection may remain | Explicitly old, timestamped position; no animation implying movement |
| Weak GPS | Recent reports fail accuracy/quality threshold | Explain weak GPS; do not refresh the last valid point’s timestamp |
| Offline | Heartbeat timeout / connectivity lost | Offline status; no active marker after expiry; timestamped last-seen text |
| Ended | Acknowledged trip end / admin termination | Active location hidden immediately; route information remains |

**Offline behavior:** driver may briefly retain the latest pending sample, not an unbounded trail. After reconnect, prioritize end/revocation state and acquire a fresh fix. Old queued samples must never replay into the live feed as current positions.

**Hard limit:** authenticated software cannot prove that a rooted/spoofed phone reports its physical location honestly. Access control, replay protection and anomaly flags reduce risk; they are not GPS anti-spoof guarantees.

## 8. Recommended architecture

### Keep the architecture small

1. **Student/admin web:** existing React + TypeScript + Vite artifact, responsive CSS/Tailwind, existing useful UI components.
2. **Driver native app:** React Native + Expo with `expo-location` and background task support; native development/release builds for the required capabilities.
3. **Identity:** Firebase Auth with verified university email plus separately approved active student/staff membership.
4. **Database:** supplied Firebase Realtime Database as the proposed single authoritative store. Inspect existing data/products first; Firestore is not added speculatively.
5. **Trusted API:** reuse Express for privileged mutations, trip lifecycle, GPS ingestion and ORS proxy. Validate Firebase tokens and current authorization on every protected operation.
6. **Realtime reads:** web/native clients receive authorized RTDB subscriptions to appropriate read models.
7. **Maps:** keep Leaflet on the web; separately provision basemap tiles and road-routing/geocoding access.

```text
Verified university email + membership approval
                    |
               Firebase Auth
                    |
      +-------------+-------------------+
      |                                 |
React student/admin web          Native driver app
      |                                 |
      +---- authenticated commands -----+
                    |
          Existing Express API
      validation + roles + ownership
          |                     |
     Firebase RTDB          ORS proxy
          |
   authorized realtime views
```

Use one typed API contract for retained server operations. Update OpenAPI/generated clients rather than maintaining disconnected API types. Do not duplicate Firebase subscription state in multiple caches.

### Native background feasibility gate

- Confirm the actual supported OS/device matrix and build/distribution route first.
- Use OS-specific background permissions and modes. Android requires the appropriate foreground service/notification behavior; iOS requires background location mode and the applicable permission flow.
- A browser preview, emulator map or Expo Go foreground demo is **not** evidence that this requirement works in the production app.
- Prove screen-off tracking, token renewal and network recovery on signed/native builds and real devices before building the rest of the mobile polish.
- If the chosen native setup cannot meet the agreed field criteria, decide between another supported native implementation or approved vehicle GPS hardware. Do not quietly downgrade to browser tracking.
- Store/build accounts and distribution approval are launch dependencies. No store acceptance or particular submission date is promised here.

## 9. Proposed Firebase data model

Conceptual model only. Exact paths, indices, limits and migration mappings must be checked against the supplied Firebase project.

| Entity / suggested path | Purpose | Visibility and writer |
| --- | --- | --- |
| `memberships/{uid}` | Role, status, validity, approved institution reference and approved email binding | Self-safe subset; admins; trusted backend writes |
| `buses/{busId}` | Registration, display label, service status | Safe directory for active members; backend writes |
| `routes/{routeId}` | Display identity, draft/published/archive status, current published version | Published subset for active members; backend writes |
| `routeVersions/{versionId}` | Immutable ordered stops and road geometry | Authorized readers; backend publishes |
| `assignments/{assignmentId}` | Driver, bus, route version, service date and shift | Assigned driver/admin; backend writes |
| `trips/{tripId}` | Lifecycle, ownership, route version and start/end metadata | Driver/admin as needed; backend writes |
| `activeTrips/{busId}` | Active trip and publisher ownership reference | Protected operational access; conditional backend updates |
| `liveLocations/{tripId}` | Latest accepted sample and heartbeat metadata | Driver/admin operational view; backend writes |
| `studentFeed/{busId}` | Sanitized active status/location without driver UID/contact details | Active university members only; backend writes |
| `auditEvents/{eventId}` | Privileged actor/action/target/time/outcome | Authorized admins/operators; append through backend |

Rules and invariants:

- Default-deny database rules; no broad public root reads.
- Direct client writes to operational records are denied in this proposed architecture. All writes pass through the verified API.
- Firebase Admin SDK bypasses client Security Rules; therefore **API validation and authorization are mandatory**, not optional.
- Database read rules check current active membership as well as identity. Student/staff reads also require verified email, approved domain and matching approved email binding. Do not depend only on a stale role claim.
- At most one active trip/publisher per bus, and no conflicting active trip for a driver.
- Starting/handover must use transactional conditional ownership, not “read, then later write”. Race tests prove the invariant.
- Trip state and student-facing feed transitions stay consistent. Do not acknowledge End before the authoritative state/feed update succeeds.
- Idempotency keys and publisher sequence checks make retries safe.
- Do not attach listeners to the entire database. RTDB Rules are not result filters; structure paths/queries to match authorization.
- Date/time values stored in UTC; service dates/shifts displayed in Asia/Kolkata. No automatic trip start from a schedule.

`onDisconnect` may supplement presence, but connection presence alone does not prove fresh GPS. Server-observed heartbeats and timestamp-based derived status remain required.

## 10. Security, privacy and data lifecycle

### Launch-blocking controls

- Remove shared hardcoded admin credentials and public GPS-write routes; revoke exposed credentials with the owner.
- Keep ORS key and Firebase service-account/private credentials in secure server configuration. Do not place them in source, frontend bundles or reports.
- Firebase web configuration is client initialization data, not authorization; secure access with identity, Rules and API enforcement.
- Use TLS, verified token issuer/audience, token expiry handling, least privilege and current membership checks.
- Rate-limit login-sensitive endpoints and mutation/GPS traffic with limits suitable for expected fleet traffic. Bound request sizes and validate arrays/strings as well as coordinates.
- If any cookie session remains, explicitly configure secure proxy handling, a production-suitable session store, SameSite/origin/CSRF policy and persistence tests. Prefer retiring the legacy admin-session path after Firebase Auth acceptance.
- Admin accounts require stronger protection using the selected identity provider’s supported MFA/step-up approach; provider availability is a pre-launch dependency.
- App attestation/App Check can supplement abuse controls after compatibility verification. It never replaces authorization.
- Do not log passwords, tokens, service credentials or routine raw GPS payloads. Use non-sensitive event IDs and aggregate operational metrics.

### Privacy

- Only approved active university users can receive live locations.
- Students do not see driver private identity/contact details in the live feed.
- Student personal location stays on-device and is optional.
- Drivers receive a clear purpose statement, visible active-tracking indication and an explicit Stop control.
- No off-duty tracking. Network loss may delay remote confirmation of Stop; communicate this honestly and expire the feed.
- Do not persist protected live data in a public/shared-device offline cache. Clear app-held private state on sign-out where possible; previously viewed data cannot be remotely “unseen”.

### Retention proposals — need university approval

| Data | Minimal proposed policy |
| --- | --- |
| Live GPS sample | Overwrite latest point; hide at acknowledged trip end; remove private residual sample within 24 hours |
| Trip metadata, not a full GPS trail | Up to 30 days for operational troubleshooting |
| Admin/security audit events | Up to 90 days, limited authorized access |
| Membership/profile data | Retain only while operationally required; university policy determines deletion/expiry |
| Backups | Defined retention, restricted access, deletion schedule and tested restoration |

Use an explicit scheduled cleanup mechanism; merely adding an expiry field does not delete RTDB records. University/legal review must approve policy and notices before launch. No legal-compliance certification is claimed.

## 11. UX and accessibility specification

### Student — mobile first

- Compact bus/route and shift search; readable route result.
- Map/list switch; ordered stops work even if map tiles fail.
- Status written in text, not only color; last update is visible.
- Sign-in, email verification pending, membership approval pending, suspended/expired access, loading, empty, no match, stale and error states designed explicitly.
- No mandatory student geolocation permission on page load.

### Driver — operate while parked

- Assigned bus/shift above primary action.
- Large, labeled Start/End controls and visible tracking indicator.
- Permission/recovery instructions for the actual platform, with no misleading “Live” success toast.
- No workflow that asks a moving driver to type, confirm frequently or inspect small map details.

### Admin — operational desktop and usable mobile

- Searchable fleet/route/assignment list, clear statuses and intentional destructive actions.
- Route editor shows draft, preview, publish and save-failure states.
- Touch-accessible edit actions; no hover-only controls.
- Preserve a draft when a provider/request fails and warn before leaving with unsaved edits.

### Accessibility and performance baseline

- Aim for WCAG 2.2 AA for web flows: semantic labels, keyboard traversal, focus management, visible focus and adequate contrast.
- Prefer 44×44 touch targets; provide accessible names for every icon action.
- Test 200% text zoom, reduced motion, mobile safe areas and screen-reader status announcements.
- Provide a non-map equivalent for route/stop information.
- Load heavy map code only where needed; optimize based on measured performance, not speculative abstractions.
- Supported web viewport checks: 360/390 px mobile, tablet and desktop widths. Native checks use the agreed real device matrix.

Brand direction: retain the recognizable PU Transit blue identity and existing useful primitives. Prioritize legibility and status clarity over a decorative redesign.

## 12. Proposed success metrics and capacity gates

These are targets to validate, not claims about the current app. No production baseline, fleet size or usage analytics have been provided.

| Metric | Proposed target / release gate | Measurement |
| --- | --- | --- |
| Unauthorized access | All defined negative authorization cases denied | API and Firebase Rules test matrix |
| Active-publisher ownership | Zero successful conflicting publishers in race tests | Concurrent Start/handover tests |
| Connected tracking delay | p95 capture-to-student-render ≤15 seconds on supported healthy test conditions | Native sample + backend receive + UI render timing |
| Fresh-trip coverage | At least 95% of measured trip minutes have a valid ≤30-second sample on supported devices | Field trials; also report all outages/causes separately |
| Offline truth | Never label a sample older than 30 seconds as live; disconnected state by 90-second heartbeat threshold | Controlled clock/network/GPS tests |
| End-trip visibility | On healthy network, p95 location hidden within 5 seconds of acknowledged End | Cross-device observation |
| Access revocation | New protected requests rejected promptly; client subscriptions denied/cleared within a tested target of 60 seconds | Existing-session revocation tests |
| Web task speed | p95 useful route result within 3 seconds on agreed representative 4G/device conditions | Field or lab measurement with defined setup |
| Availability | Initial target ≥99.5% during scheduled transport hours | Synthetic checks and incident records |
| Battery use | Measure per supported phone over representative routes; transport owner approves a sustainable budget | Screen-off native field measurements |

Capacity must be signed off before university-wide release:

- Actual buses, simultaneous active trips, daily users, peak concurrent viewers, operating hours and geographic routes.
- Native OS/device models, charging arrangements and network coverage.
- RTDB connection/egress and API-ingestion budgets, ORS/map quotas and identity-provider limits.
- Budget alerts, usage visibility and expected cost model with current provider pricing.

Simple sizing model: GPS ingest rate is approximately active buses ÷ update interval. Realtime delivery grows with subscribed viewers and update frequency. For illustration only, 100 buses at a 5-second interval imply about 20 ingests/second; this is **not** the known fleet size or a capacity guarantee.

## 13. Acceptance scenarios

Each scenario is an implementation/release test, not a test already performed.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| AC-01 | No authenticated university session | Protected route/live data is requested directly | API/Rules deny access; page offers login without leaked data |
| AC-02 | Signed-in but unapproved/expired member | User opens tracker | Pending/expired state appears; protected reads remain denied |
| AC-03 | Active student/staff | Valid bus/shift is searched | Correct published route, ordered stops and explicit current status appear |
| AC-04 | Existing selected route | Map provider fails | Text route remains usable and map failure is explained |
| AC-05 | Student declines personal location permission | Bus tracking is opened | Bus data still works and no student location is uploaded |
| AC-06 | Driver assigned to bus A | Driver submits position for bus B | Server denies it; bus B location is unchanged |
| AC-07 | No valid background permission | Driver attempts Start | Preflight explains missing permission and does not claim live sharing |
| AC-08 | Authorized driver and valid assignment | Start is retried after a timeout | Only one active trip/publisher exists; result is recoverable |
| AC-09 | Two devices try to claim one bus | Starts arrive concurrently | Only one wins; the other receives an explicit conflict |
| AC-10 | Trip is active with permissions on a supported native build | Screen locks and app backgrounds during a representative route | Updates meet agreed field criteria without foreground interaction |
| AC-11 | Active trip loses network | Driver continues moving | Student becomes delayed/offline by thresholds, never falsely live |
| AC-12 | Network returns with old queued samples | Client reconnects | Old samples do not become fresh live GPS; a new valid fix is used |
| AC-13 | GPS quality degrades but heartbeats continue | Invalid/low-quality samples arrive | UI shows weak/unavailable GPS and preserves original last-valid timestamp |
| AC-14 | Valid latest sample exists | Older sequence or future/out-of-range payload arrives | Invalid sample is rejected; correct latest state remains |
| AC-15 | Active trip, healthy network | Driver ends trip | Collection stops, End is acknowledged and active location is hidden |
| AC-16 | Active trip, no network | Driver presses End | Collection stops locally, pending sync is explicit and reconnect prioritizes End |
| AC-17 | Trip has ended or publisher was replaced | Old device sends more GPS | Writes are rejected; ended/replaced trip cannot revive |
| AC-18 | Account was active and has an open tracker | Admin suspends membership | New reads/writes are denied and active UI clears protected state within tested target |
| AC-19 | Published route is used by an active trip | Admin edits/publishes a new version | Current trip keeps old version; later trips can select the new one |
| AC-20 | Route is referenced by an active trip | Admin tries permanent deletion | Operation is denied with explanation; no dependent data is lost |
| AC-21 | Admin has edited a draft | ORS or save request fails | Draft remains, failure is visible and retry does not create duplicates | — **met 14 Sep 2026** (RTE-04, `docs/evidence/2026-09-14-rte04-route-editor.md`)
| AC-22 | Admin initiates a destructive action | Confirmation is cancelled | Nothing is modified |
| AC-23 | Admin authorizes device handover/force-end | Action succeeds | Previous publisher is revoked and an audit event records the change |
| AC-24 | Supported web/native assistive settings | User completes core tasks by keyboard or screen reader | Controls/statuses are identifiable; no map-only or focus-trap dead end |
| AC-25 | App is force-stopped or phone powers off | Heartbeats cease | Feed expires honestly; system does not promise automatic resurrection |
| AC-26 | Retention deadline passes | Cleanup executes | Eligible location records are removed and failures are detectable |
| AC-27 | Source data is imported into isolated staging | Counts, IDs and geometry are compared | Expected records match; collisions/missing data block cutover |
| AC-28 | Production-like authentication/configuration | User signs in and makes an authorized mutation | Session/token flow survives real proxy/origin conditions |
| AC-29 | Student/staff account uses an approved domain but email is unverified | User requests protected data directly | API and database rules deny access; UI explains email verification |
| AC-30 | Student/staff email is verified on an approved domain but membership is pending | User requests live tracking | Access remains denied; UI shows approval pending, not automatic activation |
| AC-31 | Student/staff has a verified email on a non-approved or deceptively similar domain | User attempts protected access | Exact-domain policy denies access; no suffix-based approval |
| AC-32 | Previously active student/staff changes account email | Session refreshes with a different or unverified email | Old membership approval cannot grant access until the new email is verified and approved |

Before release, exercise API and Rules denial directly, not only through the UI. Physical-device background tests and separate-device student tracking are mandatory.

## 14. Migration and cutover plan

1. **Inspect safely:** confirm Firebase database product, existing schema, Rules, identity setup and environment ownership. Do not reuse exposed legacy credentials.
2. **Inventory:** compare authorized current PostgreSQL and original Firebase records; identify authoritative records, duplicates, bus ID normalization and missing geometry.
3. **Back up:** obtain approved exports/snapshots and verify that a restore procedure exists.
4. **Model and transform:** map legacy route/bus keys into stable IDs and preserve relevant route data. Do not migrate plaintext credentials.
5. **Rehearse:** use isolated staging/emulator fixtures, run schema/Rules tests, compare counts/IDs/route geometry and verify each role.
6. **Validate native tracking:** meet the background feasibility gate before promising production tracking.
7. **Cut over deliberately:** agree a maintenance window or write freeze, import final changes, switch one authoritative store and observe a controlled cohort.
8. **Expand:** phased transport rollout to the full university after acceptance, onboarding and support readiness.
9. **Retire old paths:** remove public GPS writes/shared-password auth only through a coordinated safe transition; disable the insecure legacy write surface before production exposure.
10. **Rollback plan:** preserve recoverable data/configuration and assignment mappings. Do not treat restoring an insecure public-write backend as an acceptable production rollback.

No indefinite dual-write system, blind database deletion or production import without approval.

## 15. Delivery roadmap and dependencies

Sizing is relative (**S/M/L**), not a date or price commitment. Native platform scope, identity availability and existing Firebase data can materially change effort.

| Stage | Scope | Size | Depends on | Exit gate |
| --- | --- | --- | --- | --- |
| A — Decisions and access | Driver device inventory, approved email domains/membership operator, fleet scale, Firebase inspection and backup plan | S–M | University/project owner input | Critical assumptions resolved |
| B — Identity/data foundation | Auth, memberships, Rules, typed API validation and staged data model | L | A | Positive/negative role tests pass |
| C — Native tracking proof | Background permissions, single publisher, fresh samples, screen-off/reconnect/end lifecycle | L | A; B auth contract | Real-device proof meets criteria |
| D — End-to-end transit | Student authorized map/list flow, admin route versions/assignments, reliable status | L | B and C contracts | Cross-device core journey passes |
| E — Operational hardening | Accessible states, observability, quotas/budget controls, recovery and retention | M–L | D | Production-readiness checklist passes |
| F — Rehearsal and rollout | Migration rehearsal, driver onboarding, controlled validation, university expansion | M–L | All release gates | Transport owner accepts daily operations |

Stages B and C can share agreed interfaces and proceed partly in parallel. Do not complete decorative UI work before proving background tracking and authorization.

**Next/Later enhancements:** ETA accuracy work, preferred stops, opt-in
notifications, validated bulk route imports and reporting. The 13 Sep owner
direction includes short-lived admin notices (≤280 characters, ≤30 days);
that decision is not a claim that the notice implementation is complete.
Reprioritize using actual usage/support evidence, not fabricated RICE scores.

## 16. Operational readiness and incident handling

Monitor:

- Active trips, sample age, heartbeat gaps and stale/offline share.
- Ingest validation failures, unauthorized attempts, API errors and latency.
- Database connections/egress, map/ORS failures, quota exhaustion and estimated spend.
- Membership provisioning/revocation failures and retention job failures.

Runbooks:

| Incident | Expected response |
| --- | --- |
| Bus appears offline | Distinguish driver ended, weak GPS, network, device restrictions and backend outage; never auto-invent location |
| Basemap/ORS provider outage | Keep text routes available; block unsupported route generation with clear retry |
| Lost driver phone | Revoke account/session publisher access, end/handover trip and audit action |
| Wrong assignment/duplicate device | Controlled reassignment/handover; preserve traceability |
| Data/rules regression | Stop unsafe writes, restore approved safe configuration/data and communicate outage |
| Credential exposure | Revoke/rotate through secure owner-controlled setup and inspect affected access logs |

University-wide release requires driver permission training, supported-device guidance, a transport help contact, an operational support owner and a documented fallback such as normal timetable/manual dispatch.

## 17. Principal risks and mitigations

| Risk | Mitigation / gate |
| --- | --- |
| OS background restrictions or driver force-stop | Native device proof, explicit limitations, visible tracking status and heartbeat expiry |
| Official email delivery or membership approval fails | Explicit pending/recovery state and authorized support; never bypass either access check |
| User Firebase differs from legacy RTDB assumptions | Inspect first; adapt proposal rather than introduce another database silently |
| Campus-scale costs or provider quotas | Measure load, targeted subscriptions, budget alerts and approved capacity model |
| Stale/incorrect GPS treated as live | Separate capture/receive times, quality checks, sequences and explicit stale states |
| Malicious location spoofing | Authorized ownership/replay controls, anomaly review; no false anti-spoof guarantee |
| Migration loses route history/geometry | Backups, collision report, staged transform and comparison before cutover |
| Deactivated user retains already downloaded data | Minimize cache/data, deny future reads and document irreversibility of previously viewed information |
| Building too much at once | First-release boundaries, native feasibility before polish, explicit Now/Next/Later |

## 18. Open decisions before implementation approval

### Recorded decisions and deferred native scope

1. **Driver phones:** user does not yet have a confirmed device list. Keep Android/iOS coverage undecided; obtain the inventory before final native estimates, packaging and acceptance tests. Do not ask the user to guess or silently choose Android-only.
2. **University verification:** confirmed as university email verification plus approved membership. This question is settled; official domain values and approval ownership are setup details.

### Dependencies to establish during setup, not secrets to paste into chat

- Firebase RTDB vs Firestore, existing records and authorized backup access.
- Exact university-approved email domains, membership approval owner/records, email delivery configuration, account lifecycle and admin MFA capability.
- Buses/peak users, supported phones/OS versions, operating schedule and charging/network constraints.
- Provider accounts, data region, budgets and native distribution ownership.
- Retention/privacy policy, transport support owner and final acceptance sign-off.

No password, API key or service-account private key belongs in this document or chat. Secure connection/secrets setup is a separate step.

## 19. Definition of ready and definition of done

### Ready to implement

- Core scope confirmed — **done**.
- Student/staff verification method chosen — **done: verified university email + approved membership**.
- First-release native platforms chosen — **pending: driver phone inventory unavailable**.
- Firebase ownership/product and safe development access established — **pending**.
- Acceptance thresholds, capacity assumptions and privacy policy reviewed — **pending**.
- Architecture/roadmap accepted by project owner — **pending**.

### Ready for university-wide daily use

- All P0 requirements and core first-release P1 workflows implemented.
- Full role matrix, Rules tests and critical negative cases pass.
- Screen-off/background trials pass on each supported real device class.
- Cross-device Start → Live → Delayed/Offline → Reconnect → End lifecycle passes.
- No unresolved public GPS writes, hardcoded privileged credentials or broken map provider.
- Safe migration rehearsal, route data comparison and recovery procedure accepted.
- Operational monitoring, budget alerts, retention cleanup and support ownership ready.
- Accessibility/core responsive checks and real driver onboarding completed.
- Transport owner validates field operation; project owner approves rollout.

**Current status:** audit and this PRD are delivered. These implementation and release gates are not yet satisfied.

## 20. Sources and review cadence

Project evidence:

- `docs/PU-Transit-Audit.md` — detailed source findings and verification limitations.
- `screenshots/audit-home-desktop.jpg` and `screenshots/audit-student-mobile.jpg` — initial visual evidence.
- `.agents/skills/installed-sources.json` — installed upstream skill provenance.

Technical documentation consulted on 11 September 2026:

- [Expo Location — background behavior and permissions](https://docs.expo.dev/versions/latest/sdk/location/)
- [Firebase Realtime Database — offline capabilities and presence](https://firebase.google.com/docs/database/web/offline-capabilities)
- [Firebase Auth — custom claims and trusted role assignment](https://firebase.google.com/docs/auth/admin/custom-claims)
- [Firebase Realtime Database — Security Rules conditions and validation](https://firebase.google.com/docs/database/security/rules-conditions)
- [Replit — native mobile apps](https://docs.replit.com/features/artifact-types/building-mobile-apps)

Review this PRD after identity/platform selection, the native tracking proof, migration rehearsal and operational field validation. Update targets based on measurements and record scope changes instead of silently changing behavior.

### Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-09-11 | Initial full PRD incorporating confirmed university-wide scope, restricted access and native background-tracking requirement |
| 1.1 | 2026-09-11 | Confirmed two-check university access, specified verification/approval lifecycle and four negative scenarios; recorded driver platform coverage as undecided pending phone inventory |
| Owner amendment | 2026-09-13 | Web PU Transit remains current product and native is later; recorded owner-reported Play discontinuation, role-picker approval flow, personal-email grace/email switch, membership preservation, no auto-suspension, add-ons/notices/shuttle/About/Help, language-review status, and exclusion of payments/passes. |