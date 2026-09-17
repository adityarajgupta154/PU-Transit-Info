import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBuses } from './use-buses';

const storage = vi.hoisted(() => ({ getBuses: vi.fn() }));
vi.mock('@/lib/storage', () => ({ storage }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let latest: ReturnType<typeof useBuses>;

function Probe() {
  latest = useBuses();
  return null;
}

const settle = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

beforeEach(() => {
  vi.useFakeTimers();
  storage.getBuses.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useBuses', () => {
  it('refreshes bus labels every ten seconds', async () => {
    const first = { busId: 'GJ06XX1234', label: 'Waghodia 1' };
    const second = { busId: 'GJ06XX1234', label: 'Waghodia 2' };
    storage.getBuses.mockResolvedValueOnce([first]).mockResolvedValueOnce([second]);

    await act(async () => root.render(<Probe />));
    await settle();
    expect(latest.buses).toEqual([first]);
    expect(storage.getBuses).toHaveBeenCalledWith(expect.any(AbortSignal));

    await act(async () => vi.advanceTimersByTime(10000));
    await settle();
    expect(latest.buses).toEqual([second]);
  });

  it('keeps the last labels while surfacing a refresh error', async () => {
    const first = { busId: 'GJ06XX1234', label: 'Waghodia 1' };
    storage.getBuses.mockResolvedValueOnce([first]).mockRejectedValueOnce(new Error('registry unavailable'));

    await act(async () => root.render(<Probe />));
    await settle();
    await act(async () => vi.advanceTimersByTime(10000));
    await settle();

    expect(latest.buses).toEqual([first]);
    expect(latest.error).toBe('registry unavailable');
  });
});