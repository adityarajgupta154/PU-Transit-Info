# Evidence — W0-01 bundled Rules publish (12 Sep 2026)

Requirement: Remaining-Work PRD v2.0 §5 W0-01 — owner publishes the bundled Rules (admin force-end + append-only `audit` + removal of legacy `driverStatus`).

## What was published

- File: `firebase/database.rules.json` (byte-identical to the copy served at Setup → Rules, `artifacts/pu-transit/public/firebase-database.rules.json`; `cmp` exit 0). SHA-256 prefix `a39a5ef25bb8d882`.
- Top-level rule nodes: `.read`, `memberships`, `routes`, `audit`, `tracking`. No `driverStatus` rule exists, so every read/write of that path is denied by the default-deny root.
- Published by the project owner from the Firebase console (Realtime Database → Rules → Publish) on 12 Sep 2026, using the text copied from the in-app Setup page. Owner-reported; the repository has no working server credential to compare the published text remotely (`firebase:inspect` fails closed on the stored service-account secret).

## Emulator regression on the published file (run 12 Sep 2026, `pnpm --filter @workspace/scripts firebase:rules:test`)

```
✔ anonymous, unverified, wrong-domain, pending, inactive, and suspended reads fail
✔ verified users can self-create only a pending inactive student membership
✔ approved students can read routes but cannot write them
✔ legacy driverStatus is denied for every role
✔ audit is admin-readable and create-only with strict actor and shape
✔ an active approved admin can approve memberships and create, edit, and delete routes
✔ assigned driver can preflight a missing node and complete start/sample/weak/heartbeat/end
✔ tracking rejects unauthorized roles, ownership changes, malformed data, stale sequences, and old-client bypasses
✔ admin force-end is narrowly limited to the exact active-to-ended transition
✔ a stale owner can be replaced only by a new generation, and the old generation cannot publish
✔ an absent bus can receive an ended tombstone and cannot reopen that generation
ℹ tests 11 · pass 11 · fail 0
```

## Live database probes (anonymous, 12 Sep 2026)

`GET https://pu-transit-f815d-default-rtdb.firebaseio.com/{driverStatus,audit,tracking}.json` → HTTP 401 `Permission denied` for all three, before and after the publish.

## Acceptance status

| Acceptance (W0-01) | Status |
| --- | --- |
| Admin force-end succeeds in the app | **Deferred to the W0-03 live rehearsal** (owner decision, 12 Sep 2026): force-end only applies to a non-ended trip node, so it needs a real driver Start first. Rules-level proof: emulator test "admin force-end is narrowly limited to the exact active-to-ended transition". |
| An `audit` row appears in the System tab | Deferred with the above (the first audited force-end writes it). Rules-level proof: "audit is admin-readable and create-only". |
| `driverStatus` reads are denied | Rules-level proof on the published file (emulator, every role) + live anonymous 401. Direct live check as an approved admin: Firebase console Rules simulator, read `/driverStatus` with the admin's auth payload → denied, paired with `/tracking` → allowed. |

## Follow-ups

- W0-02: owner deletes the stale `driverStatus` node (console → Realtime Database → Data). Code and built bundle contain no reference (see `2026-09-12-w0-02-driverstatus-removal.md`).
- W0-03: first real force-end + audit row recorded during the live rehearsal.
