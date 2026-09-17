import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutesTab } from './routes-tab';
import { confirmLeave } from '@/hooks/use-unsaved-changes';

const testState = vi.hoisted(() => ({
  auth: {
    currentUser: null as null | { getIdToken: () => Promise<string> },
  },
  mapProps: null as null | {
    stops?: { lat: number; lng: number; name?: string }[];
    pathData?: { lat: number; lng: number }[];
    onMapClick?: (point: { lat: number; lng: number }) => void;
  },
  network: null as null | ReturnType<typeof vi.fn>,
  saveRoute: vi.fn().mockResolvedValue({}),
  createRoute: vi.fn().mockResolvedValue({}),
  deleteRoute: vi.fn().mockResolvedValue(undefined),
  archiveRoute: vi.fn().mockResolvedValue({}),
  toast: vi.fn(),
}));

vi.mock('@/lib/firebase', () => ({ auth: testState.auth }));
vi.mock('@/components/map/map-view', () => ({
  MapView: (props: typeof testState.mapProps) => {
    testState.mapProps = props;
    return null;
  },
}));
vi.mock('@/lib/storage', () => ({
  storage: {
    saveRoute: testState.saveRoute,
    createRoute: testState.createRoute,
    deleteRoute: testState.deleteRoute,
    archiveRoute: testState.archiveRoute,
  },
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: testState.toast }),
}));

type Route = {
  id: string;
  shift: string;
  busNumber: string;
  origin: string;
  destination: string;
  stops: { lat: number; lng: number; name?: string }[];
  pathData?: { lat: number; lng: number }[];
  kind?: 'bus' | 'shuttle';
  status: 'draft' | 'published' | 'archived';
  pathSource?: 'ors' | 'manual';
  publishedVersion?: number;
  hasDraft?: boolean;
};

