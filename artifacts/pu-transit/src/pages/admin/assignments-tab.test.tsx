import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentsTab, conflictMessage, serviceDateToday } from './assignments-tab';
import { driverBusOptions } from '@workspace/driver-tracking';
import type { Assignment, Bus, Member, Route } from '@/lib/storage';

const testState = vi.hoisted(() => ({
  getAssignments: vi.fn(),
  createAssignment: vi.fn(),
  deleteAssignment: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  storage: {
    getAssignments: testState.getAssignments,
    createAssignment: testState.createAssignment,
    deleteAssignment: testState.deleteAssignment,
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: testState.toast }) }));

const today = serviceDateToday();
const member = (uid: string, assignedBusId: string, role: Member['role'] = 'driver'): Member => ({
  uid,
  email: `${uid}@paruluniversity.ac.in`,
  role,
  status: 'approved',
  active: true,
  assignedBusId,
  requestedRole: null,
  expiresAt: null,
  root: false,
  createdAt: 1,
  updatedAt: 1,
});
const bus = (busId: string, status: Bus['status'] = 'active'): Bus => ({ busId, label: busId, status, reason: '', createdAt: 1, updatedAt: 1 });
const route = (id: string, busNumber: string, shift: string, status: Route['status'] = 'published'): Route => ({
  id,
  shift,
  busNumber,
  origin: 'Station',
  destination: 'Campus',
  stops: [],
  status,
  publishedVersion: status === 'published' ? 2 : undefined,
});
const assignment = (driverUid: string, busId: string, shift: string, serviceDate = today): Assignment => ({
  id: `${serviceDate}_${shift.toLowerCase().replace(/[^a-z0-9]/g, '')}_${busId}`,
  driverUid,
  driverEmail: `${driverUid}@paruluniversity.ac.in`,
  busId,
  routeId: 'r-first-2',
  routeVersion: 2,
  shift,
  serviceDate,
  startsAt: 0,
  endsAt: Number.MAX_SAFE_INTEGER,
  createdAt: 1,
  createdBy: 'admin',
});

const members = [member('asha', 'BUS1'), member('bharat', 'BUS2'), member('admin', '', 'admin')];
const buses = [bus('BUS1'), bus('BUS2'), bus('BUS3', 'out_of_service')];
const routes = [
  route('r-first-1', 'BUS1', 'First Shift'),
  route('r-first-2', 'BUS2', 'First Shift'),
  route('r-general-2', 'BUS2', 'General Shift'),
  route('r-draft-2', 'BUS2', 'ADM / Medical Shift', 'draft'),
];
const existing = [assignment('bharat', 'BUS2', 'First Shift')];

