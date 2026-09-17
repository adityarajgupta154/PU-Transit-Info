# DOC-04 — README delivered state and local setup

Date: **14 September 2026**  
Scope: documentation, not a new app release. [README opening](../Delivery-Status.md) now
describes the delivered web/API and unvalidated native feasibility source; historical
counts are labelled. [README §8](../Delivery-Status.md#8-running-the-project) provides the
local grading path.

## Checks performed

Environment: existing workspace dependencies, Node **24.13.0**, pnpm **10.26.1**,
Chromium **152**; Java **21.0.7** available for the separately recorded Rules tests.

| Check | Actual result |
|---|---|
| Shared packages: `pnpm run typecheck:libs` | **PASS** |
| Scoped API and web `run typecheck` commands | **PASS** |
| API: `pnpm --filter @workspace/api-server run build` | **PASS** |
| Web production build using the README's temporary local Vite config (`PORT=5173 BASE_PATH=/ NODE_ENV=production`, output isolated under `/tmp/doc04/web`) | **PASS**; existing large-chunk warning remains, not a build error |
| API and Vite started locally with only PATH/HOME and the documented non-secret configuration | **PASS** on ports 5000 / 5173; no inherited application secrets |
| `GET http://localhost:5173/api/healthz` through the Vite proxy | **200**, `{"status":"ok"}` |
| `GET http://localhost:5173/api/routes` through the same proxy, no token | **401**, `{"error":"Authentication required","code":"AUTH_REQUIRED"}` |
| Chromium opens `/`, `/about`, `/account` | **PASS**: public shells render; no browser page errors. No sign-in was attempted. |

Temporary local API/web test processes were stopped. The local config used for this
check is the same snippet in README §8.3; graders create it themselves. The shared
workflow configuration and application source were not changed for DOC-04.

## Setup constraints verified from code

- Vite requires both `PORT` and `BASE_PATH`; its normal config lacks a local `/api`
  proxy. The documented `mergeConfig` wrapper supplies dev and preview routing to
  the API without changing the managed-workspace config.
- Although PostgreSQL is queried only for legacy import, `transit.ts` imports
  `@workspace/db` eagerly. That module throws if `DATABASE_URL` is absent.
  A credential-free loopback placeholder allowed the smoke run to start without
  a PostgreSQL server/query. The README warns not to use it for imports.
- Browser Firebase configuration and API project/URL validation are pinned to the
  existing project. The running app is **not** an offline emulator demo; authenticated
  mutations can affect real shared Firebase data.
- ORS, service-account and session secrets were not needed by these public/401
  checks. This does not claim that admin geocoding or maintenance works without its
  separate credentials.
- [DOC-03's 97/97 API and 26/26 Rules results](2026-09-14-doc03-test-results.md) remain
  the test evidence; those suites were not rerun merely for README changes.

## Explicitly not verified

- A fresh-machine dependency install (the lockfile/install commands were inspected;
  the checks used the existing installed dependencies).
- Firebase sign-in/token refresh, local-domain authorization, live memberships,
  database contents or publication of the current Rules.
- A legacy PostgreSQL import, a live ORS call, a maintenance job or any cloud mutation.
- Native build/device behavior, W0-03/NAT-01 rehearsal, production publication or rollout.

The README documents these prerequisites rather than treating a public-page smoke
check as a complete authenticated grading run.