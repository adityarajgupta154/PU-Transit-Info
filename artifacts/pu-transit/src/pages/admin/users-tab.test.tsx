import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { endOfIstDay, istDate, UsersTab } from './users-tab';
import type { Bus, Member } from '@/lib/storage';

const testState = vi.hoisted(() => ({
  updateMembership: vi.fn(),
  toast: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  storage: {
    updateMembership: testState.updateMembership,
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: testState.toast }) }));

const member = (overrides: Partial<Member> = {}): Member => ({
  uid: 'owner-1',
  email: 'owner@paruluniversity.ac.in',
  role: 'admin',
  status: 'approved',
  active: true,
  assignedBusId: 'BUS-1',
  requestedRole: null,
  expiresAt: null,
  root: true,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const bus = (busId: string): Bus => ({
  busId,
  label: busId,
  status: 'active',
  reason: '',
  createdAt: 1,
  updatedAt: 1,
});

function control(container: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement {
  const labelNode = Array.from(container.querySelectorAll('label')).find((node) => node.textContent?.trim() === label);
  const element = labelNode ? document.getElementById(labelNode.htmlFor) : null;
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) throw new Error(`missing control ${label}`);
  return element;
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('access-until dates (IDN-01)', () => {
  it('"until 30 Sep" expires at the following IST midnight and reads back as 30 Sep', () => {
    const expiresAt = endOfIstDay('2026-09-30');
    expect(expiresAt).toBe(Date.UTC(2026, 8, 30, 18, 30));
    expect(istDate(expiresAt - 1)).toBe('2026-09-30'); // the date the input shows again
    expect(istDate(expiresAt)).toBe('2026-10-01'); // the first day without access
  });
});

describe('protected owner controls', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    testState.updateMembership.mockReset().mockResolvedValue(member());
    testState.toast.mockReset();
    testState.reload.mockReset().mockResolvedValue(undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('lets owner SELF assign a bus while protected fields stay disabled, and blocks an ordinary admin', async () => {
    const owner = member();
    const ordinaryAdmin = member({ uid: 'admin-1', email: 'admin@paruluniversity.ac.in', assignedBusId: '', root: false });
    const render = async (actingMember: Member) => {
      await act(async () => {
        root.render(
          <UsersTab
            members={[owner]}
            loading={false}
            error={null}
            reload={testState.reload}
            buses={[bus('BUS-1'), bus('BUS-2')]}
            actingMember={actingMember}
          />,
        );
        await Promise.resolve();
      });
    };

    await render(owner);
    expect(control(container, 'role').disabled).toBe(true);
    expect(control(container, 'status').disabled).toBe(true);
    expect(control(container, 'access until').disabled).toBe(true);
    const setButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'set');
    expect(setButton?.disabled).toBe(true);
    const standingBus = control(container, 'owner standing bus') as HTMLSelectElement;
    expect(standingBus.disabled).toBe(false);
    setSelectValue(standingBus, 'BUS-2');
    await act(async () => {
      await Promise.resolve();
    });
    expect(testState.updateMembership).toHaveBeenCalledWith('owner-1', { assignedBusId: 'BUS-2' });

    testState.updateMembership.mockClear();
    await render(ordinaryAdmin);
    expect(Array.from(container.querySelectorAll('label')).some((label) => label.textContent?.trim() === 'owner standing bus')).toBe(false);
    expect(control(container, 'role').disabled).toBe(true);
    expect(control(container, 'status').disabled).toBe(true);
    expect(control(container, 'access until').disabled).toBe(true);
    expect(container.textContent).toContain('protected owner settings can only be changed by the owner account');
    expect(testState.updateMembership).not.toHaveBeenCalled();
  });
});
