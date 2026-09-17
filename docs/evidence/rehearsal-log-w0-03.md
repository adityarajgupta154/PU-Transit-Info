# W0-03 — live web driver/student rehearsal log

Collected: **14 September 2026**  
Status: **NOT RUN — device intake was skipped.** No recorded live trip, device/browser
details, timings, force-end observation or live audit-row observation were found.
This is the canonical pending log; the checklist below is a protocol, not evidence
that any step occurred.

Sources: [README §10](../Delivery-Status.md#10-testing-and-verification),
[Remaining-Work PRD W0](../PU-Transit-PRD-Remaining.md#w0--immediate-owner-actions-and-live-rehearsal-size-s),
[historical Rules publication](2026-09-12-w0-01-rules-publish.md).
The historical publication report explicitly deferred in-app force-end/audit
verification to this rehearsal.

## IDs supported when a run is recorded

W0-03; DRV-01/04/06/07; STU-01/02/03; ADM-06/09;
AC-03/11/12/15/23 (definitions in [PRD §13](../PU-Transit-PRD.md#13-acceptance-scenarios)).
This **web** rehearsal cannot close native screen-off AC-10; use
[NAT-01](rehearsal-log-nat01.md) for that.

## Prerequisites — not confirmed here

- Owner available with a real driver phone and a separate student device.
- Approved test identities, a registered/serviceable bus and the intended assignment.
- Legacy routes imported as agreed before this rehearsal.
- Applicable Rules published and API reachable from both devices.
- Any fixture cleanup authorized separately; do not delete data simply to fill this log.
- Driver browser stays foregrounded; observe safely while stationary or have a
  separate operator. The driver must not operate the phone while driving.

## Run details — NOT RECORDED

| Field | Recorded value |
|---|---|
| Run date, start/end time and timezone | Not recorded |
| Driver device, OS and browser version | Not recorded |
| Student device, OS and browser version | Not recorded |
| App build/reference and environment | Not recorded |
| Rules publication reference | Not recorded |
| Test account roles, bus/route identifiers | Not recorded |
| Network type and deliberate outage window | Not recorded |
| Observer, evidence links, defects | Not recorded |
| Overall verdict | **NOT RUN** |

Use test labels, not passwords/tokens or personal account details.

## Observation checklist — all pending

Record **expected and actual state, driver timestamp, student timestamp, last-update
age, latency, evidence link and any defect** for each step. Do not infer live
timings from unit-test durations.

| Step | Expected observation | IDs | Actual result / evidence |
|---|---|---|---|
| Find the assigned bus/route on student device | Correct route, ordered stops and honest current status | AC-03, STU-01/02/03 | **NOT RUN** |
| Start on driver phone | Acquiring until valid GPS; live only after acknowledged fresh sample; student sees matching state/timestamps | DRV-01/04, AC-03 | **NOT RUN** |
| Disable driver network | Student ages to delayed, then offline at configured thresholds; no falsely fresh point | AC-11 | **NOT RUN** |
| Restore network | Fresh acknowledged fix restores live; stale queued fixes are not presented as fresh | AC-12 | **NOT RUN** |
| End normally | Collection stops; End acknowledged; active student location hidden | AC-15, DRV-06 | **NOT RUN** |
| With an explicitly started test trip, admin force-ends it | Old driver cannot resume that trip; student state updates; System tab shows matching audit event | AC-23, ADM-06/09 | **NOT RUN** |

## Sign-off

No sign-off. Replace the pending observations only with actual results; retain
failed runs and defects. Link reviewed screenshots/log exports here and update the
[AC-ID index](README.md#index-by-acceptance-id). Never mark W0-03 passed solely
because the emulator or API unit suite passed.