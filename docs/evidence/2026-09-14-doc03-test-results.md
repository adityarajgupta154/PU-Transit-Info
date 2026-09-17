# DOC-03 — collected automated test results

Date: **14 September 2026 (Asia/Kolkata)**  
Status: **local PASS**, not production/device acceptance. Both commands below exited 0
during DOC-03. No live database writes, Rules publication, credentials or device runs
were involved.

References: [README §10](../Delivery-Status.md#10-testing-and-verification) ·
[PRD acceptance definitions](../PU-Transit-PRD.md#13-acceptance-scenarios) ·
[full AC-ID index](README.md#index-by-acceptance-id).

## Firebase Security Rules

```sh
pnpm --filter @workspace/scripts run firebase:rules:test
```

**26 tests · 26 passed · 0 failed · 0 skipped · 0 cancelled · 0 todo.**
Runner duration: **5,319.12 ms** (test-runner time, not emulator startup or app latency).

- Runs `scripts/src/firebase-rules.test.ts` against the isolated `demo-pu-transit`
  Realtime Database emulator configured in `firebase/firebase.json`.
- `firebase/database.rules.json` and the Setup-served
  `artifacts/pu-transit/public/firebase-database.rules.json` were byte-identical.
- [Result artifact](2026-09-14-firebase-rules-results.txt) contains all 26 verdicts,
  timings, exact command and SHA-256 of the tested Rules payload/test source.
- Expected `permission_denied` warnings are negative-test evidence, not suite failures.
  The stored report omits those warnings and emulator startup/shutdown chatter.

| Coverage | Supported IDs / limit |
|---|---|
| Authentication, verification, membership, role and expiry/grace gates | AUTH-01–04, IDN-01, AC-01/02/29/30/32; AC-31 only under the amended grace policy |
| Trip ownership, sequence/quality checks, End tombstones, replacement and force-end authorization | AC-06/08/09/13/14/15/17/23 at the database-policy layer |
| Registry, path verification, published versions, archive protections and dated assignments | FLT-03, RTE-01–03, ASG-01, AC-19/20 |
| Admin-only audit/maintenance and retention access | ADM-09, SEC-05 authorization only; not proof that a scheduled job ran |

The historical [11/11 publication record](2026-09-12-w0-01-rules-publish.md) and
[16/16 access-model record](2026-09-13-access-model.md) concern earlier snapshots.
The current local 26/26 result does **not** establish that the new payload is published.

## Express API

```sh
pnpm --filter @workspace/api-server exec vitest run \
  --reporter=json --outputFile=/tmp/doc03/api-results.json
```

**97 tests · 11 files · 97 passed · 0 failed · 0 pending.**
The [result artifact](2026-09-14-api-unit-results.txt) is normalized from Vitest's JSON:
every test's name, status and duration plus each test file's SHA-256 are retained.
Console request/error dumps are excluded. Test durations are **not API latency measurements**.

File paths below are relative to `artifacts/api-server/src/`.

| Test file | Passed | Supports / does not establish |
|---|---:|---|
| `lib/tracking.test.ts` | 15 | Ownership, idempotency, sample validation/quality, End and feed aging: AC-06/08/09/11/12/13/14/15/17; AC-25 server expiry only, never device screen-off proof |
| `lib/audit.test.ts` | 3 | ADM-09 audit shape and bounded summaries; not an observed live admin action |
| `middleware/rate-limit.test.ts` | 5 | SEC-01 bucket/429 behavior; not fleet-capacity or load-test sign-off |
| `routes/assignments.test.ts` | 7 | ASG-01, date/timezone conflicts, assignment/Start eligibility and live-trip protection |
| `routes/buses.test.ts` | 16 | FLT-01–03, RTE-01–04, AC-19/20/21; includes same-UUID save retry and audit-failure retry |
| `routes/geo.test.ts` | 12 | W0-04 proxy auth, bounds, provider failures/timeouts; not basemap UI fallback (AC-04) |
| `routes/handover.test.ts` | 7 | ADM-10 / AC-23 authorization, replacement and audit contract |
| `routes/membership-expiry.test.ts` | 5 | IDN-01 / AC-02 expiry denial and admin extension/clear; not UI revocation timing |
| `routes/request-bounds.test.ts` | 6 | SEC-02 body/string/array/path limits and rejection without writes |
| `routes/service-calendar.test.ts` | 2 | STU-04b admin/member calendar behavior |
| `routes/transit.test.ts` | 19 | AUTH-01–04, IDN-04, AC-01/02/29/30/32; personal-email grace/expiry, root protection, notices and force-end forwarding |
| **Total** | **97** | **All local unit tests passed; not all acceptance scenarios passed** |

Firebase transport/auth are replaced by test doubles here. These tests cannot prove
cryptographic token verification, real mobile GPS, background survival, proxy/origin
behavior on a published domain, or whether the owner published the Rules.

## Rehearsals and other evidence

- [W0-03](rehearsal-log-w0-03.md): **NOT RUN**; the missing log is now an explicit
  status/protocol record, not a fabricated trip report.
- [NAT-01](rehearsal-log-nat01.md): **NOT RUN**; original feasibility protocol and
  empty result fields collected without changing the verdict.
- [NAT-05](rehearsal-log-nat05.md) and [NAT-06](rehearsal-log-nat06.md) are also
  collected here; NAT-06's historical credential-free transport passes remain
  separate from its unrun phone cases.
- Existing web/browser, security, retention and publication reports are linked in
  the [requirement index](README.md#index-by-requirement--workstream-id); those checks
  were not rerun for this documentation collection.