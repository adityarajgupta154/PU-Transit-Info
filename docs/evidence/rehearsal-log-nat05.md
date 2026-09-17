> **Evidence ID: NAT-05 · Collected: 14 Sep 2026.** Provenance: relocated from [`docs/rehearsal-log-nat05.md`](../rehearsal-log-nat05.md). The protocol and recorded results/verdicts below are original recorded results, not new runs. See [`README.md §10 — Testing and verification`](../Delivery-Status.md#10-testing-and-verification) and [`PRD §13 — Acceptance scenarios`](../PU-Transit-PRD.md#13-acceptance-scenarios).

# NAT-05 rehearsal log — ownership and idempotency parity on the native client

Status: **NOT RUN.** Protocol written 13 Sep 2026; no phone has executed it. Results are recorded below only after a real run. Never fill the tables from expectations.

NAT-05 asks whether the native driver app keeps the same ownership guarantees the web client already has: one publisher per bus, retries that cannot create a second trip, and ended or replaced trips that cannot come back. The guarantees live in the server (`artifacts/api-server/src/lib/tracking.ts`, covered by its contract tests) and in the shared state machine (`lib/driver-tracking`, shared by both clients). This rehearsal checks that nothing in the native adapter (`artifacts/pu-transit-driver/lib/tracking.ts`: background task, serialized OS calls, request wrapper) weakens them on a real phone. Scenarios: AC-08, AC-09, AC-12, AC-15, AC-16, AC-17 from `docs/PU-Transit-PRD.md` §Acceptance scenarios.

## Setup (≈ 15 minutes, one person, at a desk — no driving needed)

| Item | Requirement |
|---|---|
| Phone | One phone with a development or release build of the driver app (see `docs/rehearsal-log-nat01.md` §Build). Expo Go is not evidence. |
| Second publisher | The **web driver page** (`/driver`) in a laptop browser, signed in with the same driver account. It uses the same contract, so it stands in for a second phone. A second native phone can repeat AC-09 later; the steps are identical. |
| Observer | The **student map** (`/student`) in a second browser tab, showing the driver's bus. Optional for AC-17-ended: the **admin Fleet tab** (`/admin`, Fleet → Force end) signed in as an admin. |
| Account | Driver account with status `approved` and an assigned bus that is **registered and active in Fleet** (FLT-03, 13 Sep). Every preflight row green on the phone (the Start button is held otherwise). |
| Backend state | The 13 Sep Rules payload must be **published** and the buses migration **applied** before this run: with the older live Rules, Start is refused on the phone and on the web driver page alike (`BUS_NOT_REGISTERED` / 503), so nothing below can be exercised. See `docs/buses-registry.md`. |
| Network switch | Android: airplane-mode tile in Quick Settings (leave Wi-Fi off too). iOS: Control Centre → airplane mode. |
| Time | Set the phone and laptop to automatic time; the log is analysed with server-received timestamps, but the results table records wall-clock times. |

Evidence: before each scenario tap **Clear** in the Evidence section; after it tap **Export** and save the file as `docs/evidence/nat05/<date>-AC-xx.json`. Analyse each file with

```bash
TZ=Asia/Kolkata pnpm --filter @workspace/scripts run nat05:parity -- docs/evidence/nat05/<date>-AC-xx.json
```

The report lists every trip attempt the phone made, five invariants (`PASS`/`FAIL`), and a timeline of Start/End/conflict events. Paste the `Trip attempts` and `Invariants` blocks into the scenario's result row. A scenario passes only when the phone screen, the observer screen and the report all match the expectations below.

Phase and error strings below are what the phone's Trip card prints (`phase` / `error`). Codes (`409 OWNER_ACTIVE`, …) are what the timeline prints.

## AC-08 — Start retried after a timeout (one publisher, recoverable)

A real Start timeout is an ambiguous outcome: the server may already hold the trip while the phone believes nothing happened. The app can produce that outcome on demand: **Arm Start timeout (AC-08)** lets the next `/start` reach the server and then discards the response, so the phone sees `TIMEOUT` exactly as it would on a stalled network.

1. Phone idle, Clear. Tap **Arm Start timeout (AC-08)** — the button label changes to *Start timeout armed*.
2. Tap **Start**. Expect the phone to show phase `idle` with error `Tracking request timed out.` within a few seconds. Student map: the bus may show *acquiring* or *offline*, **never live**.
3. Tap **Start** again. Expect phase `recovery`, error `A previous trip is available for recovery or End.` — the phone refuses to create a second trip while the first one is unconfirmed.
4. Tap **End**. Expect phase `idle`, no error (the End closes the trip the server created in step 2 — timeline `request end … ok, acknowledged (ended)`). If the server had never created it, the End writes a tombstone instead and the phone says `The previous trip was superseded or cancelled.` — also acceptable.
5. Tap **Start**. Expect `acquiring` → `live` within a minute. Student map shows the bus live. Let it run 1 minute, then **End**.
6. Export as `…-AC-08.json`.

Pass: the report lists **two** trip attempts — the first `Start injected timeout`, `closed by End acknowledged` **before** the second Start; the second `Start acknowledged` with samples; invariants `PASS`. The student map never showed live between steps 2 and 5. The arm is consumed by the Start tap of step 2 even if that Start were blocked by preflight, so it cannot affect a later trip.

## AC-09 — Two devices claim one bus concurrently (one wins, explicit conflict)

1. Phone idle, Clear. Web driver page ready with Start visible (same account, same bus).
2. Tap **Start** on the phone and click **Start** on the web page as close together as you can (count down aloud). Order does not matter; the server serializes them.
3. Expect exactly one side live. The loser shows an explicit conflict:
   - phone lost: phase `conflict`, error `Another publisher is currently active on this bus.`; timeline `request start … FAILED 409 OWNER_ACTIVE`;
   - web lost: the web driver page shows its *taken over* state with the hint *another phone or the transport office owns this bus now* (English UI; the Hindi/Gujarati equivalents say the same).
4. On the loser, try **Start** again within 60 s. Expect the same conflict (the winner's 90-second heartbeat lease is intact, so no takeover is possible).
5. **End** the winner. Export the phone log as `…-AC-09.json` (if the phone won, its report shows one acknowledged trip; if it lost, two attempts — steps 2 and 4 — each `closed by 409 OWNER_ACTIVE` with 0 samples).

Pass: only one publisher was live at any time on the student map (one bus position, no jumping between two sources); the loser got the conflict text on the first and the retried Start; invariants `PASS`.

## AC-12 — Network returns with old queued samples (no replay)

Run this while moving — a walk of a few hundred metres is enough — so the position during the outage differs from the position at reconnect.

1. Phone idle, Clear. Tap **Start**, wait for `live`. Start walking.
2. Tap **Mark outage start**, switch airplane mode **on**, keep walking for 2–3 minutes. Expect phase `delayed` (error `Network request failed`) within seconds and `offline` after ~90 s; the student map moves the bus to *delayed* then *offline* — never live — while the position stays where it was at the cut.
3. Stop walking somewhere clearly different. Switch airplane mode **off**, wait for phase `live`, tap **Mark outage end**.
4. Student map: the bus must **jump** to the current position — it must not trace the walked path and must not show any position from inside the outage as live. Note the time the bus reappeared live.
5. Walk 1 more minute, **End**, Export as `…-AC-12.json`.

Pass: invariant *No acknowledged sample older than 30 s at receive time* holds (the native client keeps only the newest fix and the server rejects stale captures independently); the timeline line *first acknowledged sample after a gap* shows a capture age ≤ 30 s at a time after airplane-off; the student map jumped rather than replayed.

## AC-15 — End on a healthy network (collection stops, End acknowledged, location hidden)

1. Phone idle, Clear. **Start**, wait for `live` and for the student map to show the bus live. Android: confirm the tracking notification is present; iOS: the location indicator.
2. Tap **End**. Expect phase `stopping` briefly, then `idle` with no error. Android notification disappears (iOS indicator turns off) at once.
3. Student map: the bus stops being live immediately (hidden or *ended*) — it must not stay live until the 30-second freshness lapses.
4. Wait 1 minute with the app open; no new samples must appear. Export as `…-AC-15.json`.

Pass: timeline shows `lifecycle end_pressed`, then `request end … ok, acknowledged (ended)` and `task stopped` (the OS stop is asynchronous, so `task stopped` may log just after the End acknowledgement — that is fine); the trip is `closed by End acknowledged`; 0 acknowledged samples after close and 0 captures after End pressed; observer confirms the notification/indicator went away and the map stopped showing the bus live.

## AC-16 — End with no network (stops locally, explicit pending sync, End first on reconnect)

1. Phone idle, Clear. **Start**, wait for `live`.
2. Switch airplane mode **on**. Wait until the phone shows `delayed`/`offline` (up to ~90 s).
3. Tap **End**. Expect: Android notification disappears (iOS indicator off) immediately; phase `pending_end` with the last failure as the error line (`Network request failed`, or `Tracking request timed out.` on a stalled link) — the native app has no offline signal, so it proves the outage by trying every 5 s rather than by saying "offline". The End button stays available; Start is not.
4. Optional durability step: force-close the app (swipe away) and reopen it. Expect phase `pending_end`, error `A previous Stop is waiting for server confirmation.` Tap **End** once more so the retry resumes.
5. Switch airplane mode **off**. Expect phase `idle` within ~10 s. Student map: the bus goes from *offline* to hidden/*ended*; it must never flash live in between.
6. Export as `…-AC-16.json`.

Pass: timeline shows `end_pressed`, `task stopped`, one or more `request end … FAILED 0 NETWORK` (collapsed with a ×count; 5-second retries), then `request end … ok, acknowledged (ended)`, with **no** `request sample`/`request heartbeat` sent between airplane-off and the End acknowledgement; trip `closed by End acknowledged`; invariant *Every End that failed offline was acknowledged later* holds; if step 4 was done, a `lifecycle session_restored` line sits between the failed and the acknowledged End. An End line reading `ok but NOT acknowledged` means the server queued it — wait for the acknowledged line before judging; `acknowledgement NOT recorded` means the phone runs a build older than this protocol — rebuild before recording results.

## AC-17 — Ended or replaced trip cannot revive (writes rejected)

Two variants; run both.

**A. Replaced by another publisher (takeover after the lease lapses).**

1. Phone idle, Clear. **Start**, wait for `live`.
2. Switch airplane mode **on**. Wait **at least 2 minutes** (the 90-second heartbeat lease must expire; the phone reads `delayed` then `offline`, the student map shows *offline*).
3. On the web driver page (same account) click **Start**. Expect it to go live — the takeover is allowed only because the phone's lease lapsed. Student map now shows the laptop's position.
4. Switch airplane mode **off** on the phone. Expect, within ~15 s, phase `idle` with error `This trip was ended from the transport office or by another device. Start again if the bus is still running.` The notification/indicator goes away. The phone must not push its position onto the map: the student map keeps showing the laptop's position.
5. Do **not** tap Start yet. Wait 1 minute, confirm the phone stays idle, then Export as `…-AC-17A.json`. End the web trip.

**B. Ended by the transport office (force end while the phone is live).**

6. Phone idle, Clear. **Start**, wait for `live`.
7. In the admin Fleet tab, Force end the bus with a reason. Student map: the bus is hidden/*ended* at once.
8. Phone: within ~15 s (the next upload) expect phase `idle` with the same error text as step 4; notification/indicator gone. The map must not show the bus live again.
9. Wait 1 minute, Export as `…-AC-17B.json`. Only now tap **Start** to confirm a fresh trip is possible (new trip id in the timeline) and End it.

Pass (both): timeline shows `request sample` (or `heartbeat`) `FAILED 409 SESSION_CONFLICT` followed by phase `idle` with the superseded message, and **no acknowledged request for that trip afterwards** (invariant *No acknowledged sample after the trip was ended or superseded*); the student map never showed the phone's position after the takeover / force end.

## What this rehearsal does not prove

- Two *native* phones racing (AC-09 uses the web client as the second publisher; the contract and the server code path are the same, but a second phone should repeat step 2 once a second build exists).
- A genuine network stall producing the timeout (AC-08 uses the app's own fault injection to make the ambiguous outcome reproducible; the client-side handling from that point is the real code).
- Behaviour when the OS kills the process mid-trip (NAT-01 scope) or the auth negative cases (NAT-06).

## Results — NOT RUN

| Field | Value |
|---|---|
| Date / time (IST) | — |
| Phone (brand, model, OS) | — |
| Build (variant, app version, `executionEnvironment`) | — |
| Second publisher (web browser + OS, or second phone) | — |
| Driver account role / bus | — |
| Observer setup (student map on…, admin on…) | — |

| Scenario | Phone showed (phase / error) | Observer saw (student map, notification / indicator) | Report: attempts + invariants | Evidence file | Result |
|---|---|---|---|---|---|
| AC-08 | — | — | — | — | NOT RUN |
| AC-09 | — | — | — | — | NOT RUN |
| AC-12 | — | — | — | — | NOT RUN |
| AC-15 | — | — | — | — | NOT RUN |
| AC-16 | — | — | — | — | NOT RUN |
| AC-17 A (replaced) | — | — | — | — | NOT RUN |
| AC-17 B (force end) | — | — | — | — | NOT RUN |

Report output per scenario:

```text
(paste the nat05:parity "Trip attempts" and "Invariants" blocks here, one heading per scenario)
```

Deviations from the protocol (if any), with the step number: —