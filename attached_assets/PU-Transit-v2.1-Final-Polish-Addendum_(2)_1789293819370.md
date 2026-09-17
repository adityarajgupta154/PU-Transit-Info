# PU Transit — v2.1 Final Polish & Delivery Addendum
**Companion to:** `docs/PU-Transit-Remaining-Work-PRD.md` v2.0 (the eight-workstream document) and `README.md` v1.1 — read both first.
**Date:** 12 September 2026
**Status:** Draft — for project-owner approval before implementation starts
**Purpose:** v2.0 is an accurate, well-scoped engineering document. This addendum does three things v2.0 doesn't: (1) sanity-checks its scope against a real academic deadline, (2) splits the remaining work into "must actually get built and demoed" vs "correctly designed but honestly documented as future work," and (3) adds the submission-specific deliverables a college evaluation needs that a production PRD wouldn't otherwise include. Nothing here contradicts v2.0's requirements or acceptance criteria — it only reorders and re-scopes them for a fixed deadline.

---

## 1. Analysis of v2.0 — what's strong, what to watch

**Strong, keep as-is:**
- The honesty discipline (21/31 done, 7 partial, nothing claimed that isn't true) is unusual and genuinely valuable — keep this voice in every future document, including the final report. It's a differentiator in a college evaluation, not just process hygiene.
- W0 is well-designed: cheap, owner-blocked items go first, and they unblock almost everything else (Rules publish → force-end/audit actually work; ORS key server-side → no more exposed secret; live rehearsal → first real proof point).
- The decisions register (§4) correctly refuses to let engineering guess university-specific facts (phone inventory, retention policy, fleet scale). Keep enforcing this — don't let an AI coding agent quietly invent a device matrix or a retention period.
- The dependency graph in §8 (R0→R9) is sound and matches how the risk is actually distributed (native tracking is the one true unknown; everything else is known engineering work).

**Needs attention before you hand this to Replit:**
- **Scope vs. deadline mismatch.** W5 (rate limiting, backups+restore rehearsal, App Check), W6 (full metrics/alerting/capacity model with real budgets), and W7 (migration rehearsal, controlled validation cohort with real students, phased rollout) describe what a **production university system** needs before **real daily use**. That is correct for v1.1's stated goal ("university ke daily use ke liye") but is very unlikely to fit inside a single academic term alongside W1 (native tracking, the hardest item). Section 2 below splits this explicitly so you don't spend your remaining time budget on infrastructure a grader will never see instead of on the features they will.
- **No submission-specific deliverables.** v2.0 is written as if this project continues indefinitely toward real rollout. A college submission needs a report, a demo script, and evidence artifacts (test results, rehearsal logs) that v2.0 doesn't ask for by name. Section 4 adds these.
- **Native tracking timeline risk isn't insured.** §4 of v2.0 correctly says "Android-only is not assumed" and blocks on the phone inventory. For a graded deadline, add an explicit fallback plan now (Section 3) rather than discovering in the last week that the inventory never arrived.

---

## 2. Scope triage: Core Submission Scope vs. Documented-Only Future Work

Everything in v2.0 is worth building *eventually*. Not everything is worth building *before the deadline*. Below, every workstream item is bucketed. Items not listed under "Core" get a short written plan in the final report instead of code — and the report must say plainly that they are not implemented, per the project's own honesty rule.

### Core Submission Scope (build and demo these)

| Workstream | Items to actually build | Why |
|---|---|---|
| W0 | W0-01 through W0-05 (all) | Small, owner-blocked, high credibility, unblocks everything else |
| W1 (native tracking) | NAT-01 through NAT-06 | This is the project's core technical claim (background tracking). Must be proven on at least one real device per available OS. NAT-07 (fleet-wide battery study), NAT-08 (store distribution), NAT-09 (formal multi-driver onboarding materials) assume a real fleet — reduce to "documented, tested on the loaner device(s) only" |
| W2 (identity) | IDN-01 (membership expiry), IDN-02 (revocation propagation) | Small, closes a real gap already partially built, cheap to test |
| W3 (fleet/routes) | FLT-01–03, RTE-01–03, ASG-01, ADM-10 | Natural continuation of Phase 3 admin work already shipped; strong demo value; moderate effort |
| W4 (student) | STU-04b (no-service state), A11Y-01 (accessibility audit) | Cheap, visible polish; accessibility audit is genuinely good engineering evidence for a grader |
| W5 (security — light slice only) | SEC-01, SEC-02, SEC-03, SEC-04 | Rate limits, request bounds, CORS, secrets hygiene — all achievable in isolation, all defensible in a viva ("why is this secure") |
| Documentation | New — see Section 4 | Report, demo script, test evidence |

### Documented-Only Future Work (design it, write it down, do not build)

| Workstream | Items | Why deferred |
|---|---|---|
| W2 remainder | IDN-03 (admin MFA — needs a paid Identity Platform upgrade), IDN-04 (email-change flow test), IDN-05 (roster-assisted approval — needs real roster data) | Needs external dependencies (paid tier, real university roster) outside student control |
| W5 remainder | SEC-05 (retention job), SEC-06 (backups/restore), SEC-07 (log hygiene review), SEC-08 (App Check), PRIV-01/02 | Real operational concerns; SEC-05 is worth attempting only if W1 and Core W3 finish early (see Section 5 stretch list) |
| W6 (all) | OPS-01 through OPS-07 | Full observability/alerting/capacity-with-real-budgets is a production-ops concern, not a course deliverable. Write the plan; don't build the alerting pipeline. |
| W7 (all) | MIG-01 through MIG-03, ROL-01 through ROL-03 | Requires actual legacy data access, a real cohort of students/drivers, and university sign-off — structurally outside a single-term student project |

This triage itself is a legitimate thing to put in the final report: *"We scoped W6/W7 as documented future work because they require real institutional resources (legacy data access, a live driver cohort, budget sign-off) outside a course project's control — see Appendix X for the design."* That reads as engineering judgment, not as work avoided.

---

## 3. Native tracking (W1) fallback plan — insure the deadline

W1 is the one item on the critical path with genuine external-dependency risk (driver phone inventory, per v2.0 §4). Decide the fallback **now**, not in the last week:

- **If a real Android and/or iOS device is available (even one loaner of each):** run NAT-01 through NAT-06 for real. This is by far the strongest possible demo evidence.
- **If no device becomes available in time:** do not fabricate a "supported matrix." Instead: (a) build the native app fully in Expo including the background-task code, (b) demonstrate it working in a **development build on whatever device is available, even the developer's own phone**, explicitly labeled as a single-device feasibility proof rather than a fleet-validated result, and (c) write the device-matrix rollout plan as future work. This still satisfies v2.0's own rule ("a spike on one loaner Android + one iOS device is allowed only as a feasibility check, not as the supported matrix") and keeps the honesty discipline intact.
- Either way, record the rehearsal log (device, OS version, route duration, sample freshness %) — this log is submission evidence, independent of how many devices you tested on.

---

## 4. New: submission-specific deliverables (not in v2.0, needed for grading)

| ID | Deliverable | Content |
|---|---|---|
| DOC-01 | **Final project report** | Problem, architecture, what v1.1/v2.0 asked for, what was built vs. deferred (cite the Section 2 triage), security model, test evidence, known limitations, future work (W6/W7 as designed-not-built) |
| DOC-02 | **Demo script + video** | End-to-end: admin creates bus/route/assignment → driver starts trip (native, screen-off if device available) → student sees live→delayed→offline → driver ends trip → admin audit log shows the event. Follows the same journey as v1.1 AC-10/15/23. |
| DOC-03 | **Test evidence pack** | Firebase Rules emulator test results, API unit test results, the W0-03 live rehearsal log, the NAT rehearsal log — collected in one `docs/evidence/` folder, referenced by AC-ID in the report |
| DOC-04 | **README refresh** | Final README reflecting actual shipped state (not aspirational), setup instructions a grader could follow to run it locally |
| DOC-05 | **Architecture diagram (visual)** | One clear diagram: web/native clients → Express API → Firebase Auth/RTDB/Rules → ORS proxy. Worth generating as a real image for the report/slides, not just the ASCII diagram in v1.1 §8 |

---

## 5. If time remains after Core Scope (stretch list, in priority order)

Only touch these after everything in Section 2's Core Scope is built, tested, and demoable:
1. SEC-05 (retention cleanup job) — closes AC-26, cheap if Cloud Functions are already set up for other things.
2. IDN-04 (email-change re-verification flow test) — small, closes a named acceptance scenario (AC-32).
3. RTE-04 (draft preservation + unsaved-edit warning in route editor) — small polish, good UX credibility.
4. PERF-01 (lazy-load map code) — easy, measurable, good "we profiled this" story for the report.

---

## 6. Revised delivery order (academic-deadline version of v2.0 §8)

| Step | Scope | Depends on |
|---|---|---|
| F0 | W0 (all) | Owner, one driver phone |
| F1 | Native feasibility spike (NAT-01) — real device if available, else single-device fallback per Section 3 | F0, phone inventory or fallback decision |
| F2 | Rest of native app (NAT-02–06) | F1 |
| F3 | W3 core (FLT-01–03, RTE-01–03, ASG-01, ADM-10) — can run in parallel with F1/F2, separate code area | F0 |
| F4 | W2 core (IDN-01, IDN-02) + W4 core (STU-04b, A11Y-01) | F0 |
| F5 | W5 light slice (SEC-01–04) | F0 |
| F6 | Stretch list (Section 5) — only if time remains | F1–F5 done |
| F7 | Documentation deliverables (DOC-01–05) | Everything above; start DOC-01/DOC-04 drafts early and update continuously, don't leave to the very end |

Rule carried over from v1.1/v2.0: no decorative UI work before F1/F2 prove background tracking. This still matters most for a grader — a polished screen with a fake "live" badge is worse than an honest "acquiring GPS" state on a rough screen.

---

## 7. Definition of done — for submission (distinct from v2.0 §9's "university-wide daily use")

- [ ] W0 complete; live web rehearsal log exists
- [ ] Native app demonstrates background tracking on at least one real device, honestly labeled per Section 3
- [ ] W3 core items shipped and pass their AC-19–AC-23 scenarios
- [ ] W2 core (expiry + revocation propagation) shipped and tested
- [ ] W4 core (no-service state, accessibility audit) shipped
- [ ] W5 light slice shipped (rate limits, request bounds, CORS, secrets hygiene)
- [ ] Rules/API test suite passing, results saved as evidence
- [ ] Final report written, explicitly separating built vs. documented-future-work per Section 2
- [ ] Demo video recorded
- [ ] README reflects actual final state

This is the DoD to aim for by the submission deadline. v2.0 §9's "university-wide daily use" DoD remains the correct long-term target and should be quoted in the report's future-work section, not claimed as met.
