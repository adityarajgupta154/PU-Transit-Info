# W0-05 — production auth check on the published app (AC-28)

Date: 13 September 2026  
Status: **NOT RUN.** The project has no deployment (`isDeployed: false`, no production URL), so nothing has been verified on a real domain yet. Nothing below claims a production result.

## What was checked before publishing (13 Sep, workspace only)

| Check | Result |
|---|---|
| Deployment status via the deployments service | Not published; no production URL exists |
| Production env for the API (`FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL`, `UNIVERSITY_EMAIL_DOMAINS`) | Present in the **shared** environment, so production inherits them |
| API production build (`NODE_ENV=production`) and the exact production run command from `artifact.toml` on a spare port | Boots; `/api/healthz` → 200 |
| Anonymous `GET /api/auth/me` and anonymous `PATCH /api/memberships/:uid` against that production build | 401 `AUTH_REQUIRED` |
| `PATCH /api/memberships/:uid` with a garbage bearer token | 401 `AUTH_INVALID` |
| Token verification path | Firebase Admin `verifyIdToken` with project ID only (public certificates); no service-account material is required at runtime |
| Web production build | Static SPA, assets served from `/`, `/*` → `/index.html` rewrite; API is a separate service on `/api` |
| Sign-in method | Email/password (`signInWithEmailAndPassword`); verification email without a continue URL, so no Firebase authorized-domain entry is needed for the new domain |

These are workspace checks on production-mode builds. They are **not** the AC-28 evidence.

## Known confounders to settle before the run

1. **Firebase Rules publication.** The 13 Sep access-model Rules payload is still unpublished per `docs/evidence/2026-09-13-access-model.md`. If the live Rules are the older version, the membership approval write may be denied. Publish the Rules first, otherwise a failure in step 4 below cannot be attributed to the proxy/origin setup.
2. **`ORS_API_KEY` is not set.** Route plotting in production will return an explicit 503 until the rotated key is saved. This does not affect the AC-28 steps.

## Protocol (run only after the app is published)

Automated by the agent against the production URL, no credentials needed:

- `GET /` returns the SPA; a deep link such as `/admin` also returns the SPA.
- `GET /api/healthz` → 200.
- `GET /api/auth/me` without a token → 401 `AUTH_REQUIRED`; with a garbage token → 401 `AUTH_INVALID`.
- The served JS bundle contains no ORS key and no direct ORS URL.

Performed by the owner with a real root-admin account (the agent never receives the password), with DevTools → Network open and “Preserve log” on:

1. **Sign-in.** Open the production URL, sign in. Expected: `identitytoolkit.googleapis.com …signInWithPassword` → 200, then `GET /api/auth/me` → 200 and the admin tiles appear.
2. **Session persistence.** Hard-refresh the page. Expected: still signed in, `/api/auth/me` → 200 without a new sign-in.
3. **Forced token refresh.** Use the account refresh action (it calls `getIdToken(true)`). Expected: `securetoken.googleapis.com/v1/token` → 200, followed by `/api/auth/me` → 200 sent with the *new* token.
4. **Authorized mutation.** Admin → Users: approve one pending membership. Expected: `PATCH /api/memberships/<uid>` → 200, the row shows *approved*, and the System tab shows a `membership.update` audit entry. If this returns 403 with a Rules-denied code, see confounder 1.
5. **Natural expiry refresh.** Leave the tab open for more than 60 minutes, then reload the Users list or repeat a harmless action. Expected: a new `securetoken.googleapis.com/v1/token` → 200 and the API call → 200 with no re-login.

Report for each step: HTTP status seen in Network, the visible UI result, and the time. The agent records the exact outcomes here; nothing is marked passed without them.

## Results

Not yet available.
