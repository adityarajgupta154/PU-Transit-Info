import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { createDriverTracker, type TrackingStore } from './driver-tracking';
import { canDrive, driverBusOptions } from '@workspace/driver-tracking';
import type { LiveTrackingFeed, TripSession } from '@workspace/api-client-react';

function memoryStore(): TrackingStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
}

function feed(overrides: Partial<LiveTrackingFeed> = {}): LiveTrackingFeed {
  return {
    protocolVersion: 2,
    direction: null,
    full: false,
    busId: 'BUS-1',
    tripId: null,
    generation: 0,
    phase: 'not_started',
    requestedAt: 0,
    startedAt: 0,
    endedAt: 0,
    heartbeatAt: 0,
    gpsQuality: 'acquiring',
    lastReportCapturedAt: 0,
    lastReportReceivedAt: 0,
    reportedAccuracy: 0,
    lastValidCapturedAt: 0,
    lastValidReceivedAt: 0,
    location: null,
    status: 'not_started',
    serverTime: 100_000,
    freshUntil: 0,
    offlineAfter: 0,
    ...overrides,
  };
}

function activeSession(input: { tripId: string; publisherId: string; expectedGeneration: number }): TripSession {
  return {
    tripId: input.tripId,
    publisherId: input.publisherId,
    generation: input.expectedGeneration + 1,
    sequence: 0,
    feed: feed({
      tripId: input.tripId,
      generation: input.expectedGeneration + 1,
      phase: 'active',
      status: 'acquiring',
    }),
  };
}

