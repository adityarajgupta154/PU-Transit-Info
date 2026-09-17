/**
 * SEC-05 retention job. RTDB has no TTL, so a daily job removes what the product
 * no longer needs and records the run under maintenance/retention. It runs with a
 * job-only identity (the service account, or the emulator owner) — never with the
 * request-path user tokens — which is why the writes bypass Rules and the node
 * carries `.write: false` for every client.
 *
 * Transport-free: `Db` is two REST verbs so the same code is proven against the
 * emulator (retention.test.ts) and run against production (retention-cleanup.ts).
 */
export const JOB = "retention";
export const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** An active feed silent this long is over (public status is already "offline"); its stored fix is residual. */
export const FEED_SILENCE_MS = 60 * 60 * 1000;
export const AUDIT_BATCH = 500;

export type Db = {
  /** GET `path.json` with an optional REST query (values JSON-encoded by the adapter); null when absent. */
  read<T>(path: string, query?: Record<string, string | number>): Promise<T | null>;
  /** Multi-path PATCH at the root, atomic per call; a null value deletes that path. */
  update(updates: Record<string, unknown>): Promise<void>;
};

export type RunRecord = {
  lastRunAt: number;
  outcome: "ok" | "failed";
  removed: { feedLocations: number; auditRecords: number };
  durationMs: number;
  error?: string;
};

type Feed = { phase?: unknown; heartbeatAt?: unknown; location?: unknown };
type TrackingNodes = Record<string, { feed?: Feed } | null>;

/** Feeds whose stored location must go: ended, or active but silent past FEED_SILENCE_MS. */
export function residualLocationPaths(tracking: TrackingNodes | null, now: number): string[] {
  const paths: string[] = [];
  for (const [busId, node] of Object.entries(tracking ?? {})) {
    const feed = node?.feed;
    if (!feed || feed.location === null || feed.location === undefined) continue;
    const heartbeatAt = typeof feed.heartbeatAt === "number" ? feed.heartbeatAt : 0;
    if (feed.phase === "ended" || now - heartbeatAt > FEED_SILENCE_MS) paths.push(`tracking/${busId}/feed/location`);
  }
  return paths;
}

export async function runRetention(db: Db, now = Date.now()): Promise<RunRecord> {
  const started = Date.now();
  const removed = { feedLocations: 0, auditRecords: 0 };
  const record = async (outcome: RunRecord["outcome"], error?: string): Promise<RunRecord> => {
    const run: RunRecord = { lastRunAt: now, outcome, removed, durationMs: Date.now() - started, ...(error ? { error } : {}) };
    await db.update({ [`maintenance/${JOB}`]: run });
    return run;
  };
  try {
    const paths = residualLocationPaths(await db.read<TrackingNodes>("tracking"), now);
    if (paths.length > 0) {
      // Snapshot then delete, no compare-and-set: a Start or sample landing in the
      // milliseconds between the two loses one fix, which the next sample restores.
      // The job runs at 02:30 IST, outside service hours, so the window is idle.
      await db.update(Object.fromEntries(paths.map((path) => [path, null])));
      removed.feedLocations = paths.length;
    }
    const cutoff = now - AUDIT_RETENTION_MS;
    for (;;) {
      // Oldest first; needs the existing `.indexOn: ["at"]` under audit. startAt 1 skips
      // records without a numeric `at` (they sort first and would otherwise fill every page).
      const batch = (await db.read<Record<string, { at?: unknown } | null>>("audit", { orderBy: "at", startAt: 1, endAt: cutoff, limitToFirst: AUDIT_BATCH })) ?? {};
      const ids = Object.keys(batch).filter((id) => typeof batch[id]?.at === "number" && (batch[id]!.at as number) <= cutoff);
      if (ids.length === 0) break;
      await db.update(Object.fromEntries(ids.map((id) => [`audit/${id}`, null])));
      removed.auditRecords += ids.length;
      if (Object.keys(batch).length < AUDIT_BATCH) break;
    }
    return await record("ok");
  } catch (error) {
    // Best effort: the failed record is the alertable trace; the caller's exit code is the other one.
    await record("failed", error instanceof Error ? error.message : String(error)).catch(() => undefined);
    throw error;
  }
}

/** REST adapter over any `fetchJson` (production: the service-account client; emulator: plain fetch as owner). */
export function restDb(
  base: string,
  fetchJson: (url: string, init?: RequestInit) => Promise<unknown>,
  fixedQuery: Record<string, string> = {},
): Db {
  const url = (path: string, query: Record<string, string | number> = {}) => {
    const params = new URLSearchParams(fixedQuery);
    for (const [key, value] of Object.entries(query)) params.set(key, JSON.stringify(value));
    const search = params.toString();
    return `${base}/${path}.json${search ? `?${search}` : ""}`;
  };
  return {
    read: <T>(path: string, query?: Record<string, string | number>) => fetchJson(url(path, query)) as Promise<T | null>,
    update: async (updates) => {
      await fetchJson(url(""), { method: "PATCH", body: JSON.stringify(updates) });
    },
  };
}

/** The emulator's REST owner identity (Rules bypassed, like the service account in production). Never a production URL. */
export function emulatorDb(host: string, namespace: string): Db {
  return restDb(`http://${host}`, async (url, init) => {
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", Authorization: "Bearer owner" } });
    if (!response.ok) throw new Error(`emulator ${init?.method ?? "GET"} failed: HTTP ${response.status}`);
    return response.json();
  }, { ns: namespace });
}
