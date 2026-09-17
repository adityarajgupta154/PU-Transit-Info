import assert from 'node:assert/strict';
import test from 'node:test';
import type { Route } from '@workspace/api-client-react';
import { busKey, planMigration, renderReport } from './buses-migrate-plan';

const route = (id: string, busNumber: string, origin = 'Waghodia', destination = 'PU Campus'): Route => ({
  id,
  status: 'published',
  shift: 'First Shift',
  busNumber,
  origin,
  destination,
  stops: [{ lat: 22.3, lng: 73.2, name: 'Gate' }],
});
const bus = (busId: string, status: 'active' | 'out_of_service' = 'active') => ({
  busId,
  label: `${busId} label`,
  status,
  reason: '',
  createdAt: 1,
  updatedAt: 1,
});
const member = (uid: string, assignedBusId: string, role: 'driver' | 'student' = 'driver') => ({
  uid,
  email: `${uid}@paruluniversity.ac.in`,
  role,
  assignedBusId,
});

test('busKey follows the web normalizeBusNumber rule and the Rules regex', () => {
  assert.equal(busKey(' gj 06-bx 1414 '), 'GJ06BX1414');
  assert.equal(busKey('bus-1'), 'BUS1');
  assert.equal(busKey('-'), null);
  assert.equal(busKey('a'), null);
  assert.equal(busKey('1'.repeat(21)), null);
});

test('merges raw forms into one key, picks the most common spelling as label, and plans every rewrite', () => {
  const plan = planMigration({
    routes: [
      route('r1', 'GJ 06 BX 1414'),
      route('r2', 'gj06bx1414', 'Vadodara', 'PU Campus'),
      route('r3', 'GJ 06 BX 1414', 'Halol', 'PU Campus'),
      route('r4', 'PU07'),
    ],
    members: [member('d1', 'GJ06BX1414'), member('d2', 'gj-06-bx-1414'), member('d3', 'PU-9'), member('s1', '', 'student')],
    feeds: { 'GJ 06 BX 1414': { phase: 'ended', status: 'ended' } },
    buses: [],
  });
  assert.deepEqual(
    plan.registry.map((entry) => [entry.busId, entry.label, entry.routes, entry.drivers]),
    [['GJ06BX1414', 'GJ 06 BX 1414', 3, 2], ['PU07', 'PU07', 1, 0], ['PU9', 'PU-9', 0, 1]],
  );
  assert.deepEqual(plan.routeRewrites.map(({ route, to }) => [route.id, to]), [['r1', 'GJ06BX1414'], ['r2', 'GJ06BX1414'], ['r3', 'GJ06BX1414']]);
  assert.deepEqual(plan.memberRewrites.map((m) => [m.uid, m.to]), [['d2', 'GJ06BX1414'], ['d3', 'PU9']]);
  assert.deepEqual(plan.issues.filter((i) => i.level === 'block'), []);
  assert.deepEqual(plan.issues.map((i) => i.kind).sort(), ['merge', 'orphan_assignment', 'tracking_history']);
  const report = renderReport(plan);
  assert.match(report, /No blocking issues/);
  assert.match(report, /\| GJ06BX1414 \| GJ 06 BX 1414 \| "GJ 06 BX 1414", "gj06bx1414", "GJ06BX1414", "gj-06-bx-1414" \| 3 \| 2 \| new \|/);
  assert.match(report, /tracking history stays under the old id GJ 06 BX 1414/);
});

test('blocks on unnormalizable values, live trips and an unreadable registry; keeps existing records', () => {
  const plan = planMigration({
    routes: [route('r1', '--'), route('r2', 'bus 1'), route('r3', 'BUS2'), { ...route('r4', 'bus 4'), publishedVersion: 2, hasDraft: true }, { ...route('r5', 'bus 5'), status: 'archived' }],
    members: [member('d1', 'bus 1'), member('d2', 'BUS2')],
    feeds: { 'bus 1': { phase: 'active', status: 'live' }, BUS2: { phase: 'active', status: 'offline' } },
    buses: [bus('BUS2', 'out_of_service')],
  });
  const blocking = plan.issues.filter((i) => i.level === 'block').map((i) => i.kind);
  assert.deepEqual(blocking.sort(), ['active_trip', 'active_trip', 'draft', 'invalid']);
  assert.deepEqual(plan.issues.filter((i) => i.kind === 'archived').length, 1);
  assert.ok(!plan.routeRewrites.some((r) => r.route.id === 'r5')); // archived routes are left alone

  // The destination key can be live too (another spelling already canonical and on the road).
  const collision = planMigration({
    routes: [route('r1', 'BUS3')],
    members: [member('d1', 'bus-3')],
    feeds: { BUS3: { phase: 'active', status: 'live' } },
    buses: [bus('BUS3')],
  });
  assert.deepEqual(collision.issues.filter((i) => i.level === 'block').map((i) => i.kind), ['active_trip']);
  assert.equal(plan.registry.find((e) => e.busId === 'BUS2')?.existing?.status, 'out_of_service');
  assert.equal(plan.registry.find((e) => e.busId === 'BUS2')?.label, 'BUS2 label');
  assert.match(renderReport(plan), /Nothing can be applied/);

  const unreadable = planMigration({ routes: [], members: [], feeds: {}, buses: null });
  assert.deepEqual(unreadable.issues.map((i) => [i.level, i.kind]), [['block', 'registry_unreadable']]);
});

test('an already canonical dataset plans nothing', () => {
  const plan = planMigration({
    routes: [route('r1', 'BUS1')],
    members: [member('d1', 'BUS1')],
    feeds: { BUS1: { phase: 'active', status: 'live' } },
    buses: [bus('BUS1')],
  });
  assert.equal(plan.routeRewrites.length + plan.memberRewrites.length, 0);
  assert.deepEqual(plan.issues.filter((i) => i.level === 'block'), []);
  assert.match(renderReport(plan), /- routes: none\n\n- drivers: none/);
});
