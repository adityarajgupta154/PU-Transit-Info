// NAT-01 coverage analysis for a PU Transit Driver evidence export.
//
//   pnpm --filter @workspace/scripts run nat01:coverage -- <evidence.json> [--outage HH:MM-HH:MM ...]
//
// The evidence file is what the driver app's "Export" button shares
// ({ schema: 'pu-transit-nat01-evidence/1', events: [...] }). The report answers
// the NAT-01 acceptance question: what share of whole trip minutes had at least
// one server-acknowledged GPS sample whose capture-to-receive age was <= 30 s,
// overall and on the "healthy segment" (trip minus the deliberate outage
// windows). Deliberate outages come from in-app markers
// (lifecycle marker_outage_start / marker_outage_end) or from --outage flags
// given as local wall-clock times on the trip's date (run with TZ=Asia/Kolkata
// if the machine is not in the phone's timezone).

import { readFileSync } from 'node:fs';

export const FRESH_MS = 30_000;
export const MINUTE_MS = 60_000;
export const PASS_THRESHOLD = 0.95;
export const MIN_TRIP_MS = 45 * MINUTE_MS;

export type Event = Record<string, unknown> & { t: number; kind: string };
export type Window = { start: number; end: number; source: string };

export type Outage = {
  start: number;
  end: number;
  durationMs: number;
  causes: string[];
};

export type Check = { name: string; ok: boolean; detail: string };

export type Report = {
  tripId: string | null;
  tripCount: number;
  checks: Check[];
  tripStart: number;
  tripEnd: number;
  durationMs: number;
  totalMinutes: number;
  coveredMinutes: number;
  healthyMinutes: number;
  healthyCovered: number;
  overall: number;
  healthy: number;
  pass: boolean;
  longEnough: boolean;
  samplesAcked: number;
  samplesValid: number;
  clockSkewSamples: number;
  freshnessP50: number | null;
  freshnessP95: number | null;
  outages: Outage[];
  declared: Window[];
  backgroundShare: number | null;
  tokenEvents: Event[];
  device: Event | null;
  expoGo: boolean;
};

const num = (e: Event, key: string): number | null =>
  typeof e[key] === 'number' && Number.isFinite(e[key]) ? (e[key] as number) : null;
