import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, longestTrip, markerWindows, parseClockWindow, type Event } from './nat01-coverage';

// A 50-minute trip sampled every 5 s with the network gone from +20:00 to +23:30.
function syntheticTrip(): { events: Event[]; t0: number } {
  const t0 = new Date('2026-09-14T08:00:00+05:30').getTime();
  const events: Event[] = [
    { t: t0 - 5_000, kind: 'device', platform: 'android', osVersion: '14', executionEnvironment: 'standalone' },
    { t: t0 - 1_000, kind: 'app_state', state: 'active' },
    { t: t0, kind: 'request', op: 'start', ok: true, sentAt: t0 - 400, doneAt: t0 },
    { t: t0 + 60_000, kind: 'app_state', state: 'background' },
    { t: t0 + 20 * 60_000, kind: 'lifecycle', event: 'marker_outage_start' },
    { t: t0 + 23 * 60_000 + 30_000, kind: 'lifecycle', event: 'marker_outage_end' },
    { t: t0 + 25 * 60_000, kind: 'token', event: 'forced_refresh', ok: true, latencyMs: 420, expiresAt: t0 + 85 * 60_000 },
  ];
  const outageStart = t0 + 20 * 60_000;
  const outageEnd = t0 + 23 * 60_000 + 30_000;
  for (let capturedAt = t0 + 5_000, seq = 1; capturedAt < t0 + 50 * 60_000; capturedAt += 5_000, seq += 1) {
    const sentAt = capturedAt + 300;
    const offline = capturedAt >= outageStart && capturedAt < outageEnd;
    events.push({ t: capturedAt, kind: 'location', capturedAt, accuracy: 8, batch: 1 });
    events.push(offline
      ? { t: sentAt + 10_000, kind: 'request', op: 'sample', sequence: seq, capturedAt, sentAt, doneAt: sentAt + 10_000, ok: false, status: 0, code: 'TIMEOUT' }
      : { t: sentAt + 700, kind: 'request', op: 'sample', sequence: seq, capturedAt, sentAt, doneAt: sentAt + 700, ok: true, status: 200, serverReceivedAt: sentAt + 500 });
  }
  const end = t0 + 50 * 60_000;
  events.push({ t: end, kind: 'request', op: 'end', ok: true, sentAt: end - 300, doneAt: end });
  return { events, t0 };
}

test('coverage counts whole minutes, excludes declared outages, and lists the gap with its cause', () => {
  const { events } = syntheticTrip();
  const report = analyze(events);
  assert.equal(report.totalMinutes, 50);
  assert.equal(report.coveredMinutes, 47); // minutes 20, 21, 22 have no valid sample
  assert.equal(report.healthyMinutes, 46); // the marker window touches minutes 20-23
  assert.equal(report.healthyCovered, 46);
  assert.equal(report.pass, true);
  assert.ok(report.overall < 0.95 && report.healthy === 1);
  assert.equal(report.outages.length, 1);
  assert.ok(Math.abs(report.outages[0]!.durationMs - 215_000) <= 5_000);
  assert.ok(report.outages[0]!.causes.some(c => /TIMEOUT/.test(c)));
  assert.equal(report.tokenEvents.length, 1);
  assert.ok((report.backgroundShare ?? 0) > 0.97);
  assert.equal(report.expoGo, false);
});

test('a sample older than 30 s at receive time does not cover its minute', () => {
  const { events, t0 } = syntheticTrip();
  const stale = events.map(e =>
    e.kind === 'request' && e.op === 'sample' && (e.capturedAt as number) >= t0 + 30 * 60_000 && (e.capturedAt as number) < t0 + 31 * 60_000
      ? { ...e, serverReceivedAt: (e.capturedAt as number) + 31_000 }
      : e,
  );
  const report = analyze(stale);
  assert.equal(report.coveredMinutes, 46);
  assert.equal(report.pass, true); // 45/46 = 97.8 % on the healthy segment
});

test('short trips fail regardless of coverage; unclosed markers stay open; clock windows parse', () => {
  const { events, t0 } = syntheticTrip();
  const short = events.filter(e => e.t <= t0 + 10 * 60_000 && !(e.kind === 'request' && e.op === 'end'));
  short.push({ t: t0 + 10 * 60_000, kind: 'request', op: 'end', ok: true, doneAt: t0 + 10 * 60_000 });
  assert.equal(analyze(short).pass, false);

  const open = markerWindows([{ t: 5, kind: 'lifecycle', event: 'marker_outage_start' }]);
  assert.equal(open[0]!.end, Number.POSITIVE_INFINITY);

  const w = parseClockWindow('08:20-08:22', t0);
  assert.equal(w.start, t0 + 20 * 60_000);
  assert.equal(w.end, t0 + 22 * 60_000);
  assert.throws(() => parseClockWindow('20-22', t0));
});

test('the longest trip in an accumulated log is analysed and every gate condition is enforced', () => {
  const { events, t0 } = syntheticTrip();
  const earlier = t0 - 60 * 60_000;
  const withWarmup: Event[] = [
    { t: earlier - 5_000, kind: 'device', platform: 'android', osVersion: '14', executionEnvironment: 'storeClient' },
    { t: earlier, kind: 'request', op: 'start', ok: true, doneAt: earlier, tripId: 'warmup' },
    { t: earlier + 30_000, kind: 'request', op: 'sample', ok: true, capturedAt: earlier + 29_000, doneAt: earlier + 30_000, serverReceivedAt: earlier + 29_500, tripId: 'warmup' },
    { t: earlier + 3 * 60_000, kind: 'request', op: 'end', ok: true, doneAt: earlier + 3 * 60_000, tripId: 'warmup' },
    ...events,
  ];
  const { trip, count } = longestTrip(withWarmup);
  assert.equal(count, 2);
  assert.equal(trip.tripStart, t0);
  const report = analyze(withWarmup);
  assert.equal(report.totalMinutes, 50);
  assert.equal(report.pass, true); // the later device event (standalone) belongs to the long trip

  const noRefresh = analyze(events.filter(e => e.kind !== 'token'));
  assert.equal(noRefresh.pass, false);
  assert.equal(noRefresh.checks.find(c => /token/.test(c.name))?.ok, false);

  const noMarkers = analyze(events.filter(e => e.kind !== 'lifecycle'));
  assert.equal(noMarkers.pass, false); // 47/50 = 94 % and no declared outage
  assert.equal(analyze(events.filter(e => e.kind !== 'lifecycle'), [{ start: t0 + 20 * 60_000, end: t0 + 23 * 60_000 + 30_000, source: 'cli' }]).pass, true);

  const expoGo = analyze(events.map(e => e.kind === 'device' ? { ...e, executionEnvironment: 'storeClient' } : e));
  assert.equal(expoGo.pass, false);
});
