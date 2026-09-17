> **Evidence ID: NAT-01 · Collected: 14 Sep 2026.** Provenance: relocated from [`docs/rehearsal-log-nat01.md`](../rehearsal-log-nat01.md). The protocol and recorded results/verdicts below are original recorded results, not new runs. See [`README.md §10 — Testing and verification`](../Delivery-Status.md#10-testing-and-verification) and [`PRD §13 — Acceptance scenarios`](../PU-Transit-PRD.md#13-acceptance-scenarios).

# NAT-01 rehearsal log — single-device feasibility proof

**Label: single-device feasibility rehearsal (v2.1 Addendum §3 fallback rule). This is NOT a validated fleet/device matrix.** This protocol is intended to test whether the native driver build keeps publishing bus location with the screen off on *one* phone, through one token refresh and one network loss/recovery; no such result has been measured yet. The supported-device matrix (PRD-Remaining NAT-01 "each device class from the inventory", NAT-07 battery/data budgets, NAT-09 vendor guidance) remains future work and is listed at the end.

Status: **NOT RUN — blocked on a build path.** The app and the analysis tooling exist; no route has been driven yet. Nothing in the results section is filled in, and nothing below claims a measured result. On 13 Sep 2026 the owner reported that neither a computer with Android Studio nor an Apple Developer account is available, so no native build can be produced yet. The gate reopens as soon as one of the build paths below becomes available (any computer that can run Android Studio is enough for the Android path; Expo's cloud build service run from a personal computer is an alternative that needs no Android Studio, only an Expo account).

## What is being proven

| Question | How it is answered |
|---|---|
| Does tracking survive screen-off / backgrounding? | Android: foreground service with persistent notification (`expo-location` background updates + `expo-task-manager`). iOS: `UIBackgroundModes: location`, "Always" permission, system indicator. The evidence log records every `app_state` change, so the report shows how much of the trip the app was actually backgrounded. |
| Is the tracking contract unchanged (NAT-03)? | The native app uses the same shared state machine (`lib/driver-tracking`) and the same generated client for `/api/tracking/{busId}/start\|sample\|heartbeat\|end`. No native-only endpoint. |
| Coverage | `scripts/src/nat01-coverage.ts` counts whole trip minutes that contain at least one **server-acknowledged** sample whose capture-to-receive age is ≤ 30 s (the same freshness rule the server uses for `live`). |
| Outages with causes | Gaps > 30 s between valid samples are listed with the error codes, GPS-fix presence, app state and task events seen inside the gap. |
| Token refresh | The app forces `getIdToken(true)` 20 minutes into the trip and logs the outcome (no token material is logged); natural refreshes are logged via `onIdTokenChanged`. |

## Build (Expo Go is not evidence)

Background location is impossible in Expo Go on Android, and the in-app **Build check** row shows `executionEnvironment`; a run whose export says `storeClient` is rejected by the report. Use one of these:

| Device | Path | Notes |
|---|---|---|
| iPhone | Replit **Publish** → Expo Launch → TestFlight | Needs an Apple Developer Program membership. Install the TestFlight build. `EXPO_PUBLIC_DOMAIN` is set by the publish flow. |
| Android | Local build on a computer with Android Studio, from this repo: `cd artifacts/pu-transit-driver && EXPO_PUBLIC_DOMAIN=<api host> pnpm exec expo run:android --device --variant release` | Google Play / Android builds are not produced by Replit in this workspace. Use `--variant release` so the road run does not depend on a Metro connection. `<api host>` is the host that serves `/api` — while the app is unpublished this is the workspace's `.replit.dev` domain, which only answers while the workspace is awake. |

Before the run, the API server must be reachable from the phone's mobile network for the whole trip: keep the Replit workspace open for the duration, or publish the app first and build against the production domain.

## Run protocol (≈ 60 minutes, one person)

Preparation (at the depot, before moving):

1. Sign in with the driver account. The Identity section must show role `driver` (or `admin`) with status `approved` and an assigned bus; otherwise fix the assignment in the web admin first.
2. Preflight: every row green — location services, foreground permission, **background permission** (Android: "Allow all the time"; iOS: "Always"), notifications (Android 13+), battery optimisation set to *Unrestricted* (Android; Xiaomi/Vivo/Oppo/Realme also need "Autostart" and no battery saver on this app).
3. Note the phone's battery percentage and the wall-clock time in the results table.
4. Optional second observer: open the student web app on another device and watch the bus tile (live / delayed / offline). Qualitative only.

Trip:

5. Tap **Start**. Wait until the phase reads `live`, then lock the screen within one minute and keep it locked; phone in the pocket or on the dashboard, no other apps.
6. Drive the representative route. Do not open the app until step 8. At about +20 min the app performs the forced token refresh on its own.
7. At about +30 min (any point after +25 min): unlock, tap **Mark outage start**, switch on airplane mode, lock the screen again. After 2–3 minutes: unlock, switch airplane mode off, wait until the phase returns to `live`, tap **Mark outage end**, lock the screen. Write both wall-clock times in the table as a backup for the markers.
8. Continue until the trip is at least 45 minutes long, then unlock and tap **End**. The phase must reach `idle` (if it shows `pending_end`, keep the app open until the End is acknowledged).
9. Note the battery percentage and time. Tap **Export** and share the JSON to yourself (mail, Drive, AirDrop).

If the app was killed by the OS during the run (the notification disappeared, or the export contains a `task` event `without_tracker`), that is a **failed** run: record it as such with the phone model and OS version. Do not restart the trip and splice logs.

## Analysis

1. Save the export as `docs/evidence/nat01/<yyyy-mm-dd>-<device>.json` (create the folder; the file contains coordinates and timestamps, no credentials).
2. Run, from the workspace root:

   ```sh
   TZ=Asia/Kolkata pnpm --filter @workspace/scripts run nat01:coverage -- docs/evidence/nat01/<file>.json
   ```

   If the markers were not pressed, pass the airplane-mode window as local wall-clock time: `--outage 09:31-09:34`.

3. Paste the printed report verbatim into the results section below. The unit check for the analysis itself is `pnpm --filter @workspace/scripts run nat01:test`.

The export accumulates every launch since the last *Clear*; the script analyses the **longest** Start→End trip in it and says how many it found. Clear the log before the real run to keep the file small.

Pass criteria — the script prints this checklist and says PASS only if every line holds:

- Build is a development/production build (`executionEnvironment` is not `storeClient`).
- Trip duration ≥ 45 min.
- **Healthy segment ≥ 95 %** of whole minutes covered (trip minus declared outage windows).
- One `forced_refresh` token event with `ok`, and valid samples continuing after it.
- One deliberate outage declared inside the trip (markers or `--outage`), with valid samples after it.
- No `SESSION_CONFLICT` response (the recovery kept the same trip; no second Start).

Read manually: every gap > 30 s is listed with a cause (the deliberate one should show network/timeout codes only), and the backgrounded share should be the large majority of the trip (the screen was actually off).

## Known limitations of this build

- **No auto-resume after a process kill.** The shared state machine deliberately never restarts publishing from persisted metadata (same rule as the web). If Android kills the process, the relaunched location task finds no tracker, stops the OS updates and logs `task without_tracker`; the run is recorded as FAIL with the phone model and OS version. That is the information the feasibility gate is for.
- **Persistence is write-through, not awaited.** Session/pending-end metadata is kept in memory and mirrored to AsyncStorage in order; a kill within milliseconds of a write can lose the last record. The server's 90 s heartbeat lease and sequence checks bound the consequence (a stale End or a rejected replay), acceptable for a feasibility proof, to be revisited for the fleet build.
- **The API host must stay reachable** (see Build).

## Results — NOT RUN

| Field | Value |
|---|---|
| Date / time (IST) | — |
| Device (brand, model) | — |
| OS version | — |
| Build (variant, app version, `executionEnvironment`) | — |
| Driver account role / bus | — |
| Route (origin → destination) | — |
| Trip start → end, duration | — |
| Screen locked from | — |
| Deliberate outage (airplane mode) start → end | — |
| Token refresh probe at | — |
| Battery start → end | — |
| Overall coverage | — |
| Healthy-segment coverage | — |
| Outages (count, causes) | — |
| Result (PASS / FAIL) | — |
| Observer notes (student view, notification visible, indicator on iOS) | — |

Report output:

```text
(paste the nat01:coverage output here)
```

## Future work (not covered by this proof)

- Device matrix per PRD-Remaining NAT-01: at least one phone per device class actually used by the fleet, each with its own log; Android vendors with aggressive background killing (Xiaomi/MIUI-HyperOS, Vivo, Oppo/Realme, Samsung with "sleeping apps") need separate runs and onboarding notes (NAT-09).
- iOS run if the first proof is Android (and vice versa).
- Battery and mobile-data measurement per device class (NAT-07).
- Ownership/idempotency parity cases on the native client (NAT-05: AC-08, AC-09, AC-12, AC-15, AC-16, AC-17 — protocol in `docs/rehearsal-log-nat05.md`), and the negative auth tests (NAT-06).
- Recovery after the OS kills the process (currently logged as a failed run, not recovered).