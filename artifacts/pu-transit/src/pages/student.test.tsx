import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Student from './student';

const testState = vi.hoisted(() => ({
  feed: null as null | Record<string, unknown>,
  routes: [] as Record<string, unknown>[],
  buses: [] as Record<string, unknown>[],
  busesError: null as string | null,
  getRouteVersion: vi.fn(),
  mapProps: null as null | { stops?: { name?: string }[]; pathData?: { lat: number; lng: number }[] },
}));

const ROUTE_ID = '8f3c2a1e-6b7d-4a5e-9c1f-0d2e3f4a5b6c';
const current = {
  id: ROUTE_ID,
  shift: 'First Shift',
  busNumber: 'GJ06XX1234',
  origin: 'Waghodia',
  destination: 'PU Campus',
  stops: [{ lat: 22.3, lng: 73.2, name: 'New market' }],
  pathData: [{ lat: 22.3, lng: 73.2 }],
  status: 'published',
  pathSource: 'manual',
  publishedVersion: 2,
};
const v1 = {
  n: 1,
  shift: 'First Shift',
  busNumber: 'GJ06XX1234',
  origin: 'Waghodia',
  destination: 'Old campus gate',
  stops: [{ lat: 22.31, lng: 73.21, name: 'Old market' }],
  pathData: [{ lat: 22.31, lng: 73.21 }],
  pathSource: 'manual',
  createdAt: 1,
  createdBy: 'admin',
};

vi.mock('@/lib/storage', () => ({ storage: { getRouteVersion: testState.getRouteVersion } }));
vi.mock('@/hooks/use-transit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-transit')>()),
  useRoutes: () => ({ routes: testState.routes, error: null, refresh: vi.fn() }),
  useTrackingFeed: () => ({ status: testState.feed ? 'live' : 'offline', feed: testState.feed, receivedAt: Date.now(), error: null }),
}));
vi.mock('@/hooks/use-buses', () => ({
  useBuses: () => ({ buses: testState.buses, error: testState.busesError, refresh: vi.fn() }),
}));
vi.mock('@/components/map/map-view', () => ({
  MapView: (props: typeof testState.mapProps) => {
    testState.mapProps = props;
    return null;
  },
}));
vi.mock('@/components/service-notices', () => ({ ServiceNotices: () => null }));
vi.mock('@/components/no-service-today', () => ({ NoServiceToday: () => null }));

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('Student route version pinning (RTE-02 / AC-19)', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    testState.getRouteVersion.mockReset();
    testState.mapProps = null;
    testState.routes = [current];
    testState.buses = [];
    testState.busesError = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function search(text: string) {
    const input = container.querySelector('input');
    const form = container.querySelector('form');
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) throw new Error('search form missing');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
  }

  /** A search with one match opens that bus directly. */
  async function openBus() {
    act(() => root.render(<Student />));
    await search('1234');
  }

  it('shows the version the live trip started with, and says so', async () => {
    testState.feed = { phase: 'active', routeVersions: { [ROUTE_ID]: 1 }, location: { lat: 22.3, lng: 73.2 } };
    testState.getRouteVersion.mockResolvedValue(v1);
    await openBus();

    expect(testState.getRouteVersion).toHaveBeenCalledWith(ROUTE_ID, 1, expect.any(AbortSignal));
    expect(container.textContent).toContain('Old market');
    expect(container.textContent).not.toContain('New market');
    expect(container.textContent).toContain('Old campus gate');
    expect(container.textContent).toContain('showing the route this trip started with (v1)');
    expect(testState.mapProps?.pathData).toEqual(v1.pathData);
  });

  it('shows the current route when the trip pinned it, when there is no trip, and when the snapshot cannot be loaded', async () => {
    testState.feed = { phase: 'active', routeVersions: { [ROUTE_ID]: 2 } };
    await openBus();
    expect(testState.getRouteVersion).not.toHaveBeenCalled();
    expect(container.textContent).toContain('New market');
    expect(container.textContent).not.toContain('started with');
    act(() => root.unmount());

    root = createRoot(container);
    testState.feed = { phase: 'ended', routeVersions: { [ROUTE_ID]: 1 } };
    await openBus();
    expect(testState.getRouteVersion).not.toHaveBeenCalled();
    expect(container.textContent).toContain('New market');
    act(() => root.unmount());

    root = createRoot(container);
    testState.feed = { phase: 'active', routeVersions: { [ROUTE_ID]: 1 } };
    testState.getRouteVersion.mockRejectedValue(new Error('Not found'));
    await openBus();
    expect(container.textContent).toContain('New market');
    expect(container.textContent).toContain('could not load the route this trip started with');
  });
});