function setValue(container: HTMLElement, label: string, value: string) {
  const control = Array.from(container.querySelectorAll('label'))
    .filter((candidate) => candidate.textContent?.trim() === label)
    .map((candidate) => document.getElementById(candidate.htmlFor))[0];
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) throw new Error(`missing control ${label}`);
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  act(() => {
    setter?.call(control, value);
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  return control;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`missing button ${label}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const alerts = (container: HTMLElement) => Array.from(container.querySelectorAll('[role="alert"]')).map((node) => node.textContent?.trim());

describe('conflictMessage (ASG-01)', () => {
  it('names the other driver or bus and lets the same driver keep their own slot', () => {
    const asha = { driverUid: 'asha', driverEmail: 'asha@paruluniversity.ac.in', serviceDate: today, shift: 'First Shift' };
    expect(conflictMessage(existing, { ...asha, busId: 'BUS2' })).toBe(`bus BUS2 is already assigned to bharat@paruluniversity.ac.in on ${today} (first shift).`);
    expect(conflictMessage(existing, { ...asha, busId: 'BUS2', shift: 'General Shift' })).toBeNull();
    expect(conflictMessage(existing, { ...asha, busId: 'BUS2', serviceDate: '2099-01-01' })).toBeNull();
    const bharat = { ...asha, driverUid: 'bharat', driverEmail: 'bharat@paruluniversity.ac.in' };
    expect(conflictMessage(existing, { ...bharat, busId: 'BUS1' })).toBe(`bharat@paruluniversity.ac.in already drives bus BUS2 on ${today} (first shift).`);
    expect(conflictMessage(existing, { ...bharat, busId: 'BUS2' })).toBeNull(); // overwrite of their own record
  });
});

describe('driverBusOptions (ASG-01)', () => {
  it("lists today's assignments before the standing bus and never twice", () => {
    const own = bus('BUS1');
    const other = bus('BUS2');
    const dated = assignment('asha', 'BUS2', 'First Shift');
    expect(driverBusOptions({ membership: member('asha', 'BUS1'), bus: own, assignments: [{ assignment: dated, bus: other }] })).toEqual([
      { busId: 'BUS2', bus: other, assignment: dated },
      { busId: 'BUS1', bus: own, assignment: null },
    ]);
    const same = assignment('asha', 'BUS1', 'General Shift');
    expect(driverBusOptions({ membership: member('asha', 'BUS1'), bus: own, assignments: [{ assignment: same, bus: own }] })).toEqual([{ busId: 'BUS1', bus: own, assignment: same }]);
    expect(driverBusOptions({ membership: member('asha', '', 'student'), bus: null, assignments: [] })).toEqual([]);
    expect(driverBusOptions({ membership: member('asha', ''), bus: null, assignments: [] })).toEqual([]);
    expect(driverBusOptions(undefined)).toEqual([]);
  });
});

describe('AssignmentsTab', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    testState.getAssignments.mockReset().mockResolvedValue(existing);
    testState.createAssignment.mockReset().mockResolvedValue(assignment('asha', 'BUS2', 'General Shift'));
    testState.deleteAssignment.mockReset().mockResolvedValue(undefined);
    testState.toast.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(nextMembers = members, actingMember: Member | null = null) {
    await act(async () => {
      root.render(<AssignmentsTab members={nextMembers} buses={buses} routes={routes} actingMember={actingMember} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('offers only approved drivers, active buses and published routes of the chosen bus', async () => {
    await render();
    const driverOptions = Array.from(setValue(container, 'driver', 'asha').querySelectorAll('option')).map((o) => o.value);
    expect(driverOptions).toEqual(['', 'asha', 'bharat']);
    const busOptions = Array.from(setValue(container, 'bus', 'BUS2').querySelectorAll('option')).map((o) => o.value);
    expect(busOptions).toEqual(['', 'BUS1', 'BUS2']);
    const routeOptions = Array.from(setValue(container, 'route (sets the shift)', 'r-first-2').querySelectorAll('option')).map((o) => o.textContent);
    expect(routeOptions).toEqual(['choose a published route', 'first shift · Station → Campus · v2', 'general shift · Station → Campus · v2']);
    expect(container.querySelector('ul[aria-label="upcoming assignments"]')?.textContent).toContain(`${today} · first shift · bus BUS2 · bharat@paruluniversity.ac.in`);
  });

  it('shows the protected owner only to a root acting admin and keeps the source label', async () => {
    const owner = { ...member('owner', 'BUS1', 'admin'), root: true };
    const ordinaryAdmin = member('admin', '');
    const withOwner = [...members, owner];
    await render(withOwner, ordinaryAdmin);
    expect(Array.from(setValue(container, 'driver', '').querySelectorAll('option')).map((o) => o.value)).not.toContain('owner');

    await render(withOwner, owner);
    const options = Array.from(setValue(container, 'driver', '').querySelectorAll('option'));
    expect(options.map((o) => o.value)).toContain('owner');
    expect(options.find((o) => o.value === 'owner')?.textContent).toContain('owner admin');
  });

  it('shows the conflict with names before saving and keeps the save button disabled until it is resolved', async () => {
    await render();
    setValue(container, 'driver', 'asha');
    setValue(container, 'bus', 'BUS2');
    setValue(container, 'route (sets the shift)', 'r-first-2');
    expect(alerts(container)).toEqual([`bus BUS2 is already assigned to bharat@paruluniversity.ac.in on ${today} (first shift).`]);
    expect(button(container, 'save assignment').disabled).toBe(true);
    await click(button(container, 'save assignment'));
    expect(testState.createAssignment).not.toHaveBeenCalled();

    setValue(container, 'route (sets the shift)', 'r-general-2');
    expect(alerts(container)).toEqual([]);
    expect(button(container, 'save assignment').disabled).toBe(false);
    await click(button(container, 'save assignment'));
    expect(testState.createAssignment).toHaveBeenCalledWith({ driverUid: 'asha', busId: 'BUS2', routeId: 'r-general-2', serviceDate: today });
    expect(testState.getAssignments).toHaveBeenCalledTimes(2);
  });

  it('shows the API refusal inline when the server finds a conflict the form did not know about', async () => {
    testState.createAssignment.mockRejectedValue(new Error('Bus BUS1 is already assigned to someone@paruluniversity.ac.in on 2099-01-01 (First Shift).'));
    await render();
    setValue(container, 'driver', 'asha');
    setValue(container, 'bus', 'BUS1');
    setValue(container, 'route (sets the shift)', 'r-first-1');
    setValue(container, 'service date (IST)', '2099-01-01');
    await click(button(container, 'save assignment'));
    expect(alerts(container)).toEqual(['Bus BUS1 is already assigned to someone@paruluniversity.ac.in on 2099-01-01 (First Shift).']);
    expect(testState.getAssignments).toHaveBeenCalledTimes(1);
  });

  it('removes only after confirmation; keep it changes nothing', async () => {
    await render();
    const id = existing[0].id;
    await click(button(container, `remove ${id}`));
    await click(button(container, 'keep it'));
    expect(testState.deleteAssignment).not.toHaveBeenCalled();
    expect(container.textContent).toContain('bharat@paruluniversity.ac.in');
    await click(button(container, `remove ${id}`));
    await click(button(container, 'yes, remove'));
    expect(testState.deleteAssignment).toHaveBeenCalledWith('bharat', id);
    expect(testState.getAssignments).toHaveBeenCalledTimes(2);
  });
});
