# PU Transit — Demo Recording Script and Checklist

**DOC-02 · Prepared 14 September 2026 · Script only — recording pending**  
**Suggested length:** 10–15 minutes, plus an optional separate office-force-end take.
These are recording estimates, not measured app performance.

## Important audit limitation

**Normal driver Start/End does not create an office audit event in the current app.**
After the main trip, show its End in the Driver/Student/Fleet views and show the
actual **bus, route and assignment** entries in Admin → System.

If your recording must also show a **trip-related audit event**, use the clearly
labelled **separate Take B** below: start another demo trip and have the **admin**
end it from the office. That produces `tracking.force_end`, displayed as
**“ended a trip.”** Do not present it as the audit entry for the driver's normal End.
Ordinary Start/End audit recording would require a separate code change.

## 1. Before recording — do not skip

### Access and safety

- [ ] Obtain permission to create test records. The current app can write to the
  **real shared Firebase project**, even when its web/API processes run locally.
  Do not assume a proposed local-demo mode is installed or isolated.
- [ ] Confirm the owner has published the **applicable current Rules after QA**.
  The collected evidence still records the 13–14 Sep amendments as unpublished.
  Do not weaken Rules, promote the protected root account or run migrations to
  make the recording succeed.
- [ ] Prepare **three separate approved, active, unexpired accounts**:
  admin, driver and student. Email verification/eligibility must already work.
  A requested driver/admin role is not sufficient.
- [ ] Use separate browser profiles/devices so signing in as one role does not
  replace another role's session. Sign in **before** recording.
- [ ] Use a dedicated demo bus, not an in-service bus. Confirm no other publisher
  will use it and the demo driver has no conflicting dated assignment.
- [ ] Keep the **student/admin and API online independently of the driver**.
  Do not use the driver's phone hotspot for the observer's connection.
- [ ] Avoid a test date already marked as no service. Do **not** create or delete
  a university-wide calendar entry just for the demo; choose an agreed test day.
- [ ] Arrange genuine GPS reception, preferably safely outdoors within the
  configured Vadodara map area. A stationary test is acceptable: do not describe
  a stationary marker as a moving bus.
- [ ] Never operate the phone or recording controls while driving. If movement is
  needed, a passenger/observer handles the demonstration.
- [ ] Hide passwords, tokens, notifications and private account details. Do not
  record request headers, a secrets page or the Firebase console.

### Choose one driver branch

| Branch | Requirement | What you may claim |
|---|---|---|
| **A — Native, preferred** | A real phone with an installed, API-connected development/standalone build; native Build check and every Preflight row pass. | Native behavior actually observed on that device for the recorded duration. |
| **B — Web-only fallback** | `/driver` in a foreground browser with genuine location permission and a secure context. | Foreground browser tracking only. **Skip screen-off proof** and label it “native device demonstration not run.” |

Expo Go, a browser preview and an emulator are **not substitutes for native
screen-off evidence**. A two-minute locked-screen clip is not a 45-minute NAT-01
rehearsal or a supported-device matrix. For the full protocol, use the
[NAT-01 log](evidence/rehearsal-log-nat01.md).

For native, check:

- [ ] Location Services on; precise foreground location granted.
- [ ] Android **Allow all the time** / iOS **Always** location granted.
- [ ] Android notifications granted where required; battery setting appropriate
  for the app, including **Unrestricted** where the preflight requires it.
- [ ] API reachable from the phone; every native **Preflight** row green after
  **Re-check**. See the [permission checklist](permission-review-nat02.md).
- [ ] Any optional fault-injection controls are off.
- [ ] If clearing native evidence for a fresh recording, first export any prior
  evidence you need to keep and clear only while idle.

### Run sheet — fill before the take

| Item | Your value — no credentials |
|---|---|
| Date/time and timezone | |
| Driver branch, device model/OS and app build | |
| App/API environment used | |
| Admin / driver / student aliases | |
| Demo bus registration and label | |
| Route start/end, shift and version | |
| Assignment service date, in IST | |
| Raw video filename / take number | |

Example test registration: **`DEMO02A`**, label **`DOC-02 recording only`**.
If it already exists, choose a new agreed test identifier; do not overwrite it.
Labels below follow the current English UI.

## 2. Recording sequence — main take

Start recording before the first mutation. Keep the same bus, assignment and
trip throughout this take. Keep a clock visible or note video timestamps.

### Shot 1 — Introduce the scope · about 20 seconds

**Show:** signed-in admin and the separate driver/student views.

**Say:**
> “This is PU Transit. I will create a demo bus, publish a route, assign a driver,
> and show how the student view distinguishes a fresh location from a delayed or
> offline feed. This recording uses [a native build on this phone / the foreground
> web driver].”

