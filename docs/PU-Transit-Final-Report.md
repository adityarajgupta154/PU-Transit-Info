# PU Transit — Final Project Report

**DOC-01 · Submission draft · Evidence cut-off: 14 September 2026**  
**Project:** University bus-route lookup, authorized live tracking and transport administration  
**Delivery:** Web application and API, with an unvalidated native-driver feasibility build

## Abstract

PU Transit addresses a practical transport question: how can a university passenger
find a bus and distinguish a current position from an old or unavailable one? The
project combines a responsive student/staff interface, an authorized driver
tracking workflow and transport-administration tools. Its central design principle
is that “live” must be supported by a recent, sufficiently accurate sample from the
authorized publisher, rather than inferred from a Start button or the presence of
stored coordinates.

The delivered repository contains a React/Vite web application, an Express API,
Firebase authentication and Realtime Database policies, and an Expo native-driver
feasibility implementation. Route publishing/versioning, fleet records, assignments,
membership lifecycle controls and several security protections have been added.
The latest collected evidence records **97/97 API unit tests** and **26/26 Firebase
Rules emulator tests** passing. These results support local contracts; they do not
prove field reliability or production acceptance.

This report applies Section 2 of the **v2.1 Final Polish & Delivery Addendum** to
separate core submission work from future operational work. It also records
deviations from that initial triage where later code exists. **W6 and W7 remain
designed-but-not-built workstreams.** Current Rules publication, live web rehearsal,
native screen-off demonstration and other security/operational gates remain open.
Neither university-wide readiness nor completion of the entire submission
definition of done is claimed.

## Contents