function fixture(options: {
  online?: () => boolean;
  end?: ReturnType<typeof vi.fn>;
  start?: ReturnType<typeof vi.fn>;
} = {}) {
  let success: PositionCallback | undefined;
  const geo = {
    watchPosition: vi.fn((callback: PositionCallback) => {
      success = callback;
      return 9;
    }),
    clearWatch: vi.fn(),
  };
  const initial = feed();
  const start = options.start ?? vi.fn(async (input: Parameters<typeof activeSession>[0]) => activeSession(input));
  const end = options.end ?? vi.fn(async () => ({
    acknowledged: true,
    outcome: 'ended' as const,
    feed: feed({ phase: 'ended', status: 'ended' }),
  }));
  const transport = {
    getFeed: vi.fn(async () => initial),
    start,
    sample: vi.fn(async (input: any) => ({
      tripId: input.tripId,
      publisherId: input.publisherId,
      generation: input.generation,
      sequence: input.sequence,
      feed: feed({
        tripId: input.tripId,
        generation: input.generation,
        phase: 'active',
        status: 'live',
        full: input.full ?? false,
      }),
    })),
    heartbeat: vi.fn(async (input: any) => ({
      tripId: input.tripId,
      publisherId: input.publisherId,
      generation: input.generation,
      sequence: input.sequence,
      feed: feed({
        tripId: input.tripId,
        generation: input.generation,
        phase: 'active',
        status: 'live',
        full: input.full ?? false,
      }),
    })),
    end,
  };
  const sessionStore = memoryStore();
  const pendingStore = memoryStore();
  const states: ReturnType<typeof createDriverTracker> extends { getState: () => infer S } ? S[] : never[] = [];
  let current = 100_000;
  const tracker = createDriverTracker({
    uid: 'uid-1',
    busId: 'BUS-1',
    geo,
    transport,
    sessionStore,
    pendingStore,
    notify: state => states.push(state),
    isOnline: options.online ?? (() => true),
    clock: {
      now: () => current,
      setTimeout: (callback, timeout) => setTimeout(callback, timeout),
      clearTimeout: handle => clearTimeout(handle),
    },
  });
  const position = (timestamp = current, lng = 73) => {
    success?.({
      timestamp,
      coords: { latitude: 22, longitude: lng, accuracy: 10 },
    } as GeolocationPosition);
  };
  return {
    tracker,
    geo,
    transport,
    sessionStore,
    pendingStore,
    states,
    position,
    setNow: (value: number) => { current = value; },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('driver tracking lifecycle', () => {
  it('recovers persisted metadata without automatically starting GPS or ending a duplicate tab', async () => {
    const sessionStore = memoryStore();
    sessionStore.setItem(
      'pu-transit:tracking:session:uid-1:BUS-1',
      JSON.stringify({
        uid: 'uid-1',
        busId: 'BUS-1',
        tripId: 'trip-1',
        publisherId: 'publisher-1',
        generation: 1,
        sequence: 2,
        requestedAt: 100_000,
      }),
    );
    const f = fixture();
    const tracker = createDriverTracker({
      uid: 'uid-1',
      busId: 'BUS-1',
      geo: f.geo,
      transport: f.transport,
      sessionStore,
      pendingStore: f.pendingStore,
      notify: state => f.states.push(state),
    });

    expect(tracker.getState().phase).toBe('recovery');
    expect(f.geo.watchPosition).not.toHaveBeenCalled();
    await tracker.dispose();
    expect(f.transport.end).not.toHaveBeenCalled();
  });

  it('coalesces GPS, persists sequence before upload, and drops old captures', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.tracker.start();
    await flush();
    expect(f.geo.watchPosition).toHaveBeenCalledTimes(1);

    f.position(100_000, 73);
    f.setNow(100_001);
    f.position(100_001, 74);
    f.position(99_999, 75);
    vi.advanceTimersByTime(5_000);
    await flush();

    expect(f.transport.sample).toHaveBeenCalledTimes(1);
    expect(f.transport.sample.mock.calls[0][0]).toMatchObject({ sequence: 1, lng: 74 });
    const persisted = [...f.sessionStore.values.values()].map(value => JSON.parse(value));
    expect(persisted.some(value => value.sequence === 1)).toBe(true);
    await f.tracker.dispose();
  });

  it('sends the selected direction on Start and persists it with the session', async () => {
    const start = vi.fn(async (input: any) => {
      const result = activeSession(input);
      return {
        ...result,
        feed: feed({
          ...result.feed,
          direction: input.direction,
        }),
      };
    });
    const f = fixture({ start });
    await f.tracker.start('toCampus');
    await flush();

    expect(start.mock.calls[0][0]).toMatchObject({ direction: 'toCampus' });
    const persisted = [...f.sessionStore.values.values()].map(value => JSON.parse(value));
    expect(persisted.some(value => value.direction === 'toCampus')).toBe(true);
    expect(f.tracker.getState().feed?.direction).toBe('toCampus');
    await f.tracker.dispose();
  });

  it('queues a full-status heartbeat after an in-flight sample with the next sequence', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let resolveSample!: () => void;
    f.transport.sample.mockImplementationOnce((input: any) => new Promise(resolve => {
      resolveSample = () => resolve({
        tripId: input.tripId,
        publisherId: input.publisherId,
        generation: input.generation,
        sequence: input.sequence,
        feed: feed({
          tripId: input.tripId,
          generation: input.generation,
          phase: 'active',
          status: 'live',
          full: false,
        }),
      });
    }));
    await f.tracker.start();
    await flush();
    f.position(100_000, 74);
    vi.advanceTimersByTime(5_000);
    await flush();

    const update = f.tracker.setFull(true);
    await flush();
    expect(f.transport.sample.mock.calls[0][0]).toMatchObject({ sequence: 1, full: false });
    expect(f.transport.heartbeat).not.toHaveBeenCalled();

    resolveSample();
    await update;
    await flush();
    expect(f.transport.heartbeat.mock.calls[0][0]).toMatchObject({ sequence: 2, full: true });
    expect(f.tracker.getState().feed?.full).toBe(true);
    await f.tracker.dispose();
  });

  it('increments and persists heartbeat sequence after a sample', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let previous = 0;
    f.transport.heartbeat.mockImplementation(async (input: any) => {
      if (input.sequence <= previous) throw new Error('duplicate sequence');
      previous = input.sequence;
      return {
        tripId: input.tripId,
        publisherId: input.publisherId,
        generation: input.generation,
        sequence: input.sequence,
        feed: feed({ tripId: input.tripId, generation: input.generation, phase: 'active', status: 'live' }),
      };
    });
    await f.tracker.start();
    await flush();
    f.position(100_000, 74);
    vi.advanceTimersByTime(5_000);
    await flush();
    vi.advanceTimersByTime(10_000);
    await flush();

    expect(f.transport.sample.mock.calls[0][0]).toMatchObject({ sequence: 1 });
    expect(f.transport.heartbeat.mock.calls[0][0]).toMatchObject({ sequence: 2 });
    const persisted = [...f.sessionStore.values.values()].map(value => JSON.parse(value));
    expect(persisted.some(value => value.sequence === 2)).toBe(true);
    await f.tracker.dispose();
  });

  it('does not mark a recent weak GPS report unavailable on heartbeat', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.transport.sample.mockImplementation(async (input: any) => ({
      tripId: input.tripId,
      publisherId: input.publisherId,
      generation: input.generation,
      sequence: input.sequence,
      feed: feed({
        tripId: input.tripId,
        generation: input.generation,
        phase: 'active',
        status: 'weak_gps',
        gpsQuality: 'weak',
        lastReportCapturedAt: input.capturedAt,
        lastReportReceivedAt: 100_000,
        reportedAccuracy: 250,
        freshUntil: 100_030,
        offlineAfter: 100_090,
      }),
    }));
    await f.tracker.start();
    await flush();
    // Accuracy is intentionally weak but still a valid report.
    const success = (f.geo.watchPosition.mock.calls[0][0] as PositionCallback);
    success({
      timestamp: 100_000,
      coords: { latitude: 22, longitude: 74, accuracy: 250 },
    } as GeolocationPosition);
    vi.advanceTimersByTime(5_000);
    await flush();
    vi.advanceTimersByTime(10_000);
    await flush();

    expect(f.transport.heartbeat.mock.calls[0][0]).toMatchObject({ sequence: 2 });
    expect(f.transport.heartbeat.mock.calls[0][0].gpsUnavailable).toBeUndefined();
    await f.tracker.dispose();
  });

  it('drops queued GPS on disconnect and requires a fresh fix after reconnect', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.tracker.start();
    await flush();
    f.position(100_000, 74);
    await f.tracker.disconnect();
    f.position(100_001, 75);
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(f.transport.sample).not.toHaveBeenCalled();

    // The server still shows this session as the active publisher.
    const live = f.tracker.getState().feed!;
    f.transport.getFeed.mockResolvedValueOnce(feed({ phase: 'active', status: 'live', tripId: live.tripId, generation: live.generation }));
    await f.tracker.reconnect();
    f.position(100_002, 76);
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(f.transport.sample).toHaveBeenCalledTimes(1);
    expect(f.transport.sample.mock.calls[0][0]).toMatchObject({ lng: 76 });
    await f.tracker.dispose();
  });

  it('aborts Start before any server call when a native adapter cannot start collection', async () => {
    const f = fixture();
    f.geo.watchPosition.mockImplementationOnce(() => Promise.reject(new Error('Foreground service refused')) as never);
    await f.tracker.start();
    expect(f.transport.getFeed).not.toHaveBeenCalled();
    expect(f.transport.start).not.toHaveBeenCalled();
    expect(f.tracker.getState()).toMatchObject({ phase: 'idle', error: 'Foreground service refused' });
    expect(f.sessionStore.values.size).toBe(0);

    // An adapter that resolves asynchronously (OS collection started) proceeds normally.
    f.geo.watchPosition.mockImplementationOnce(() => Promise.resolve(11) as never);
    await f.tracker.start();
    await flush();
    expect(f.transport.start).toHaveBeenCalledTimes(1);
    await f.tracker.stop();
    expect(f.geo.clearWatch).toHaveBeenCalledWith(11);
  });

  it('waits for a superseded native watch to settle before a new Start attaches its own collection', async () => {
    // Start → End → Start faster than the OS starts collection: the second
    // Start must not reach the server on the strength of the first (stale)
    // attachment, which is torn down when it finally resolves.
    vi.useFakeTimers();
    const f = fixture();
    let resolveFirst!: (id: number) => void;
    f.geo.watchPosition
      .mockImplementationOnce(() => new Promise<number>(resolve => { resolveFirst = resolve; }) as never)
      .mockImplementationOnce(() => Promise.resolve(22) as never);
    const first = f.tracker.start();
    await flush();
    await f.tracker.stop();
    const second = f.tracker.start();
    await flush();
    expect(f.transport.getFeed).not.toHaveBeenCalled();
    expect(f.transport.start).not.toHaveBeenCalled();

    resolveFirst(11);
    await first;
    await second;
    await flush();
    expect(f.geo.clearWatch).toHaveBeenCalledWith(11);
    expect(f.geo.watchPosition).toHaveBeenCalledTimes(2);
    expect(f.transport.start).toHaveBeenCalledTimes(1);
    // Only the second (adopted) watch feeds the new trip.
    (f.geo.watchPosition.mock.calls[1][0] as PositionCallback)({
      timestamp: 100_000,
      coords: { latitude: 22, longitude: 74, accuracy: 10 },
    } as GeolocationPosition);
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(f.transport.sample).toHaveBeenCalledTimes(1);
    await f.tracker.stop();
    expect(f.geo.clearWatch).toHaveBeenCalledWith(22);
  });

  it('serializes a delayed Start with an immediate Stop and sends End afterwards', async () => {
    let resolveStart!: (value: TripSession) => void;
    const start = vi.fn(() => new Promise<TripSession>(resolve => { resolveStart = resolve; }));
    const f = fixture({ start });
    const starting = f.tracker.start();
    await flush();
    const stopping = f.tracker.stop();
    expect(f.geo.clearWatch).toHaveBeenCalledWith(9);
    expect([...f.pendingStore.values.keys()]).toHaveLength(1);

    resolveStart(activeSession({
      tripId: (start.mock.calls[0][0] as any).tripId,
      publisherId: (start.mock.calls[0][0] as any).publisherId,
      expectedGeneration: 0,
    }));
    await starting;
    await stopping;
    await flush();
    expect(f.transport.end).toHaveBeenCalledTimes(1);
    expect(f.states.some(state => state.phase === 'live')).toBe(false);
  });

  it('keeps retrying an unacknowledged End', async () => {
    vi.useFakeTimers();
    const end = vi.fn()
      .mockResolvedValueOnce({ acknowledged: false, outcome: 'pending' as const, feed: feed() })
      .mockResolvedValueOnce({ acknowledged: true, outcome: 'ended' as const, feed: feed({ phase: 'ended', status: 'ended' }) });
    const f = fixture({ end });
    await f.tracker.start();
    await flush();
    await f.tracker.stop();
    expect(end).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(end).toHaveBeenCalledTimes(2);
    await f.tracker.dispose();
  });

  it('turns a definite Start conflict into conflict without ending another publisher', async () => {
    const f = fixture({
      start: vi.fn().mockRejectedValue(new ApiError('busy', 409, 'active_publisher')),
    });
    await f.tracker.start();
    await flush();
    expect(f.tracker.getState().phase).toBe('conflict');
    expect(f.transport.end).not.toHaveBeenCalled();
  });

  it('idles with the server reason on a refused Start (parked bus) and leaves nothing to recover', async () => {
    const start = vi.fn()
      .mockRejectedValueOnce(new ApiError('Bus BUS-1 is out of service: gearbox. Ask the transport admin before starting.', 403, 'BUS_OUT_OF_SERVICE'));
    const f = fixture({ start });
    await f.tracker.start();
    await flush();
    expect(f.tracker.getState().phase).toBe('idle');
    expect(f.tracker.getState().error).toContain('gearbox');
    expect(f.transport.end).not.toHaveBeenCalled();
    await f.tracker.start(); // the bus was reactivated: a plain new Start, not "recovery"
    await flush();
    expect(start).toHaveBeenCalledTimes(2);
    expect(f.tracker.getState().phase).not.toBe('recovery');
  });

  it('stops and idles when an upload is rejected as SESSION_CONFLICT (force-end)', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.tracker.start();
    await flush();
    f.transport.sample.mockRejectedValueOnce(new ApiError('not current', 409, 'SESSION_CONFLICT'));
    f.position(100_000, 74);
    vi.advanceTimersByTime(5_000);
    await flush();

    expect(f.tracker.getState().phase).toBe('idle');
    expect(f.tracker.getState().error).toMatch(/ended from the transport office/);
    expect(f.geo.clearWatch).toHaveBeenCalled();
    expect(f.sessionStore.values.size).toBe(0);
    expect(f.transport.end).not.toHaveBeenCalled();

    // No further uploads once superseded.
    f.position(100_001, 75);
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(f.transport.sample).toHaveBeenCalledTimes(1);
    await f.tracker.dispose();
  });

  it('keeps the session on a per-request 409 such as a replayed sequence', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.tracker.start();
    await flush();
    f.transport.sample.mockRejectedValueOnce(new ApiError('replay', 409, 'SEQUENCE_REPLAY'));
    f.position(100_000, 74);
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(f.tracker.getState().phase).toBe('delayed');
    expect(f.sessionStore.values.size).toBeGreaterThan(0);
    await f.tracker.dispose();
  });

  it('treats an ended feed on reconnect as a finished trip', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.tracker.start();
    await flush();
    await f.tracker.disconnect();
    f.transport.getFeed.mockResolvedValueOnce(feed({ phase: 'ended', status: 'ended', tripId: 'x', generation: 1 }));
    await f.tracker.reconnect();
    await flush();
    expect(f.tracker.getState().phase).toBe('idle');
    expect(f.geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(f.sessionStore.values.size).toBe(0);
    expect(f.transport.end).not.toHaveBeenCalled();
    await f.tracker.dispose();
  });

  it('flushes an offline pending End before a later Start', async () => {
    let online = true;
    const f = fixture({ online: () => online });
    await f.tracker.start();
    await flush();
    online = false;
    await f.tracker.stop();
    expect(f.transport.end).not.toHaveBeenCalled();

    online = true;
    await f.tracker.reconnect();
    expect(f.transport.end).toHaveBeenCalledTimes(1);
    await f.tracker.start();
    await flush();
    expect(f.transport.end.mock.invocationCallOrder[0]).toBeLessThan(
      f.transport.start.mock.invocationCallOrder[1],
    );
  });
});

describe('owner driver capability', () => {
  it('allows drivers and only the server-marked owner admin', () => {
    expect(canDrive({ role: 'driver' })).toBe(true);
    expect(canDrive({ role: 'admin' })).toBe(false);
    expect(canDrive({ role: 'admin', root: false })).toBe(false);
    expect(canDrive({ role: 'admin', root: true })).toBe(true);
    expect(canDrive({ role: 'student', root: true })).toBe(false);
    expect(canDrive(null)).toBe(false);
  });

  it('keeps the owner stored as admin while allowing the standing bus', () => {
    const bus = { busId: 'BUS-1', label: 'Campus', status: 'active' as const, reason: '', createdAt: 1, updatedAt: 1 };
    const membership = {
      uid: 'owner',
      email: 'owner@paruluniversity.ac.in',
      role: 'admin' as const,
      root: true,
      status: 'approved' as const,
      active: true,
      assignedBusId: 'BUS-1',
      requestedRole: null,
      expiresAt: null,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(driverBusOptions({ membership, bus, assignments: [] })).toEqual([
      { busId: 'BUS-1', bus, assignment: null },
    ]);
    expect(driverBusOptions({ membership: { ...membership, root: false }, bus, assignments: [] })).toEqual([]);
  });
});