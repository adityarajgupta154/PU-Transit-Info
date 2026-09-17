import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storage = vi.hoisted(() => ({ getTrackingFeed: vi.fn(), getTrackingFeeds: vi.fn() }));
vi.mock('@/lib/storage', () => ({ storage }));
import { useFleetStatus, useTrackingFeed } from './use-transit';

const feed = { status: 'live', phase: 'active', location: { lat: 22.31, lng: 73.18, accuracy: 8 }, serverTime: 1000, lastValidCapturedAt: 900 };
const suspended = () => Promise.reject(new ApiError('access suspended', 403, 'MEMBERSHIP_REQUIRED'));

let root: Root;
let container: HTMLDivElement;
let latest: unknown;
function Probe({ hook }: { hook: () => unknown }) {
  latest = hook();
  return null;
}
const mount = (hook: () => unknown) => act(() => root.render(<Probe hook={hook} />));
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const tick = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
});

// IDN-02: a 403 on the poll means this account may no longer read live positions — the protected
// state leaves the view on that poll, instead of ageing out over minutes as a network fault would.
describe('useTrackingFeed on revocation', () => {
  it('drops the feed on a 403 but keeps it through other failures', async () => {
    storage.getTrackingFeed.mockResolvedValueOnce(feed);
    await mount(() => useTrackingFeed('BUS1'));
    await settle();
    let state = latest as ReturnType<typeof useTrackingFeed>;
    expect(state.status).toBe('live');

    storage.getTrackingFeed.mockRejectedValueOnce(new ApiError('down', 503, 'FIREBASE_UNAVAILABLE'));
    await tick(5000);
    await settle();
    state = latest as ReturnType<typeof useTrackingFeed>;
    expect(state.feed).not.toBeNull();
    expect(state.error).toBe('down');

    storage.getTrackingFeed.mockImplementationOnce(suspended);
    await tick(5000);
    await settle();
    state = latest as ReturnType<typeof useTrackingFeed>;
    expect(state.feed).toBeNull();
    expect(state.status).toBeNull();
    expect(state.error).toBe('access suspended');
  });
});

describe('useTrackingFeed when the bus changes', () => {
  it('never renders the previous bus while the first poll for the new one is in flight', async () => {
    storage.getTrackingFeed.mockResolvedValueOnce(feed);
    await mount(() => useTrackingFeed('BUS1'));
    await settle();
    expect((latest as ReturnType<typeof useTrackingFeed>).status).toBe('live');

    storage.getTrackingFeed.mockReturnValueOnce(new Promise(() => {}));
    const seen: unknown[] = [];
    await mount(() => {
      const state = useTrackingFeed('BUS2');
      seen.push(state.feed);
      return state;
    });
    await settle();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((f) => f === null)).toBe(true);
  });
});

describe('useFleetStatus on revocation', () => {
  it('empties the fleet on a 403', async () => {
    storage.getTrackingFeeds.mockResolvedValueOnce({ BUS1: feed });
    await mount(() => useFleetStatus());
    await settle();
    expect(Object.keys((latest as ReturnType<typeof useFleetStatus>).feeds)).toEqual(['BUS1']);

    storage.getTrackingFeeds.mockImplementationOnce(suspended);
    await tick(10000);
    await settle();
    const state = latest as ReturnType<typeof useFleetStatus>;
    expect(state.feeds).toEqual({});
    expect(state.error).toBe('access suspended');
  });
});
