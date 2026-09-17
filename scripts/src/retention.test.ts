/**
 * SEC-05 proof against the RTDB emulator: eligible records are gone after the run
 * (read back as null through the same REST identity), ineligible ones are intact,
 * the run is recorded, and a forced failure is recorded and surfaced.
 *
 *   pnpm --filter @workspace/scripts run retention:test
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AUDIT_BATCH, AUDIT_RETENTION_MS, emulatorDb, FEED_SILENCE_MS, JOB, residualLocationPaths, runRetention, type Db } from "./retention.js";

const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
if (!host) throw new Error("FIREBASE_DATABASE_EMULATOR_HOST is required; run through firebase emulators:exec so this can never touch production.");
const db = emulatorDb(host, process.env.GCLOUD_PROJECT ?? "demo-pu-transit");

const NOW = Date.UTC(2026, 8, 14, 21, 0, 0); // 15 Sep 2026 02:30 IST, the intended daily slot
const DAY = 24 * 60 * 60 * 1000;
const fix = { lat: 22.29, lng: 73.36, accuracy: 8 };
const feed = (phase: "active" | "ended", heartbeatAt: number, location: typeof fix | null) => ({
  driverUid: "driver-1",
  publisherId: "pub-1",
  sequence: 7,
  feed: { protocolVersion: 2, busId: "x", tripId: "t", generation: 1, phase, requestedAt: 1, startedAt: 1, endedAt: phase === "ended" ? heartbeatAt : 0, heartbeatAt, gpsQuality: "good", lastReportCapturedAt: 1, lastReportReceivedAt: 1, reportedAccuracy: 8, lastValidCapturedAt: 1, lastValidReceivedAt: 1, ...(location ? { location } : {}) },
});
const audit = (at: number) => ({ at, action: "membership.approve", actorUid: "admin-1", actorEmail: "admin@paruluniversity.ac.in", target: "u", summary: "s" });

test.before(async () => {
  // The audit query needs the repo Rules' `.indexOn: ["at"]`; the bare emulator namespace has no index.
  const rules = await readFile(new URL("../../firebase/database.rules.json", import.meta.url), "utf8");
  const response = await fetch(`http://${host}/.settings/rules.json?ns=${process.env.GCLOUD_PROJECT ?? "demo-pu-transit"}`, {
    method: "PUT", headers: { Authorization: "Bearer owner" }, body: rules,
  });
  assert.ok(response.ok, `loading Rules into the emulator failed: HTTP ${response.status}`);
});

test.beforeEach(async () => {
  await db.update({ tracking: null, audit: null, maintenance: null });
});

test("eligible feed locations and audit records are deleted, not marked; everything else stays", async () => {
  await db.update({
    "tracking/ENDED_LEGACY": feed("ended", NOW - 2 * DAY, fix), // ended before End nulled the fix
    "tracking/DEAD_ACTIVE": feed("active", NOW - 25 * 60 * 60 * 1000, fix), // driver app died mid-trip
    "tracking/JUST_SILENT": feed("active", NOW - FEED_SILENCE_MS - 1, fix), // silent one second past the threshold
    "tracking/LIVE": feed("active", NOW - 30_000, fix), // heartbeating now
    "tracking/RECENT_QUIET": feed("active", NOW - FEED_SILENCE_MS + 60_000, fix), // silent, but not long enough
    "tracking/ENDED_CLEAN": feed("ended", NOW - DAY, null), // already without a fix
    "audit/old-91d": audit(NOW - 91 * DAY),
    "audit/old-90d-boundary": audit(NOW - AUDIT_RETENTION_MS),
    "audit/keep-89d": audit(NOW - 89 * DAY),
    "audit/keep-today": audit(NOW - 60_000),
  });

  const run = await runRetention(db, NOW);

  assert.deepEqual(run.removed, { feedLocations: 3, auditRecords: 2 });
  assert.equal(run.outcome, "ok");
  for (const bus of ["ENDED_LEGACY", "DEAD_ACTIVE", "JUST_SILENT"]) {
    assert.equal(await db.read(`tracking/${bus}/feed/location`), null, `${bus} location must be gone`);
    assert.equal(await db.read(`tracking/${bus}/feed/heartbeatAt`), (await db.read<{ feed: { heartbeatAt: number } }>(`tracking/${bus}`))!.feed.heartbeatAt, `${bus} keeps its other fields`);
    assert.equal(await db.read(`tracking/${bus}/sequence`), 7);
  }
  assert.deepEqual(await db.read("tracking/LIVE/feed/location"), fix);
  assert.deepEqual(await db.read("tracking/RECENT_QUIET/feed/location"), fix);
  assert.equal(await db.read("audit/old-91d"), null);
  assert.equal(await db.read("audit/old-90d-boundary"), null);
  assert.deepEqual(Object.keys((await db.read<Record<string, unknown>>("audit"))!).sort(), ["keep-89d", "keep-today"]);

  const recorded = await db.read<Record<string, unknown>>(`maintenance/${JOB}`);
  assert.deepEqual(recorded, { lastRunAt: NOW, outcome: "ok", removed: { feedLocations: 3, auditRecords: 2 }, durationMs: run.durationMs });

  const again = await runRetention(db, NOW);
  assert.deepEqual(again.removed, { feedLocations: 0, auditRecords: 0 }, "second run finds nothing: deletion, not marking");
});

test("audit trimming pages through more than one batch and is not blocked by records without a numeric at", async () => {
  const seed: Record<string, unknown> = {};
  for (let i = 0; i < AUDIT_BATCH + 5; i++) seed[`audit/old-${String(i).padStart(4, "0")}`] = audit(NOW - 100 * DAY - i);
  for (let i = 0; i < AUDIT_BATCH + 1; i++) seed[`audit/bad-${String(i).padStart(4, "0")}`] = { action: "legacy", note: "no at field" };
  seed["audit/keep"] = audit(NOW - DAY);
  await db.update(seed);

  const run = await runRetention(db, NOW);

  assert.equal(run.removed.auditRecords, AUDIT_BATCH + 5);
  const left = Object.keys((await db.read<Record<string, unknown>>("audit"))!);
  assert.ok(left.includes("keep") && left.every((id) => id === "keep" || id.startsWith("bad-")), "old valid records gone, malformed ones untouched");
  assert.equal(left.length, AUDIT_BATCH + 2);
});

test("a forced failure is recorded as failed and surfaces to the caller", async () => {
  await db.update({ "tracking/ENDED_LEGACY": feed("ended", NOW - 2 * DAY, fix), "audit/old": audit(NOW - 100 * DAY) });
  const broken: Db = {
    read: (path, query) => db.read(path, query),
    update: (updates) => ("audit/old" in updates ? Promise.reject(new Error("simulated write outage")) : db.update(updates)),
  };

  await assert.rejects(runRetention(broken, NOW), /simulated write outage/);

  const recorded = await db.read<Record<string, unknown>>(`maintenance/${JOB}`);
  assert.equal(recorded?.outcome, "failed");
  assert.equal(recorded?.error, "simulated write outage");
  assert.deepEqual(recorded?.removed, { feedLocations: 1, auditRecords: 0 }, "partial progress is reported truthfully");
  assert.equal(await db.read("audit/old") === null, false, "the record the outage blocked is still there");
});

test("selection rule is exact at the boundaries", () => {
  const node = (phase: "active" | "ended", heartbeatAt: number, location: unknown) => ({ feed: { phase, heartbeatAt, location } });
  assert.deepEqual(
    residualLocationPaths({
      ended: node("ended", NOW, fix),
      silent: node("active", NOW - FEED_SILENCE_MS - 1, fix),
      atThreshold: node("active", NOW - FEED_SILENCE_MS, fix),
      noHeartbeat: node("active", 0, fix),
      noFix: node("ended", 0, null),
      empty: null,
    }, NOW),
    ["tracking/ended/feed/location", "tracking/silent/feed/location", "tracking/noHeartbeat/feed/location"],
  );
  assert.deepEqual(residualLocationPaths(null, NOW), []);
});
