import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarTab } from './calendar-tab';
import { serviceDateToday } from '@/lib/service-date';

const testState = vi.hoisted(() => ({
  listServiceCalendar: vi.fn(),
  setServiceDay: vi.fn(),
  deleteServiceDay: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  storage: {
    listServiceCalendar: testState.listServiceCalendar,
    setServiceDay: testState.setServiceDay,
    deleteServiceDay: testState.deleteServiceDay,
  },
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: testState.toast }) }));

const today = serviceDateToday();
const marked = { date: '2026-11-08', noService: true as const, note: 'Diwali holiday', updatedBy: 'admin', updatedAt: 1 };

function setValue(container: HTMLElement, label: string, value: string) {
  const control = Array.from(container.querySelectorAll('label'))
    .filter((candidate) => candidate.textContent?.trim() === label)
    .map((candidate) => document.getElementById(candidate.htmlFor))[0];
  if (!(control instanceof HTMLInputElement)) throw new Error(`missing control ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
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

describe('CalendarTab (STU-04b)', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    testState.listServiceCalendar.mockReset().mockResolvedValue([marked]);
    testState.setServiceDay.mockReset().mockResolvedValue(marked);
    testState.deleteServiceDay.mockReset().mockResolvedValue(undefined);
    testState.toast.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render() {
    await act(async () => {
      root.render(<CalendarTab />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('lists marked days, saves a trimmed reason for a date not before today, and restores service on delete', async () => {
    await render();
    expect(container.querySelector('ul')?.textContent).toContain('Sun, 8 Nov');
    expect(container.querySelector('ul')?.textContent).toContain('Diwali holiday');

    const dateInput = setValue(container, 'date (IST)', '2026-10-02');
    expect(dateInput.min).toBe(today);
    setValue(container, 'reason (optional, max 140 chars)', '  Gandhi Jayanti  ');
    await click(button(container, 'mark no service'));
    expect(testState.setServiceDay).toHaveBeenCalledWith('2026-10-02', { noService: true, note: 'Gandhi Jayanti' });
    expect(testState.listServiceCalendar).toHaveBeenCalledTimes(2);
    expect(dateInput.value).toBe('');

    await click(button(container, 'restore service on 2026-11-08'));
    expect(testState.deleteServiceDay).toHaveBeenCalledWith('2026-11-08');
    expect(testState.toast).toHaveBeenLastCalledWith({ title: 'service restored on Sun, 8 Nov' });
  });

  it('omits the note when the reason is blank and surfaces a failed save', async () => {
    testState.setServiceDay.mockRejectedValueOnce(new Error('A no-service day needs noService: true'));
    await render();
    setValue(container, 'date (IST)', '2026-10-02');
    setValue(container, 'reason (optional, max 140 chars)', '   ');
    await click(button(container, 'mark no service'));
    expect(testState.setServiceDay).toHaveBeenCalledWith('2026-10-02', { noService: true });
    expect(testState.toast).toHaveBeenLastCalledWith({ title: 'A no-service day needs noService: true', variant: 'destructive' });
  });
});
