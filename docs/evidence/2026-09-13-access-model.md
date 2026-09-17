# Evidence — owner access-model amendment (13 Sep 2026)

## Authority and scope

This is the authoritative product and access-model amendment for the project
owner's decisions on 13 September 2026. It supersedes conflicting *current*
instructions in earlier drafts, while dated 12 September records remain
historical evidence of what was published then.

The product remains the **PU Transit web app**. Native driver tracking is later
work, not a reason to rename the web product or claim that a native app exists.
The owner reports that the official Play app is being discontinued; that is
owner-reported information, not an independently verified store finding.

## Decision record

- New sign-up has a role picker: **student, staff, driver, admin**.
- PU student and PU staff sign-ups are approved immediately under the owner's
  current access policy.
- A driver or admin sign-up is approved as **student plus the requested role**
  until the office confirms it in **Admin → Users**. The requested role is not
  authority by itself.
- A new student may use a personal email during a **30-day grace period**
  measured from that membership's `createdAt`. Rules and the API enforce the
  deadline.
- Before the grace period ends, the student must switch the account to a
  verified university email from **Account**. Existing memberships are
  preserved; the switch must never wipe or recreate them.
- There are no automatic suspensions. A grace deadline can block protected
  access through Rules/API until the email is corrected, but it does not
  silently change a membership to `suspended`.
- The established root account remains protected. There are no new Firebase
  Console instructions to promote a root account. Future driver/admin
  confirmation is handled in **Admin → Users**.
- Add-on direction is `toCampus` / `fromCampus`, with a `full` flag.
- Driver UI supports English, Hindi and Gujarati; native-speaker review is
  still pending.
- Admin notices are at most 280 characters and expire within 30 days of posting. Admins
  create and delete notices.
- Route kind includes `shuttle`.
- **About / Help** is available from the app navigation.
- Payments and passes are excluded.
- PU blue remains pinned to **`#0A76D6`**. Do not substitute indigo.

## Implementation versus publication

| Item | Status at this evidence date |
| --- | --- |
| Web product name and native-later direction | Implemented product direction; this evidence does not claim a native build or a native test. |
| Role picker, account email-switch path, direction/full, notices, shuttle kind, About/Help and driver languages | Implemented and locally checked; real email delivery and live end-to-end use still require the published policy and owner rehearsal. |
| 30-day personal-email grace, requested-role approval, membership preservation and no-auto-suspension policy | Implemented in API, UI and emulator-tested Rules. The new Rules payload is **not published**. |
| 12 Sep 2026 Rules publication | Historical: the owner-reported publication remains recorded in `2026-09-12-w0-01-rules-publish.md`; it is not evidence that this 13 Sep payload was published. |

### Local verification

- API: 36/36 Vitest checks passed, including email/token mismatch denial,
  personal-email grace, root protection, role requests, notice validation,
  expiry filtering and audited deletion.
- Firebase Rules: 16/16 emulator scenarios passed, including negative
  direct-write cases and complete direction/full tracking transitions.
- Frontend: the 41-check suite passed; additional service-notice scope/expiry
  and multi-day grace-expiry checks passed separately.
- Workspace TypeScript checks passed before the final UI fixes; final frontend
  typecheck and production Vite build also passed. Build retains non-blocking
  bundle-size and existing tooltip sourcemap warnings.
- Desktop/phone visual checks used explicitly mocked identities/data, not real
  Firebase sign-ins. Final scoped capture had no client errors or horizontal
  overflow. Screenshots are under `artifacts/pu-transit/.impeccable/review/access-*`.
- UI detector: no blocking findings; four advisory findings on existing type
  sizes were left within the established Metro visual design.
- Running API health returned 200; unauthenticated notices returned 401.
- Rules mirrors are byte-identical. SHA-256:
  `f61cb851e961d4e52f3291b37d20e1c6a8fb681ca67365edcac55f5bf0af6098`.
  Reproducible access-model mutation:
  `scripts/rules-mutations/2026-09-13-access-model.py`.

These checks do not prove real email delivery, a physical driver's GPS session,
or the new live policy. **No Rules were published and no existing live
memberships were edited, suspended or deleted by this implementation.**

## Owner publication walkthrough — after QA

The two checked-in files are code mirrors of one payload:

1. `firebase/database.rules.json`
2. `artifacts/pu-transit/public/firebase-database.rules.json`

After QA has reviewed the complete new access policy and confirmed that the
two files are byte-identical, the project owner should:

1. Sign in to the PU Transit web app with the already-established protected
   admin/root account and open **Setup → Rules**.
2. Use the Setup page's copy/download action to obtain the complete Rules JSON.
   Do not assemble fragments, paste only the changed branches, or use the old
   12 Sep payload.
3. In the Firebase Console, open project `pu-transit-f815d` →
   **Realtime Database → Rules**.
4. Replace the entire editor contents with that one complete payload from
   Setup and select **Publish** once.
5. Do not add a temporary `allow: true` rule, open the database, or promote a
   new root account. Future driver/admin confirmations belong in **Admin →
   Users**.
6. Record the actual publication date and owner confirmation only after the
   console reports success. Until then, clients must be treated as running
   against the historical published policy and the new access behavior remains
   unpublished.

The owner publishes one complete payload; the Setup copy is the distribution
surface and the two repository files are the QA-checked mirrors, not two
different policies or two separate publications.

## Remaining owner/manual checks

- Delete the old test fixture, with approval, without deleting existing
  memberships.
- Complete the legacy routes import/rehearsal before the live rehearsal.
- Rotate the ORS key.
- Perform the production-auth smoke check.
- Publish the new full Rules payload only after QA, using the walkthrough above.