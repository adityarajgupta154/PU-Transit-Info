# Evidence — revocation propagation (IDN-02 / AC-18, 14 Sep 2026)

## What was tested

A student with the live tracker view open (`/student`, bus selected, status **live**) is suspended by an admin. AC-18 asks that new reads are denied and that the open view clears its protected state within 60 s.

The web app has no Realtime Database listener: the tracker view polls `GET /api/tracking/{busId}` every 5 s with the caller's ID token, the API reads Firebase through that token, and the auth context re-reads `/api/auth/me` every 20 s and on window focus. So the client-side "permission denied" event is a **403 from the API** (`MEMBERSHIP_REQUIRED`, `MEMBERSHIP_EXPIRED`, …), and the Rules denial is what the API meets on the next read.

## Method (credential-free, real code paths)

- Firebase **Auth + Realtime Database emulators** loaded with the repo's `firebase/database.rules.json` (the unpublished 14 Sep payload; the suspended gate itself is unchanged since 12 Sep) and the real project id.
- The **API server build** (`dist/index.mjs`) unchanged, with `FIREBASE_AUTH_EMULATOR_HOST` and a test-only fetch preload that rewrote its RTDB REST calls to the emulator.
- The **web app** served by the normal Vite dev server, opened in headless Chromium (playwright-core, software WebGL). Its Firebase Auth and `/api` traffic was redirected to the emulator and the local API at the network layer; no app code was changed for the run.
- Seed: approved student, admin and driver (verified emails), `buses/BUS1`, one published route; the driver started a real trip through the API and posted one fix.
- Sequence: sign in through the account page → open `/student` → search `BUS1` → wait for **live** → admin `PATCH /api/memberships/{uid}` `{status: "suspended", active: false}` through the API (t = 0 at the 200 response) → watch the page text every 50 ms; the harness also read `tracking/BUS1/feed` directly from the database with the student's own token before and after.

Throwaway harness (not committed): `/tmp/idn02/{seed,run,shim}.mjs`.

## Observed

| Run | Ordering of the next poll | Rules: direct feed read | Feed left the view | Gate showed *access suspended* |
| --- | --- | --- | --- | --- |
| before the fix | routes poll first (403 at +3.5 s) | 200 → **401 Permission denied** immediately | +3.6 s (routes list emptied) | **+13.5 s** (next 20 s membership poll) |
| after the fix | routes poll first (403 at +3.6 s) | 200 → 401 | +3.7 s | **+3.7 s** |
| after the fix | routes poll first (403 at +1.6 s) | 200 → 401 | +1.6 s | **+1.7 s** |
| after the fix | **feed poll first** (403 at +0.80 s) | 200 → 401 | **+0.86 s** | **+0.86 s** |
| after the fix, with coalescing (final code) | feed poll first (403 at +0.75 s) | 200 → 401 | +0.79 s | +0.79 s |

Before the fix the outcome was already inside 60 s but depended on which poll came first: a 403 on the feed poll kept the last bus position on the map (`error` set, feed retained for ageing) until the routes poll (≤10 s) or the membership poll (≤20 s) caught up. Every API call after the suspension was refused (`/api/routes`, `/api/notices`, `/api/tracking/BUS1` → 403), and the direct database read flipped to *Permission denied* at once.

## Fix

- `src/lib/api.ts`: any 403 dispatches `pu-transit:forbidden` (deliberately any code — a refresh is cheap, a missed revocation is not); `src/contexts/auth-context.tsx` re-checks `/api/auth/me` on it, so the gate closes on the next poll instead of the next 20 s tick. Bursts are coalesced: a refresh already in flight is never aborted by a further 403 (that could starve it while several polls fail at once); one trailing refresh runs after it.
- `src/hooks/use-transit.ts`: a 403 on the feed (single bus or fleet) drops the protected state at once instead of ageing it out.
- Tests: `src/lib/api-session.test.ts` (403 announces, 503 does not), `src/hooks/use-transit.test.tsx` (feed kept through a 503, dropped on a 403; fleet emptied), `src/contexts/auth-context.test.tsx` (a burst of 403s = one in-flight refresh + one trailing refresh, nothing aborted).

Nominal bound (visible tab, healthy network) = the longest poll on the open view plus one `/auth/me` round trip: 5 s with a bus selected, 10 s on the search screen, 20 s elsewhere behind the gate. Background tabs throttle timers and a slow or failing `/auth/me` adds its own latency; the 60 s target still holds with margin, the sub-5 s figures are the observed visible-tab timing.

## Live re-run (owner, after publishing)

Two browsers: student signed in with the tracker open on a running bus; admin on **Admin → Users**. Press *suspend* and start a stopwatch. Expected: the bus and the live tile leave the student view and *access suspended* appears within 5 s; *reactivate* brings access back on the student's next *check status* (or reload). Record the two times here.

Known noise during the clear: the map plugin logs `Cannot read properties of null (reading 'getZoom')` once when the map unmounts mid-frame (`@maplibre/maplibre-gl-leaflet`); it is harmless and not specific to revocation.
