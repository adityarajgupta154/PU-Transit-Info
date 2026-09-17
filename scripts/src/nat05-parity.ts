// NAT-05 ownership / idempotency parity report for a PU Transit Driver evidence export.
//
//   pnpm --filter @workspace/scripts run nat05:parity -- <evidence.json>
//
// One export per scenario (Clear → run AC-xx → Export). The report prints the
// trip attempts the phone made, the invariants every scenario in
// docs/rehearsal-log-nat05.md relies on, and a timeline of the contract-relevant
// events so the result table can be filled without reading raw JSON. Run with
// TZ=Asia/Kolkata so times match the phone's clock.

import { loadEvents, type Event } from './nat01-coverage';

export type { Event };

export const FRESH_MS = 30_000;

type Req = Event & { op: string; ok: boolean; tripId?: string; sequence?: number; capturedAt?: number; code?: string; doneAt?: number; sentAt?: number; injected?: boolean; acknowledged?: boolean; outcome?: string };

export type Attempt = {
  tripId: string;
  startedAt: number;
  startOutcome: string;           // 'acknowledged' | 'injected timeout' | '409 OWNER_ACTIVE' | 'unconfirmed (TIMEOUT)' ...
  serverMayHold: boolean;         // acknowledged or unconfirmed (non-409 failure): the server may have created the trip
  closedBy: string | null;        // 'End acknowledged' | '409 SESSION_CONFLICT' | '409 OWNER_ACTIVE' ... | null (still open at the end of the log)
  closedAt: number | null;
  ackedSamples: number;
  ackedAfterClose: number;        // acknowledged samples for this trip after it was closed
  staleAcked: number;             // acknowledged samples older than FRESH_MS at receive time
  capturesAfterEndPressed: number;// acknowledged samples captured after the driver pressed End
  endAttempts: number;            // failed End requests before the acknowledgement (AC-16 retries)
};

export type Report = {
  device: Event | null;
  attempts: Attempt[];
  checks: { label: string; ok: boolean; detail: string }[];
  pass: boolean;
  timeline: string[];
};

const isReq = (e: Event): e is Req => e.kind === 'request' && typeof e.op === 'string';
// HTTP success alone does not end a trip: a pending server-side End answers 200/202 with
// acknowledged:false, and an export from a build that did not record the field must not pass.
const isEndAck = (r: Req): boolean => r.op === 'end' && r.ok && r.acknowledged === true;
// Closure = the client is definitely no longer the publisher of this trip: an
// acknowledged End, any 409 on Start (the client drops the session), or a
// SESSION_CONFLICT on a later upload. Other upload 409s (SEQUENCE_REPLAY, …) keep the session.
const isClosure = (r: Req): boolean =>
  isEndAck(r) || (!r.ok && r.status === 409 && (r.op === 'start' || r.code === 'SESSION_CONFLICT'));
const short = (id: unknown): string => (typeof id === 'string' ? id.slice(0, 8) : '—');
const receiveTime = (e: Req): number => (typeof e.serverReceivedAt === 'number' ? e.serverReceivedAt : e.doneAt ?? e.t);

function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString('en-GB', { hour12: false });
}
function fmtOffset(t: number, from: number): string {
  const s = Math.round((t - from) / 1000);
  return `${s < 0 ? '-' : '+'}${String(Math.floor(Math.abs(s) / 60)).padStart(2, '0')}:${String(Math.abs(s) % 60).padStart(2, '0')}`;
}

