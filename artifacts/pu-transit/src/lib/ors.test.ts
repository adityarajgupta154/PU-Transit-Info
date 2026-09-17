import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRouteFromORS, searchPlaces } from './ors';

const authState = vi.hoisted(() => ({
  currentUser: null as null | { getIdToken: () => Promise<string> },
}));

vi.mock('./firebase', () => ({ auth: authState }));

type FetchResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

const response = (body: unknown, status = 200): FetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('geo helpers', () => {
  let network: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    authState.currentUser = { getIdToken: vi.fn().mockResolvedValue('test-token') };
    network = vi.fn();
    vi.stubGlobal('fetch', network);
  });

  afterEach(() => {
    authState.currentUser = null;
    vi.unstubAllGlobals();
  });

  it('searches places through the authenticated backend route, passing the query as typed', async () => {
    const depot = { name: 'Waghodia Bus Depot', detail: 'Waghodia, Vadodara', lat: 22.3072, lng: 73.3987 };
    network.mockResolvedValueOnce(response({ places: [depot, { name: 'Parul University', detail: '', lat: 22.2887, lng: 73.3638 }] }));

    await expect(searchPlaces('Wagh')).resolves.toEqual([depot, { name: 'Parul University', detail: '', lat: 22.2887, lng: 73.3638 }]);

    expect(network).toHaveBeenCalledOnce();
    const [url, init] = network.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/geo/geocode');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"query":"Wagh"}');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-token');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('passes the abort signal through so a superseded search is cancelled', async () => {
    network.mockResolvedValueOnce(response({ places: [] }));
    const controller = new AbortController();

    await expect(searchPlaces('Unknown place', controller.signal)).resolves.toEqual([]);

    const [, init] = network.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it('rejects malformed place responses', async () => {
    network.mockResolvedValueOnce(response({ point: { lat: 22.3, lng: 73.2 } }));
    await expect(searchPlaces('Station')).rejects.toThrow(/malformed response/);

    network.mockResolvedValueOnce(response({ places: [{ name: 'Station', lat: 22.3 }] }));
    await expect(searchPlaces('Station')).rejects.toThrow(/malformed response/);
  });

  it('drops any place outside the Vadodara bounds', async () => {
    network.mockResolvedValueOnce(
      response({
        places: [
          { name: 'New Delhi', detail: '', lat: 28.6, lng: 77.2 },
          { name: 'Sayajigunj', detail: 'Vadodara', lat: 22.31, lng: 73.19 },
        ],
      }),
    );

    await expect(searchPlaces('S')).resolves.toEqual([{ name: 'Sayajigunj', detail: 'Vadodara', lat: 22.31, lng: 73.19 }]);
  });

  it('preserves backend errors from the authenticated request', async () => {
    network.mockResolvedValueOnce(response({ error: 'provider unavailable', code: 'provider_failure' }, 502));

    await expect(searchPlaces('Station')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'provider unavailable',
      status: 502,
      code: 'provider_failure',
    });
    expect(network).toHaveBeenCalledWith('/api/geo/geocode', expect.any(Object));
  });

  it('gets directions with lat/lng request points and maps the road path', async () => {
    network.mockResolvedValueOnce(
      response({
        path: [
          { lat: 22.2, lng: 73.1 },
          { lat: 22.3, lng: 73.2 },
        ],
      }),
    );

    await expect(
      getRouteFromORS([
        { lat: 22.2, lng: 73.1, name: 'Station' },
        { lat: 22.25, lng: 73.15, name: 'Market' },
        { lat: 22.3, lng: 73.2 },
      ]),
    ).resolves.toEqual([
      { lat: 22.2, lng: 73.1 },
      { lat: 22.3, lng: 73.2 },
    ]);

    const [url, init] = network.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/geo/directions');
    // Intermediate stops go as `via` (names stripped) so the path covers every leg (RTE-01).
    expect(init.body).toBe(
      '{"start":{"lat":22.2,"lng":73.1},"end":{"lat":22.3,"lng":73.2},"via":[{"lat":22.25,"lng":73.15}]}',
    );
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-token');
  });

  it('rejects missing or malformed directions instead of returning a fake path', async () => {
    const endpoints = [{ lat: 22.2, lng: 73.1 }, { lat: 22.3, lng: 73.2 }];
    network.mockResolvedValueOnce(response({ path: [] }));
    await expect(getRouteFromORS(endpoints)).rejects.toThrow(/no directions/);

    network.mockResolvedValueOnce(response({ path: [{ lat: 22.2 }] }));
    await expect(getRouteFromORS(endpoints)).rejects.toThrow(/no directions/);

    await expect(getRouteFromORS(endpoints.slice(0, 1))).rejects.toThrow(/two stops/);
    await expect(getRouteFromORS(Array.from({ length: 51 }, () => endpoints[0]!))).rejects.toThrow(/50 stops/);
    expect(network).toHaveBeenCalledTimes(2);
  });
});