describe('Student accessibility (A11Y-01 / AC-24)', () => {
  let root: Root;
  let container: HTMLDivElement;
  const other = { ...current, id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', busNumber: 'GJ06XX5678', origin: 'Alkapuri' };
  const click = (el: Element | null) => act(() => el?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const byText = (text: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) ?? null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    testState.getRouteVersion.mockReset();
    testState.routes = [current, other];
    testState.buses = [];
    testState.busesError = null;
    testState.feed = { busId: 'GJ06XX1234', phase: 'active', routeVersions: {}, location: { lat: 22.3, lng: 73.2 } };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Student />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function submit(text: string) {
    const input = container.querySelector('input') as HTMLInputElement;
    const form = container.querySelector('form') as HTMLFormElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
  }

  it('moves focus to the result of a search: the bus heading, the count, or the no-match tile', async () => {
    await submit('1234');
    expect(document.activeElement?.id).toBe('route-heading');
    expect(document.activeElement?.textContent).toBe('bus 1234');

    await submit('GJ06');
    expect(document.activeElement?.id).toBe('results-summary');
    expect(document.activeElement?.textContent).toBe('2 buses');

    await submit('0000');
    expect(document.activeElement?.id).toBe('results-summary');
    expect(document.activeElement?.textContent).toContain('no bus matches “0000”');

    // Focus stays where the user put it through unrelated re-renders, and a repeated identical search moves it again.
    (container.querySelector('input') as HTMLInputElement).focus();
    await act(async () => root.render(<Student />));
    expect(document.activeElement?.tagName).toBe('INPUT');
    await submit('0000');
    expect(document.activeElement?.id).toBe('results-summary');
  });

  it('selecting a result focuses its heading, and "back to results" returns focus to that result tile', async () => {
    await submit('GJ06');
    click(byText('GJ06XX5678'));
    expect(document.activeElement?.id).toBe('route-heading');
    expect(document.activeElement?.textContent).toBe('bus 5678');

    click(byText('back to results'));
    expect(document.activeElement?.id).toBe(`bus-${other.id}`);
    expect(document.activeElement?.getAttribute('aria-pressed')).toBe('false');
  });

  it('announces the state word once per change through a single live region, without the ticking age', async () => {
    await submit('1234');
    const live = container.querySelectorAll('[aria-live], [role="status"], [role="alert"]');
    expect(live).toHaveLength(1);
    expect(live[0].textContent).toBe('bus 1234: live');

    // The visible tile still shows the age, but it is no longer a live region.
    expect(container.textContent).toContain('position is fresh');
    expect(container.querySelector('.metro-flip')?.getAttribute('role')).toBeNull();

    testState.feed = null;
    await act(async () => root.render(<Student />));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
  });
});

describe('Student bus labels', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    testState.routes = [current];
    testState.buses = [{ busId: current.busNumber, label: 'Waghodia 1' }];
    testState.busesError = null;
    testState.feed = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function search(text: string) {
    act(() => root.render(<Student />));
    const input = container.querySelector('input');
    const form = container.querySelector('form');
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) throw new Error('search form missing');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
  }

  it('shows a persisted label beside the bus ID in results and selected detail', async () => {
    await search('1234');
    expect(container.textContent).toContain('GJ06XX1234 · Waghodia 1');
    expect(container.textContent).toContain('first shift');
  });

  it('shows a refreshed label without changing the route or tracking selection', async () => {
    testState.feed = { phase: 'active', location: { lat: 22.3, lng: 73.2 } };
    await search('1234');
    expect(container.textContent).toContain('Waghodia 1');

    testState.buses = [{ busId: current.busNumber, label: 'Waghodia 2' }];
    await act(async () => root.render(<Student />));
    expect(container.textContent).toContain('Waghodia 2');
    expect(container.textContent).toContain('New market');
    expect(container.textContent).toContain('live');
  });

  it('surfaces label refresh errors while retaining the route and tracking view', async () => {
    testState.feed = { phase: 'active', location: { lat: 22.3, lng: 73.2 } };
    await search('1234');
    testState.busesError = 'labels service unavailable';
    await act(async () => root.render(<Student />));

    expect(container.textContent).toContain('bus labels could not refresh');
    expect(container.textContent).toContain('labels service unavailable');
    expect(container.textContent).toContain('Waghodia 1');
    expect(container.textContent).toContain('New market');
    expect(container.textContent).toContain('live');
  });
});
