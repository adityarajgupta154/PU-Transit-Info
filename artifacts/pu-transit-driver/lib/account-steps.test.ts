/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { User } from 'firebase/auth';
import type { AuthMe, Member } from '@workspace/api-client-react';
import { accountSteps, type MeLike } from './account-steps';

// NAT-06: the negative auth cases the web AuthGate blocks, applied to the native
// preflight. Every case must leave the Driver account row red (Start disabled);
// only an approved, active driver with an assigned bus passes both rows.

const user = { uid: 'driver-1', email: 'driver@paruluniversity.ac.in', emailVerified: true } as User;
const online = { ok: true, value: 'online', fix: null, action: 'none' as const };

const member = (overrides: Partial<Member> = {}): Member => ({
  uid: 'driver-1',
  email: 'driver@paruluniversity.ac.in',
  role: 'driver',
  status: 'approved',
  active: true,
  assignedBusId: 'BUS-1',
  requestedRole: null,
  expiresAt: null,
  root: false,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const me = (data: Partial<AuthMe>): MeLike => ({
  isLoading: false,
  error: null,
  data: { uid: 'driver-1', email: user.email!, emailVerified: true, universityEmail: true, graceEndsAt: null, membership: member(), bus: bus(), assignments: [], ...data },
});
const bus = (overrides: Partial<NonNullable<AuthMe['bus']>> = {}): NonNullable<AuthMe['bus']> => ({
  busId: 'BUS-1',
  label: 'Waghodia 1',
  status: 'active' as const,
  reason: '',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

test('an approved, active, assigned driver on an in-service bus passes all three account rows', () => {
  const steps = accountSteps(user, me({}), online);
  assert.equal(steps.identity.ok, true);
  assert.equal(steps.assignment.ok, true);
  assert.equal(steps.assignment.value, 'BUS-1');
  assert.equal(steps.bus.ok, true);
  assert.equal(steps.bus.value, 'Waghodia 1');
});

test('a parked or unregistered bus blocks at the Bus in service row with the reason (FLT-03)', () => {
  const parked = accountSteps(user, me({ bus: bus({ status: 'out_of_service', reason: 'gearbox' }) }), online);
  assert.equal(parked.assignment.ok, true);
  assert.equal(parked.bus.ok, false);
  assert.equal(parked.bus.value, 'out of service');
  assert.match(parked.bus.fix ?? '', /gearbox/);
  const unregistered = accountSteps(user, me({ bus: null }), online);
  assert.equal(unregistered.bus.value, 'not registered');
  assert.match(unregistered.bus.fix ?? '', /BUS-1/);
  assert.equal(accountSteps(user, me({ membership: member({ assignedBusId: '' }) }), online).bus.value, 'waiting');
});

test('an unverified email blocks with the verification instruction, never "not registered"', () => {
  const steps = accountSteps(user, me({ emailVerified: false, membership: null }), online);
  assert.equal(steps.identity.ok, false);
  assert.equal(steps.identity.value, 'email not verified');
  assert.match(steps.identity.fix ?? '', /verification link/);
  assert.equal(steps.assignment.ok, false);
});

test('a token the server rejects (forged, expired, revoked) blocks with the server message', () => {
  const steps = accountSteps(user, { isLoading: false, error: { message: 'Authentication is invalid' }, data: undefined }, online);
  assert.equal(steps.identity.ok, false);
  assert.match(steps.identity.fix ?? '', /server rejected this account \(Authentication is invalid\)/);
});

test('a 5xx from the server blocks without telling the driver to sign out', () => {
  const message = 'HTTP 503 Service Unavailable: Firebase membership is unavailable: Firebase refused assignments/uid (Permission denied)';
  const steps = accountSteps(user, { isLoading: false, error: { message, status: 503 }, data: undefined }, online);
  assert.equal(steps.identity.ok, false);
  assert.equal(steps.identity.value, 'server error');
  assert.match(steps.identity.fix ?? '', /refused assignments\/uid/);
  assert.doesNotMatch(steps.identity.fix ?? '', /sign out/);
});

test('pending, rejected, suspended and inactive memberships block like the web gate', () => {
  for (const status of ['pending', 'rejected', 'suspended'] as const) {
    const steps = accountSteps(user, me({ membership: member({ status }) }), online);
    assert.equal(steps.identity.ok, false, status);
    assert.equal(steps.identity.value, status);
  }
  const inactive = accountSteps(user, me({ membership: member({ active: false }) }), online);
  assert.equal(inactive.identity.ok, false);
  assert.equal(inactive.identity.value, 'deactivated');
});

test('an approved, active driver whose access end has passed is blocked as "expired", not deactivated (IDN-01)', () => {
  const expired = accountSteps(user, me({ membership: member({ expiresAt: Date.now() - 1000 }) }), online);
  assert.equal(expired.identity.ok, false);
  assert.equal(expired.identity.value, 'expired');
  assert.match(expired.identity.fix ?? '', /ran until .* — ask the transport admin to extend it/);
  assert.equal(expired.assignment.value, 'waiting');
  assert.equal(accountSteps(user, me({ membership: member({ expiresAt: Date.now() + 86_400_000 }) }), online).identity.ok, true);
});

test('students, staff and ordinary admins are not drivers on this app', () => {
  for (const role of ['student', 'staff', 'admin'] as const) {
    const steps = accountSteps(user, me({ membership: member({ role }) }), online);
    assert.equal(steps.identity.ok, false, role);
    assert.equal(steps.identity.value, `role: ${role}`);
  }
});

test('the protected owner keeps the stored admin role while passing driver account checks', () => {
  const steps = accountSteps(user, me({ membership: member({ role: 'admin', root: true }) }), online);
  assert.equal(steps.identity.ok, true);
  assert.equal(steps.identity.value, 'owner admin');
  assert.equal(steps.assignment.value, 'BUS-1');
  assert.equal(steps.bus.ok, true);
});

test('no membership record blocks; an approved driver without a bus is blocked at assignment', () => {
  assert.equal(accountSteps(user, me({ membership: null }), online).identity.value, 'not registered');
  const noBus = accountSteps(user, me({ membership: member({ assignedBusId: '' }) }), online);
  assert.equal(noBus.identity.ok, true);
  assert.equal(noBus.assignment.ok, false);
  assert.equal(noBus.assignment.value, 'no bus');
});

test('a record for a different uid is never trusted (shared phone, account switched mid-request)', () => {
  const steps = accountSteps(user, me({ uid: 'someone-else', membership: member({ uid: 'someone-else' }) }), online);
  assert.equal(steps.identity.ok, false);
  assert.equal(steps.identity.value, 'account mismatch');
});

test('signed out and still loading are red without an instruction to the admin', () => {
  assert.equal(accountSteps(null, me({}), online).identity.value, 'signed out');
  assert.equal(accountSteps(user, { isLoading: true, error: null, data: undefined }, online).identity.value, 'checking');
});

test("a dated assignment (ASG-01) is offered before the standing bus and drives the Bus in service row", () => {
  const other = bus({ busId: 'BUS-2', label: 'Waghodia 2', status: 'out_of_service', reason: 'gearbox' });
  const assignment = {
    id: '2026-09-14_firstshift_BUS-2', driverUid: 'driver-1', driverEmail: user.email!, busId: 'BUS-2', routeId: 'r', routeVersion: 1,
    shift: 'First Shift', serviceDate: '2026-09-14', startsAt: 0, endsAt: 1, createdAt: 1, createdBy: 'admin',
  };
  const today = me({ assignments: [{ assignment, bus: other }] });
  const dated = accountSteps(user, today, online);
  assert.equal(dated.assignment.ok, true);
  assert.equal(dated.assignment.value, 'BUS-2 · First Shift today');
  assert.equal(dated.bus.ok, false);
  assert.match(dated.bus.fix!, /Bus BUS-2 is out of service \(gearbox\)/);
  // Choosing the standing bus explicitly falls back to the usual registry record.
  const usual = accountSteps(user, today, online, 'BUS-1');
  assert.equal(usual.assignment.value, 'BUS-1');
  assert.equal(usual.bus.ok, true);
  // An unknown choice (the assignment was removed meanwhile) falls back to the first option.
  assert.equal(accountSteps(user, today, online, 'BUS-9').assignment.value, 'BUS-2 · First Shift today');
});
