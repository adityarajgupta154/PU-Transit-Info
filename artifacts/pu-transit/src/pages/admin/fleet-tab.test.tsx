import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetTab, HandoverForm } from './fleet-tab';
import type { Bus, Member, Route } from '@/lib/storage';

const testState = vi.hoisted(() => ({ handoverTracking: vi.fn(), updateBus: vi.fn(), toast: vi.fn() }));

vi.mock('@/lib/storage', () => ({ storage: { handoverTracking: testState.handoverTracking, updateBus: testState.updateBus } }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: testState.toast }) }));

const member = (uid: string, assignedBusId: string, role: Member['role'] = 'driver', active = true): Member => ({
  uid,
  email: `${uid}@paruluniversity.ac.in`,
  role,
  status: 'approved',
  active,
  assignedBusId,
  requestedRole: null,
  expiresAt: null,
  root: false,
  createdAt: 1,
  updatedAt: 1,
});
const route = (id: string, busNumber: string, shift: string, status: Route['status'] = 'published'): Route => ({
  id,
  shift,
  busNumber,
  origin: 'Station',
  destination: 'Campus',
  stops: [],
  status,
  publishedVersion: 2,
});
const members = [member('asha', 'BUS1'), member('bharat', 'BUS2'), member('chetan', 'BUS1', 'driver', false), member('admin', '', 'admin')];
const routes = [route('r-first-1', 'BUS1', 'First Shift'), route('r-draft-1', 'BUS1', 'General Shift', 'draft'), route('r-first-2', 'BUS2', 'First Shift')];

function control(container: HTMLElement, label: string): HTMLSelectElement | HTMLInputElement {
  const found = Array.from(container.querySelectorAll('label'))
    .filter((candidate) => candidate.textContent?.trim() === label)
    .map((candidate) => document.getElementById(candidate.htmlFor))[0];
  if (!(found instanceof HTMLInputElement || found instanceof HTMLSelectElement)) throw new Error(`missing control ${label}`);
  return found;
}

