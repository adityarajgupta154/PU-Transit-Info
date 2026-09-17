> **Evidence ID: NAT-06 · Collected: 14 Sep 2026.** Provenance: relocated from [`docs/rehearsal-log-nat06.md`](../rehearsal-log-nat06.md). The protocol and recorded results/verdicts below are original recorded results, not new runs. Credential-free transport PASS entries remain historical passes; phone/device steps remain NOT RUN. See [`README.md §10 — Testing and verification`](../Delivery-Status.md#10-testing-and-verification) and [`PRD §13 — Acceptance scenarios`](../PU-Transit-PRD.md#13-acceptance-scenarios).

# NAT-06 — auth parity between the native client and the web (AUTH-06)

Status, 13 Sep 2026: **parity confirmed in code; the credential-free negative cases RUN from the native transport against the live workspace API (all pass, §3); the cases that need a real account, and the sign-out check on a phone, are NOT RUN** — same build-path block as NAT-01 (no Android Studio machine or Apple Developer account). Fill §5 only after a real run.

NAT-06 asks three things: the native app must use the same Firebase ID tokens and the same membership gate as the web; sign-out must clear whatever private state the phone holds; and the negative auth tests that pass on the web must pass identically from the native client. The gate lives in the server and is client-agnostic, so most of the work is showing that the native client cannot reach the server any other way and that its own preflight blocks for the same reasons the web `AuthGate` does.

## 1. Same tokens, same gate — by construction

| Concern | Web (`artifacts/pu-transit`) | Native (`artifacts/pu-transit-driver`) | Same? |
|---|---|---|---|
| Identity provider | Firebase Auth project `pu-transit-f815d` (`src/lib/firebase.ts`) | Same project and web API key (`lib/firebase.ts`); `initializeAuth` with AsyncStorage persistence | Yes |
| Token on each request | `fetchWithAuth` (`src/lib/api.ts`): `auth.currentUser.getIdToken()` → `Authorization: Bearer`; fails closed if the user changes around the call | `app/_layout.tsx`: `setAuthTokenGetter(() => auth.currentUser.getIdToken())` feeding the shared `customFetch` (`lib/api-client-react/src/custom-fetch.ts`), which adds the same header. Tracking traffic uses the same generated client; the token is force-refreshed 20 min after Start so a background trip never runs on a stale token | Yes — one header, one SDK, no native-only path |
| Server gate | `firebaseIdentity` (firebase-admin `verifyIdToken` against Google's public certs; no emulator or dev bypass) → `requireVerifiedEmail` → `requireActiveMember` → `requireDriver` → `requireDriverAssignment` (`artifacts/api-server/src/middleware/firebase-auth.ts`, chains in `routes/tracking.ts` / `routes/transit.ts`) | Identical — the native app calls the same endpoints | Yes |
| Error codes | 401 `AUTH_REQUIRED` / `AUTH_INVALID`; 403 `EMAIL_UNVERIFIED`, `MEMBERSHIP_REQUIRED` (missing, pending, rejected, suspended, inactive), `UNIVERSITY_EMAIL_REQUIRED`, `MEMBERSHIP_EMAIL_MISMATCH`, `ROLE_REQUIRED`, `BUS_ASSIGNMENT_REQUIRED`; 503 `FIREBASE_UNAVAILABLE` | Same | Yes |
| Client-side gate (messaging, Start held) | `AuthGate`: sign in → verify email → request access → pending / rejected / suspended → inactive → grace ended (students) → role | `accountSteps` (`lib/account-steps.ts`): signed out → checking → server rejected → **account mismatch** → **email not verified** → not registered → role → pending / rejected / suspended → deactivated; then the bus-assignment row. Start stays disabled while any row is red and the list re-runs at tap time (NAT-04) | Yes — the two bold rows were added by NAT-06; before it an unverified driver was told "not registered" |
| Personal-email grace period | Blocks students only (`membership.role === 'student'`) | Not needed: the role row already blocks non-drivers, and the Rules keep personal-email accounts as students. The server still enforces it for every role | n/a |
| Account switch during a request | `auth-context` discards a response whose uid is not the current user | `/api/auth/me` is cached per uid (`['/api/auth/me', uid]`) and a record for another uid turns the row red (`account mismatch`) | Yes |
| Revocation | Token expiry only (≤ 60 min); Firebase revocation is not checked (`checkRevoked` unused) — open item AC-18 in W2 | Same | Same gap, tracked in W2 |

## 2. Sign-out — what the phone holds and what clears it

Sign out is disabled while a trip is active or a pending End exists (`active = phase not in ['idle','conflict']`), so at sign-out the tracker is idle and `dispose()` sends nothing. `logout()` in `app/index.tsx` then runs, in order:

| Device-held state | Where | Cleared by | Note |
|---|---|---|---|
| Firebase session (refresh token, cached ID token) | AsyncStorage (`firebase:authUser:*`) | `signOut(auth)` | Same SDK call as the web |
| Account record from `/api/auth/me` (uid, email, role, status, assigned bus) | React Query memory | `queryClient.cancelQueries()` + `queryClient.clear()` | Also keyed by uid, so one account's record is never rendered for another on a shared phone |
| Saved trip session `pu-transit:tracking:session:<uid>:<busId>` | AsyncStorage + in-memory mirror (`storeValues`) | `clearTrackingState(uid)` (`lib/tracking.ts`) | Present at sign-out only after an ambiguous Start (timeout: the server may hold the trip, the phone shows `idle`). Dropping it means that trip is not recoverable from this phone; the server closes it by heartbeat lease (~90 s) and a Start inside that window answers 409 `OWNER_ACTIVE` once. Privacy wins over recovery here; the web keeps its copy (note below) |
| Pending End `pu-transit:tracking:pending-end:<uid>:<busId>` | Same | `clearTrackingState(uid)` | Cannot exist at sign-out (button held while `pending_end`); removed defensively |
| Live trip state / feed | React state | Reset to `INITIAL_STATE` when `user` becomes null (`[busId, storeReady, user]` effect) | — |
| Evidence log (NAT-01/05 exports) | App document directory | **Kept**; Evidence → *Clear* | Holds bus id, trip ids, phases, timestamps and accuracy — no coordinates, uid or email. Kept so a rehearsal export survives a sign-out |
| Permission prompt counter `pu-transit:permission-attempts` | AsyncStorage | Kept | Per-device UX counter, nothing personal |

Web note (out of NAT-06 scope, follow-up in W2): the web driver page keeps its session key and pending End in `sessionStorage` / `localStorage` after sign-out; both are keyed by uid and useless without a token, but they are not removed.

## 3. Negative tests — same cases, native transport

Two layers, because the driver artifact has no device build path yet:

- **Transport, live, credential-free** — `scripts/src/nat06-auth-parity.ts` sends the requests through the native client's transport (shared `customFetch` + `setAuthTokenGetter`, exactly as `app/_layout.tsx` wires it) at `GET /api/auth/me` and `POST /api/tracking/BUS-NAT06/start` on a live API, which verifies signatures with Google's certificates. No real token is sent.
  ```bash
  pnpm --filter @workspace/scripts run nat06:auth -- --base https://<domain>
  ```
- **Preflight, unit** — `artifacts/pu-transit-driver/lib/account-steps.test.ts` (`pnpm --filter @workspace/pu-transit-driver run test`) applies the web `AuthGate` cases to the native account rows.

| Case | Server answer | Web / API evidence | Native evidence | Status |
|---|---|---|---|---|
| No token | 401 `AUTH_REQUIRED` | `routes/transit.test.ts` "does not expose routes without a Firebase token"; `geo.test.ts` anonymous | `nat06:auth` — me 401 `AUTH_REQUIRED`, start 401 `AUTH_REQUIRED` | **RUN 13 Sep 2026, PASS** |
| Forged token — RS256, genuine-looking claims for this project, unknown key id | 401 `AUTH_INVALID` | `geo.test.ts` invalid token (mocked verifier) | `nat06:auth` — 401 `AUTH_INVALID` on both | **RUN, PASS** (a 503 here would have meant certificate lookup failed) |
| Forged and already expired | 401 `AUTH_INVALID` | — | `nat06:auth` — 401 `AUTH_INVALID` on both | **RUN, PASS** |
| Unsigned token (`alg: none`) | 401 `AUTH_INVALID` | — | `nat06:auth` — 401 `AUTH_INVALID` on both | **RUN, PASS** |
| Garbage bearer string | 401 `AUTH_INVALID` | — | `nat06:auth` — 401 `AUTH_INVALID` on both | **RUN, PASS** |
| Unverified email | `/me` 200 with `emailVerified:false, membership:null` (no RTDB read); tracking 403 `EMAIL_UNVERIFIED` | `transit.test.ts` "returns an unverified university user without reading RTDB"; `geo.test.ts` unverified; web `AuthGate` "verify your email" | Unit: row `email not verified` with the verification instruction, Start held. Device: step D1 | Unit RUN; device **NOT RUN** |
| Expired membership | Modelled since 14 Sep 2026 (IDN-01): `expiresAt` on the membership; past it the API answers 403 `MEMBERSHIP_EXPIRED` and the driver app shows the `expired` row with the extend-it message (`account-steps.test.ts`). Before that, the nearest states were `suspended`, `rejected` and `active:false` | 403 `MEMBERSHIP_REQUIRED` / `MEMBERSHIP_EXPIRED` — `geo.test.ts`, `membership-expiry.test.ts`; web `AuthGate` "access suspended" / "account inactive" / "access expired" | Unit: rows `suspended` / `rejected` / `deactivated` / `expired`, Start held. Device: step D2 | Unit RUN; device **NOT RUN** |
| Pending / no membership | 403 `MEMBERSHIP_REQUIRED` | `geo.test.ts` pending; `transit.test.ts` | Unit: `pending` / `not registered` | Unit RUN |
| Wrong role (student, staff, admin) | 403 `ROLE_REQUIRED` | `transit.test.ts` student write → `ROLE_REQUIRED` | Unit: `role: <role>` | Unit RUN |
| Record for a different uid | client-side only | `auth-context` uid check; `api-session.test.ts` discards after sign-out | Unit: `account mismatch` | Unit RUN |
| Sign-out clears device state | — | no web test (see §2 note) | Device: step D3 | **NOT RUN** |

## 4. Device protocol (≈ 20 minutes, one phone, at a desk)

Needs a development or release build (`docs/rehearsal-log-nat01.md` §Build), the workspace or published API, and an admin signed in to `/admin` on a laptop. Use test accounts the transport office controls; do not use a real driver's account.

**D1 — unverified email.** On the web account page sign up a fresh university-domain test account and do **not** open the verification link. Sign in with it on the phone. Expect: *Driver account* row red, value `email not verified`, fix line "Open the verification link we emailed you, then tap Re-check…"; Start disabled; Trip status never says live. Open the link, tap **Re-check**: the row must move on to `not registered` (until an admin approves the account as a driver). Record the exact row text.

**D2 — membership withdrawn ("expired").** Sign in on the phone with an approved test driver (all rows green, do not Start). In `/admin` set the account to **suspended**, then on the phone tap **Re-check**. Expect row `suspended`, fix line "…ask the transport admin to restore it", Start disabled. Repeat with **deactivate** (row `deactivated`) and, if the office uses it, **rejected**. Optional server check: while suspended, `curl -H "Authorization: Bearer <token>" <base>/api/tracking/<bus>/start -X POST …` must answer 403 `MEMBERSHIP_REQUIRED` — the phone only ever sends what the server refuses.

**D3 — sign-out clears the phone.** With the approved test driver, create the one state that can survive to a sign-out: tap **Arm Start timeout (AC-08)**, then **Start**; expect `idle` with `Tracking request timed out.` (a saved session now exists on the phone — a second Start would say `recovery`). Tap **Sign out**. Expect the sign-in form with no email, role or bus visible anywhere. Force-stop the app, reopen it: it must open on the sign-in form with no `session_restored` evidence event and no account details; the Evidence section still holds the log (kept by design, §2). Sign in again as the same driver and tap **Start**: expect `acquiring` → `live` as a **fresh** trip (new trip id in the timeline) — never `recovery`. If the timed-out trip's lease is still alive the first Start answers 409 `OWNER_ACTIVE`; wait 90 s and tap again. End the trip. Then sign in as a **different** test driver on the same phone: the account rows must show only the second account's email and bus. Export the evidence and run `nat05:parity` on it: the report must list the timed-out attempt and the fresh trip with no recovery between them.

Also run `nat06:auth` against the API the phone uses (`--base https://<domain>`); the five transport cases must print PASS.

## 5. Results — device steps NOT RUN

| Field | Value |
|---|---|
| Date / time (IST) | — |
| Phone (brand, model, OS) | — |
| Build (variant, app version) | — |
| API base used (workspace / published) | — |
| Test accounts (roles only, no emails) | — |

| Step | Phone showed (row value / fix line, Start state) | Server / admin evidence | Result |
|---|---|---|---|
| D1 unverified | — | — | NOT RUN |
| D2 suspended / deactivated / rejected | — | — | NOT RUN |
| D3 sign-out | — | — | NOT RUN |
| `nat06:auth` against the phone's API | — | — | NOT RUN on that base (workspace run 13 Sep 2026: 5/5 PASS) |

## What this does not prove

- That the OS keeps nothing else (iOS keychain copy of the Firebase session, Android backup of AsyncStorage): the Firebase SDK owns those stores and `signOut` is the only clearing API either client has.
- Revocation inside a token's lifetime (AC-18): neither client checks it; W2.
- Rate limiting or lockout on repeated bad tokens: not a NAT-06 requirement.