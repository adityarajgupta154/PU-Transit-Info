import { afterEach, expect, it, vi } from 'vitest';
import { createDriverTracker, type TrackingStore } from './driver-tracking';

afterEach(() => vi.unstubAllGlobals());

it('creates an RFC-4122 v4 trip id without crypto', async () => {
  vi.stubGlobal('crypto', undefined);
  const values = new Map<string, string>();
  const store: TrackingStore = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
  const start = vi.fn(async () => { throw new Error('stop after capture'); });
  const tracker = createDriverTracker({
    uid: 'uid',
    busId: 'BUS-1',
    geo: { watchPosition: () => 1, clearWatch: () => undefined },
    sessionStore: store,
    pendingStore: store,
    notify: () => undefined,
    transport: {
      getFeed: async () => ({
        generation: 0, full: false, lastReportCapturedAt: 0,
        freshUntil: 0, offlineAfter: 0, serverTime: 0, status: 'not_started',
      }) as never,
      start,
      sample: vi.fn(), heartbeat: vi.fn(), end: vi.fn(),
    },
  });
  await tracker.start();
  expect(start.mock.calls[0][0].tripId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});