For web fallback add:
> “Native screen-off behavior is not being demonstrated in this take.”

### Shot 2 — Admin creates the bus · about 30–45 seconds

1. Open **Admin → Fleet**.
2. In **bus registry**, enter the agreed **registration** and optional **label**.
3. Click **add bus** once.
4. Show the new registry entry and confirm its status is **active**.

- [ ] The new bus appears; no error or conflicting existing record.

**Say:**
> “This is a separate test bus. A driver must have an eligible assignment to an
> active registered bus before starting.”

### Shot 3 — Admin creates and publishes the route · about 1–2 minutes

1. Open **Admin → Routes**.
2. Choose **shift** — for example **First Shift** — and **vehicle type**.
3. Select the new bus under **bus number**.
4. Enter **start** and **end** descriptions for two agreed test locations.
5. Click at least **two distinct points on the map in route order** to add stops.
6. Click **plot road path** and wait for a successful road path.
7. Click **publish v1**, not just **save draft**.
8. Show the resulting published route/version.

**If ORS is unavailable:** do not pretend routing succeeded. Keep the stops,
explicitly select **manual path — … path is not road-verified**, publish only if
the form accepts it, and show/say **“path not verified.”** This is an honest
manual-path demonstration, not ORS success. If publishing fails, pause and record
the error; do not continue with a draft as though students can see it.

- [ ] Correct demo bus and shift; route is **published**, not draft/archived.
- [ ] Road path is genuinely plotted, or the manual/unverified path is disclosed.

**Say:**
> “Publishing makes this route available to riders and assignments. The trip
> uses its published route version rather than silently following later edits.”

### Shot 4 — Admin creates the assignment · about 45 seconds

Use a **dated assignment** so this take has a distinct assignment record:

1. Open **Admin → Assignments → assign for a day**.
2. Select the approved demo **driver** and the new **bus**.
3. Select the published **route (sets the shift)**.
4. Set **service date (IST)** to the recording date.
5. Click **save assignment**.
6. Show the saved driver/bus/route/date, with no conflict.

On the driver, refresh account/preflight information and select the new bus if
more than one eligible assignment appears. The standing assignment can remain an
option; verify the selected bus instead of assuming the app chose the demo bus.

- [ ] Assignment saved; correct bus visible/selected on the driver.
- [ ] No automatic trip start occurred merely because an assignment was saved.

**Say:**
> “This dated assignment authorizes our driver for the selected demo bus and
> route. It does not automatically start tracking.”

### Shot 5 — Student opens the route, then driver starts · about 1 minute

1. On **Student**, choose the same shift, search the exact demo bus registration,
   and open the matching route.
2. Before Start, show **“not running”** for this fresh test bus.
3. Keep recording both views **before** tapping Start; the acquiring state may be
   brief when GPS already has a good fix.
4. On native, check **Assigned bus**, press **Re-check** and confirm all Preflight
   rows pass; tap **Start**. On web, complete preflight and choose **trip direction**:
   **city → campus** (`toCampus`) or **campus → city** (`fromCampus`), matching the
   route. Then click **Start trip**; it stays disabled until a direction is chosen.
5. Capture acquiring/starting, then wait for an actual accepted GPS sample.
   The student-facing label for `acquiring` is **“starting”**, with the hint
   **“trip started, waiting for the first gps fix.”**
6. Capture **live**, a recent update age and the genuine bus position.

- [ ] Start acknowledged; waiting/starting is not narrated as live.
- [ ] A real sample becomes **live**; no mock coordinates or edited badge.
- [ ] If acquiring was too brief to see, note that rather than manufacturing it.

**Say:**
> “Starting a session is not the same as having a live position. The app first
> waits for GPS. It shows live only after a fresh, acceptable sample is received.”

If the app stays **weak gps** or **gps lost**, improve genuine reception or stop
the take and report it. Do not disable GPS/permissions to force the desired
acquiring shot.

### Shot 6 — Native screen-off segment · at least 2 minutes, native branch only

1. While **live** and still online, show the native active-tracking indication.
2. Use a second camera/observer to show the phone being **physically locked**.
   A blank screen recording alone is not proof that the phone was locked.
3. Keep it locked for about **2 minutes**. Keep recording the student view:
   capture several fresh updates/age resets, not just one “live” frame.
4. Unlock and show that the same trip remains active and samples continue.

- [ ] Phone lock and continued fresh student updates both captured.
- [ ] Actual locked duration recorded: ______.
- [ ] If it stalled, show the stall and mark this step failed.

**Say, only if observed:**
> “The phone stayed locked for [actual duration], and the student view continued
> receiving fresh updates. This is a short observation on this device, not
> fleet-wide or full NAT-01 validation.”

**Web branch:** skip this shot; keep the driver page visible and the device awake.

