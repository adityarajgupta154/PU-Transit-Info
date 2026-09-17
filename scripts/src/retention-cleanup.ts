/**
 * Runs the SEC-05 retention job once. Schedule it daily (see docs/ops-notes.md,
 * "Retention").  Identity: the service account from FIREBASE_SERVICE_ACCOUNT_JSON
 * (job-only; the API never holds it), or the emulator owner when
 * FIREBASE_DATABASE_EMULATOR_HOST is set (rehearsal, never production).
 * Exit code 1 on any failure, after recording the failed run when possible.
 *
 *   pnpm --filter @workspace/scripts run retention:cleanup
 */
import { deleteApp } from "firebase-admin/app";
import { createFirebaseClient, reportSetupError, requireProject, SetupError } from "./firebase-admin-client.js";
import { emulatorDb, JOB, restDb, runRetention, type Db } from "./retention.js";

async function main() {
  const emulator = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  let db: Db;
  let close = async () => {};
  if (emulator) {
    db = emulatorDb(emulator, process.env.GCLOUD_PROJECT ?? "demo-pu-transit");
    console.log(`${JOB}: emulator run against ${emulator}`);
  } else {
    // A destructive job only ever targets this project's own database root.
    const projectId = requireProject(process.env.FIREBASE_PROJECT_ID);
    const target = URL.parse(process.env.FIREBASE_DATABASE_URL ?? "") ?? new URL("https://invalid");
    const ownDatabase = target.hostname.startsWith(`${projectId}-default-rtdb.`) || target.hostname === `${projectId}.firebaseio.com`;
    if (target.protocol !== "https:" || target.pathname !== "/" || target.search || target.hash || !ownDatabase) {
      throw new SetupError("FIREBASE_DATABASE_URL must be the root URL of this project's Realtime Database.");
    }
    const base = target.origin;
    const client = createFirebaseClient();
    close = () => deleteApp(client.app);
    db = restDb(base, (url, init) => client.request(url, "Retention job", init));
  }
  try {
    const run = await runRetention(db);
    console.log(`${JOB}: ${run.outcome}; removed ${run.removed.feedLocations} feed location(s) and ${run.removed.auditRecords} audit record(s) in ${run.durationMs} ms`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(`${JOB}: failed`);
  reportSetupError(error);
});