const str = (e: Event, key: string): string | null => {
  const value = e[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
};

export type Trip = { tripId: string | null; tripStart: number; tripEnd: number; events: Event[] };

// The on-device log accumulates across launches, so it may hold several trips.
// Each acknowledged Start opens a trip that runs to its acknowledged End (or to
// the next Start / the end of the log). The longest one is analysed.
export function trips(events: Event[]): Trip[] {
  const starts = events.filter(e => e.kind === 'request' && e.op === 'start' && e.ok === true);
  if (!starts.length) throw new Error('No acknowledged start request in the evidence; there is no trip to measure.');
  return starts.map((start, i) => {
    const tripId = str(start, 'tripId');
    const limit = i + 1 < starts.length ? starts[i + 1]!.t : Number.POSITIVE_INFINITY;
    const tripStart = num(start, 'doneAt') ?? start.t;
    const slice = events.filter(e => e.t >= start.t && e.t < limit);
    const end = [...slice].reverse().find(e => e.kind === 'request' && e.op === 'end' && e.ok === true && (!tripId || !str(e, 'tripId') || str(e, 'tripId') === tripId));
    const tripEnd = end ? (num(end, 'doneAt') ?? end.t) : slice[slice.length - 1]!.t;
    return { tripId, tripStart, tripEnd, events: slice.filter(e => e.t <= tripEnd || e.kind !== 'request') };
  }).filter(t => t.tripEnd > t.tripStart);
}

export function longestTrip(events: Event[]): { trip: Trip; count: number } {
  const all = trips(events);
  if (!all.length) throw new Error('Every trip in the evidence ends before it starts; evidence is inconsistent.');
  const trip = all.reduce((best, t) => (t.tripEnd - t.tripStart > best.tripEnd - best.tripStart ? t : best));
  return { trip, count: all.length };
}

export function markerWindows(events: Event[]): Window[] {
  const windows: Window[] = [];
  let open: number | null = null;
  for (const e of events) {
    if (e.kind !== 'lifecycle') continue;
    if (e.event === 'marker_outage_start') open = e.t;
    if (e.event === 'marker_outage_end' && open !== null) {
      windows.push({ start: open, end: e.t, source: 'marker' });
      open = null;
    }
  }
  if (open !== null) windows.push({ start: open, end: Number.POSITIVE_INFINITY, source: 'marker (never closed)' });
  return windows;
}

// "HH:MM-HH:MM" local wall-clock on the trip's date -> absolute window.
export function parseClockWindow(flag: string, tripStart: number): Window {
  const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(flag.trim());
  if (!match) throw new Error(`--outage expects HH:MM-HH:MM (24h local time), got "${flag}"`);
  const at = (h: string, m: string) => {
    const d = new Date(tripStart);
    d.setHours(Number(h), Number(m), 0, 0);
    return d.getTime();
  };
  const start = at(match[1]!, match[2]!);
  let end = at(match[3]!, match[4]!);
  if (end < start) end += 24 * 60 * MINUTE_MS; // crosses midnight
  return { start, end, source: `--outage ${flag}` };
}

const intersects = (aStart: number, aEnd: number, w: Window) => aStart < w.end && aEnd > w.start;

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

export function analyze(events: Event[], declaredExtra: Window[] = []): Report {
  const all = [...events].sort((a, b) => a.t - b.t);
  const { trip, count: tripCount } = longestTrip(all);
  const { tripStart, tripEnd } = trip;
  // Device/app-state context from before Start still matters; requests only from this trip.
  const sorted = all.filter(e => e.kind !== 'request' || trip.events.includes(e));
  const durationMs = tripEnd - tripStart;
  const totalMinutes = Math.floor(durationMs / MINUTE_MS);
  const declared = [...markerWindows(sorted), ...declaredExtra];

  const acked = sorted.filter(e => e.kind === 'request' && e.op === 'sample' && e.ok === true);
  const valid: number[] = []; // capturedAt of every valid sample
  const freshness: number[] = [];
  let clockSkewSamples = 0;
  for (const e of acked) {
    const capturedAt = num(e, 'capturedAt');
    const receivedAt = num(e, 'serverReceivedAt') ?? num(e, 'doneAt') ?? e.t;
    if (capturedAt === null) continue;
    const age = receivedAt - capturedAt;
    if (age < 0) clockSkewSamples += 1; // device/server clock skew; still a live sample
    if (age <= FRESH_MS) {
      valid.push(capturedAt);
      freshness.push(Math.max(0, age));
    }
  }
  freshness.sort((a, b) => a - b);

  const covered = new Array<boolean>(totalMinutes).fill(false);
  for (const capturedAt of valid) {
    const i = Math.floor((capturedAt - tripStart) / MINUTE_MS);
    if (i >= 0 && i < totalMinutes) covered[i] = true;
  }
  let coveredMinutes = 0;
  let healthyMinutes = 0;
  let healthyCovered = 0;
  for (let i = 0; i < totalMinutes; i += 1) {
    const mStart = tripStart + i * MINUTE_MS;
    const mEnd = mStart + MINUTE_MS;
    if (covered[i]) coveredMinutes += 1;
    if (declared.some(w => intersects(mStart, mEnd, w))) continue;
    healthyMinutes += 1;
    if (covered[i]) healthyCovered += 1;
  }

  // Gaps > 30 s between consecutive valid captures (plus trip edges) are outages.
  const points = [tripStart, ...valid.sort((a, b) => a - b), tripEnd];
  const outages: Outage[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const start = points[i - 1]!;
    const end = points[i]!;
    if (end - start <= FRESH_MS) continue;
    outages.push({ start, end, durationMs: end - start, causes: causesBetween(sorted, start, end) });
  }

  const tokenEvents = sorted.filter(e => e.kind === 'token' && e.t >= tripStart && e.t <= tripEnd);
  const device = [...all].reverse().find(e => e.kind === 'device' && e.t <= tripEnd) ?? null;
  const overall = totalMinutes ? coveredMinutes / totalMinutes : 0;
  const healthy = healthyMinutes ? healthyCovered / healthyMinutes : 0;
  const longEnough = durationMs >= MIN_TRIP_MS;
  const expoGo = device ? str(device, 'executionEnvironment') === 'storeClient' : false;
  const lastValid = valid.length ? valid[valid.length - 1]! : null;
  const forcedRefresh = tokenEvents.find(e => e.event === 'forced_refresh' && e.ok === true);
  const declaredInTrip = declared.filter(w => w.start >= tripStart && w.end <= tripEnd);
  const conflicts = sorted.filter(e => e.kind === 'request' && e.ok === false && str(e, 'code') === 'SESSION_CONFLICT').length;
  const checks: Check[] = [
    { name: `Build is a development/production build (not Expo Go)`, ok: device !== null && !expoGo, detail: device ? (str(device, 'executionEnvironment') ?? '?') : 'no device event recorded' },
    { name: `Trip lasted >= ${MIN_TRIP_MS / MINUTE_MS} min`, ok: longEnough, detail: `${(durationMs / MINUTE_MS).toFixed(1)} min` },
    { name: `Healthy segment >= ${pct(PASS_THRESHOLD)} of whole minutes covered`, ok: healthyMinutes > 0 && healthy >= PASS_THRESHOLD, detail: `${healthyCovered}/${healthyMinutes}` },
    { name: 'Forced token refresh succeeded and samples continued after it', ok: !!forcedRefresh && lastValid !== null && lastValid > forcedRefresh.t, detail: forcedRefresh ? fmtOffset(forcedRefresh.t, tripStart) : 'no successful forced_refresh in the trip' },
    { name: 'One deliberate outage declared inside the trip, with valid samples after it', ok: declaredInTrip.length > 0 && lastValid !== null && declaredInTrip.every(w => lastValid > w.end), detail: declaredInTrip.length ? `${declaredInTrip.length} window(s)` : 'none declared (markers or --outage)' },
    { name: 'No SESSION_CONFLICT (recovery kept the same trip)', ok: conflicts === 0, detail: conflicts ? `${conflicts} conflict response(s)` : 'none' },
  ];

  return {
    tripId: trip.tripId,
    tripCount,
    tripStart,
    tripEnd,
    durationMs,
    totalMinutes,
    coveredMinutes,
    healthyMinutes,
    healthyCovered,
    overall,
    healthy,
    pass: checks.every(c => c.ok),
    checks,
    longEnough,
    samplesAcked: acked.length,
    samplesValid: valid.length,
    clockSkewSamples,
    freshnessP50: percentile(freshness, 0.5),
    freshnessP95: percentile(freshness, 0.95),
    outages,
    declared,
    backgroundShare: backgroundShare(sorted, tripStart, tripEnd),
    tokenEvents,
    device,
    expoGo,
  };
}

function causesBetween(events: Event[], start: number, end: number): string[] {
  const pad = 5_000;
  const inWindow = events.filter(e => e.t >= start - pad && e.t <= end + pad);
  const codes = new Map<string, number>();
  for (const e of inWindow) {
    if (e.kind === 'request' && e.ok === false) {
      const code = str(e, 'code') ?? (num(e, 'status') !== null ? `HTTP ${num(e, 'status')}` : 'unknown');
      codes.set(code, (codes.get(code) ?? 0) + 1);
    }
  }
  const causes: string[] = [];
  for (const [code, count] of codes) causes.push(`${count}x ${code}`);
  const fixes = inWindow.filter(e => e.kind === 'location').length;
  if (fixes === 0) causes.push('no GPS fixes delivered by the OS');
  const states = new Set(inWindow.filter(e => e.kind === 'app_state').map(e => str(e, 'state')));
  if (states.size) causes.push(`app state -> ${[...states].join(', ')}`);
  const tasks = inWindow.filter(e => e.kind === 'task');
  for (const t of tasks) causes.push(`task ${str(t, 'event')}${str(t, 'message') ? `: ${str(t, 'message')}` : ''}`);
  const tokens = inWindow.filter(e => e.kind === 'token');
  for (const t of tokens) causes.push(`token ${str(t, 'event')} ${t.ok === false ? 'FAILED' : 'ok'}`);
  const phases = inWindow.filter(e => e.kind === 'phase').map(e => str(e, 'phase')).filter(Boolean);
  if (phases.length) causes.push(`phases -> ${phases.join(' > ')}`);
  return causes.length ? causes : ['no error recorded (silent gap)'];
}

// Share of trip time the app reported itself in the background/inactive state.
function backgroundShare(events: Event[], tripStart: number, tripEnd: number): number | null {
  const changes = events.filter(e => e.kind === 'app_state');
  if (!changes.length) return null;
  let state: string | null = null;
  for (const e of changes) if (e.t <= tripStart) state = str(e, 'state');
  let cursor = tripStart;
  let background = 0;
  for (const e of changes) {
    if (e.t <= tripStart || e.t > tripEnd) continue;
    if (state && state !== 'active') background += e.t - cursor;
    cursor = e.t;
    state = str(e, 'state');
  }
  if (state && state !== 'active') background += tripEnd - cursor;
  return background / (tripEnd - tripStart);
}

const fmtTime = (ms: number) =>
  Number.isFinite(ms)
    ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(ms)
    : 'open';
const fmtOffset = (ms: number, base: number) => {
  if (!Number.isFinite(ms)) return 'open';
  const s = Math.max(0, Math.round((ms - base) / 1000));
  return `+${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

export function render(r: Report): string {
  const lines: string[] = [];
  lines.push('# NAT-01 coverage report (single-device feasibility proof)');
  lines.push('');
  if (r.device) {
    lines.push(
      `Device: ${str(r.device, 'platform') ?? '?'} ${str(r.device, 'osVersion') ?? ''} ${str(r.device, 'model') ?? ''}`.trim() +
        ` | build: ${str(r.device, 'executionEnvironment') ?? '?'} v${str(r.device, 'appVersion') ?? '?'}` +
        ` | background permission: ${str(r.device, 'backgroundPermission') ?? '?'}`,
    );
  } else {
    lines.push('Device: no device event in the export (older app build?)');
  }
  if (r.expoGo) lines.push('WARNING: executionEnvironment is storeClient (Expo Go). This run is NOT valid NAT-01 evidence.');
  lines.push(`Trip${r.tripId ? ` ${r.tripId}` : ''}: ${fmtTime(r.tripStart)} -> ${fmtTime(r.tripEnd)} local, ${(r.durationMs / MINUTE_MS).toFixed(1)} min` +
    (r.tripCount > 1 ? ` (longest of ${r.tripCount} trips in this export)` : ''));
  lines.push(`Samples acknowledged by the server: ${r.samplesAcked}; valid (<= ${FRESH_MS / 1000} s capture-to-receive): ${r.samplesValid}` +
    (r.clockSkewSamples ? `; ${r.clockSkewSamples} with server time before device capture time (clock skew)` : ''));
  if (r.freshnessP50 !== null) lines.push(`Capture-to-receive age: p50 ${(r.freshnessP50 / 1000).toFixed(1)} s, p95 ${((r.freshnessP95 ?? 0) / 1000).toFixed(1)} s`);
  if (r.backgroundShare !== null) lines.push(`Time the app reported itself backgrounded/inactive: ${pct(r.backgroundShare)}`);
  lines.push('');
  lines.push(`Overall: ${r.coveredMinutes}/${r.totalMinutes} whole minutes covered = ${pct(r.overall)}`);
  lines.push(`Declared outage windows (${r.declared.length}):` + (r.declared.length ? '' : ' none'));
  for (const w of r.declared) lines.push(`  - ${fmtTime(w.start)} -> ${fmtTime(w.end)} (${fmtOffset(w.start, r.tripStart)} -> ${fmtOffset(w.end, r.tripStart)}) [${w.source}]`);
  lines.push(`Healthy segment: ${r.healthyCovered}/${r.healthyMinutes} minutes covered = ${pct(r.healthy)}`);
  lines.push('');
  lines.push(`NAT-01 gate: ${r.pass ? 'PASS' : 'FAIL'}`);
  for (const c of r.checks) lines.push(`  [${c.ok ? 'x' : ' '}] ${c.name} — ${c.detail}`);
  lines.push('');
  lines.push(`Gaps > ${FRESH_MS / 1000} s between valid samples (${r.outages.length}):`);
  if (!r.outages.length) lines.push('  none');
  for (const o of r.outages) {
    lines.push(`  - ${fmtTime(o.start)} -> ${fmtTime(o.end)} (${fmtOffset(o.start, r.tripStart)} -> ${fmtOffset(o.end, r.tripStart)}), ${(o.durationMs / 1000).toFixed(0)} s`);
    for (const c of o.causes) lines.push(`      ${c}`);
  }
  lines.push('');
  lines.push(`Token events (${r.tokenEvents.length}):`);
  if (!r.tokenEvents.length) lines.push('  none recorded');
  for (const e of r.tokenEvents) {
    const exp = num(e, 'expiresAt');
    lines.push(`  - ${fmtTime(e.t)} (${fmtOffset(e.t, r.tripStart)}) ${str(e, 'event')} ${e.ok === false ? 'FAILED ' + (str(e, 'error') ?? '') : 'ok'}` +
      (exp ? `, new expiry ${fmtTime(exp)}` : '') + (num(e, 'latencyMs') !== null ? `, ${num(e, 'latencyMs')} ms` : ''));
  }
  return lines.join('\n');
}

export function loadEvents(path: string): Event[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { schema?: unknown; events?: unknown };
  if (raw.schema !== 'pu-transit-nat01-evidence/1' || !Array.isArray(raw.events)) {
    throw new Error(`${path} is not a pu-transit-nat01-evidence/1 export`);
  }
  return raw.events.filter((e): e is Event => typeof e === 'object' && e !== null && typeof (e as Event).t === 'number' && typeof (e as Event).kind === 'string');
}

function main(argv: string[]): void {
  const file = argv.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('usage: nat01-coverage <evidence.json> [--outage HH:MM-HH:MM ...]');
    process.exit(2);
  }
  const events = loadEvents(file);
  const { tripStart } = longestTrip([...events].sort((a, b) => a.t - b.t)).trip;
  const extra: Window[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--outage') extra.push(parseClockWindow(argv[i + 1] ?? '', tripStart));
  }
  console.log(render(analyze(events, extra)));
}

if (process.argv[1] && /nat01-coverage\.ts$/.test(process.argv[1])) main(process.argv.slice(2));