### Shot 7 — Student sees live → delayed → offline · allow about 2 minutes

Keep the student/admin connected and the app server running throughout.

1. Capture the student view **live** with a fresh age.
2. Note the outage-start time: ______. On native, optionally press
   **Mark outage start**.
3. Cut **only the driver's internet**, leaving location services, permissions
   and the app running:
   - **Native:** turn off both Wi-Fi and mobile data. Do not rely on airplane mode
     alone; it can leave Wi-Fi enabled or affect location on some phones.
   - **Web fallback:** use a separate driver's connection, or DevTools Network
     **Offline on the driver tab only**. Keep credential-bearing panels hidden.
4. Record the **student view continuously**, including the last-update age.
5. Wait for **delayed**, then **offline**. Do not tap End yet.

| Student state | Expected basis — not a stopwatch guarantee |
|---|---|
| **live** | A sufficiently accurate valid sample has recent capture **and** receipt timestamps. |
| **delayed** | The previous valid sample is older than **30 seconds**, while the last accepted heartbeat still has a lease. Last known position is labelled stale. |
| **offline** | More than **90 seconds since the last accepted heartbeat**. The feed no longer supplies a current location; the live bus marker should not remain trustworthy/visible as live. |

Sampling is nominally 5 seconds and heartbeat 15 seconds. The boundaries above
start at **accepted timestamps**, not exactly when you touch the network toggle;
UI refresh and in-flight requests can affect the observed time. Never describe a
student API-load error as the driver's offline state.

- [ ] Delayed captured at video time ______; last-fix age ______.
- [ ] Offline captured at video time ______.
- [ ] Student/API stayed online; no location permission was revoked.

**Say:**
> “Only the driver lost internet. The student still has a working connection.
> The last known fix first becomes delayed. When the heartbeat lease expires,
> the app reports offline instead of continuing to call the old position live.”

### Shot 8 — Recover, then driver ends normally · about 1 minute

1. Restore the driver's internet. Bring the native app to the foreground, or set
   the web driver tab back to **Online**.
2. Wait for new acknowledged data and for the **student to return to live**.
   Do not press Start again to disguise failed recovery.
3. On native, optionally press **Mark outage end** after recovery. Note time: ______.
4. Tap native **End** / web **End trip**.
5. Wait for the driver to reach acknowledged idle/ended, not **pending end** or
   **Ending the trip…**.
6. Show **ended** on Student and Admin → Fleet; the live marker is gone.

- [ ] Same trip recovered without a replacement Start.
- [ ] Driver End acknowledged; no pending-End state left.
- [ ] Student/Fleet End observed at video time ______.

**Say:**
> “After connectivity returns, fresh samples resume. I am now ending the trip
> from the driver. The server-acknowledged end removes its live position.”

If End remains pending, keep the app open and network available. Do not claim the
server knows the trip ended until the acknowledgment/observer state confirms it.

### Shot 9 — Show the actual office audit entries · about 45 seconds

1. Open **Admin → System → audit log**, then click **refresh**.
2. Find this take's timestamp and demo target/summary. There is no audit filter;
   entries are newest first.
3. Show the relevant entries:
   - **saved a bus** — `bus.save`
   - **saved a route** — `route.save`
   - **assigned a driver to a bus for a day** — `assignment.save`
4. Match the displayed action, time and target/summary to this recording.
   Crop/blur private actor details while retaining enough test context.
5. Stay in the audit panel. Do **not** use System's legacy import controls.
   An unavailable legacy-preview panel is separate from the audit result.

- [ ] Actual saved entries shown; no “audit could not load” error represented as success.
- [ ] No claim that these entries are a normal driver Start/End audit.

**Say:**
> “The office audit records our bus, route and dated assignment changes. Normal
> driver Start and End are not office audit events in this version; I verified
> that trip's end in the driver and observer views.”

## 3. Optional Take B — a real trip-related audit event

**Use this only on the agreed demo bus, after the main take has fully ended.**
This deliberately starts a **second trip**; introduce it with a visible title card
so it cannot be mistaken for the normal End above.

**Say:**
> “This is a separate trip to demonstrate the office force-end and its audit
> event. The administrator, not the driver, will end this one.”

1. Keep the demo driver online. On web, choose **trip direction** again if needed.
   **Start a new trip**, wait for live and capture its start time separately.
2. Open **Admin → Fleet**, locate the exact demo bus, and click
   **end trip from office**.
3. Read the confirmation; optionally enter the reason
   **“DOC-02 separate office-end demonstration.”**
4. Click **yes, end [demo bus]**.
5. Capture the success message saying the change is in the audit log.
   If it says **had already ended / nothing changed**, no new audit is expected;
   do not pass this step.
