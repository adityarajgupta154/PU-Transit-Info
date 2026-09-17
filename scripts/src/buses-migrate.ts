// FLT-01 migration: registers every bus the data refers to under its canonical
// key and rewrites route busNumber / driver assignedBusId to that key, through
// the API (so every change is validated and audited like an admin's edit).
//
//   PU_ADMIN_ID_TOKEN=<admin Firebase ID token> pnpm --dir scripts run buses:migrate -- --base https://<domain>            # report only
//   PU_ADMIN_ID_TOKEN=<admin Firebase ID token> pnpm --dir scripts run buses:migrate -- --base https://<domain> --apply    # after reading the report
//
// The token is the admin's own short-lived ID token (DevTools → Network → any
// /api call → Authorization header). Nothing is written without --apply, and
// --apply refuses while the report has blocking items. Re-running is idempotent.
import {
  createBus,
  listBuses,
  listMemberships,
  listRoutes,
  listTrackingFeeds,
  setAuthTokenGetter,
  setBaseUrl,
  updateMembership,
  updateRoute,
} from '@workspace/api-client-react';
import { planMigration, renderReport, type Snapshot } from './buses-migrate-plan';

const args = process.argv.slice(2);
const base = args[args.indexOf('--base') + 1] || 'http://127.0.0.1:8080';
const apply = args.includes('--apply');
const token = process.env.PU_ADMIN_ID_TOKEN;
if (!token) {
  console.error('PU_ADMIN_ID_TOKEN is not set (an admin Firebase ID token; never paste it into chat or commit it).');
  process.exit(2);
}
setBaseUrl(base);
setAuthTokenGetter(async () => token);

const status = (error: unknown): number => (error as { status?: number }).status ?? 0;

async function snapshot(): Promise<Snapshot> {
  const [routes, members, feeds] = await Promise.all([listRoutes(), listMemberships(), listTrackingFeeds()]);
  let buses: Snapshot['buses'] = null;
  try {
    buses = await listBuses();
  } catch (error) {
    if (status(error) !== 503) throw error; // 503 = Rules not published; anything else is a real failure
  }
  return { routes, members, feeds, buses };
}

const plan = planMigration(await snapshot());
console.log(renderReport(plan));
if (!apply) process.exit(0);

const blocking = plan.issues.filter((issue) => issue.level === 'block');
if (blocking.length) {
  console.error(`refusing --apply: ${blocking.length} blocking issue(s) above`);
  process.exit(1);
}
for (const entry of plan.registry.filter((entry) => !entry.existing)) {
  await createBus({ registration: entry.busId, label: entry.label });
  console.log(`registered ${entry.busId} "${entry.label}"`);
}
for (const { route, to } of plan.routeRewrites) {
  const { id, publishedVersion: _version, hasDraft: _draft, ...input } = route; // server-owned fields (RTE-02)
  await updateRoute(id, { ...input, busNumber: to });
  console.log(`route ${id}: "${route.busNumber}" -> ${to}`);
}
for (const rewrite of plan.memberRewrites) {
  await updateMembership(rewrite.uid, { assignedBusId: rewrite.to });
  console.log(`driver ${rewrite.email}: "${rewrite.from}" -> ${rewrite.to}`);
}
const after = planMigration(await snapshot());
const left = after.routeRewrites.length + after.memberRewrites.length + after.registry.filter((e) => !e.existing).length;
console.log(left === 0 ? 'done; a fresh report shows nothing left to change' : `done, but ${left} item(s) still pending; run the report again`);
process.exit(left === 0 ? 0 : 1);