const buses = [
  { busId: 'GJ06XX1234', label: 'GJ06XX1234', status: 'active' as const, reason: '', createdAt: 1, updatedAt: 1 },
  { busId: 'BUS-1', label: 'BUS-1', status: 'active' as const, reason: '', createdAt: 1, updatedAt: 1 },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function setValue(container: HTMLElement, selector: string, value: string) {
  const element = container.querySelector(selector);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) {
    throw new Error(`missing form control ${selector}`);
  }
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
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

describe('RoutesTab geo plotting', () => {
  let root: Root;
  let container: HTMLDivElement;
  let network: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    testState.auth.currentUser = { getIdToken: vi.fn().mockResolvedValue('test-token') };
    testState.network = network = vi.fn();
    vi.stubGlobal('fetch', network);
    testState.mapProps = null;
    testState.saveRoute.mockClear();
    testState.createRoute.mockClear();
    testState.deleteRoute.mockClear();
    testState.archiveRoute.mockClear();
    testState.toast.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    testState.auth.currentUser = null;
    testState.network = null;
    vi.unstubAllGlobals();
  });

  function renderRoutes(routes: Route[] = [], fleetFeeds: Record<string, { feed: { phase: string } }> = {}, registry = buses) {
    act(() => {
      root.render(
        <RoutesTab routes={routes} routesError={null} refreshRoutes={vi.fn()} fleetFeeds={fleetFeeds as never} buses={registry} />,
      );
    });
  }

  const searchBox = () => {
    const element = container.querySelector('input[role="combobox"]');
    if (!(element instanceof HTMLInputElement)) throw new Error('missing stop search box');
    return element;
  };
  const options = () => Array.from(container.querySelectorAll('[role="option"]')).map((option) => option.textContent?.replace(/\s+/g, ' ').trim());
  const status = () => container.querySelector('[role="status"]')?.textContent ?? '';
  const fieldValue = (selector: string) => {
    const element = container.querySelector(selector);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) throw new Error(`missing field ${selector}`);
    return element.value;
  };
  const type = (text: string) => setValue(container, 'input[role="combobox"]', text);
  const press = (key: string) => act(() => void searchBox().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  // The search waits for a pause in typing before asking the server.
  const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 400))));

  const depot = { name: 'Waghodia Bus Depot', detail: 'Waghodia, Vadodara', lat: 22.3072, lng: 73.3987 };
  const campus = { name: 'Parul University', detail: '', lat: 22.2887, lng: 73.3638 };

  it('adds stops from place suggestions, pasted coordinates and map taps; the rider-facing start and end follow the first and last stop', async () => {
    renderRoutes();
    expect(container.textContent).toContain('no stops yet');

    // Suggestions: one Vadodara-boxed search per pause, listed by name and area, chosen with the keyboard.
    type('W');
    await settle();
    expect(network).not.toHaveBeenCalled();
    network.mockResolvedValueOnce(jsonResponse({ places: [depot, campus] }));
    type('Wagh');
    expect(status()).not.toContain('searching');
    await settle();
    expect(network).toHaveBeenCalledOnce();
    expect(network.mock.calls[0]?.[0]).toBe('/api/geo/geocode');
    expect(JSON.parse(String(network.mock.calls[0]?.[1]?.body))).toEqual({ query: 'Wagh' });
    expect(options()).toEqual(['Waghodia Bus Depot, Waghodia, Vadodara', 'Parul University']);
    expect(searchBox().getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain('Waghodia Bus Depot');

    await press('Enter');
    expect(testState.mapProps?.stops).toEqual([{ lat: depot.lat, lng: depot.lng, name: 'Waghodia Bus Depot' }]);
    expect(searchBox().value).toBe('');
    expect(searchBox().getAttribute('aria-expanded')).toBe('false');
    expect(status()).toContain('added Waghodia Bus Depot');
    expect(document.activeElement).toBe(searchBox());
    expect(fieldValue('input[placeholder="Waghodia"]')).toBe('Waghodia Bus Depot');
    expect(fieldValue('input[placeholder="Parul University"]')).toBe('Waghodia Bus Depot');
    expect(container.textContent).toContain('start · 22.30720, 73.39870');

    // Coordinates (here as a Google Maps link) become an exact pin without touching the server.
    type('https://www.google.com/maps/place/Parul+University/@22.2887,73.3634,17z');
    expect(options()).toEqual(['pin at 22.28870, 73.36340, exact point']);
    expect(status()).toContain('exact point');
    await press('ArrowDown');
    await press('Enter');
    await settle();
    expect(network).toHaveBeenCalledOnce();
    expect(testState.mapProps?.stops?.[1]).toEqual({ lat: 22.2887, lng: 73.3634, name: 'Stop 2' });
    expect(status()).toContain('added a stop at 22.28870, 73.36340');
    expect(fieldValue('input[placeholder="Waghodia"]')).toBe('Waghodia Bus Depot');
    expect(fieldValue('input[placeholder="Parul University"]')).toBe('Stop 2');
    expect(container.textContent).toContain('end · 22.28870, 73.36340');

    // Renaming the last stop renames the end; a hand-written label then stays put through reorders.
    setValue(container, 'input[aria-label="stop 2 name"]', 'Parul University gate');
    expect(fieldValue('input[placeholder="Parul University"]')).toBe('Parul University gate');
    setValue(container, 'input[placeholder="Waghodia"]', 'Waghodia');
    act(() => testState.mapProps?.onMapClick?.({ lat: 22.25, lng: 73.25 }));
    expect(testState.mapProps?.stops?.map((stop) => stop.name)).toEqual(['Waghodia Bus Depot', 'Parul University gate', 'Stop 3']);
    expect(fieldValue('input[placeholder="Waghodia"]')).toBe('Waghodia');
    expect(fieldValue('input[placeholder="Parul University"]')).toBe('Stop 3');
    await click(button(container, 'move stop 3 up'));
    expect(fieldValue('input[placeholder="Waghodia"]')).toBe('Waghodia');
    expect(fieldValue('input[placeholder="Parul University"]')).toBe('Parul University gate');
    await click(button(container, 'remove stop 1'));
    await click(button(container, 'remove stop 1'));
    await click(button(container, 'remove stop 1'));
    expect(fieldValue('input[placeholder="Waghodia"]')).toBe('Waghodia');
    expect(fieldValue('input[placeholder="Parul University"]')).toBe('');
  });

  it('names the problem when a search finds nothing, is throttled, or the coordinates lie outside Vadodara; escape closes the list', async () => {
    renderRoutes();

    network.mockResolvedValueOnce(jsonResponse({ places: [] }));
    type('Kapurai');
    await settle();
    expect(options()).toEqual([]);
    expect(status()).toContain('nothing in vadodara matches “Kapurai”');
    expect(status()).toContain('tap the map');

    network.mockResolvedValueOnce(jsonResponse({ error: 'Too many geo requests', code: 'RATE_LIMITED' }, 429));
    type('Kapurai village');
    await settle();
    expect(status()).toContain('too many searches');
    expect(searchBox().getAttribute('aria-invalid')).toBe('true');

    type('28.6139, 77.2090');
    expect(options()).toEqual([]);
    expect(status()).toContain('28.61390, 77.20900 is outside the Vadodara map');
    await press('Enter');
    expect(testState.mapProps?.stops).toEqual([]);

    network.mockResolvedValueOnce(jsonResponse({ places: [depot] }));
    type('Wagh');
    await settle();
    expect(options()).toHaveLength(1);
    await press('Escape');
    expect(searchBox().getAttribute('aria-expanded')).toBe('false');
    // Enter on a hidden list shows it again instead of adding a stop nobody can see.
    await press('Enter');
    expect(testState.mapProps?.stops).toEqual([]);
    expect(searchBox().getAttribute('aria-expanded')).toBe('true');
    await press('Enter');
    expect(testState.mapProps?.stops).toEqual([{ lat: depot.lat, lng: depot.lng, name: 'Waghodia Bus Depot' }]);
    expect(network).toHaveBeenCalledTimes(3);
  });

  it('names each empty required field under itself when saving, moves focus there, and clears as it is filled', async () => {
    renderRoutes();
    setValue(container, '#route-shift', 'General Shift');
    act(() => testState.mapProps?.onMapClick?.({ lat: 22.2, lng: 73.1 }));
    setValue(container, '#route-origin', '');
    await click(button(container, 'save draft'));

    const busSelect = container.querySelector('#route-bus-number');
    expect(busSelect?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(busSelect);
    expect(container.querySelector('#route-bus-number-error')?.textContent).toBe('choose the bus.');
    expect(container.querySelector('#route-origin-error')?.textContent).toBe('type the start riders will see.');
    expect(container.querySelector('#route-shift')?.getAttribute('aria-invalid')).toBeNull();
    expect(container.querySelector('#route-destination')?.getAttribute('aria-invalid')).toBeNull();
    const alerts = () => Array.from(container.querySelectorAll('[role="alert"]')).map((el) => el.textContent);
    expect(alerts()).toEqual(['still needed: a bus number and the start shown to riders.']);
    expect(testState.createRoute).not.toHaveBeenCalled();

    setValue(container, '#route-bus-number', 'BUS-1');
    expect(busSelect?.getAttribute('aria-invalid')).toBeNull();
    expect(alerts()).toEqual(['still needed: the start shown to riders.']);
    setValue(container, '#route-origin', 'Waghodia');
    expect(alerts()).toEqual([]);
    expect(container.querySelector('#route-origin-error')).toBeNull();
  });

  it('says where buses come from when the registry is empty', () => {
    renderRoutes([], {}, []);
    expect(container.querySelector('#route-bus-number')?.parentElement?.textContent).toContain(
      'no buses registered yet — add the bus in the fleet tab, then it appears here.',
    );
  });

  it('applies a road path only to the stop list it was plotted for (RTE-01)', async () => {
    renderRoutes();
    act(() => testState.mapProps?.onMapClick?.({ lat: 22.2, lng: 73.1 }));
    act(() => testState.mapProps?.onMapClick?.({ lat: 22.3, lng: 73.2 }));
    let answer: ((response: ReturnType<typeof jsonResponse>) => void) | undefined;
    network.mockReturnValueOnce(new Promise<ReturnType<typeof jsonResponse>>((resolve) => void (answer = resolve)));
    const plotButton = button(container, 'plot road path');
    await click(plotButton);
    expect(plotButton.textContent).toContain('plotting');

    // A stop added while directions are in flight makes the answer stale.
    act(() => testState.mapProps?.onMapClick?.({ lat: 22.25, lng: 73.15 }));
    await act(async () => {
      answer?.(jsonResponse({ path: [{ lat: 22.2, lng: 73.1 }, { lat: 22.3, lng: 73.2 }] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(testState.mapProps?.pathData).toEqual([]);
    expect(testState.mapProps?.stops).toHaveLength(3);
    expect(button(container, 'publish v1').disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();

    // Plotting the new list applies as usual.
    const path = [{ lat: 22.2, lng: 73.1 }, { lat: 22.25, lng: 73.15 }, { lat: 22.3, lng: 73.2 }];
    network.mockResolvedValueOnce(jsonResponse({ path }));
    await click(button(container, 'plot road path'));
    expect(testState.mapProps?.pathData).toEqual(path);
    expect(container.textContent).toContain('ready to publish');
  });

  it('plots only from two or more listed stops and keeps the draft when directions fail', async () => {
    renderRoutes();
    await click(button(container, 'plot road path'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('at least two stops');
    expect(network).not.toHaveBeenCalled();

    act(() => testState.mapProps?.onMapClick?.({ lat: 22.2, lng: 73.1 }));
    await click(button(container, 'plot road path'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('at least two stops');
    expect(network).not.toHaveBeenCalled();

    act(() => testState.mapProps?.onMapClick?.({ lat: 22.3, lng: 73.2 }));
    network.mockResolvedValueOnce(jsonResponse({ error: 'directions unavailable', code: 'provider_failure' }, 502));
    await click(button(container, 'plot road path'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('directions unavailable');
    expect(network.mock.calls.map(([url]) => url)).toEqual(['/api/geo/directions']);
    expect(testState.mapProps?.stops).toEqual([
      { lat: 22.2, lng: 73.1, name: 'Stop 1' },
      { lat: 22.3, lng: 73.2, name: 'Stop 2' },
    ]);
    expect(testState.mapProps?.pathData).toEqual([]);
    expect(testState.saveRoute).not.toHaveBeenCalled();
    expect(testState.createRoute).not.toHaveBeenCalled();
  });

  it('expands the map to the whole screen and closes it again with escape, returning focus to the expand tile', async () => {
    renderRoutes();
    const expand = button(container, 'expand map');
    expect(container.querySelector('.fixed.inset-0')).toBeNull();
    await click(expand);
    expect(container.querySelector('.fixed.inset-0')).not.toBeNull();
    expect(document.activeElement).toBe(button(container, 'close map'));
    expect(document.body.style.overflow).toBe('hidden');
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.contains(button(container, 'close map'))).toBe(true);
    // Tab stays inside the overlay: the form underneath is not reachable while the map covers it.
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => void document.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button(container, 'close map'));
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('.fixed.inset-0')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(button(container, 'expand map'));
  });

  it('plots through every stop in order, and moving a stop drops the road path until it is plotted again (RTE-01)', async () => {
    renderRoutes();
    const tapped = [
      { lat: 22.2, lng: 73.1 },
      { lat: 22.25, lng: 73.15 },
      { lat: 22.3, lng: 73.2 },
    ];
    for (const point of tapped) act(() => testState.mapProps?.onMapClick?.(point));
    expect(button(container, 'publish v1').disabled).toBe(true);

    const path = [{ lat: 22.2, lng: 73.1 }, { lat: 22.26, lng: 73.15 }, { lat: 22.3, lng: 73.2 }];
    network.mockResolvedValueOnce(jsonResponse({ path }));
    await click(button(container, 'plot road path'));

    expect(network.mock.calls.map(([url]) => url)).toEqual(['/api/geo/directions']);
    expect(JSON.parse(String(network.mock.calls[0]?.[1]?.body))).toEqual({
      start: tapped[0],
      end: tapped[2],
      via: [tapped[1]],
    });
    expect(testState.mapProps?.stops?.map((stop) => stop.name)).toEqual(['Stop 1', 'Stop 2', 'Stop 3']);
    expect(testState.mapProps?.pathData).toEqual(path);
    expect(button(container, 'publish v1').disabled).toBe(false);

    await click(button(container, 'move stop 3 up'));
    expect(testState.mapProps?.stops?.map((stop) => stop.name)).toEqual(['Stop 1', 'Stop 3', 'Stop 2']);
    expect(testState.mapProps?.pathData).toEqual([]);
    expect(button(container, 'publish v1').disabled).toBe(true);
  });

  it('keeps coordinate mapping when creating and saving a route from a manual map stop', async () => {
    renderRoutes();
    setValue(container, 'select', 'First Shift');
    setValue(container, '#route-bus-number', 'GJ06XX1234');
    setValue(container, 'input[placeholder="Waghodia"]', 'Station');
    setValue(container, 'input[placeholder="Parul University"]', 'Campus');
    act(() => testState.mapProps?.onMapClick?.({ lat: 22.25, lng: 73.25 }));

    // No road path and no acknowledgement: only a draft can be saved.
    expect(button(container, 'publish v1').disabled).toBe(true);
    await click(button(container, 'save draft'));

    const fields = {
      shift: 'First Shift',
      busNumber: 'GJ06XX1234',
      origin: 'Station',
      destination: 'Campus',
      stops: [{ lat: 22.25, lng: 73.25, name: 'Stop 1' }],
      pathData: [],
      kind: 'bus',
    };
    expect(testState.createRoute).toHaveBeenCalledWith({ ...fields, status: 'draft' }, expect.stringMatching(UUID));
    expect(testState.createRoute.mock.calls[0]?.[0]).not.toHaveProperty('pathSource');
    expect(testState.saveRoute).not.toHaveBeenCalled();

    // The manual-path acknowledgement unlocks publishing and travels with the route.
    renderRoutes();
    setValue(container, 'select', 'First Shift');
    setValue(container, '#route-bus-number', 'GJ06XX1234');
    setValue(container, 'input[placeholder="Waghodia"]', 'Station');
    setValue(container, 'input[placeholder="Parul University"]', 'Campus');
    act(() => testState.mapProps?.onMapClick?.({ lat: 22.25, lng: 73.25 }));
    const acknowledgement = container.querySelector('input[type="checkbox"]');
    if (!(acknowledgement instanceof HTMLInputElement)) throw new Error('missing manual path checkbox');
    await click(acknowledgement);
    expect(button(container, 'publish v1').disabled).toBe(false);
    await click(button(container, 'publish v1'));
    expect(testState.createRoute).toHaveBeenLastCalledWith({ ...fields, status: 'published', pathSource: 'manual' }, expect.stringMatching(UUID));
    // Each new route gets its own id.
    expect(testState.createRoute.mock.calls[1]?.[1]).not.toBe(testState.createRoute.mock.calls[0]?.[1]);
  });

  it('keeps coordinate mapping when editing and saving an existing route', async () => {
    const route: Route = {
      id: 'route-1',
      shift: 'General Shift',
      busNumber: 'BUS-1',
      origin: 'Old start',
      destination: 'Old end',
      stops: [
        { lat: 22.22, lng: 73.12, name: 'Old start' },
        { lat: 22.28, lng: 73.18, name: 'Old end' },
      ],
      pathData: [{ lat: 22.24, lng: 73.14 }, { lat: 22.27, lng: 73.17 }],
      kind: 'shuttle',
      status: 'published',
      pathSource: 'ors',
    };
    renderRoutes([route]);

    await click(button(container, 'edit BUS-1'));
    expect(testState.mapProps?.stops).toEqual(route.stops);
    expect(testState.mapProps?.pathData).toEqual(route.pathData);
    await click(button(container, 'publish v1'));

    expect(testState.saveRoute).toHaveBeenCalledWith(
      {
        shift: route.shift,
        busNumber: route.busNumber,
        origin: route.origin,
        destination: route.destination,
        stops: route.stops,
        pathData: route.pathData,
        kind: route.kind,
        status: 'published',
        pathSource: 'ors',
      },
      route.id,
    );
  });

  it('lets a versioned route be edited during a live trip, but only a draft for a route published before versioning (RTE-02)', async () => {
    const legacy: Route = {
      id: 'route-legacy',
      shift: 'General Shift',
      busNumber: 'BUS-1',
      origin: 'Old start',
      destination: 'Old end',
      stops: [{ lat: 22.22, lng: 73.12, name: 'Old start' }],
      pathData: [],
      status: 'published',
      pathSource: 'manual',
    };
    const versioned: Route = { ...legacy, id: 'route-v3', busNumber: 'GJ06XX1234', publishedVersion: 3, hasDraft: true };
    const live = { feed: { phase: 'active' } };
    renderRoutes([legacy, versioned], { 'BUS-1': live, GJ06XX1234: live });

    expect(container.textContent).toContain('v3');
    expect(container.textContent).toContain('unpublished draft');
    expect(button(container, 'archive BUS-1').disabled).toBe(true);
    expect(button(container, 'archive GJ06XX1234').disabled).toBe(true);

    await click(button(container, 'edit GJ06XX1234'));
    expect(button(container, 'publish v4').disabled).toBe(false);
    expect(button(container, 'save draft (riders keep v3)').disabled).toBe(false);
    testState.saveRoute.mockResolvedValueOnce({ ...versioned, publishedVersion: 4, hasDraft: undefined });
    await click(button(container, 'publish v4'));
    expect(testState.saveRoute).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'published' }), 'route-v3');
    expect(testState.toast).toHaveBeenLastCalledWith({ title: 'route for GJ06XX1234 published as v4' });

    await click(button(container, 'edit BUS-1'));
    expect(button(container, 'publish v1').disabled).toBe(true);
    expect(container.textContent).toContain('predates versioning');
    testState.saveRoute.mockResolvedValueOnce({ ...legacy, hasDraft: true });
    await click(button(container, 'save draft (riders keep the current route)'));
    expect(testState.saveRoute).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'draft' }), 'route-legacy');
    expect(testState.toast).toHaveBeenLastCalledWith({ title: 'route for BUS-1 saved as draft — riders keep the current route' });
  });

  it('archives published routes and deletes only never-published drafts, each behind a confirmation that can be cancelled (RTE-03, AC-20, AC-22)', async () => {
    const published: Route = {
      id: 'route-pub',
      shift: 'General Shift',
      busNumber: 'GJ06XX1234',
      origin: 'Start',
      destination: 'End',
      stops: [{ lat: 22.22, lng: 73.12, name: 'Start' }],
      pathData: [],
      status: 'published',
      pathSource: 'ors',
      publishedVersion: 2,
    };
    const draft: Route = { ...published, id: 'route-draft', busNumber: 'BUS-1', status: 'draft', publishedVersion: undefined };
    const archived: Route = { ...published, id: 'route-old', busNumber: 'BUS-9', status: 'archived' };
    renderRoutes([published, draft, archived], { 'BUS-1': { feed: { phase: 'active' } } });

    expect(container.querySelector('[aria-label="delete GJ06XX1234"]')).toBeNull();
    expect(container.querySelector('[aria-label="archive BUS-9"]')).toBeNull(); // nothing left to do: edit + publish restores it
    expect(container.querySelector('[aria-label="delete BUS-9"]')).toBeNull();
    expect(button(container, 'delete BUS-1').disabled).toBe(false); // a live trip never references a draft
    expect(container.textContent).toContain('riders never see drafts');

    // AC-22: cancelling changes nothing.
    await click(button(container, 'archive GJ06XX1234'));
    expect(container.textContent).toContain('published versions stay for history');
    await click(button(container, 'keep it'));
    expect(container.querySelector('[aria-label="confirm archive GJ06XX1234"]')).toBeNull();
    expect(testState.archiveRoute).not.toHaveBeenCalled();
    expect(testState.deleteRoute).not.toHaveBeenCalled();

    await click(button(container, 'archive GJ06XX1234'));
    await click(button(container, 'yes, archive GJ06XX1234'));
    expect(testState.archiveRoute).toHaveBeenCalledWith('route-pub');
    expect(testState.deleteRoute).not.toHaveBeenCalled();
    expect(testState.toast).toHaveBeenLastCalledWith({ title: 'route for GJ06XX1234 archived' });

    await click(button(container, 'delete BUS-1'));
    expect(container.textContent).toContain('never published');
    testState.deleteRoute.mockRejectedValueOnce(new Error('Bus BUS-1 has a live trip')); // AC-20: the API explains a refusal
    await click(button(container, 'yes, delete BUS-1'));
    expect(testState.deleteRoute).toHaveBeenCalledWith('route-draft');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('live trip');
  });

  it('keeps the draft and its id across a failed save so the retry lands on the same route, and only a touched form asks before leaving (RTE-04, AC-21)', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const field = (selector: string) => {
      const element = container.querySelector(selector);
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) throw new Error(`missing field ${selector}`);
      return element.value;
    };
    const unloadPrevented = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    renderRoutes();

    // An untouched form never asks.
    expect(confirmLeave()).toBe(true);
    expect(unloadPrevented()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();

    setValue(container, 'select', 'First Shift');
    setValue(container, '#route-bus-number', 'GJ06XX1234');
    setValue(container, 'input[placeholder="Waghodia"]', 'Station');
    setValue(container, 'input[placeholder="Parul University"]', 'Campus');
    act(() => testState.mapProps?.onMapClick?.({ lat: 22.25, lng: 73.25 }));

    // Dirty: leaving asks, a refused prompt keeps the form, and reload/close is flagged too.
    expect(confirmLeave()).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('unsaved changes'));
    expect(unloadPrevented()).toBe(true);

    testState.createRoute.mockRejectedValueOnce(new Error('save failed: network unreachable'));
    await click(button(container, 'save draft'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('network unreachable');
    expect(field('input[placeholder="Waghodia"]')).toBe('Station');
    expect(field('input[placeholder="Parul University"]')).toBe('Campus');
    expect(field('#route-bus-number')).toBe('GJ06XX1234');
    expect(testState.mapProps?.stops).toEqual([{ lat: 22.25, lng: 73.25, name: 'Stop 1' }]);
    expect(button(container, 'save draft').disabled).toBe(false);
    expect(confirmLeave()).toBe(false);

    // The retry reuses the id, so a save that did reach the server is overwritten rather than duplicated.
    await click(button(container, 'save draft'));
    expect(testState.createRoute).toHaveBeenCalledTimes(2);
    const [, firstId] = testState.createRoute.mock.calls[0] ?? [];
    expect(firstId).toMatch(UUID);
    expect(testState.createRoute.mock.calls[1]?.[1]).toBe(firstId);
    expect(testState.saveRoute).not.toHaveBeenCalled();

    // Saved: the form is empty and clean again.
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(field('input[placeholder="Waghodia"]')).toBe('');
    expect(confirmLeave()).toBe(true);
    expect(unloadPrevented()).toBe(false);

    // Loading a route to edit is not dirty until a field changes; a failed plot keeps the loaded draft.
    const route: Route = {
      id: 'route-1',
      shift: 'First Shift',
      busNumber: 'BUS-1',
      origin: 'Station',
      destination: 'Campus',
      stops: [
        { lat: 22.2, lng: 73.1, name: 'Station' },
        { lat: 22.3, lng: 73.2, name: 'Campus' },
      ],
      pathData: [{ lat: 22.2, lng: 73.1 }, { lat: 22.3, lng: 73.2 }],
      status: 'draft',
    };
    renderRoutes([route]);
    await click(button(container, 'edit BUS-1'));
    expect(confirmLeave()).toBe(true);
    setValue(container, 'input[placeholder="Parul University"]', 'New campus');
    expect(confirmLeave()).toBe(false);
    network.mockResolvedValueOnce(jsonResponse({ error: 'directions unavailable', code: 'provider_failure' }, 502));
    await click(button(container, 'plot road path'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('directions unavailable');
    expect(field('input[placeholder="Parul University"]')).toBe('New campus');
    expect(testState.mapProps?.stops).toEqual(route.stops);
    expect(testState.createRoute).toHaveBeenCalledTimes(2);
    expect(testState.saveRoute).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