1. [Problem statement and objectives](#1-problem-statement-and-objectives)
2. [Source documents and reporting method](#2-source-documents-and-reporting-method)
3. [What the baseline and remaining-work requirements asked for](#3-what-the-baseline-and-remaining-work-requirements-asked-for)
4. [Scope triage and delivery status](#4-scope-triage-and-delivery-status)
5. [Architecture and implementation](#5-architecture-and-implementation)
6. [Security and privacy model](#6-security-and-privacy-model)
7. [Test evidence and evaluation](#7-test-evidence-and-evaluation)
8. [Known limitations](#8-known-limitations)
9. [Future work: W6 and W7 designs](#9-future-work-w6-and-w7-designs)
10. [Conclusion](#10-conclusion)
11. [References and reproducibility](#11-references-and-reproducibility)

## 1. Problem statement and objectives

### 1.1 Problem

Students and staff need a trustworthy answer to “where is the bus?” Drivers need
a low-interaction way to share location while on duty. Transport administrators
need controlled access to fleet, route, assignment and service information.
Coordinates alone are insufficient: a bus can lose connectivity, provide poor GPS
accuracy, end a trip or have its publisher replaced while an old position remains
stored.

The baseline [audit](PU-Transit-Audit.md) and [PRD v1.1 §3](PU-Transit-PRD.md#3-problem-evidence-and-alternatives)
identified insecure public GPS writes, source-held administrative credentials,
stale coordinates appearing live and insufficient evidence of actual cross-device
or background tracking. These describe the **starting implementation**, not a
claim that every weakness still exists today.

The project was not based on a completed passenger survey, validated fleet-size
study or confirmed vendor comparison. Timetables, phone calls and generic location
sharing were considered as alternatives, but no interview counts, market-share
figures or measured waiting-time reduction are claimed.

### 1.2 Objectives

The baseline goals were:

- **G1 — Trustworthy tracking:** distinguish current, delayed, weak-GPS, offline
  and ended states using data and session validity.
- **G2 — Controlled access:** protect operational data through verified identity,
  membership eligibility and role-specific authorization.
- **G3 — Background reliability:** support normal phone-lock/background use on
  validated native driver devices.
- **G4 — Operational control:** manage routes, memberships, assignments and
  active-trip conflicts without silently disrupting authorized work.
- **G5 — Safe transition:** preserve legitimate existing data while retiring
  insecure legacy paths.
- **G6 — Maintainability:** reuse React, Firebase and shared tracking logic rather
  than introduce unnecessary infrastructure.

These are project objectives, not six completed acceptance claims. G3 and the
production aspects of G5 remain particularly dependent on device and institutional
validation.

## 2. Source documents and reporting method

### 2.1 Source/version interpretation

| Source | How it is used in this report |
|---|---|
| [Delivery status (former README)](Delivery-Status.md) | Delivered-state summary and local grading instructions, updated 14 Sep 2026. |
| [Product PRD v1.1](PU-Transit-PRD.md) | Original functional requirements, architecture, acceptance scenarios AC-01–AC-32 and university-wide goals. |
| [Remaining-Work PRD v2.0](PU-Transit-PRD-Remaining.md) | W0–W7 backlog, dependencies, proposed data changes and remaining acceptance gates. |
| [Final Polish Addendum v2.1](../attached_assets/PU-Transit-v2.1-Final-Polish-Addendum_%282%29_1789293819370.md) | Section 2 submission triage, Section 3 native fallback and Section 4 DOC-01–DOC-05 deliverables. |
| [Evidence index](evidence/README.md) and its dated records | Results, limitations and links by acceptance/requirement ID. |

The addendum calls its companion **“README.md v1.1.”** The current README has no
version header; the explicitly versioned requirements are in
`docs/PU-Transit-PRD.md`. Accordingly, “v1.1 baseline” below refers to that
requirements baseline, while today's README is treated as a delivery/status
document. The addendum also uses a different filename for the remaining-work PRD;
this report links the repository's actual `PU-Transit-PRD-Remaining.md`.

The addendum is dated 12 Sep 2026 and marked draft. Its Section 2 is the requested
submission-scoping framework, not evidence of implementation or owner sign-off.
The later 13 Sep owner amendment governs current access/product policy where it
conflicts with earlier proposal text. Later dated implementation and test records
are reported explicitly rather than silently rewriting the original triage.

### 2.2 Evidence labels

- **Built:** implementation exists in the repository.
- **Local pass:** a named unit, emulator, browser or build check passed in its
  stated environment.
- **Historical/recorded:** evidence is retained from a named earlier run; it has
  not been repeated for this report.
- **NOT RUN / blocked:** no qualifying observation has been recorded.
- **Designed-but-not-built:** requirements and a proposed approach exist, but the
  workstream has not been delivered or accepted.

There is no new test run associated with writing this report. The historical
**21 done / 7 partial / 1 not started / 2 deferred** count for 31 functional
requirements is a **12 Sep baseline**, not a recalculated final completion score.
Passing tests are not converted into a percentage of production readiness.

## 3. What the baseline and remaining-work requirements asked for

### 3.1 v1.1 baseline

The intended end state was daily university transport use: eligible students and
staff could view their bus, authorized drivers could publish while on duty, and
administrators could manage transport operations. Its 31 functional requirements
cover access/identity, student experience, driver behavior and administration.
Cross-cutting sections add security, reliability, accessibility, migration,
monitoring and rollout expectations.

The most important technical distinction was explicit: **browser/PWA tracking does
not satisfy the native screen-off requirement**. Even a native implementation
cannot promise uninterrupted GPS after force-stop, power-off, permission removal
or loss of GPS/network. The required response is an honest unavailable/stale state,
not an invented fresh location.

The first release excluded payments, attendance, ticketing, AI arrival prediction,
driver scoring, multi-university SaaS and historical replay of every GPS point.
The project must not present these as missing features it had promised to deliver.

### 3.2 v2.0 remaining work

The remaining-work PRD converted the gap between the baseline and the then-current
implementation into eight workstreams:

| Workstream | What v2.0 asked for |
|---|---|
| **W0 — Immediate verification/security gates** | Rules publication, legacy tracking-path removal, live web rehearsal, ORS secret migration/revocation and production-like authentication checks. |
| **W1 — Native driver tracking** | Device feasibility, permissions, background collection, preflight, tracking/auth parity, battery/data measurement, distribution and onboarding. |
| **W2 — Identity completion** | Membership expiry and revocation, privileged-action hardening, email-change verification and roster-assisted approval. |
| **W3 — Fleet and route operations** | Registered buses, publishable/verified paths, immutable route versions, protected archive/delete, dated assignments and explicit handover. |
| **W4 — Student experience** | Calendar-backed no-service state, subscription/tab behavior, accessibility and measured performance improvements; preferences only if validation justifies them. |
| **W5 — Security/privacy/lifecycle** | Rate and request limits, CORS/headers, secrets hygiene, retention, backups, log review, App Check and privacy controls. |
| **W6 — Operational readiness** | Metrics, alerts, runbooks, named owners, capacity/budgets, availability monitoring and field performance measurement. |
| **W7 — Migration and rollout** | Legacy reconciliation, isolated rehearsal, approved cutover/rollback, controlled cohort, onboarding and phased expansion. |

The v2.0 target remained **university-wide daily use**, which requires more than
code, unit tests or a polished demonstration.

## 4. Scope triage and delivery status

### 4.1 Core submission scope

This table follows the exact buckets in
[v2.1 Section 2](../attached_assets/PU-Transit-v2.1-Final-Polish-Addendum_%282%29_1789293819370.md#2-scope-triage-core-submission-scope-vs-documented-only-future-work).
“Core” means expected for submission, **not automatically complete**.

| Core items in the addendum | Actual delivered state at the evidence cut-off |
|---|---|
| **W0-01–W0-05** | Legacy `driverStatus` removal is recorded. The 12 Sep Rules publication is historical; current amendments remain unpublished. ORS proxy code exists, but the previous key still needs revocation. W0-03 is **NOT RUN** and W0-05 production-auth acceptance is blocked. **W0 is not complete.** |
| **NAT-01–NAT-06** | Expo feasibility source, shared tracking contract, permission/preflight flows, background-location integration and evidence tooling exist. NAT-06 has recorded credential-free transport checks. NAT-01 and NAT-05 device rehearsals are **NOT RUN**. There is no demonstrated screen-off acceptance or supported-device matrix. |
| **IDN-01, IDN-02** | Membership expiry and revocation handling are built and locally tested. An emulator-backed browser run recorded revocation in 0.9–3.7 s. Publication and published-app verification remain separate gates. |
| **FLT-01–03, RTE-01–03, ASG-01, ADM-10** | Bus registry, route publish/version/archive, dated assignments and handover are implemented with local API/Rules coverage. Current Rules publication, relevant data migration and real-device handover/force-end observation remain pending. |
| **STU-04b, A11Y-01** | Admin service calendar and truthful no-service display are built. A browser accessibility audit and fixes are recorded. No calendar entry means no schedule claim; real assistive-technology/device validation is still pending. |
| **SEC-01–SEC-04** | Rate limits and request bounds are built; secrets-sweep evidence exists. **SEC-03 is incomplete:** the API currently uses permissive CORS without the specified allowlist/header hardening. **SEC-04 remains open** until the old ORS key is revoked. Fleet-scale/published-app checks are not complete. |
| **Documentation** | DOC-03 evidence collection and DOC-04 README/local setup are delivered. This document is the DOC-01 draft. The [DOC-02 script/checklist](PU-Transit-Demo-Script.md) is prepared for owner recording; no completed demo video or DOC-05 standalone visual architecture deliverable is asserted. |

**Native fallback is not a waiver of proof.** Addendum Section 3 allows a
development-build demonstration on an available phone to count as a clearly
labelled single-device feasibility proof, rather than fleet validation. It still
requires a real demonstration and a log containing device/OS, duration and
freshness observations. Source code and an empty rehearsal protocol do **not**
meet that fallback. The current record remains “feasibility implementation,
device proof pending.”

### 4.2 Initially deferred work and later exceptions

| Addendum bucket | What is actually true now |
|---|---|
| **W2 remainder: IDN-03–IDN-05** | Admin MFA/step-up and roster-assisted approval remain future work. **IDN-04 is an exception:** the email-change flow and local tests were subsequently implemented; published-app proof remains pending. |
| **W5 remainder: SEC-05–SEC-08, PRIV-01/02** | Backups/restore rehearsal, production log-hygiene review, App Check and completed privacy acceptance remain future work. Existing indicators/session safeguards do not establish full privacy approval. **SEC-05 is an exception:** cleanup code and emulator proof exist, but no scheduled production retention operation is established. |
| **W6: OPS-01–OPS-07** | **Designed-but-not-built as a complete workstream.** Basic logs, health route and fleet UI are not a delivered monitoring/alerting/capacity programme. See §9.1. |
| **W7: MIG-01–MIG-03, ROL-01–ROL-03** | **Designed-but-not-built as a complete workstream.** Import helpers and local migration/planner tests are not an executed institutional migration, controlled cohort or approved rollout. See §9.2. |

The addendum reduces NAT-07–NAT-09 to a documented/device-limited scope rather than
requiring a fleet-wide battery study, store distribution and formal multi-driver
onboarding for submission. No completed loaner-device measurements are claimed.

Section 5's stretch list also includes **RTE-04** and **PERF-01**. RTE-04 is built:
failed route saves preserve drafts, retries reuse a UUID without duplicating the
route/version, and dirty forms warn on supported navigation. PERF-01 map
lazy-loading is **not delivered**; no completed before/after improvement result is
claimed. The existence of stretch implementation does not close unmet core
device/publication gates.

## 5. Architecture and implementation

### 5.1 Components and trust boundaries

| Component | Responsibility |
|---|---|
| **React/Vite web client** | Responsive student/staff, driver and admin interfaces. Displays domain states, collects browser location only with permission and polls API feeds for live views. |
| **Expo driver client** | Native feasibility source with platform permission/location/persistence adapters. It shares the tracking contract with the web driver; device execution is not validated. |
| **Shared tracking library** | Session ownership, sequence/idempotency handling, pending-End behavior and common state transitions, with platform-specific adapters rather than two independent implementations. |
| **Express API** | Verifies Firebase ID tokens, checks membership/roles, validates requests, enforces limits and coordinates domain operations. |
| **Firebase Auth** | Email/password identity, email verification and ID-token issuance. The API uses Firebase Admin **Auth** for token verification. |
| **Firebase Realtime Database and Rules** | Stores application records and applies the independent data-authorization/validation policy to normal user-token requests. |
| **OpenRouteService proxy** | Admin geocoding/directions through server-only credentials. It is distinct from public basemap tile delivery. |
| **MapLibre within Leaflet** | OpenFreeMap vector basemap, with raster fallback where supported rendering is unavailable; route and bus display is constrained to the Vadodara area. |
| **Legacy PostgreSQL** | Retained for legacy-route import, not the current operational system of record. Its eager pool initialization still creates a local-startup configuration dependency. |

The normal data flow is:

1. A web/native client signs in with Firebase Auth and obtains an ID token.
2. The client calls Express with that bearer token.
3. Express verifies identity and eligibility, then applies role/domain checks and
   request validation.
4. Express accesses RTDB REST **using the acting user's token**. Normal app data
   access does not use a service-account database bypass.
5. RTDB Rules independently allow or deny the operation. The client displays the
   acknowledged result or an explicit error.
6. For admin geocoding/directions only, Express calls ORS using the server secret.
   The browser never receives that credential.

Separate retention/migration tooling has a more privileged service-account trust
boundary and is not part of an ordinary user request.

### 5.2 Data and behavioral model

The implemented model includes memberships, registered buses, route identities,
admin-only drafts, immutable route versions, standing/dated assignments, per-bus
tracking sessions, service-calendar entries, notices and audit records.

- **Tracking:** one active publisher owns a bus session. Start establishes
  ownership; samples/heartbeats must match the session and sequence rules. End
  acknowledges the server state change, not merely a local button press.
- **Freshness:** nominal sampling is approximately every 5 seconds and heartbeat
  every 15 seconds. The implemented “Live” gate includes sample age at most
  30 seconds and accuracy at most 100 metres, alongside session/quality validity.
  These are implementation thresholds, **not measured service-level results**.
- **Failure handling:** the UI distinguishes acquiring, live, delayed, weak GPS,
  GPS unavailable, offline, ended, conflict and data-load failure. Failed/offline
  End is retained for retry rather than falsely reported as acknowledged.
- **Route consistency:** Start pins the applicable published route versions.
  Subsequent edits/publishing do not silently replace the route used by that trip.
  Published routes are archived rather than permanently deleted; never-published
  drafts have a protected delete path.
- **Assignments:** dated assignments use the IST service day and retain a standing
  assignment as an allowed option. The chosen bus is locked during a trip; a
  schedule does not automatically start tracking.
- **Handover:** the API authorizes the incoming driver, ends the outgoing session
  against the ownership it read, then records the audit event. The outgoing
  publisher is rejected on a subsequent request. This sequence is not presented
  as a proven real-phone handover or one cross-record atomic transaction.
- **Calendar:** an explicit entry can establish no service for a date. Missing or
  stale calendar information is not converted into a guessed holiday.

### 5.3 Delivered role workflows

**Student/staff:** search by bus/shift, inspect ordered stops and route geometry,
view current tracking state and last-update age, and optionally use personal
location on the device. Manual/unverified road paths are labelled.

**Driver:** complete assignment/permission preflight, select an eligible bus,
Start/End and observe GPS/network/synchronization state. Browser tracking is a
foreground workflow; the native implementation must still prove normal screen-off
operation.

**Administrator:** manage the fleet registry, route lifecycle, memberships and
assignments; inspect feeds; force-end or hand over a session; manage notices and
calendar entries; inspect audit records. Existence of a control does not remove
its authorization requirements or current Rules-publication dependency.

Local reproduction instructions are in [README §8](Delivery-Status.md#8-running-the-project).
There is no isolated seeded demo login. Full authenticated grading requires
owner-approved accounts and data in the existing Firebase project.

## 6. Security and privacy model

### 6.1 Authentication and authorization

Protected data requires a verified identity and eligible, approved, active
membership, including expiry checks where configured. Authentication alone is
insufficient. Role checks separate rider reads, driver publishing and
administrative mutations; a privileged role request at sign-up does not grant
that privilege.

The 13 Sep owner amendment permits a **verified personal-email student** during
a **30-day grace period from membership creation**. This supersedes the original
blanket university-domain-only interpretation of AC-31. Email changes require
verification and continued eligibility; membership follows the UID under those
checks, not arbitrary unverified email text. Grace expiry denies access under the
policy; it is not described as automatic suspension or membership deletion.

The API uses Firebase Admin Auth to verify tokens, then sends the user's token to
RTDB. Rules are an independent boundary, not a replacement for API validation.
The UI is not trusted to enforce permissions. Revocation handling clears open web
state after the API reports denial; its recorded local timing is not a published
service guarantee.

### 6.2 Integrity and abuse controls

| Risk | Implemented control | Remaining qualification |
|---|---|---|
| Wrong driver, stale session or two publishers | Assignment/role checks, conditional ownership, session/sequence validation, stale publisher rejection | Device concurrency, force-stop and handover rehearsals remain pending. |
| Invalid/malformed or oversized input | Schema/key/enum/array/string validation; 32 kB JSON cap, with 512 kB for route bodies; explicit 400/413 outcomes | Not a substitute for production abuse/load testing. |
| Excessive authenticated requests | Per-UID and shared-client fixed-window limits; 429 with `Retry-After`; denial logging without request payloads | Fleet sizing/load proof and trusted-proxy behavior are not production-validated. |
| Unsafe route lifecycle changes | Immutable versions, trip pinning, protected archive/delete, consequence-stating confirmations | UI/mock results do not establish every production mutation. |
| Undetected administrative changes | Append-only, bounded audit records and audited operational mutations | Real force-end/audit-row observation and operational review are still open. |
| Third-party credential exposure | ORS calls moved server-side; current-secret sweep covers tree/history and built web/API output | A previous exposed ORS key remained accepted at the last recorded check; revocation is unresolved. |
| Over-privileged data access | Normal API requests use user-token RTDB access; maintenance identity is separate | Trusted maintenance credentials must be secured and scheduled by the owner. |

Firebase's public web configuration is not an authorization secret. Conversely,
service-account credentials, ID tokens and ORS secrets must not appear in client
bundles, report attachments or committed rehearsal exports.

### 6.3 Known security gaps

**SEC-03 must not be claimed complete.** The API currently calls permissive
`cors()`; the specified production/development origin allowlist and baseline
security-header hardening are not delivered as requested. CORS is not the primary
authorization boundary, but this is still an unmet core hardening requirement.

Admin MFA/recent re-authentication and Firebase App Check are future controls, not
present protections. Backups with an isolated restore rehearsal and a production
log-hygiene review are also not established. The latest local Rules payload is
not confirmed published, so the report cannot equate tested Rules with current
live enforcement.

### 6.4 Privacy and lifecycle

Student personal location is optional and is not stored on the server. Driver
tracking is tied to an active trip, with visible state and an End path; the product
does not offer historical replay of all GPS points.

Retention cleanup is built and emulator-tested. It removes eligible residual
feed locations and audit records beyond the configured 90-day window, records
maintenance outcomes and reports failure. **It is not a scheduled production
service.** A configured retention value is not evidence of university approval of
the complete privacy policy. Institutional purpose/notice approval, production
operation and remaining privacy acceptance must be completed separately.

## 7. Test evidence and evaluation

### 7.1 Latest collected automated results

The [DOC-03 run summary](evidence/2026-09-14-doc03-test-results.md) records:

| Suite | Result on 14 Sep 2026 | What the result establishes |
|---|---|---|
| Firebase Rules emulator | **26/26 passed**, zero failed/skipped | Authorization and data invariants for the checked-in Rules in isolated `demo-pu-transit`; both Rules copies were byte-identical. |
| Express API unit tests | **97/97 passed across 11 files**, zero failed/pending | Tested API contracts, including tracking, audit, limits, assignments, buses/routes, geo, handover, membership expiry, request bounds and calendar. Firebase/auth boundaries are mocked. |

The [Rules report](evidence/2026-09-14-firebase-rules-results.txt) and
[API report](evidence/2026-09-14-api-unit-results.txt) retain individual verdicts,
commands and source hashes. Expected denial warnings/request dumps were omitted
from normalized reports; failures were not reclassified as passes.

These suites do **not** prove cryptographic token verification end-to-end, live
Firebase configuration, current Rules publication, OS background scheduling, GPS
quality, real 4G performance or production reliability. Their counts are not
combined with historical suites into a misleading “total acceptance tests passed.”

### 7.2 Other recorded evidence

| Evidence | Recorded result and boundary |
|---|---|
| [DOC-04 local setup](evidence/2026-09-14-doc04-local-setup.md) | Shared/scoped typechecks and builds pass; local web proxy returns health 200 and unauthenticated routes 401; three public page shells render in Chromium. Existing dependencies were used: not a fresh-machine install or authenticated grading run. |
| [RTE-04 editor recovery](evidence/2026-09-14-rte04-route-editor.md) | Recorded API and web tests plus Chromium navigation/retry checks support draft preservation and dirty-only warnings. Hardware-back/device check remains pending. |
| [A11Y-01 audit](evidence/2026-09-14-a11y01-audit.md) | Recorded browser/axe, keyboard/focus/live-region and narrow/zoomed-view checks; 84/84 web tests at that run and zero reported axe violations after fixes. Real screen readers, Safari/Firefox and physical-device checks were not run. |
| [IDN-02 revocation](evidence/2026-09-14-idn02-revocation.md) | Emulator-backed browser measurement **0.9–3.7 seconds**. Not a published-app revocation result. |
| [IDN-04 email changes](evidence/2026-09-14-idn04-email-change.md) | Local eligibility/re-verification checks; published-app owner check remains pending. |
| [SEC-04 secrets sweep](evidence/2026-09-14-sec04-secrets-sweep.md) | Current-secret checks passed for the documented tree/history/web/API build scope; native source only, not a native bundle. The old ORS credential remains an explicitly recorded unresolved exposure/revocation issue. |
| [SEC-05 retention](evidence/2026-09-14-sec05-retention.md) | **4/4** recorded isolated-emulator tests, including read-back deletion, pagination/boundaries and detectable failure. Not scheduled production cleanup. |
| [NAT-06 transport](evidence/rehearsal-log-nat06.md) | Historical **5/5 credential-free transport checks**; native phone authentication scenarios remain unrun. |
| [W0-01 publication](evidence/2026-09-12-w0-01-rules-publish.md) | Historical owner-reported 12 Sep publication. Not proof that later amendments are live. |

### 7.3 Acceptance coverage and unclosed gates

The [AC-ID index](evidence/README.md#index-by-acceptance-id) is the detailed
traceability record. In summary:

| Acceptance IDs | Evidence interpretation |
|---|---|
| **AC-01/02, 29–32** | Local access-policy evidence; AC-31 uses the amended personal-email grace semantics. Production-auth AC-28 is not complete. |
| **AC-03–05** | Route selection and some usability checks exist. A failed-basemap/text-only scenario and complete personal-location permission/no-upload acceptance are not established by the collected API/Rules suites. |
| **AC-06–17, 25** | Ownership, freshness/quality, sequence, End and expiry contracts have local coverage. Permission denial, actual screen-off collection, network recovery and force-stop behavior require real devices. |
| **AC-18** | Recorded local revocation timing and current denial tests; published rerun pending. |
| **AC-19–23** | Local route-version, protection, editor-recovery and handover evidence; actual live handover/force-end/audit observation pending. |
| **AC-24** | Browser accessibility audit, not a completed real screen-reader/device acceptance run. |
| **AC-26** | Retention demonstrated in an isolated emulator only. |
| **AC-27/28** | No completed staging cutover rehearsal or production-like authenticated acceptance. |

The following logs are deliberately preserved as protocols/status records, not
successful demonstrations:

- [W0-03 web rehearsal](evidence/rehearsal-log-w0-03.md): **NOT RUN**.
- [NAT-01 screen-off feasibility](evidence/rehearsal-log-nat01.md): **NOT RUN**.
- [NAT-05 ownership/idempotency device rehearsal](evidence/rehearsal-log-nat05.md):
  **NOT RUN**.
- [W0-05 production-auth check](evidence/w0-05-production-auth-check.md):
  **blocked/not complete** in the recorded evidence.

## 8. Known limitations

1. **Native proof is incomplete.** No recorded qualifying screen-off run, supported
   device matrix, battery/data study or field-tested distribution path exists.
   An Expo Go/web preview does not prove native background execution.
2. **Publication differs from implementation.** Current 13–14 Sep Rules amendments
   remain unpublished in the evidence record. A real phone Start → Live → End,
   force-end and audit observation are still pending.
3. **Security closure is incomplete.** CORS/header requirements, old-key
   revocation and production security checks remain open. MFA, App Check,
   backups/restore and full production log/privacy review are not claimed.
4. **No operational service levels are measured.** Fleet-wide throughput,
   availability, p95 capture-to-render time and fresh-minute targets have not been
   demonstrated during a real cohort.
5. **Local grading is not self-contained.** The app is pinned to the existing
   Firebase project. Protected workflows need owner-approved accounts; authorized
   local mutations can affect shared data. The README documents a local proxy and
   the legacy `DATABASE_URL` startup workaround, not a safe all-role offline demo.
6. **Retention is not deployed on a schedule.** Local cleanup proof does not
   establish production deletion, monitoring or recovery.
7. **Client/platform limits remain.** Native pending-End retry needs the app open;
   process-kill recovery is not an automatic-resume guarantee. The route-editor
   navigation guard does not cover arbitrary multi-entry browser-history jumps.
8. **Accessibility/performance coverage is bounded.** Real assistive-technology
   and cross-browser/device checks remain pending; map lazy-loading and its
   completed before/after comparison are not delivered.
9. **Institutional decisions remain external.** Device inventory, roster access,
   operating/support owners, budget/scale, policy approval and rollout permission
   cannot be inferred from code. Per-route service-day scheduling is also not
   implemented; the current calendar is date-based.
10. **Submission documentation is not a demonstration.** This draft and the
    evidence index cannot substitute for the missing demo video, real rehearsal
    observations or acceptance sign-off.

## 9. Future work: W6 and W7 designs

**Status of this entire section: designed-but-not-built.** It specifies proposed
work and acceptance gates, not delivered infrastructure or performed exercises.
No monitoring pipeline, migration, notification, cohort or rollout was created
while writing this report.

The scope rationale follows v2.1 Section 2: these workstreams need institutional
resources—real legacy data, a live driver/passenger cohort, named operational
owners and budget/sign-off—that are outside the demonstrated course-project
delivery. They remain requirements for real daily use, not optional quality claims.

### 9.1 W6 — Observability, capacity and operational readiness

| ID | Proposed design | Evidence needed before declaring it complete |
|---|---|---|
| **OPS-01 — Metrics** | Emit structured, privacy-minimized events for active trips, sample age, heartbeat gaps, stale/offline share, validation rejects, 401/403, latency and errors; aggregate into an internal/admin summary. | A dashboard populated during an actual rehearsal and checked against known events. Existing request logs/Fleet tiles are insufficient. |
| **OPS-02 — Alerts** | Route API-down, Firebase/ORS quota, retention-failure and unusual-denial signals to a named responder. Set thresholds from the approved operating model. | Trigger every alert in a controlled drill and record delivery, acknowledgment and response. No invented thresholds or recipients. |
| **OPS-03 — Runbooks** | Define diagnosis, safe mitigation, escalation and recovery for offline bus, map/ORS outage, lost phone, wrong assignment/duplicate device, data/Rules regression and credential exposure. | Tabletop exercises with the transport owner and corrected runbooks. Existing partial ops notes are inputs, not completed drills. |
| **OPS-04 — Ownership/support** | Record transport and technical owners, an approved in-app help contact, and a timetable/manual-dispatch fallback. | Confirmed ownership and visible, approved support information; no fabricated names or contacts. |
| **OPS-05 — Capacity/budgets** | Model sample ingest approximately as active buses divided by sample interval, plus heartbeats and viewer fan-out. Estimate RTDB egress/connections and API/ORS use from real fleet/viewer data. | Owner-approved numbers, budget and configured thresholds; no production sizing is inferred from a developer smoke test. |
| **OPS-06 — Availability** | Monitor both `/api/healthz` and an authorized read with a designated monitor account during transport hours. | Measured cohort-period availability against the **≥99.5% target**. A single health 200 is not uptime evidence. |
| **OPS-07 — Field quality** | Collect timestamped capture-to-render, freshness, End visibility, revocation and web-result observations using documented device/network conditions. | Report p95 capture→render **≤15 s**, fresh minutes **≥95%**, End hidden **≤5 s**, revocation **≤60 s**, web result **≤3 s on 4G** as targets; record misses without concealing them. |

Recommended sequence is to agree owners and privacy-safe event definitions, obtain
fleet/viewer estimates, instrument the limited cohort, establish thresholds, then
run alert/tabletop drills. Outputs should include a capacity worksheet, metrics
definitions, runbooks and an evidence-backed readiness review. None is presented
here as an operating production system.

### 9.2 W7 — Migration, controlled validation and rollout

| ID | Proposed design | Evidence needed before declaring it complete |
|---|---|---|
| **MIG-01 — Inventory/reconciliation** | Compare authorized legacy PostgreSQL and RTDB records by counts, IDs, normalized bus identifiers and geometry; produce per-record differences and collision decisions. | Reviewed reconciliation report; all collisions resolved before import. Existing preview/planner code is not the completed institutional comparison. |
| **MIG-02 — Isolated rehearsal** | Rehearse import and Rules in a separate staging project/emulator, then exercise every role and compare expected records. | AC-27 evidence with counts/content reconciliation; mismatches block cutover. Never use live records destructively to manufacture evidence. |
| **MIG-03 — Cutover/rollback** | Obtain an approved write-freeze window, backup, final import and designation of a single authoritative store. Roll back by restoring an approved backup, **not** by reopening insecure legacy public writes. | Owner-approved plan plus an isolated restoration/rollback rehearsal. |
| **ROL-01 — Controlled cohort** | After prerequisites, select an owner-approved limited group; v2.0 suggests **2–3 buses, one shift, two weeks** as an example, not an agreed commitment. Measure the defined targets and log incidents. | A documented go/no-go review with the transport owner. No real cohort has been run for this report. |
| **ROL-02 — Onboarding** | Provide permission/device guidance, unaided driver practice, student/staff communication, support contact and fallback instructions. | Observed unaided starts, recorded support issues and approved communication/privacy material. |
| **ROL-03 — Phased expansion** | Expand by route groups only after each phase's reliability/support review. Retain a rollback/fallback decision for each phase. | Per-phase results and explicit go/no-go decisions, then university-wide authorization. |

This work depends on validated native behavior, applicable Rules publication,
security closure, recoverable data and W6's operating controls. A script that can
import records does not authorize the import; a proposed cohort does not imply
university permission.

### 9.3 Other follow-on work and long-term completion

Before a live cohort, the most immediate work is current Rules publication after
QA, old ORS-key revocation, SEC-03 hardening, W0-03/W0-05 verification and real
NAT-01–NAT-06 rehearsals. Additional designed work includes MFA/step-up,
roster-assisted approval, backup/restore, log/privacy review, App Check where
compatible, production retention scheduling, broader device validation and
measured client performance. These are not implemented by this report.

The long-term definition of done remains [v2.0 §9](PU-Transit-PRD-Remaining.md#9-definition-of-done--university-wide-daily-use-v11-19-current-state).
It explicitly requires:

> “Monitoring, budget alerts, retention cleanup and support ownership ready”

and:

> “Transport owner validates field operation; project owner approves rollout”

The associated native, role/assignment, safe-migration/recovery, security/privacy
and controlled-validation gates must also be met. This report does **not** claim
that university-wide definition of done, or all v2.1 submission gates, is satisfied.

## 10. Conclusion

PU Transit delivers a substantial, locally tested web/API implementation and a
native-driver feasibility codebase. The strongest demonstrated outcomes are
explicit tracking-state semantics, user-token/Rules authorization, route/version
integrity, administrative workflows and documented failure behavior. The evidence
pack makes those claims inspectable instead of relying on a polished interface.

The unresolved technical claim is real-device background reliability; the
unresolved release claims include current policy publication and production
security/operational readiness. Separating these from implemented code is part of
the project's engineering result. W6/W7 are intentionally documented designs
requiring institutional participation, not features presented as completed.

The project can therefore be evaluated for the implementation and bounded
verification it actually contains, while the recorded gaps define the work needed
before an honest live demonstration and eventual university-wide operation.

## 11. References and reproducibility

- [Delivery status (former README): actual delivery and grader setup](Delivery-Status.md)
- [Product PRD v1.1](PU-Transit-PRD.md)
- [Remaining-Work PRD v2.0](PU-Transit-PRD-Remaining.md)
- [v2.1 Final Polish & Delivery Addendum](../attached_assets/PU-Transit-v2.1-Final-Polish-Addendum_%282%29_1789293819370.md)
  — the three uploaded copies are byte-identical; this report cites one, not three
  independent sources.
- [Baseline audit](PU-Transit-Audit.md)
- [Tracking contract](Phase-2-Reliable-Tracking.md)
- [Route publishing/versioning](route-publishing.md), [bus registry](buses-registry.md)
  and [assignments/handover](assignments.md)
- [Firebase setup/publication guide](Firebase-Setup.md) and [operations notes](ops-notes.md)
- [Evidence collection and AC-ID index](evidence/README.md)
- [DOC-03 automated-run summary](evidence/2026-09-14-doc03-test-results.md)
- [DOC-04 local-setup verification](evidence/2026-09-14-doc04-local-setup.md)

For reproduction, follow the README's scoped install/build/test commands and
respect its distinction between credential-free checks and real-project
authenticated actions. Do not publish Rules, run maintenance/import jobs or
modify shared live records merely to reproduce this report.