# Test and rehearsal evidence index

**DOC-03 · Collected 14 September 2026.** Start here for the evidence behind
[README §10 — Testing and verification](../Delivery-Status.md#10-testing-and-verification)
and its [acceptance-scenario status](../Delivery-Status.md#4-status-of-the-other-prd-sections).
The AC-ID definitions are in [PRD §13 — Acceptance scenarios](../PU-Transit-PRD.md#13-acceptance-scenarios);
workstream IDs are in the [Remaining-Work PRD](../PU-Transit-PRD-Remaining.md#5-workstreams).

**Collection is complete; acceptance is not.** A passing unit/emulator check is not a
phone rehearsal, a Rules publication, or production sign-off.

## Requested evidence

| Evidence | Result / scope | Record |
|---|---|---|
| Firebase Security Rules | **PASS — local:** 26/26, 0 failed/skipped; both Rules copies byte-identical. Current checked-in payload, not a publication claim. | [Run summary and coverage](2026-09-14-doc03-test-results.md#firebase-security-rules) · [26 result lines, totals and hashes](2026-09-14-firebase-rules-results.txt) |
| Express API unit tests | **PASS — local:** 97/97 across 11 files, 0 failed/pending. Firebase/auth boundaries are mocked. | [Run summary and per-file coverage](2026-09-14-doc03-test-results.md#express-api) · [97 result lines, totals and hashes](2026-09-14-api-unit-results.txt) |
| W0-03 live web rehearsal | **NOT RUN:** device intake was skipped; no driver/student device observations or timings recorded. | [Canonical log and pending checklist](rehearsal-log-w0-03.md) |
| NAT-01 screen-off rehearsal | **NOT RUN:** build/device path remains blocked; protocol and empty results are preserved. | [Canonical feasibility log](rehearsal-log-nat01.md) |

The two automated suites were run for this collection on **14 September 2026**.
The `.txt` artifacts retain individual test verdicts; expected denial warnings and API
request dumps were omitted, not reclassified as failures. Commands and source hashes
are included. The device logs are protocols/status records, **not measured results**.

## Index by acceptance ID

“Local” below means only the named layer was checked. “Recorded” points to an earlier
dated report; it does not imply that its checks were repeated during DOC-03.

| AC-ID | Scenario referenced by README / PRD | Supporting evidence and remaining limit |
|---|---|---|
| AC-01, AC-02 | Unauthenticated / unapproved / expired access denied | [Rules + API](2026-09-14-doc03-test-results.md): local gates pass; [NAT-06](rehearsal-log-nat06.md#3-negative-tests--same-cases-native-transport) has historical credential-free transport checks, not phone acceptance. |
| AC-03 | Correct published route, stops and current status | [API route/version tests](2026-09-14-doc03-test-results.md#express-api) cover data selection; rider observation remains [W0-03 NOT RUN](rehearsal-log-w0-03.md). |
| AC-04 | Map failure leaves text route usable | **Gap:** [W0-04](2026-09-13-w0-04-ors-proxy.md) checks ORS proxy errors, not a failed basemap or this UI acceptance scenario. |
| AC-05 | Declined personal-location permission does not stop bus tracking | [Accessibility report](2026-09-14-a11y01-audit.md) records opt-in/location UI checks; full permission-denial/no-upload acceptance is not established by the suites collected here. |
| AC-06 | Driver cannot publish for another bus | [Rules/API tracking and assignment tests](2026-09-14-doc03-test-results.md): local authorization checks, not a phone run. |
| AC-07 | Missing background permission blocks Start | Protocol in [NAT-02 permission review](../permission-review-nat02.md); device review **NOT RUN**. |
| AC-08, AC-09 | Retried Start / concurrent publishers | [Rules/API contract tests](2026-09-14-doc03-test-results.md) pass locally; [NAT-05 parity rehearsal](rehearsal-log-nat05.md) **NOT RUN** on device. |
| AC-10 | Screen-off/background updates | [NAT-01](rehearsal-log-nat01.md#results--not-run) **NOT RUN**. No emulator/unit result is evidence of OS background collection. |
| AC-11, AC-12 | Network loss, aging and safe reconnect | [API tracking tests](2026-09-14-doc03-test-results.md#express-api) check state/stale-sample contracts; [W0-03](rehearsal-log-w0-03.md), [NAT-01](rehearsal-log-nat01.md) and [NAT-05](rehearsal-log-nat05.md) device observations are pending. |
| AC-13, AC-14 | Weak GPS / invalid, future or old samples | [Rules/API tracking tests](2026-09-14-doc03-test-results.md) pass for data/sequence/quality invariants; not a real GPS-quality rehearsal. |
| AC-15, AC-16, AC-17 | End, offline pending-End and stale publisher rejection | [Rules/API tests](2026-09-14-doc03-test-results.md) cover server End/replay rejection, not offline collection stopping or client persistence. [NAT-05](rehearsal-log-nat05.md) and [W0-03](rehearsal-log-w0-03.md) remain pending. |
| AC-18 | Revocation denies access and clears open UI | [IDN-02](2026-09-14-idn02-revocation.md): recorded emulator-backed browser measurement **0.9–3.7 s**; [current Rules/API](2026-09-14-doc03-test-results.md) check denial. Published-app rerun pending. |
| AC-19, AC-20 | Version pinning / protect routes used by a trip | [Rules/API route tests](2026-09-14-doc03-test-results.md) pass locally; [route runbook](../route-publishing.md) records implementation and publication/device limits. |
| AC-21 | Failed save/ORS keeps draft; retry creates no duplicate | [RTE-04](2026-09-14-rte04-route-editor.md): recorded web/browser tests; [current API route test](2026-09-14-doc03-test-results.md#express-api) repeats the idempotent-create/audit-retry check. |
| AC-22 | Cancel destructive confirmation without mutation | [RTE-03 record](../route-publishing.md) reports rendered web confirmation checks; not covered by the two suites rerun here. |
| AC-23 | Force-end / handover revokes publisher and audits | [Rules/API handover tests](2026-09-14-doc03-test-results.md) pass locally; [historical W0-01](2026-09-12-w0-01-rules-publish.md) explicitly defers the real force-end/audit-row observation to [W0-03](rehearsal-log-w0-03.md). |
| AC-24 | Keyboard/screen-reader usability | [A11Y-01](2026-09-14-a11y01-audit.md): recorded web audit; real screen-reader/device checks remain pending. |
| AC-25 | Force-stop/power-off expires feed honestly | [API expiry tests](2026-09-14-doc03-test-results.md#express-api) support the server contract only; native power-off/force-stop drill not run. |
| AC-26 | Retention cleanup and detectable failures | [SEC-05](2026-09-14-sec05-retention.md): recorded isolated-emulator cleanup proof; scheduled production operation pending. Rules ownership gates also pass in the current suite. |
| AC-27 | Staging import counts, IDs and geometry reconcile | [Registry migration notes](../buses-registry.md) and [API import tests](2026-09-14-doc03-test-results.md#express-api) are local/planner checks; **no completed staging cutover rehearsal** recorded. |
| AC-28 | Production-like sign-in, refresh and authorized mutation | [W0-05](w0-05-production-auth-check.md): **blocked/not complete**, app not published. Mocked auth tests do not close this gate. |
| AC-29, AC-30 | Unverified email / pending membership denial | [Rules/API auth tests](2026-09-14-doc03-test-results.md) pass locally; [NAT-06](rehearsal-log-nat06.md) phone steps pending. |
| AC-31 | Email-domain policy | **Amended semantics:** the [13 Sep owner amendment](../Delivery-Status.md#current-owner-amendment--13-sep-2026) permits verified personal-email students within 30-day grace. [Rules/API tests](2026-09-14-doc03-test-results.md) check grace/expiry; they do **not** prove the superseded blanket non-university-domain denial. |
| AC-32 | Changed email requires verification / policy eligibility | [IDN-04](2026-09-14-idn04-email-change.md) plus [current Rules/API tests](2026-09-14-doc03-test-results.md): local pass; published-app owner check pending. |

## Index by requirement / workstream ID

| ID | Evidence |
|---|---|
| DOC-03 | This index and [fresh test-run summary](2026-09-14-doc03-test-results.md). Collection complete 14 Sep 2026; no rehearsal verdict promoted. |
| DOC-04 | [README/local-setup verification](2026-09-14-doc04-local-setup.md) — delivered-state rewrite and credential-free startup/proxy/public-page checks; not a fresh-machine install or authenticated rehearsal. |
| W0-01 | [12 Sep historical Rules publication](2026-09-12-w0-01-rules-publish.md) — owner-reported publication, then 11/11; not the current 26-test payload. |
| W0-02 | [Legacy driverStatus removal](2026-09-12-w0-02-driverstatus-removal.md). |
| W0-03 | [Live web rehearsal — NOT RUN](rehearsal-log-w0-03.md). |
| W0-04 | [ORS proxy/local verification and outstanding old-key revocation](2026-09-13-w0-04-ors-proxy.md) · [preview capture](w0-04-preview-sanity.jpg). |
| W0-05 | [Production auth protocol and pre-publish checks](w0-05-production-auth-check.md). |
| AUTH-01–06, IDN-01, IDN-02, IDN-04 | [13 Sep access-model record](2026-09-13-access-model.md), [current Rules/API](2026-09-14-doc03-test-results.md), [revocation timing](2026-09-14-idn02-revocation.md), [email change](2026-09-14-idn04-email-change.md), [NAT-06](rehearsal-log-nat06.md). |
| NAT-01, NAT-03, DRV-03 | [Single-device feasibility protocol/results](rehearsal-log-nat01.md); build/contract exists, device run pending. |
| NAT-02, NAT-04 | [Permission/preflight review checklist](../permission-review-nat02.md), not a completed device report. |
| NAT-05 | [Ownership/idempotency rehearsal](rehearsal-log-nat05.md) — device NOT RUN. |
| NAT-06, AUTH-06 | [Auth-parity log](rehearsal-log-nat06.md) — historical 5/5 credential-free transport checks; phone scenarios NOT RUN. |
| FLT-01–03, RTE-01–03, ASG-01, ADM-10 | [Current Rules/API coverage](2026-09-14-doc03-test-results.md), [registry](../buses-registry.md), [routes](../route-publishing.md), [assignments/handover](../assignments.md). |
| RTE-04 | [Route editor recovery and navigation checks](2026-09-14-rte04-route-editor.md). |
| A11Y-01 | [Assistive web audit](2026-09-14-a11y01-audit.md). |
| SEC-01, SEC-02 | [Current API tests](2026-09-14-doc03-test-results.md#express-api) · [operations notes](../ops-notes.md). |
| SEC-04 | [Secrets-sweep evidence](2026-09-14-sec04-secrets-sweep.md). |
| SEC-05 | [Retention job proof and production blockers](2026-09-14-sec05-retention.md). |
| STU-04b, ADM-09 | [Service-calendar and audit tests](2026-09-14-doc03-test-results.md#express-api). |

## Keeping this collection honest

- Add dated test outputs and update the relevant AC/requirement row; preserve older
  reports as historical evidence rather than changing their counts.
- Record each real rehearsal with device/build, timestamps, expected vs observed
  states, defects and an explicit verdict. Missing observations stay **NOT RUN**.
- Review device exports/screenshots for credentials, account details and location
  privacy before committing them. Never commit tokens, private keys or service-account JSON.
- The original `docs/rehearsal-log-nat01.md`, `nat05.md` and `nat06.md` locations are
  relocation stubs. Edit the canonical logs in this folder, not those stubs.