# NAT-02 permission review checklist — walk through on a real phone

Status: **NOT RUN.** Nothing below is a result. Each row of the results table is filled in only after someone taps through the flow on the phone named in that row. The build type must be a development or production build (the **Build check** section of the app must not say `storeClient`); Expo Go cannot show the Android foreground-service notification for this app or hold iOS "Always", so a walk-through in Expo Go proves nothing.

Scope: PRD-Remaining **NAT-02** — Android foreground service with a persistent notification and the background-location permission flow; iOS "Always" location with the location background mode and the system indicator; an in-app purpose statement before each OS location prompt. Acceptance: this checklist passes on each OS version in the device matrix, and **tracking never runs without the visible indicator**. Battery-optimisation handling and the rest of the preflight belong to NAT-04/NAT-09; the purpose-statement wording is a draft until the university approves it (PRIV-01).

## What the build contains (verify from the repo, no phone needed)

| Item | Where | Expected |
|---|---|---|
| Android permissions | `artifacts/pu-transit-driver/app.json` → `android.permissions` | `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, `WAKE_LOCK` |
| Foreground service type `location` (Android 14+) | `expo-location` plugin, `isAndroidForegroundServiceEnabled: true` | the plugin declares the service with `android:foregroundServiceType="location"` |
| iOS background mode | `ios.infoPlist.UIBackgroundModes` and plugin `isIosBackgroundLocationEnabled: true` | `["location"]` |
| iOS purpose strings | `NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription` (same text in the plugin options) | mention: bus position, students and staff, only during a trip you start, screen off/background (Always string), stops at End |
| Indicator options | `lib/tracking.ts` → `startLocationUpdatesAsync` | `showsBackgroundLocationIndicator: true`; `foregroundService.notificationTitle/Body` set |
| Start gate | `lib/preflight.ts` (`buildRows`) + `app/index.tsx` (`start()`) | Start is disabled while any of the nine preflight rows is red **and** re-runs every row (account record, server probe, permissions, battery) at the moment of tapping Start; a red row blocks with `Tracking not started — <row>: <fix>` |
| Preflight rows (NAT-04) | `lib/preflight.ts` (`LABELS`, `accountSteps`, `probeNetwork`) + `lib/permissions.ts` (`readPermissions`) | in this order: Driver account, Bus assignment, Network, Location services, Location while using the app (precise), Location Always / all the time, Battery optimisation (Android, `expo-battery` → `isIgnoringBatteryOptimizations`), Notifications (Android 13+); every red row has exactly one `fix` line naming the Settings path or the person to ask |
| No "live" claim while a row is red | `lib/preflight.ts` (`tripStatus`) | the Trip status line says `Not sharing — <row>: <fix>` while idle with a red row, and `Sharing for now, but <row>: <fix>` if a row goes red mid-trip; the word *Live* appears only with every row green |
| Purpose statement before the prompt | `lib/permissions.ts` (`purposeFor`) + `components/PurposeSheet.tsx` | shown for the "while using" and the "background / Always" steps; the OS prompt fires only from **Continue** |
| No server session without the indicator | `lib/tracking.ts` (`geo.watchPosition`) + `lib/driver-tracking` (`attachGeoWatch` before `getFeed`/`start`) | the native start is awaited and verified with `hasStartedLocationUpdatesAsync` **before** any server call; a refusal aborts Start with the reason shown as the tracking error. Cannot be provoked on demand from Settings — verified by the shared-lib test "aborts Start before any server call…" |
| Indicator lost mid-trip → trip ends | `lib/tracking.ts` (`endTripForIndicatorLoss`, checked in the location task before every delivered batch, ~5 s) + `app/index.tsx` (on every permission refresh while active) | losing notifications (Android 13+), foreground location, or the "all the time"/Always grant during a trip runs the durable End path; message "Trip ended: …" on the screen; evidence event `lifecycle/indicator_lost` |
| Denials remembered across relaunch | `lib/permissions.ts` (`ATTEMPTS_KEY` in AsyncStorage) | after an iOS Always refusal or an Android "don't ask again" on notifications the row goes straight to **Open settings** on the next launch |

## Fresh-install walk-through

Do this on a phone where the app has never been installed (or after *Settings → Apps → PU Transit Driver → Storage → Clear data* and removing the location permission). Sign in with a driver account that has an assigned bus. Read every dialog aloud; record the exact wording if it differs from the expectation.

### A. Android

| # | Action | Expected on the phone | Expected in the app |
|---|---|---|---|
| A1 | Open the app, look at **Preflight** | — | Rows: Location services, Location while using the app, Location: Allow all the time, Notifications (Android 13+), Battery optimisation. All red except services (if location is on). **Start** disabled |
| A2 | Turn location off in quick settings, tap **Re-check**, then **Turn on** | Android's "turn on location" system dialog | services row red → green after accepting |
| A3 | Tap **Allow** on *Location while using the app* | **No OS dialog yet.** The in-app purpose sheet appears: why location, only during a trip you start, "choose While using the app, keep Precise" | tapping **Not now** closes the sheet, row stays red, no OS dialog appeared |
| A4 | Tap **Allow** again → **Continue** | Android permission dialog with **Precise / Approximate** toggle (Android 12+) and *While using the app / Only this time / Don't allow* | choose *While using the app*, Precise → row green "while using, precise" |
| A5 | (Android 12+) Repeat A4 on a fresh install choosing **Approximate** | — | row red "approximate only" with fix line pointing to *Use precise location*; **Open settings** opens the app's settings page; after toggling, returning to the app turns the row green without a tap |
| A6 | Tap **Allow** on *Location: Allow all the time* | **No OS dialog yet.** Purpose sheet with the wording "…even when the app is closed or not in use…", the notification-shade / active-apps sentence and "choose Allow all the time" | **Not now** → nothing else opens |
| A7 | Tap **Allow** → **Continue** | Android 10: system dialog with *Allow all the time*. Android 11+: the app's **Location permission settings page** opens (the option is *Allow all the time*) | after choosing it and coming back, the row is green "Allow all the time" |
| A8 | Fresh install, in A7 choose *Keep while-in-use only* / press back | — | row red; after the second refusal the button changes to **Open settings** and the fix line names the Settings path |
| A9 | (Android 13+) Tap **Allow** on *Notifications* | System notification permission dialog | allow → green. Deny twice → button becomes **Open settings** |
| A10 | Battery optimisation → **Open settings** | App settings page (Battery → Unrestricted) | row turns green after returning (this row is trust-based until NAT-04) |
| A11 | Revoke *Location* in Settings while all rows are green, come back, tap **Start** | — | Start refuses: "Tracking not started — fix the red preflight rows first"; rows refreshed to red; phase stays `idle`; the web map never shows the bus as live |
| A12 | All rows green → **Start** | Within a few seconds a notification **"PU Transit is sharing your bus location"** appears and cannot be swiped away on Android 13 and below; on Android 14+ the OS allows swiping it, but the shade's **active apps** entry keeps listing PU Transit Driver | phase `acquiring` → `live`; samples acked count rises |
| A13 | Lock the phone for 5 minutes, unlock | notification still present | *Last ack age* stays under 30 s (the NAT-01 report is the long-form proof) |
| A14 | Swipe the app away from Recents during a trip | notification remains (the service is not bound to the activity) | reopen: the trip is still `live` and samples continue **only if the process survived**. If the phone killed the process, the headless task stops itself (evidence `task/without_tracker`), the relaunch shows `recovery` ("A previous trip is available for recovery or End") — tap **End**; the feed went stale by the 90 s lease. Record the phone model: a killed process is a NAT-09 vendor finding |
| A15 | During a trip, revoke Location in Settings | Android stops the foreground service and kills the app process (system behaviour on permission revoke) | on relaunch: `recovery` with the stored session → **End**; no claim of live; the web feed goes stale after the 90 s lease |
| A15b | Android 13+: during a trip, turn off **Notifications** for the app in Settings, stay out of the app for 2 minutes | the notification disappears; the trip ends at the next location batch, within seconds (evidence `lifecycle/indicator_lost`); no batch is uploaded after the revoke | on return: "Trip ended: notification permission was turned off", phase `idle`, Notifications row red with **Open settings** |
| A16 | **End** | notification disappears within seconds | phase `idle`; nothing is sent afterwards (check *Samples acked* stops rising) |

Repeat A1–A16 (A15b on 13+) per Android version in the device matrix (10, 11/12, 13, 14+). Vendor skins (MIUI/HyperOS, ColorOS, OneUI, Funtouch) add their own background-restriction screens; record any extra prompt in Notes.

### B. iOS

| # | Action | Expected on the phone | Expected in the app |
|---|---|---|---|
| B1 | Open the app, look at **Preflight** | — | Rows: Location services, Location while using the app, Location: Always, Notifications (n/a), Battery optimisation (n/a). Start disabled |
| B2 | Tap **Allow** on *Location while using the app* | **No OS dialog yet.** Purpose sheet, "choose Allow While Using App, keep Precise on" | **Not now** → nothing else opens |
| B3 | Tap **Allow** → **Continue** | iOS dialog with the **exact `NSLocationWhenInUseUsageDescription` text** from `app.json`, *Precise: On* toggle, *Allow Once / Allow While Using App / Don't Allow* | choose *Allow While Using App* → row green |
| B4 | Fresh install, in B3 turn *Precise* off | — | row red "approximate only"; fix line names *Precise Location*; **Open settings** opens the app's page in Settings; toggling it turns the row green on return |
| B5 | Tap **Allow** on *Location: Always* | **No OS dialog yet.** Purpose sheet with "…even when the app is closed or not in use…", the blue-indicator sentence and "Change to Always Allow" | **Not now** → nothing else opens |
| B6 | Tap **Allow** → **Continue** | iOS alert *"Allow PU Transit Driver to also use your location even when you are not using the app?"* with **Keep Only While Using / Change to Always Allow** (iOS 13.4+) and the `NSLocationAlwaysAndWhenInUseUsageDescription` text | choose *Change to Always Allow* → row green "Always" |
| B7 | Fresh install, in B6 choose *Keep Only While Using* | — | row red "While Using only"; button becomes **Open settings** (also after force-quitting and relaunching the app — iOS would otherwise report the upgrade as never asked); Settings → PU Transit Driver → Location → *Always* turns the row green on return |
| B8 | All rows green → **Start**, then press the side button (screen off) or switch apps | the **blue location indicator** (status-bar pill / arrow, or Dynamic Island indicator) is visible while the app is in the background | *Last ack age* under 30 s after coming back |
| B9 | Some days later iOS may show *"PU Transit Driver has used your location in the background…"* | choose *Always Allow* | no change needed in the app; record the date it appeared |
| B10 | During a trip, change Location to *While Using* in Settings and stay out of the app | indicator disappears (iOS stops background delivery) | on return the app refreshes permissions, the row is red and the trip ends by itself: "Trip ended: Location: Always is While Using only", phase `idle`; the web feed had already expired by the 90 s lease |
| B11 | Swipe the app away from the app switcher during a trip | indicator disappears — iOS ends background location for a user-terminated app | reopen: no automatic resume (by design); phase shows the stored session for **End**; the feed went stale honestly |
| B12 | **End** | indicator gone | phase `idle` |

Repeat per iOS version in the matrix (16, 17, 18).

### C. Cross-checks on the web map (either platform)

| # | Check | Expected |
|---|---|---|
| C1 | While a preflight row is red and the driver taps Start | the bus never shows **live** on the student map |
| C2 | During A12/B8 | the bus is live; after End it leaves the map within the feed's freshness rule |
| C3 | After A15/A15b/B10/B11 | the bus turns stale within ~90 s, never a frozen "live" |

### D. Preflight rows (NAT-04, AC-07) — either platform unless marked

Sign in with a driver account that has an assigned bus, then break one thing at a time and read the row and the Trip status line aloud.

| # | Set up | Expected row text (value → fix) | Start | Trip status line |
|---|---|---|---|---|
| D1 | Signed out | Driver account: `signed out` → "Sign in with your driver account above."; Bus assignment `waiting` | disabled | "Not sharing — Driver account: …" |
| D2 | Admin removes the bus assignment (web admin), tap Re-check | Bus assignment: `no bus` → "…ask the transport admin to assign your bus, then tap Re-check." | disabled | "Not sharing — Bus assignment: …" |
| D3 | Admin sets the account to pending / suspended, tap Re-check | Driver account: `pending` / `suspended` → the matching "ask the transport admin…" line | disabled | "Not sharing — Driver account: …" |
| D4 | Airplane mode, tap Re-check | Network: `offline` → "Turn on mobile data or Wi-Fi …"; Driver account may show `waiting` → "Fix the Network row first" | disabled | "Not sharing — Network: …" |
| D5 | Location services off (A1 / B1) | Location services: `off` → platform Settings path | disabled | "Not sharing — Location services: …" |
| D6 | Precise location off (A10 / B9) | Location while using the app: `approximate only` → Settings path to "Precise" | disabled | "Not sharing — Location while using the app: …" |
| D7 | Background permission missing (Android "While using" only / iOS While Using) | Location Always row: `denied` / `While Using only` → "Choose Always…" or the Settings path | disabled; tapping Start after revoking in Settings shows "Tracking not started — Location…: …" | never contains the word "Live" |
| D8 | Android: app on "Optimised" battery (App info → Battery) | Battery optimisation: `optimised` → "Settings → Apps → PU Transit Driver → Battery → Unrestricted (…)"; button opens App info; after choosing Unrestricted and returning: `unrestricted` | disabled until green | "Not sharing — Battery optimisation: …" |
| D9 | Android 13+: notifications off (A13) | Notifications: `not allowed` → the notification-purpose line | disabled | "Not sharing — Notifications (Android 13+): …" |
| D10 | Everything green | every row green | enabled | "Ready — tap Start to share this bus." then "Waiting for a GPS fix — not visible to students yet." then "Live — students can see this bus." |
| D11 | Android: during a live trip switch Battery back to "Optimised", return to the app | Battery row red again | — | "Sharing for now, but Battery optimisation: …" (no bare "Live") |
| D12 | Export evidence after D1–D11 | each blocked Start logged as `preflight` with `ok: false` and the red row's id | | |

## Results

| Date | Phone (brand/model) | OS version | Build (`executionEnvironment` / app version) | A/B rows passed | Rows failed (numbers + what happened) | C1–C3 | D1–D12 | Reviewer |
|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — |

## Exporting what the app recorded

The evidence log (Evidence → **Export**) contains one `permission` event per OS prompt (`step`, `status`, `canAskAgain`, iOS `scope`/`accuracy` or Android `accuracy`) and the `app_state` changes around each Settings visit, so a reviewer can attach the JSON to the results row instead of retyping it.
