# IDN-04 / AC-32 — email-change path (14 Sep 2026)

**Claim under test.** A previously approved member whose account email changes — or is no longer
verified — cannot use the old approval until the new email is verified and matched; the UI says so.

## Policy as built

The approval is bound to `uid` **and** `email`. Every protected gate (Rules and API) requires
`email_verified == true` and `memberships/{uid}.email == token email`. Re-approval is the same rule
that approves a sign-up: a verified **university** address is approved by policy, so the record is
re-bound to it (Rules `EMAIL_SYNC` branch, applied by `/auth/me`) with role, dates and bus unchanged.
A personal or unverified address is never re-bound — there is no path back to the old approval other
than switching to a verified university address (the office cannot edit emails; admin PATCH excludes
`email`).

| Session after the change | Rules | API | Web | Driver app |
| --- | --- | --- | --- | --- |
| new address, **not verified** (console change, unverified sign-up) | every read/write denied, own record included | `/auth/me` → `emailVerified:false, membership:null` without an RTDB read; protected routes 403 `EMAIL_UNVERIFIED` | gate "verify your email — open the link we emailed to *addr*…"; account page red tile with *send again* / *refresh* | Membership row: "email not verified — open the verification link, then sign in again" |
| **personal** address, verified | own record readable, everything else denied, rebind refused | `/auth/me` returns the stored record unchanged and skips the bus/assignment reads Rules would deny (client sees `membership.email ≠ email`); protected routes 403 `MEMBERSHIP_EMAIL_MISMATCH` | gate "email changed — approved for *old*, signed in as *new*, only a verified university email can carry that approval"; account page red status line | Membership row: "approved for *old*, not this email — verify a university address" |
| **university** address, verified | denied until the record follows the token; the identical-fields rewrite is allowed, a role change is not; the old address is then the mismatched one | `/auth/me` PUTs the rebound record (same role/dates) and returns it | no visible stop: access continues on the next check | same |

Both clients judge the record in the API's order — status, activity, expiry, then the email binding —
so a suspended or expired member with a changed address is told that first (switching the address
would not restore them), and the personal-grace copy is suppressed while the emails differ.

Firebase revokes the refresh token on an email change, so the user signs in again with the new
address and the next `/auth/me` runs with the new claim. The ID token already issued keeps its old
claim until it expires (≤ 1 h) — the same token-lifetime window as every claim-based check; the
API does not call `checkRevoked` per request.

## Tests (all local, credential-free)

- Rules, emulator (`pnpm --filter @workspace/scripts run firebase:rules:test`, **26/26**): new case
  "a changed or unverified email cannot reuse an approved record; only a verified university email
  carries it over (AC-32)" — approved driver record, three tokens for the same uid (unverified
  university, verified personal, verified other-university): reads of `routes` / `tracking/BUS1`,
  a tracking start write and the rebind attempt, then the rebind with the same role succeeding and
  the old address failing afterwards.
- API, vitest (`artifacts/api-server`, **96/96**): "denies a changed or unverified email the stored
  approval, and rebinds only a verified university email" — `/auth/me` shape for the personal and
  the unverified claim, 403 `MEMBERSHIP_EMAIL_MISMATCH` on `GET /api/routes` and
  `POST /api/tracking/BUS1/start`, 403 `EMAIL_UNVERIFIED` with no RTDB call, and the PUT that
  re-binds a verified university claim with role and `createdAt` intact. For the personal claim the
  mock answers every non-membership read with a Rules-style 401, so the test fails if `/auth/me`
  ever tries the bus/assignment enrichment for a mismatched token (it did before this pass: 503). (The personal → university
  sync and the stored-admin/personal-token case were already covered.)
- Web, vitest (`artifacts/pu-transit`, **86/86**): auth context derives `emailMismatch` from the two
  emails the API compared (its echo of the token email vs. the stored record) and clears it once
  they match; the gate renders the "email changed" stop naming both addresses and linking to the
  account page, and shows "access suspended" instead when the record is suspended.

## Copy (reviewed)

- Gate, unverified: "open the link we emailed to *addr*, then refresh from the account page. nothing is approved before that."
- Gate, mismatch: "your access was approved for *old*, and you are now signed in as *new*. only a verified university email can carry that approval — switch back from the account page, or ask the transport office."
- Account page, status line: "approved for *old*, not for *new* — only a verified university email carries your access. switch back below or ask the transport office"
- Account page, after requesting the change: "verification link sent to *new*. open it, then sign in again with *new*: your access moves to the new address once it is verified — a personal address cannot take it over."
- Account page, unverified tile: "open the link we emailed to *addr*, then come back and press refresh. nothing works before that — if the address is new or the link is missing, press send again."

## Fixed on review

`/auth/me` used to enrich a current driver record with its bus and dated assignments before checking
the email binding; against real Rules those reads are denied for a mismatched token and the route
answered 503, so the web would have shown an error instead of the explanation. The enrichment now
requires the binding, and the mismatch stop was moved behind the status/expiry stops.

## Not done here

- No audit record for the rebind: `audit` writes are admin-only in Rules, so a member's own sync
  cannot append one without a Rules change; the members list shows the current email and `updatedAt`.
- Elevated roles (driver, admin) follow the uid to a verified university address. Making them lapse
  on an email change would be one Rules mutation (drop `role` from the identical-fields list, force
  `student`) plus the API mirror — a product decision, not taken here.
- Owner check on the published app (needs a real Firebase project): change the address from the
  account page → open the link → sign in again → access continues with the same role; then change
  it in the Firebase console to a personal address → sign in → the "email changed" stop appears and
  every call is a 403 until the address is switched back.