export function analyze(input: Event[]): Report {
  const events = [...input].sort((a, b) => a.t - b.t);
  const device = events.find(e => e.kind === 'device') ?? null;
  const requests = events.filter(isReq);
  const attempts: Attempt[] = [];

  for (const r of requests) {
    if (r.op === 'start' && r.tripId && !attempts.some(a => a.tripId === r.tripId)) {
      const rejected = !r.ok && r.status === 409;
      attempts.push({
        tripId: r.tripId,
        startedAt: r.sentAt ?? r.t,
        startOutcome: r.ok ? 'acknowledged' : r.injected ? 'injected timeout' : rejected ? `409 ${r.code}` : `unconfirmed (${r.code ?? 'failed'})`,
        serverMayHold: r.ok || !rejected,
        closedBy: null, closedAt: null, ackedSamples: 0, ackedAfterClose: 0, staleAcked: 0, capturesAfterEndPressed: 0, endAttempts: 0,
      });
    }
  }

  // end_pressed is matched by time (the attempt open when End was tapped): the
  // app stamps it with the feed's trip id, which is stale after an unconfirmed Start.
  const endPresses = events.filter(e => e.kind === 'lifecycle' && e.event === 'end_pressed');
  for (const [i, a] of attempts.entries()) {
    const mine = requests.filter(r => r.tripId === a.tripId);
    const nextStart = attempts[i + 1]?.startedAt ?? Infinity;
    const endPressed = endPresses.find(e => e.t >= a.startedAt && e.t < nextStart);
    for (const r of mine) {
      if (!a.closedBy && isClosure(r)) {
        a.closedBy = isEndAck(r) ? 'End acknowledged' : `409 ${r.code}`;
        a.closedAt = r.doneAt ?? r.t;
      }
      if (r.op === 'end' && !isEndAck(r) && !a.closedBy) a.endAttempts += 1;
      if (r.op === 'sample' && r.ok) {
        a.ackedSamples += 1;
        if (a.closedBy && (r.doneAt ?? r.t) > (a.closedAt ?? 0)) a.ackedAfterClose += 1;
        if (typeof r.capturedAt === 'number' && receiveTime(r) - r.capturedAt > FRESH_MS) a.staleAcked += 1;
        if (endPressed && typeof r.capturedAt === 'number' && r.capturedAt > endPressed.t) a.capturesAfterEndPressed += 1;
      }
    }
  }

  // A later Start attempt while an earlier one is still open on the server side would mean two publishers from one phone.
  const overlapping = attempts.filter((a, i) => {
    const next = attempts[i + 1];
    return Boolean(next) && a.serverMayHold && (!a.closedAt || a.closedAt > next.startedAt);
  });
  const unfinishedEnd = attempts.filter(a => a.endAttempts > 0 && !a.closedBy);
  const sum = (pick: (a: Attempt) => number) => attempts.reduce((n, a) => n + pick(a), 0);

  const checks = [
    { label: 'The export contains at least one Start attempt (otherwise the scenario was not run)', ok: attempts.length > 0, detail: `${attempts.length} attempt(s)` },
    { label: 'Every trip the server may hold is closed (End acknowledged or 409) before the next Start', ok: overlapping.length === 0, detail: overlapping.map(a => short(a.tripId)).join(', ') || 'ok' },
    { label: 'No acknowledged sample after the trip was ended or superseded', ok: sum(a => a.ackedAfterClose) === 0, detail: `${sum(a => a.ackedAfterClose)} found` },
    { label: `No acknowledged sample older than ${FRESH_MS / 1000} s at receive time (queued GPS never becomes live)`, ok: sum(a => a.staleAcked) === 0, detail: `${sum(a => a.staleAcked)} found` },
    { label: 'No acknowledged capture taken after End was pressed (collection stopped locally)', ok: sum(a => a.capturesAfterEndPressed) === 0, detail: `${sum(a => a.capturesAfterEndPressed)} found` },
    { label: 'Every End that failed offline was acknowledged later', ok: unfinishedEnd.length === 0, detail: unfinishedEnd.map(a => short(a.tripId)).join(', ') || 'ok' },
  ];

  const first = events[0]?.t ?? 0;
  const stamp = (t: number) => `${fmtTime(t)} ${fmtOffset(t, first)}`;
  let lastAckedSampleAt = -Infinity;
  const entries = events.flatMap((e): { t: number; text: string; repeat?: string }[] => {
    if (isReq(e)) {
      if (e.op === 'sample' && e.ok) {
        // Hundreds of these; show only the first one after a gap (the sample that made the bus live again).
        const gap = e.t - lastAckedSampleAt;
        lastAckedSampleAt = e.t;
        if (gap <= FRESH_MS) return [];
      }
      const age = typeof e.capturedAt === 'number' ? `, capture age ${Math.round((receiveTime(e) - e.capturedAt) / 1000)} s` : '';
      const note = e.op === 'sample' && e.ok ? ' (first acknowledged sample after a gap)' : '';
      const outcome = !e.ok ? `FAILED ${e.status ?? ''} ${e.code ?? ''}`.trim()
        : e.op === 'end' ? (e.acknowledged === true ? `ok, acknowledged${e.outcome ? ` (${e.outcome})` : ''}` : e.acknowledged === false ? 'ok but NOT acknowledged (server End still pending)' : 'ok but acknowledgement NOT recorded (old build?) — not counted as an End')
        : 'ok';
      const text = `request ${e.op} trip ${short(e.tripId)}${typeof e.sequence === 'number' ? ` #${e.sequence}` : ''} → ${outcome}${e.injected ? ' (injected)' : ''}${age}${note}`;
      // Consecutive identical failures (offline retries) collapse into one line.
      return [{ t: e.t, text, repeat: e.ok ? undefined : `${e.op}|${short(e.tripId)}|${outcome}` }];
    }
    if (e.kind === 'phase') return [{ t: e.t, text: `phase ${String(e.phase)}${e.error ? ` — ${String(e.error)}` : ''}` }];
    if (e.kind === 'lifecycle' || e.kind === 'task' || e.kind === 'app_state') {
      return [{ t: e.t, text: `${e.kind} ${String(e.event ?? e.state ?? '')}${e.reason ? ` — ${String(e.reason)}` : ''}${e.tripId ? ` trip ${short(e.tripId)}` : ''}` }];
    }
    return [];
  });
  const timeline: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    let j = i;
    while (entry.repeat && entries[j + 1]?.repeat === entry.repeat) j += 1;
    timeline.push(j > i
      ? `${stamp(entry.t)} ${entry.text.replace(/ #\d+/, '')} ×${j - i + 1} until ${fmtTime(entries[j].t)}`
      : `${stamp(entry.t)} ${entry.text}`);
    i = j;
  }

  return { device, attempts, checks, pass: checks.every(c => c.ok), timeline };
}

