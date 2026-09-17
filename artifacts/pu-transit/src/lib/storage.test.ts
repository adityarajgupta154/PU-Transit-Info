import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTrackingTransport, storage } from './storage';
import { auth } from './firebase';
import { ApiError } from './api';

// Mock the firebase module so we can control auth.currentUser
vi.mock('./firebase', () => {
  return {
    auth: {
      currentUser: null
    }
  };
});

global.fetch = vi.fn();

describe('Storage API Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockReset();

    // Default mock to an authenticated user
    (auth as any).currentUser = {
      uid: 'uid-1',
      getIdToken: vi.fn().mockResolvedValue('mock-token')
    };
  });

  afterEach(() => {
    (auth as any).currentUser = null;
    vi.useRealTimers();
  });

  it('fails closed when there is no user', async () => {
    // Override default to simulate logged out
    (auth as any).currentUser = null;

    await expect(storage.getRoutes()).rejects.toThrowError(
      new ApiError('Not authenticated', 401, 'unauthenticated')
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should save a route and send Authorization Bearer', async () => {
    const routeData = {
      shift: 'First Shift',
      busNumber: 'TEST-123',
      origin: 'A',
      destination: 'B',
      stops: [{ lat: 1, lng: 1 }]
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'new-id', ...routeData })
    });

    const saved = await storage.saveRoute(routeData);

    expect(global.fetch).toHaveBeenCalledWith('/api/routes', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(routeData)
    }));

    // Verify Authorization Bearer token is passed
    const fetchArgs = vi.mocked(global.fetch).mock.calls[0];
    const headers = fetchArgs[1]?.headers as Headers;
    expect(headers).toBeInstanceOf(Headers);
    expect(headers.get('Authorization')).toBe('Bearer mock-token');

    expect(saved.id).toBe('new-id');
  });

  it('creates a new route under the id the form chose, so a retried save is idempotent (RTE-04)', async () => {
    const routeData = { shift: 'First Shift', busNumber: 'TEST-123', origin: 'A', destination: 'B', stops: [{ lat: 1, lng: 1 }], status: 'draft' as const };
    (global.fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'form-id', ...routeData }) });

    const saved = await storage.createRoute(routeData, 'form-id');

    expect(global.fetch).toHaveBeenCalledWith('/api/routes/form-id', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ ...routeData, id: 'form-id' }),
    }));
    expect(saved.id).toBe('form-id');
  });

  it('should delete a route with 204 No Content', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 204
    });

    await storage.deleteRoute('some-id');
    expect(global.fetch).toHaveBeenCalledWith('/api/routes/some-id', expect.objectContaining({
        method: 'DELETE'
    }));
  });

  it('force-ends a trip through the admin endpoint', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ outcome: 'ended', feed: { busId: 'BUS-456' }, auditId: 'a1' })
    });

    const result = await storage.forceEndTracking('BUS-456', 'driver forgot');
    expect(global.fetch).toHaveBeenCalledWith('/api/tracking/BUS-456/force-end', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reason: 'driver forgot' })
    }));
    expect(result.outcome).toBe('ended');
  });

  it('lists audit entries with a limit', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entries: [] })
    });

    const result = await storage.getAudit(20);
    expect(global.fetch).toHaveBeenCalledWith('/api/audit?limit=20', expect.objectContaining({
      headers: expect.any(Headers)
    }));
    expect(result.entries).toEqual([]);
  });

  it('surfaces structured ApiError', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Access denied', code: 'permission_denied' })
    });

    try {
      await storage.getRoutes();
      expect.fail('Should have thrown ApiError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.message).toBe('Access denied');
      expect(err.status).toBe(403);
      expect(err.code).toBe('permission_denied');
    }
  });

  it('aborted requests bubble AbortError to prevent state retention', async () => {
    const controller = new AbortController();
    controller.abort();

    (global.fetch as any).mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

    await expect(storage.getRoutes(controller.signal)).rejects.toThrowError(DOMException);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('exposes sanitized tracking feed reads with caller cancellation', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'not_started' }),
    });

    await storage.getTrackingFeed('BUS/1');
    expect(global.fetch).toHaveBeenCalledWith('/api/tracking/BUS%2F1', expect.objectContaining({
      signal: undefined,
      headers: expect.any(Headers),
    }));

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ 'BUS/1': { status: 'not_started' } }),
    });
    await storage.getTrackingFeeds();
    expect(global.fetch).toHaveBeenCalledWith('/api/tracking', expect.anything());
  });

  it('binds every tracking transport call to its original account and auth helper', async () => {
    const transport = createTrackingTransport('BUS-1', 'uid-1');
    const input = {
      tripId: 'trip-1',
      publisherId: 'publisher-1',
      expectedGeneration: 0,
      requestedAt: 100,
    };
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ tripId: 'trip-1' }),
    });

    await transport.start(input);
    expect(global.fetch).toHaveBeenCalledWith('/api/tracking/BUS-1/start', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(input),
      headers: expect.any(Headers),
      signal: expect.any(AbortSignal),
    }));

    (auth as any).currentUser = {
      uid: 'uid-2',
      getIdToken: vi.fn().mockResolvedValue('other-token'),
    };
    await expect(transport.getFeed()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds a tracking request even when the underlying fetch ignores AbortSignal', async () => {
    vi.useFakeTimers();
    const transport = createTrackingTransport('BUS-1', 'uid-1');
    (global.fetch as any).mockImplementation(() => new Promise(() => undefined));
    const request = transport.getFeed();
    await Promise.resolve();
    vi.advanceTimersByTime(10_000);
    await expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
