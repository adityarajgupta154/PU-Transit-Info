# Dated assignments (ASG-01 / ADM-05)

Built 13 Sep 2026. A dated assignment puts a driver on a bus for **one service day and one shift** without touching the standing bus on the Users tab. The standing `assignedBusId` keeps working; a dated assignment *adds* a bus the driver may start that day. Trips still begin from the driver's phone — nothing starts from this schedule.

## Data

`assignments/{driverUid}/{id}` with `id = serviceDate_shiftKey_busId` (`shiftKey` = the route's shift lowercased with non-alphanumerics removed, e.g. `2026-09-14_firstshift_GJ06BX2020`).

| field | meaning |
| --- | --- |
| `driverUid`, `driverEmail` | the driver; the email is copied from the membership so conflict messages can name people |
| `busId` | registry key (`busKey`), must be an **active** bus at save time |
| `routeId`, `routeVersion` | a published or legacy route of that bus and its `publishedVersion` when saved (informational: Start pins its own versions) |
| `shift` | copied from the route — the route decides the shift |
| `serviceDate` | calendar date in Asia/Kolkata (`YYYY-MM-DD`) |
| `startsAt`, `endsAt` | IST midnight opening that date and +24 h; the window the API and Rules check |
| `createdAt`, `createdBy` | server time and the admin |

The subtree is per driver so Rules can locate a record from `auth.uid`; a driver reads only their own, admins read everything, only admins write.

## API (admin)

- `GET /api/assignments` — every stored assignment (past ones included; the tab hides those whose day is over).
- `POST /api/assignments` `{ driverUid, busId, routeId, serviceDate }` → 201 with the record. Refusals: 400 (bad or past date), 409 `DRIVER_NOT_ELIGIBLE` (not an approved, active driver), 409 `BUS_OUT_OF_SERVICE` / `BUS_NOT_REGISTERED` (same wording as Start), 409 `ROUTE_NOT_FOR_BUS` (route is a draft, archived, or belongs to another bus), 409 `ASSIGNMENT_CONFLICT` with a message that names the other party: *Bus X is already assigned to a@… on 2026-09-14 (First Shift)* or *a@… already drives bus Y on 2026-09-14 (First Shift)*. Conflicts are **rejected**, never "continue anyway". The same driver, bus, date and shift overwrites (a route change). Audit `assignment.save`.
- `DELETE /api/assignments/{driverUid}/{id}` → 204 (also when absent); 409 `ASSIGNMENT_IN_USE` while a live trip on that bus was started under this assignment. Audit `assignment.delete`.
- `GET /api/auth/me` for an approved, active driver now returns `assignments`: today's (IST) assignments, each with its bus record for the preflight.

## Start under an assignment

`requireDriverAssignment` (API) first checks the standing bus; otherwise it reads the driver's own assignments and accepts one for this bus whose day covers *now* (Start) or ended less than 24 h ago (sample / heartbeat / end, so a trip crossing midnight keeps reporting and ends normally). Start writes `feed.assignmentId` only when the override admitted it; every later write must carry the same id.

Rules mirror this (`scripts/rules-mutations/2026-09-13-assignments.py`, run after `2026-09-13-route-archive.py`; tests in `scripts/src/firebase-rules.test.ts`): the driver branch of `tracking/{busId}` accepts the standing bus **or** a `feed.assignmentId` that belongs to the caller and to this bus — a Start (fresh node, or generation bump with sequence 0) needs the window to cover `now`, any later write needs the same id as the stored one and `now < endsAt + 24 h` — the same grace as the API, so an abandoned node cannot be kept alive for days. `feed/assignmentId` is key-shaped and frozen after Start like `routeVersions`. `tracking/{busId}` became readable by any approved driver (the API reads the node with the driver's token before the CAS write); the feed was member-readable already and driver writes still require `driverUid == auth.uid`. Part of the **unpublished** 13 Sep payload; nothing in live data changes.

## Handover (ADM-10 / ADM-06)

`POST /api/tracking/{busId}/handover` `{ nextDriverUid, routeId?, reason? }` (admin) replaces "force-end, then ask the next driver to Start" with one confirmed action. Order: read the current node (404 `NOT_STARTED` when the bus never reported; 400 when the next driver already holds it) → authorize the next driver — nothing to write when this is their standing bus; otherwise a dated assignment for **today (IST)** on `routeId`, a published route of this bus (400 `ROUTE_REQUIRED` without it; the usual 409s `DRIVER_NOT_ELIGIBLE` / `ROUTE_NOT_FOR_BUS` / `ASSIGNMENT_CONFLICT` with names, and a refusal changes nothing) — → force-end the trip **the admin looked at** (bound to that driver and generation: a bus that changed hands meanwhile is 409 `OWNER_CHANGED` and the other trip is untouched; `already_ended` is reported, not refused, the next driver is authorized either way) → **one** audit `tracking.handover` whose summary names both drivers first (email + uid; the reason is what gets cut at the 300-char limit), then the trip and generation, the assignment id and the reason. Response `{ outcome, feed, previousDriverUid, assignment | null, auditId }`.

A handover reassigns the bus itself, so whoever the bus was booked for that shift is overridden — the outgoing driver's own dated assignment, or a booking that never started — the same known limit as a standing driver; the next driver being booked on **another** bus at that time is still refused with names. Nothing is deleted: the outgoing driver's record stays, because the trip under it is ended and removing it would turn the old phone's next upload into a 403 the tracker does not treat as "session gone". So handovers chain (A → B → C on one day) and the previous phone drops to idle the same way as after a force-end: its next sample or heartbeat is 409 `SESSION_CONFLICT`; its own End stays idempotent (200, phase `ended`). The next driver's Start on the handed-over bus succeeds at once (an ended node needs no lease to expire) and pins `feed.assignmentId` when an assignment was written.

Not atomic across the two nodes: if the end fails after the assignment was written (provider error, `OWNER_CHANGED`), the response is an error and the next driver's authorization stays; running the handover again from the refreshed tile overwrites the same assignment key rather than duplicating it, or the record can be removed in the assignments tab.

Fleet tile → **hand over**: next driver (approved, active) → route of this bus only when their usual bus is another one → optional reason → one confirm. The plain **end trip from office** stays for the case without a successor. Rules: only the audit action joins the enum (`scripts/rules-mutations/2026-09-13-handover.py`, after `2026-09-13-assignments.py`; unpublished with the rest of the 13 Sep payload) — the admin end branch and the assignment write already existed. Limit: the authorization is for today's IST date; a handover minutes before midnight leaves the next driver a Start window that closes at 00:00.

## Clients

- Admin → **assignments** tab: driver → active bus → published route of that bus (shows shift and version) → date (defaults to today IST, past dates disabled). The form runs the same conflict check against the loaded list and names the other driver or bus before you save; the save button stays disabled until the conflict is gone. A conflict the form did not know about (another admin saved meanwhile) comes back from the API and is shown inline. Upcoming assignments list with a two-step *remove*.
- Web driver page and native app: options = today's assignments first, then the standing bus (a dated assignment for the standing bus itself appears once). The first option is the default; a picker appears only with two or more, disabled while a trip is running. Once a trip is in flight the client keeps its bus even if the options change underneath (an office edit, the IST day rolling over) — the tracker is keyed on the bus and rebuilding it would end the trip; the lock clears when the phase returns to idle. The *bus assigned* row says `bus · shift · today's assignment`; the *bus in service* row uses the selected bus's registry record. The shared helper is `driverBusOptions` in `lib/driver-tracking`.

## Known limits

- An override **adds** to the standing bus rather than replacing it for that day; a driver moved to another bus can still start their usual one. Blocking the standing bus would surprise the driver whose replacement never turned up.
- The cross-driver conflict check is API-side (Rules cannot scan other drivers' subtrees); two admins saving the same slot in the same second is not caught. Same class as the live-trip gates (FLT-03 precedent).
- No warning when a dated assignment overlaps a *standing* driver of that bus (the standing driver keeps starting it); the office decides who actually drives.
- Deletion is refused while the trip is live, but as an API precheck (same class as the other live-trip gates): a Start landing between the check and the delete leaves a trip whose later writes fail against the missing record until an admin force-ends it.
- After an app restart past midnight the override bus is no longer offered, so a pending End left from that trip is not flushed until the driver is put on that bus again (the server still accepts it for 24 h); an admin can force-end meanwhile — the same behaviour as a standing-bus change mid-trip.
- A tombstone end (no node exists) carries no assignment id, so an override driver cannot write one; the API answers the usual 403 for a bus that is not theirs.
- `routeVersion` is informational; Start pins the current published versions of every route of the bus, as always.
- No history view or cleanup of past assignments; `GET /api/assignments` returns them all.
- No per-shift time windows: an assignment for the First Shift admits a Start at any time of that IST day.
