# RTE-04 — route editor keeps the draft, retries without duplicates, warns before leaving

Date: 14 September 2026  
Status: **Built; unit-tested (web 90/90, API 97/97) and the history guard proven in a real Chromium.** Device run
(Android hardware back on the admin page) remains an owner check.

## What changed

| Piece | Behaviour |
|---|---|
| `PUT /api/routes/{id}` (new, same admin chain as `POST /routes`) | Idempotent create-or-update. `{id}` must be a UUID (400 otherwise — mirrors the Rules key pattern, so the client sees a validation error instead of a Rules 503). Body `id` must match. Same versioning, publish gate and live-trip lock as POST. |
| Replay short-circuit (PUT only) | If the stored node already holds exactly this content (`routeForStorage` equality, `publishedVersion` ignored), the request answers 200 with the node: no write, **no extra version**. It is still audited, with the summary suffixed `(replayed, unchanged)`, because the first attempt may have failed exactly at its audit line — a retry must not turn a 502 `AUDIT_FAILED` into an unaudited change. |
| Web `storage.createRoute(route, id)` | Sends the PUT. The routes tab draws one `crypto.randomUUID()` per new route and keeps it across failed saves, so a retry writes the same node. Edits of existing routes still use `POST /routes` with the existing id. |
| Draft preservation | Save/geocode/ORS failures never reset the form: the draft state is only cleared on success or an explicit reset. (The failing request shows its message inline, as before.) |
| Dirty tracking | `baseline` = empty draft, or the loaded route when editing; `dirty` = draft ≠ baseline. |
| Leaving guard (`hooks/use-unsaved-changes.ts`) | While dirty: admin tab switch, any in-app link/redirect (wouter `Router hook={useGuardedLocation}`), back/forward, reload and tab close all ask first; nothing is asked when clean. |

### Back/forward without a router blocker

wouter 3 has no navigation blocker, so the hook parks a **spare history entry** (same URL, state `puUnsavedSpare`)
on the first edit. One "back" pops the spare — the page does not move — and the `popstate` handler asks; declining
re-pushes the spare, accepting (or a form that is clean again) goes back once more for real. A confirmed in-app link
*replaces* the spare, so one back from the next page returns to the admin page exactly once. The guard is armed once
per mount (dirty → clean → dirty does not stack spares or queue a traversal that could land on a stale spare);
unmounting while still parked on the spare drops it.

## Proof

**API** — `artifacts/api-server/src/routes/buses.test.ts` (16/16): PUT creates (201) → identical replay 200, one node,
second audit line reads `draft (replayed, unchanged)`; publish → replay stays v1 with one `routeVersions` snapshot;
a real change publishes v2; body-id mismatch 400; `not-a-uuid` 400; POST with a vanished id 404; **write landed but
audit POST returned 500 → 502 `AUDIT_FAILED`, exact retry → 200, still v2, and an audit line exists**.

**Web** — `routes-tab.test.tsx` (8/8): failed save keeps every field and stop; retry sends the same UUID; `confirmLeave`
prompts only when dirty; `beforeunload` is prevented only when dirty; clean after a successful save; loaded route is
not dirty until edited; failed *plot road path* keeps the loaded draft. `use-unsaved-changes.test.tsx` (2/2): Link
click blocked when unsaved and declined, proceeds when accepted (replacing the spare), no prompt when clean; the
back/forward sequence with `pushState`/`back` spied.

**Real browser (Chromium 152, headless, throwaway CDP harness in `/tmp`, not committed)** — a demo page mounting the
same hook source behind wouter with `useGuardedLocation`:

| Scenario | Result |
|---|---|
| First edit pushes the spare (`history.length` +1, same URL) | pass |
| Back while dirty → `confirm` with the route-form message; decline → still `/admin`, input value intact | pass |
| Back again → accept → previous page | pass |
| Dirty, confirmed link to another page → back lands on `/admin` once, next back goes home; no prompts on those | pass |
| Untouched form → back leaves at once, no prompt | pass |
| Dirty then cleared → one back leaves, no prompt | pass |
| Dirty, full navigation → native `beforeunload` prompt; decline keeps the form | pass |
| Previous entry is another document: accept the back prompt → exactly one dialog (no second `beforeunload` prompt) | pass |

`PUT /api/routes/<uuid>` without a token → 401 on the running dev API.

## Known limits (accepted)

- A multi-entry history jump (long-press back → an older entry) lands elsewhere and is not asked; the spare protects
  the one-step back only. Pushing the spare discards any forward stack (inherent to the approach).
- If the admin page is the first entry of the tab, accepting the back prompt has nowhere to go; the form stays,
  and the guard re-arms on the next edit.
- No visible "unsaved" marker in the form (not asked for).
- Edits of existing routes go through `POST /routes/{id}`; an identical re-save there still publishes the next
  version (pre-existing behaviour, untouched).

## Owner check

Android phone, admin account: open a route, change a stop, press hardware back → the prompt appears; cancel keeps
the edits; back again + OK leaves.