function setValue(container: HTMLElement, label: string, value: string) {
  const target = control(container, label);
  const prototype = target instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  act(() => {
    setter?.call(target, value);
    target.dispatchEvent(new Event(target instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

const submitButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

async function submit(container: HTMLElement) {
  await act(async () => {
    container.querySelector('form')!.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('HandoverForm (ADM-10)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onDone = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<HandoverForm busId="BUS1" routes={routes} members={members} onDone={onDone} onCancel={onCancel} />);
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('lists approved active drivers only and asks for a route just when the usual bus differs', async () => {
    const driverSelect = control(container, 'next driver') as HTMLSelectElement;
    expect(Array.from(driverSelect.options).map((o) => o.value)).toEqual(['', 'asha', 'bharat']);
    expect(submitButton(container).disabled).toBe(true);

    setValue(container, 'next driver', 'asha'); // standing driver of BUS1: no route needed
    expect(container.querySelectorAll('select')).toHaveLength(1);
    expect(submitButton(container).disabled).toBe(false);
    expect(submitButton(container).textContent).toContain('hand BUS1 to asha');

    setValue(container, 'next driver', 'bharat'); // usual bus BUS2: a published route of BUS1 is required
    expect(submitButton(container).disabled).toBe(true);
    const routeSelect = control(container, 'route of BUS1 for today (sets the shift)') as HTMLSelectElement;
    expect(Array.from(routeSelect.options).map((o) => o.value)).toEqual(['', 'r-first-1']); // no drafts, no BUS2 routes
    setValue(container, 'route of BUS1 for today (sets the shift)', 'r-first-1');
    setValue(container, 'reason (optional)', 'driver taken ill');
    testState.handoverTracking.mockResolvedValue({
      outcome: 'ended',
      assignment: { id: 'x', shift: 'First Shift' },
      previousDriverUid: 'asha',
      auditId: 'a1',
      feed: {},
    });
    await submit(container);
    expect(testState.handoverTracking).toHaveBeenCalledWith('BUS1', { nextDriverUid: 'bharat', routeId: 'r-first-1', reason: 'driver taken ill' });
    expect(testState.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'bus BUS1 handed to bharat@paruluniversity.ac.in', description: expect.stringContaining('assigned for today, first shift') }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('sends only the driver for their standing bus and shows the API refusal inline', async () => {
    setValue(container, 'next driver', 'asha');
    testState.handoverTracking.mockRejectedValueOnce(new Error('Bus BUS1 is already assigned to bharat@paruluniversity.ac.in on 2026-09-14 (First Shift).'));
    await submit(container);
    expect(testState.handoverTracking).toHaveBeenCalledWith('BUS1', { nextDriverUid: 'asha' });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('already assigned to bharat');
    expect(onDone).not.toHaveBeenCalled();
    expect(testState.toast).not.toHaveBeenCalled();
  });

  it('shows the protected owner in handover only for a root acting admin', () => {
    const owner = { ...member('owner', 'BUS1', 'admin'), root: true };
    const ordinaryAdmin = member('admin', '', 'admin');
    act(() => {
      root.render(
        <HandoverForm
          busId="BUS1"
          routes={routes}
          members={[...members, owner]}
          actingMember={ordinaryAdmin}
          onDone={onDone}
          onCancel={onCancel}
        />,
      );
    });
    const ordinarySelect = control(container, 'next driver');
    if (!(ordinarySelect instanceof HTMLSelectElement)) throw new Error('next driver must be a select');
    expect(Array.from(ordinarySelect.options).map((o) => o.value)).not.toContain('owner');

    act(() => {
      root.render(
        <HandoverForm
          busId="BUS1"
          routes={routes}
          members={[...members, owner]}
          actingMember={owner}
          onDone={onDone}
          onCancel={onCancel}
        />,
      );
    });
    const ownerSelect = control(container, 'next driver');
    if (!(ownerSelect instanceof HTMLSelectElement)) throw new Error('next driver must be a select');
    const ownerOption = Array.from(ownerSelect.options).find((o) => o.value === 'owner');
    expect(ownerOption?.textContent).toContain('owner admin');
  });
});

describe('Fleet bus label editing', () => {
  let container: HTMLDivElement;
  let root: Root;
  let bus: Bus;
  const reload = vi.fn(async () => renderFleet());
  const renderFleet = () => root.render(
    <FleetTab
      fleet={{ feeds: {}, error: null, refresh: vi.fn() }}
      routes={routes}
      buses={[bus]}
      members={members}
      busesLoading={false}
      busesError={null}
      reloadBuses={reload}
    />,
  );
  const editButton = () => container.querySelector<HTMLButtonElement>('button[aria-label="edit label for BUS1"]')!;
  const editForm = () => container.querySelector<HTMLFormElement>('form[aria-label="edit label for BUS1"]')!;
  const saveButton = () => editForm().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const changeLabel = (value: string) => setValue(container, 'bus label', value);
  const save = async () => {
    await act(async () => { editForm().requestSubmit(); });
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    testState.updateBus.mockReset();
    bus = { busId: 'BUS1', label: 'Campus express', status: 'active', reason: '', createdAt: 1, updatedAt: 1 };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(renderFleet);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each(['active', 'out_of_service'] as const)('saves a trimmed label for an %s bus without changing its ID or status and refreshes', async (status) => {
    bus = { ...bus, status, reason: status === 'out_of_service' ? 'maintenance' : '' };
    act(renderFleet);
    act(() => editButton().click());
    const input = control(container, 'bus label') as HTMLInputElement;
    expect(input.value).toBe('Campus express');
    expect(document.activeElement).toBe(input);
    expect(input.maxLength).toBe(64);
    expect(input.required).toBe(true);
    expect(editForm().querySelectorAll('input')).toHaveLength(1);
    changeLabel('  North campus  ');

    let finish!: () => void;
    testState.updateBus.mockImplementation(async (_id, data) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      bus = { ...bus, ...data };
      return bus;
    });
    await save();
    expect(input.disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
    expect(editForm().textContent).toContain('saving label');
    expect(editForm().querySelector<HTMLButtonElement>('button[type="button"]')?.disabled).toBe(true);
    await act(async () => { finish(); });

    expect(testState.updateBus).toHaveBeenCalledExactlyOnceWith('BUS1', { label: 'North campus' });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(bus.status).toBe(status);
    expect(container.querySelector('h3')?.textContent).toBe('BUS1');
    expect(container.textContent).toContain('North campus');
    expect(editForm()).toBeNull();
    expect(document.activeElement).toBe(editButton());
  });

  it('blocks blank and unchanged labels, keeps failed drafts for retry, and displays the API error', async () => {
    act(() => editButton().click());
    expect(saveButton().disabled).toBe(true);
    for (const invalid of ['', '   ']) {
      changeLabel(invalid);
      expect(saveButton().disabled).toBe(true);
      await save();
    }
    expect(testState.updateBus).not.toHaveBeenCalled();
    changeLabel('Corrected label');
    testState.updateBus.mockRejectedValueOnce(new Error('Admin access required'));
    await save();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Admin access required');
    expect(control(container, 'bus label').value).toBe('Corrected label');
    expect(saveButton().disabled).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(testState.toast).not.toHaveBeenCalled();
  });

  it('cancels without saving, restores focus, and reopens with the current label', () => {
    act(() => editButton().click());
    changeLabel('Discard me');
    act(() => editForm().querySelector<HTMLButtonElement>('button[type="button"]')!.click());
    expect(document.activeElement).toBe(editButton());
    expect(testState.updateBus).not.toHaveBeenCalled();
    bus = { ...bus, label: 'Changed elsewhere' };
    act(renderFleet);
    act(() => editButton().click());
    expect(control(container, 'bus label').value).toBe('Changed elsewhere');
    act(() => control(container, 'bus label').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(editForm()).toBeNull();
    expect(document.activeElement).toBe(editButton());
    expect(testState.updateBus).not.toHaveBeenCalled();
  });
});

describe('FleetTab announcer (A11Y-01)', () => {
  it('announces the fleet as state counts through one live region, not one ticking tile per bus', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const feed = (busId: string) => ({ busId, phase: 'active', gpsQuality: 'good', routeVersions: {}, serverTime: 1000, lastValidCapturedAt: 900 }) as never;
    const aged = (busId: string, status: 'live' | 'delayed' | 'offline') => ({ feed: feed(busId), status, error: null, receivedAt: 0 });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const fleet = { feeds: { BUS1: aged('BUS1', 'live'), BUS2: aged('BUS2', 'live'), BUS3: aged('BUS3', 'offline') }, error: null, refresh: vi.fn() };
    act(() =>
      root.render(
        <FleetTab fleet={fleet} routes={routes} buses={[]} members={members} busesLoading={false} busesError={null} reloadBuses={vi.fn()} />,
      ),
    );
    const live = container.querySelectorAll('[aria-live], [role="status"], [role="alert"]');
    expect(live).toHaveLength(1);
    expect(live[0].textContent).toBe('fleet: 2 live, 1 offline');
    act(() => root.unmount());
    container.remove();
  });
});
