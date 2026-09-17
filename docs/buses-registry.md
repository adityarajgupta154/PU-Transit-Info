# Bus registry (FLT-01 / FLT-02) — 13 Sep 2026

Status: **built and tested locally; not live.** The Rules payload that adds the `buses` node is not published, and the migration has **not** been applied to any data. Nothing in the live database has changed.

## Model

`buses/{busId}` — `busId` is the canonical key: the registration uppercased with everything except `A–Z` and `0–9` removed, 2–20 characters (`GJ 06 BX 1414`, `gj06bx1414`, `gj-06-bx-1414` are all `GJ06BX1414`). The same one-line rule lives in the API (`busKey`), the web (`normalizeBusNumber`), the migration planner and the Rules key regex.

| field | rule |
| --- | --- |
| `busId` | equals the key |
| `label` | 1–64 chars, shown to admins (`"Waghodia 14"`); defaults to the registration as typed |
| `status` | `active` or `out_of_service` |
| `reason` | ≤200 chars, why it is out of service; empty while active |
| `createdAt` / `updatedAt` | server timestamps; `createdAt` immutable |

Every bus reference uses the key: `memberships.assignedBusId`, `routes.busNumber`, `tracking/{busId}`. Buses are never deleted (history, audit and tracking nodes stay); deactivation is the retirement path.

## API

| call | who | result |
| --- | --- | --- |
| `GET /api/buses` | member | admins: every bus; others: `active` only |
| `POST /api/buses` `{registration, label?}` | admin | 201; **409 `BUS_EXISTS`** names the existing record (`Registration GJ06BX1414 is already registered as "Waghodia 14" (active)`); audit `bus.save` |
| `PATCH /api/buses/{busId}` `{label?, status?, reason?}` | admin | 200; **409 `BUS_ACTIVE_TRIP`** while the bus has a live trip (names the trip, "end it from Fleet first"), nothing written, no audit; deactivation writes audit `bus.deactivate` with the reason, reactivation `bus.reactivate`, rename `bus.save` |
| `PATCH /api/memberships/{uid}` | admin | a **new** assignment must be a registered `active` bus (**409 `BUS_NOT_REGISTERED` / `BUS_OUT_OF_SERVICE`**); an unchanged assignment only has to exist, so a driver whose bus was parked can still be suspended |
| `POST /api/routes`, `PATCH /api/routes/{id}` | admin | `busNumber` must be registered (any status); stored as the key |
| `GET /api/routes` | member | non-admins do not receive routes whose bus is `out_of_service`; admins see all; the routes themselves are untouched |

Rules mirror the same constraints (`scripts/rules-mutations/2026-09-13-bus-registry.py`, tests in `scripts/src/firebase-rules.test.ts`): `buses` admin-write / member-read / no delete, `assignedBusId` is `''` or a registered key and a *changed* assignment must point at an `active` bus (same changed/unchanged rule as the API), `busNumber` is a registered key, audit action enum gains the three `bus.*` actions. Assignments are left intact on deactivation by design (the driver keeps the bus and sees the reason in preflight; Start is refused, see FLT-03 below).

## Start gate (FLT-03)

`POST /api/tracking/{busId}/start` reads `buses/{busId}` before anything else: missing → **403 `BUS_NOT_REGISTERED`**, `out_of_service` → **403 `BUS_OUT_OF_SERVICE`** with the reason (`Bus GJ06BX1414 is out of service: gearbox. Ask the transport admin before starting.`). Samples, heartbeats and End are not gated, so a bus parked mid-trip (the check-then-write window of deactivation) still reports until the driver ends the trip. Rules mirror it in the tracking Start branch only (new node, restart after End, takeover of a stale trip): `buses/$busId/status == 'active'`; emulator test covers parked → denied, reactivated → allowed, parked mid-trip → samples/End still allowed, restart denied while parked.

Preflight: `/api/auth/me` now returns `bus` (the driver's assigned bus record, any status; null for non-drivers, without an assignment, or when the assigned id is not a registry key). Web driver page shows a *bus in service* row (English/Hindi/Gujarati) and native preflight a *Bus in service* row between *Bus assignment* and *Network*; both go red with the reason and keep Start disabled. If the bus is parked after the page loaded, the server's 403 text is shown as the tracking error; the shared tracker treats a Start 403 as a definite refusal (drops the provisional session, so the next Start is a plain Start, not "recovery") and never as a publisher conflict. `/auth/me` reads the registry only for approved, active drivers — suspended or deactivated drivers keep getting their membership (Rules would refuse them the bus read).

Legacy ids: until the migration runs, a driver whose `assignedBusId` is not a canonical registry key cannot start (both layers say *not registered*). Publish the Rules and run the migration in one sitting.

## Web

Admin → Fleet has the registry: add form (registration + optional label; a duplicate shows the server's message under the form), list with status badge and reason, *mark out of service* (optional reason) and *back in service*; a 409 stays next to that bus until the admin acts. Users → driver bus picker and Routes → bus select read the registry (parked or unregistered current values stay selectable, labelled). The student page did not change; the server filters.

## Rollout order (owner)

1. Publish the Rules payload (both mirrors are byte-identical; Setup → Firebase Console, as for the access-model payload). Until then `GET /api/buses` answers 503 and route/assignment edits that need the registry fail with the messages above.
2. Run the report (read-only) and read it:
   ```sh
   PU_ADMIN_ID_TOKEN=<your ID token> pnpm --dir scripts run buses:migrate -- --base https://<api domain>
   ```
   The token is your own short-lived admin ID token (signed-in app → DevTools → Network → any `/api` call → `Authorization: Bearer …`). It expires after an hour; never paste it into chat or a file.
3. Fix blocking items in the app (invalid values under Routes / Users; live trips end on their own or from Fleet), re-run the report.
4. Apply: same command with `--apply`. It registers buses (`POST /api/buses`), rewrites routes (`PATCH /api/routes/{id}`), then assignments (`PATCH /api/memberships/{uid}`) — every change is validated and audited like an admin edit — and prints a fresh report; re-running is a no-op.

## Report format

Markdown on stdout: summary counts; **Registry** table (key, label, spellings found, routes, drivers, new/exists); **Blocking** (`invalid` — value that does not normalize; `active_trip` — old or new id has a live trip; `registry_unreadable` — Rules not published); **Notes** (`merge` — several spellings collapse into one key, label = the most common spelling; `existing` — kept as registered; `orphan_assignment` — driver assigned to a bus no route serves; `tracking_history` — history left under an old id, admins cannot move tracking nodes); **Planned rewrites** (routes, drivers). Sample from fixture data: `pnpm --dir scripts run buses:test`.

## Verification (13 Sep 2026, local)

- API: `pnpm --filter @workspace/api-server run test` — 55 passed incl. `src/routes/buses.test.ts` (create / duplicate naming existing / invalid / deactivate blocked by live trip with no write and no audit / deactivate idle + audit row / student route filter / assignment and route guards).
- Rules: `pnpm --dir scripts run firebase:rules:test` — 17 passed (new registry case).
- Planner: `pnpm --dir scripts run buses:test` — 4 passed. Web: typecheck + 54 tests passed.
- FLT-03: api-server test `denies Start on a parked or unregistered bus…` (56 total), Rules lifecycle test extended, native `account-steps` tests 9 passed, web typecheck + 54 tests.
- Not done: live report/apply (needs the owner's token after the Rules are published); device run of the native row.
