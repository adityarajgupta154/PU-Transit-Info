import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, type Event } from './nat05-parity';

const t0 = Date.parse('2026-09-20T09:00:00+05:30');
const at = (s: number) => t0 + s * 1000;
const req = (s: number, op: string, tripId: string, extra: Record<string, unknown> = {}): Event =>
  ({ t: at(s), kind: 'request', op, tripId, sentAt: at(s), doneAt: at(s) + 300, ok: true, status: 200,
    ...(op === 'end' ? { acknowledged: true, outcome: 'ended' } : {}), ...extra });
const sample = (s: number, tripId: string, sequence: number, captureAgeS = 2, extra: Record<string, unknown> = {}) =>
  req(s, 'sample', tripId, { sequence, capturedAt: at(s) - captureAgeS * 1000, serverReceivedAt: at(s) + 200, ...extra });

test('AC-08: injected Start timeout, End of the ghost trip, fresh Start — passes', () => {
  const r = analyze([
    req(0, 'start', 'A', { ok: false, status: 0, code: 'TIMEOUT', injected: true }),
    { t: at(20), kind: 'lifecycle', event: 'end_pressed', tripId: 'A' },
    req(21, 'end', 'A'),
    req(40, 'start', 'B'),
    sample(45, 'B', 1), sample(50, 'B', 2),
    { t: at(60), kind: 'lifecycle', event: 'end_pressed', tripId: 'B' },
    req(61, 'end', 'B'),
  ]);
  assert.equal(r.pass, true, JSON.stringify(r.checks));
  assert.equal(r.attempts[0].startOutcome, 'injected timeout');
  assert.equal(r.attempts[0].closedBy, 'End acknowledged');
});

test('a second Start while the ghost trip is still open fails the single-publisher check', () => {
  const r = analyze([
    req(0, 'start', 'A', { ok: false, status: 0, code: 'TIMEOUT', injected: true }),
    req(10, 'start', 'B'),
  ]);
  assert.equal(r.checks[1].ok, false);
});

test('AC-09 loser: 409 OWNER_ACTIVE closes the attempt without a sample', () => {
  const r = analyze([req(0, 'start', 'L', { ok: false, status: 409, code: 'OWNER_ACTIVE' })]);
  assert.equal(r.pass, true);
  assert.equal(r.attempts[0].closedBy, '409 OWNER_ACTIVE');
});

test('AC-12: a replayed old capture acknowledged after reconnect fails the freshness check', () => {
  const r = analyze([req(0, 'start', 'A'), sample(5, 'A', 1), sample(200, 'A', 2, 150)]);
  assert.equal(r.checks[3].ok, false);
  assert.equal(r.attempts[0].staleAcked, 1);
});

test('AC-16: offline End retries then the acknowledgement, no sample in between', () => {
  const r = analyze([
    req(0, 'start', 'A'), sample(5, 'A', 1),
    { t: at(10), kind: 'lifecycle', event: 'end_pressed', tripId: 'A' },
    req(11, 'end', 'A', { ok: false, status: 0, code: 'NETWORK' }),
    req(16, 'end', 'A', { ok: false, status: 0, code: 'NETWORK' }),
    req(90, 'end', 'A'),
  ]);
  assert.equal(r.pass, true, JSON.stringify(r.checks));
  assert.equal(r.attempts[0].endAttempts, 2);
});

test('AC-17: an acknowledged sample after SESSION_CONFLICT or after End fails', () => {
  const superseded = analyze([
    req(0, 'start', 'A'), sample(5, 'A', 1),
    req(100, 'sample', 'A', { ok: false, status: 409, code: 'SESSION_CONFLICT', sequence: 2, capturedAt: at(98) }),
    sample(110, 'A', 3),
  ]);
  assert.equal(superseded.checks[2].ok, false);
  const afterEnd = analyze([
    req(0, 'start', 'A'),
    { t: at(10), kind: 'lifecycle', event: 'end_pressed', tripId: 'A' },
    req(11, 'end', 'A'),
    sample(15, 'A', 2),
  ]);
  assert.equal(afterEnd.checks[2].ok, false);
  assert.equal(afterEnd.checks[4].ok, false); // captured after End pressed
});

test('an export without any Start is not a pass', () => {
  assert.equal(analyze([{ t: t0, kind: 'device' }]).pass, false);
});

test('an HTTP-200 End with acknowledged:false does not close the trip; a real TIMEOUT Start is treated as server-held', () => {
  const pending = analyze([
    req(0, 'start', 'A'),
    { t: at(10), kind: 'lifecycle', event: 'end_pressed' },
    req(11, 'end', 'A', { acknowledged: false, outcome: 'pending' }),
    req(40, 'start', 'B'),
  ]);
  assert.equal(pending.attempts[0].closedBy, null);
  assert.equal(pending.attempts[0].endAttempts, 1);
  assert.equal(pending.checks[1].ok, false);
  const realTimeout = analyze([
    req(0, 'start', 'A', { ok: false, status: 0, code: 'TIMEOUT' }),
    req(10, 'start', 'B'),
  ]);
  assert.equal(realTimeout.attempts[0].serverMayHold, true);
  assert.equal(realTimeout.checks[1].ok, false);
});

test('a SEQUENCE_REPLAY on a sample does not close the trip, and end_pressed is matched by time', () => {
  const r = analyze([
    req(0, 'start', 'A'),
    req(5, 'sample', 'A', { ok: false, status: 409, code: 'SEQUENCE_REPLAY', sequence: 1, capturedAt: at(4) }),
    sample(10, 'A', 2),
    { t: at(20), kind: 'lifecycle', event: 'end_pressed', tripId: 'stale-feed-id' },
    sample(25, 'A', 3), // captured after End was pressed → collection did not stop
    req(26, 'end', 'A', { acknowledged: true, outcome: 'ended' }),
  ]);
  assert.equal(r.attempts[0].closedBy, 'End acknowledged');
  assert.equal(r.attempts[0].capturesAfterEndPressed, 1);
  assert.equal(r.checks[4].ok, false);
});

test('a successful End without a recorded acknowledgement does not close the trip', () => {
  const r = analyze([req(0, 'start', 'A'), req(11, 'end', 'A', { acknowledged: undefined, outcome: undefined })]);
  assert.equal(r.attempts[0].closedBy, null);
});