export function render(r: Report): string {
  const lines = ['# NAT-05 parity report'];
  if (r.device) lines.push(`Device: ${String(r.device.model ?? '?')}, ${String(r.device.platform ?? '?')} ${String(r.device.osVersion ?? '?')} — build ${String(r.device.executionEnvironment ?? '?')} v${String(r.device.appVersion ?? '?')}${r.device.executionEnvironment === 'storeClient' ? ' (Expo Go — NOT evidence)' : ''}`);
  lines.push('', '## Trip attempts', '');
  if (!r.attempts.length) lines.push('none — no /start request in this export');
  for (const a of r.attempts) {
    lines.push(`- ${fmtTime(a.startedAt)} trip ${short(a.tripId)}: Start ${a.startOutcome}; ${a.closedBy ? `closed by ${a.closedBy} at ${fmtTime(a.closedAt ?? 0)}` : 'still open at the end of the log'}; ${a.ackedSamples} acknowledged samples${a.endAttempts ? `; ${a.endAttempts} End retries before the acknowledgement` : ''}${a.ackedAfterClose ? `; ${a.ackedAfterClose} acknowledged AFTER close` : ''}${a.staleAcked ? `; ${a.staleAcked} stale acknowledged` : ''}${a.capturesAfterEndPressed ? `; ${a.capturesAfterEndPressed} captured after End pressed` : ''}`);
  }
  lines.push('', `## Invariants: ${r.pass ? 'PASS' : 'FAIL'}`, '');
  for (const c of r.checks) lines.push(`- [${c.ok ? 'x' : ' '}] ${c.label} — ${c.detail}`);
  lines.push('', '## Timeline (acknowledged samples shown only when they follow a gap > 30 s)', '', ...r.timeline);
  return lines.join('\n');
}

function main(argv: string[]): void {
  const file = argv.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('usage: nat05-parity <evidence.json>');
    process.exit(2);
  }
  console.log(render(analyze(loadEvents(file))));
}

if (process.argv[1] && /nat05-parity\.ts$/.test(process.argv[1])) main(process.argv.slice(2));
