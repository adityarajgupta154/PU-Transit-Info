# Isolated local grading demo — 14 Sep 2026

This implementation is separate from the earlier DOC-04 documentation-only
check. It adds a development-only `pnpm demo` command to the existing web/API,
not a deployment, database migration or Rules publication.

## Boundaries

- Firebase CLI Auth and RTDB emulators, `demo-pu-transit`, loopback ports
  9099/9000; namespace `demo-pu-transit-default-rtdb`.
- Synthetic verified student/driver/admin accounts and approved memberships,
  BUS1 and a published manual First Shift route. No live records copied.
- Existing Firebase SDK token verification, membership/role checks and the
  unmodified checked-in RTDB Rules are used for application requests.
- Only bootstrap uses local emulator administration. It refuses nonempty data.
- Child environment is allowlisted; no application secrets or PostgreSQL URL.
  Non-import startup no longer imports the legacy PostgreSQL package.
- Demo migration preview/import are disabled. Normal managed project/database
  allowlists, workflow configuration and both Rules mirrors are unchanged.

## Checks run

- API unit suite: 105 tests passed; additional startup-binding tests: 3 passed.
  Includes invalid/one-sided demo configuration, separate emulator identity,
  local REST namespace, unavailable Auth, normal verification-error mapping,
  no eager PostgreSQL import and disabled demo migration endpoints.
- Web unit suite: 93 tests passed, including browser Firebase configuration.
  Additional Vite configuration tests: 3 passed with actual temporary
  `.env.local` / `.env.development` files, process precedence, paired flags,
  normal routing, demo loopback/proxy and build/preview rejection.
- Shared-library, web, API and scripts typechecks passed; API built/started from
  the sanitized launcher environment without a `DATABASE_URL`. Normal production
  web build passed (existing bundle-size and tooltip sourcemap warnings).
- `pnpm demo:check` passed with real Auth emulator password sign-in and refresh
  for all three roles, same-origin `/api`, role-specific permissions, direct RTDB
  Rules denial and an admin bus-label edit visible to the student then restored.
- Paused Auth and RTDB individually, keeping an already-issued token:
  `/api/auth/me` returned **503** in each case. Resuming each emulator restored
  **200**. All requests used loopback addresses; no cloud fallback.
- SIGTERM and SIGINT to the launcher each shut down ports 5173, 3001, 9099 and
  9000. Fresh startup recreated only the synthetic fixture, with no previous
  tracking or audit records.
- Managed API/web workflows restarted successfully without demo flags; the
  managed public homepage screenshot rendered normally.

## Browser journey (real emulators, no successful-request mocks)

- Student signed in, reloaded with its session intact, selected First Shift and
  found BUS1 / Waghodia Circle → PU Campus. Student `/admin` access was denied.
- Driver signed in with BUS1 assigned, selected city → campus, started a trip,
  then confirmed End. A separate student session observed the active trip and
  then the ended state.
- Admin signed in and loaded Users, Fleet and Routes with the synthetic records.
- An intentionally blocked loopback Auth sign-in showed the network-unavailable
  error and did not fall back to cloud Auth.
- **Observed production Firebase browser requests: 0.**

Limits: the automated browser did not supply a usable GPS fix, so live coordinates
were not verified (active/ended cross-session tracking was). The existing Fleet UI
has no label-edit control; label persistence was checked through the real API,
not claimed as a browser edit. No new fleet-editor UI is part of this task.
Basemap tiles still require internet; ORS is deliberately unavailable in the
credential-free demo. This is not a fresh-machine package-install test, native
background rehearsal or production-readiness claim.