6. Show Student/Fleet **ended**. The old publisher should stop on its next
   rejected upload/refresh; keep it online and capture the actual response.
7. Open **System → audit log → refresh**.
8. Show the new **“ended a trip”** entry (`tracking.force_end`) matching this
   admin, bus, time and reason.

- [ ] Second trip is explicitly distinguished from the main take.
- [ ] Office action changed an active trip, with a success/audit confirmation.
- [ ] Matching new audit entry captured at video time ______.

**Say:**
> “The office ended this second trip. This ‘ended a trip’ entry records that
> administrative action; it is not the driver's normal End event.”

## 4. If a step does not behave as expected

| Symptom | Safe response |
|---|---|
| 403 / publication-related refusal | Check eligibility and applicable Rules with the owner. Stop that portion; do not grant broader privileges or call it passed. |
| Bus/route/assignment save fails | Capture the error and check whether the record exists before retrying. For route retry, keep the same populated form/UUID rather than resetting and creating duplicates. |
| Assignment/bus missing | Confirm published route, active bus, approved driver, correct IST date and selected bus; refresh account/preflight data. |
| Start disabled / no acceptable fix | Follow the displayed preflight fix; on web select **trip direction**. Improve real reception. No fake GPS or forced status. |
| Acquiring is not caught on video | Report it as too brief/not captured. If re-recording, fully end first and label a new take; do not splice unrelated trip states into one supposed run. |
| Student gets a data-load error | Restore the observer/API connection. That is not the intended driver-only outage demonstration. |
| No delayed/offline after the intended outage | Verify both driver network paths are off, no other device owns the bus and observer data is refreshing. Note actual times; do not edit a badge or change system time. |
| Native stops while locked | Record a device-specific failure; fall back to an explicitly labelled web take if needed. Do not claim background success. |
| End remains pending | Restore network and keep the driver open until acknowledgment; leave the result pending if it never arrives. |
| Audit missing/error | Refresh and check the action/target and publication prerequisites. A normal driver End has no office entry; an already-ended office no-op also creates none. |

## 5. Recording wrap-up and evidence checklist

- [ ] Both takes, if used, have ended; no demo publisher remains active.
- [ ] Preserve the raw recording. Trim dead time only with a labelled time jump;
  retain the underlying continuous evidence and real timestamps.
- [ ] Export native evidence, if used, before clearing it. Keep the original
  privately; review/redact precise locations, identifiers and account details
  before sharing or committing anything. Redaction must not fabricate timings.
- [ ] Do not combine two trips' logs or rename a failed take as a successful one.
- [ ] Retain demo records/audit for review. Any later cleanup needs the owner's
  agreement; do not delete shared data or erase audit evidence.
- [ ] Complete the outcome sheet below. Do **not** change existing W0-03/NAT logs
  from NOT RUN to PASS based only on this script or a short edited video.
- [ ] If this was only a short native segment, label the precise duration; full
  NAT-01 acceptance still requires its separate ≥45-minute protocol and criteria.

### Outcome sheet — all blank until you record

Use **Observed / Failed / Skipped / Not captured**. Add actual timestamps and
errors, not just ticks.

| Step | Result | Video timestamp / actual observation |
|---|---|---|
| Bus created and active | | |
| Route published; verified/manual disclosed | | |
| Dated assignment saved and selected | | |
| Acquiring/starting captured | | |
| Fresh live data | | |
| Native screen-off updates, actual duration | | |
| Student delayed | | |
| Student offline | | |
| Same-trip recovery to live | | |
| Normal driver End acknowledged; observers ended | | |
| Bus/route/assignment audit entries | | |
| Separate Take B office End and matching audit, if used | | |

**Closing narration:**
> “This recording showed [only the outcomes actually observed]. The checks and
> limits are listed in the report and evidence pack. Unrun device or production
> checks remain unrun.”

## References and acceptance boundaries

- [Local setup and account prerequisites](Delivery-Status.md#8-running-the-project)
- [Final project report](PU-Transit-Final-Report.md)
- [Evidence index by AC-ID](evidence/README.md#index-by-acceptance-id)
- [W0-03 web rehearsal](evidence/rehearsal-log-w0-03.md)
- [NAT-01 sustained screen-off protocol](evidence/rehearsal-log-nat01.md)
- [NAT-05 ownership/idempotency protocol](evidence/rehearsal-log-nat05.md)
- [Native permission review](permission-review-nat02.md)

This checklist demonstrates route/assignment setup, acquiring/live and failure
states, normal End and the office audit boundary. A short native shot is bounded
AC-10 evidence only; normal End relates to AC-15; a correctly recorded separate
office-force-end take supports AC-23. It does not automatically close every step
of those acceptance scenarios, the full W0-03/NAT protocols or production rollout.