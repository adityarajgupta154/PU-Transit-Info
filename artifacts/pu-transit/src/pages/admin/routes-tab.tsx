import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, Maximize2, Minimize2, Pencil, Trash2, X } from 'lucide-react';
import { MapView } from '@/components/map/map-view';
import { PlaceSearch, type PickedPlace } from '@/components/map/place-search';
import { Field, SelectField } from '@/components/metro/field';
import { Headline, Tile, TileButton } from '@/components/metro/tile';
import { useToast } from '@/hooks/use-toast';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import type { AgedTrackingStatus } from '@/hooks/use-transit';
import { formatCoordinates } from '@/lib/coordinates';
import { getRouteFromORS } from '@/lib/ors';
import { SHIFTS, busNumberMatches, shiftLabel } from '@/lib/shifts';
import { storage, type Bus, type Route } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { followEndpoints, type Stop } from './route-draft';

type PathSource = NonNullable<Route['pathSource']>;
type Draft = {
  shift: string;
  busNumber: string;
  origin: string;
  destination: string;
  stops: Stop[];
  pathData: { lat: number; lng: number }[];
  kind: 'bus' | 'shuttle';
  /** ors = plotted through every current stop; manual = admin acknowledged an unverified path; null = unverified (draft only). */
  pathSource: PathSource | null;
};
const stopsKey = (stops: Stop[]) => stops.map((s) => `${s.lat},${s.lng}`).join('|');

/** What a route needs before it can be saved, in form order, each with the id of the box that fills it. */
const REQUIRED = {
  shift: { id: 'route-shift', filled: (d: Draft) => Boolean(d.shift), summary: 'a shift', error: 'choose a shift.' },
  busNumber: { id: 'route-bus-number', filled: (d: Draft) => Boolean(d.busNumber), summary: 'a bus number', error: 'choose the bus.' },
  stops: { id: 'route-stop-search', filled: (d: Draft) => d.stops.length > 0, summary: 'at least one stop', error: 'add at least one stop.' },
  origin: { id: 'route-origin', filled: (d: Draft) => Boolean(d.origin.trim()), summary: 'the start shown to riders', error: 'type the start riders will see.' },
  destination: {
    id: 'route-destination',
    filled: (d: Draft) => Boolean(d.destination.trim()),
    summary: 'the end shown to riders',
    error: 'type the end riders will see.',
  },
} as const;
type RequiredField = keyof typeof REQUIRED;

/** "a shift, a bus number and at least one stop" */
const listWords = (words: string[]) => (words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);
const EMPTY_DRAFT: Draft = { shift: '', busNumber: '', origin: '', destination: '', stops: [], pathData: [], kind: 'bus', pathSource: null };

export function RoutesTab({
  routes,
  routesError,
  refreshRoutes,
  fleetFeeds,
  buses,
  busesLoading = false,
  busesError = null,
}: {
  routes: Route[];
  routesError: string | null;
  refreshRoutes: () => void;
  fleetFeeds: Record<string, AgedTrackingStatus>;
  buses: Bus[];
  busesLoading?: boolean;
  busesError?: string | null;
}) {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // RTE-04: what the form last loaded (empty, or the route being edited); the form is dirty when the draft differs.
  const [baseline, setBaseline] = useState<Draft>(EMPTY_DRAFT);
  // RTE-04: a new route keeps one id across failed saves, so a retry after a lost response cannot create a second route.
  const createId = useRef<string | null>(null);
  const [plotting, setPlotting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Set by a save that found the form incomplete: from then on each empty required field says so under itself
  // (and stops saying so the moment it is filled), instead of one sentence that lists everything at once.
  const [checked, setChecked] = useState(false);
  const [filter, setFilter] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  // The map can take the whole screen while stops are being placed; it is the same map, only its box changes.
  const [mapExpanded, setMapExpanded] = useState(false);
  const expandButton = useRef<HTMLButtonElement>(null);
  const closeMapButton = useRef<HTMLButtonElement>(null);
  const mapOverlay = useRef<HTMLDivElement>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  // Adding, removing or reordering stops invalidates a plotted road path; a manual acknowledgement stays.
  // Renaming keeps the path. Either way the rider-facing start/end follow the first and last stop.
  const setStops = (stops: Stop[], { keepPath = false } = {}) =>
    setDraft((d) => ({
      ...d,
      ...followEndpoints(d, stops),
      stops,
      ...(keepPath ? {} : { pathData: [], pathSource: d.pathSource === 'manual' ? 'manual' : null }),
    }));
  const addStop = (picked: PickedPlace) =>
    setStops([...draft.stops, { lat: picked.lat, lng: picked.lng, name: picked.name ?? `Stop ${draft.stops.length + 1}` }]);
  const renameStop = (index: number, name: string) =>
    setStops(
      draft.stops.map((s, i) => (i === index ? { ...s, name } : s)),
      { keepPath: true },
    );
  const moveStop = (index: number, delta: number) => {
    const stops = [...draft.stops];
    const [stop] = stops.splice(index, 1);
    if (stop) stops.splice(index + delta, 0, stop);
    setStops(stops);
  };

  useEffect(() => {
    if (!mapExpanded) return;
    closeMapButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMapExpanded(false);
        return;
      }
      // The overlay is modal: tab cycles through its own controls (close, zoom, the map) and never
      // reaches the form hidden underneath.
      if (event.key === 'Tab' && mapOverlay.current) {
        const focusable = Array.from(
          mapOverlay.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const current = document.activeElement;
        if (event.shiftKey && (current === first || !mapOverlay.current.contains(current))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (current === last || !mapOverlay.current.contains(current))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      expandButton.current?.focus();
    };
  }, [mapExpanded]);
  const liveBus = (busNumber: string) => fleetFeeds[busNumber]?.feed?.phase === 'active';
  const riderVersion = (route: Route) => (route.publishedVersion ? `v${route.publishedVersion}` : 'the current route');
  // RTE-02: trips pin the version they started with, so editing never disturbs a live trip.
  // Routes published before versioning have nothing pinned: publishing them waits for the trip to end.
  const legacyLocked = (route: Route) => route.status !== 'draft' && !route.publishedVersion && liveBus(route.busNumber);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return routes
      .filter(
        (r) =>
          !q ||
          busNumberMatches(r.busNumber, q) ||
          r.origin.toLowerCase().includes(q) ||
          r.destination.toLowerCase().includes(q) ||
          shiftLabel(r.shift).includes(q),
      )
      .sort((a, b) => a.busNumber.localeCompare(b.busNumber));
  }, [routes, filter]);

  // Plots the road path through every stop in list order: the first stop is the start, the last the end.
  const plot = async () => {
    setFormError(null);
    if (draft.stops.length < 2) {
      setFormError('add at least two stops before plotting — the first is where the route starts, the last where it ends.');
      return;
    }
    setPlotting(true);
    try {
      const requested = stopsKey(draft.stops);
      const pathData = await getRouteFromORS(draft.stops);
      // The stops can change (or another route can be opened) while directions are in flight; a road
      // path only ever certifies the exact stop list it was plotted for (RTE-01).
      setDraft((d) => (stopsKey(d.stops) === requested ? { ...d, pathData, pathSource: 'ors' } : d));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'plotting failed');
    } finally {
      setPlotting(false);
    }
  };

  const save = async (status: 'draft' | 'published') => {
    if (missing.length > 0) {
      setChecked(true);
      setFormError(null);
      // Take the admin to the first empty field rather than leaving them at the buttons.
      const first = document.getElementById(REQUIRED[missing[0]].id);
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first?.focus({ preventScroll: true });
      return;
    }
    setChecked(false);
    setSaving(true);
    setFormError(null);
    try {
      const { pathSource, ...fields } = draft;
      const input = { ...fields, status, ...(pathSource ? { pathSource } : {}) };
      const saved = editingId
        ? await storage.saveRoute(input, editingId)
        : await storage.createRoute(input, (createId.current ??= crypto.randomUUID()));
      toast({
        title: `route for ${draft.busNumber} ${
          status === 'published' ? `published as v${saved.publishedVersion}` : saved.hasDraft ? `saved as draft — riders keep ${riderVersion(saved)}` : 'saved as draft'
        }`,
      });
      reset();
      refreshRoutes();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  };

  const edit = (route: Route) => {
    const loaded: Draft = {
      shift: route.shift,
      busNumber: route.busNumber,
      origin: route.origin,
      destination: route.destination,
      stops: route.stops ?? [],
      pathData: route.pathData ?? [],
      kind: route.kind ?? 'bus',
      pathSource: route.pathSource ?? null,
    };
    setEditingId(route.id);
    createId.current = null;
    setChecked(false);
    setDraft(loaded);
    setBaseline(loaded);
    setFormError(null);
    document.getElementById('route-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const reset = () => {
    setEditingId(null);
    createId.current = null;
    setChecked(false);
    setDraft(EMPTY_DRAFT);
    setBaseline(EMPTY_DRAFT);
    setFormError(null);
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useUnsavedChanges(dirty, 'you have unsaved changes in the route form. leave and lose them?');

  // RTE-03: drafts nobody has seen are deleted; anything published is archived (history kept).
  const remove = async (route: Route) => {
    const deleting = route.status === 'draft';
    setRowError(null);
    try {
      if (deleting) await storage.deleteRoute(route.id);
      else await storage.archiveRoute(route.id);
      if (editingId === route.id) reset();
      setDeletingId(null);
      toast({ title: `route for ${route.busNumber} ${deleting ? 'deleted' : 'archived'}` });
      refreshRoutes();
    } catch (err) {
      setRowError({ id: route.id, message: err instanceof Error ? err.message : `${deleting ? 'delete' : 'archive'} failed` });
    }
  };

  const duplicate =
    draft.busNumber.trim() &&
    routes.some((r) => r.id !== editingId && r.busNumber === draft.busNumber.trim() && r.shift === draft.shift);
  const draftBusRegistered = buses.some((bus) => bus.busId === draft.busNumber);
  const missing = (Object.keys(REQUIRED) as RequiredField[]).filter((field) => !REQUIRED[field].filled(draft));
  const fieldError = (field: RequiredField) => (checked && missing.includes(field) ? REQUIRED[field].error : undefined);
  // One sentence by the buttons naming only what is still empty; it disappears as the fields fill.
  const stillNeeded = checked && missing.length > 0 ? `still needed: ${listWords(missing.map((field) => REQUIRED[field].summary))}.` : null;
  // The bus picker explains an empty list itself: the registry lives in the fleet tab.
  const busHint = busesLoading
    ? 'loading the bus registry'
    : buses.length === 0
      ? 'no buses registered yet — add the bus in the fleet tab, then it appears here.'
      : duplicate
        ? 'this bus already has a route in this shift — saving adds a second one.'
        : undefined;
  const editingRoute = routes.find((r) => r.id === editingId);

  const stopCount = draft.stops.length;
  const pathNote =
    draft.pathSource === 'ors'
      ? 'road path plotted through every stop — ready to publish.'
      : stopCount < 2
        ? 'with two or more stops, plot draws the road path through them in list order.'
        : 'plot draws the road path through the stops in list order; publishing needs it, or the manual acknowledgement below.';

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      {/* Form */}
      <form id="route-form" onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-10" aria-labelledby="route-form-heading">
        <Headline as="h2" size="section">
          <span id="route-form-heading">{editingId ? `editing ${draft.busNumber}` : 'new route'}</span>
        </Headline>

        <section className="flex flex-col gap-4" aria-labelledby="route-bus-heading">
          <Headline as="h3" size="row" id="route-bus-heading">
            bus and shift
          </Headline>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField id="route-shift" label="shift" value={draft.shift} onChange={(e) => set('shift', e.target.value)} error={fieldError('shift')}>
              <option value="">choose</option>
              {SHIFTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </SelectField>
            <SelectField label="vehicle type" value={draft.kind} onChange={(e) => set('kind', e.target.value as 'bus' | 'shuttle')}>
              <option value="bus">city bus</option>
              <option value="shuttle">campus shuttle</option>
            </SelectField>
            <SelectField
              id="route-bus-number"
              label="bus number"
              value={draft.busNumber}
              onChange={(e) => set('busNumber', e.target.value)}
              error={busesError ? `buses could not load: ${busesError}` : fieldError('busNumber')}
              hint={busHint}
            >
              <option value="">choose a bus</option>
              {draft.busNumber && !draftBusRegistered && <option value={draft.busNumber}>{draft.busNumber} (not in registry)</option>}
              {buses.map((bus) => (
                <option key={bus.busId} value={bus.busId}>
                  {bus.busId}
                  {bus.label && bus.label !== bus.busId ? ` — ${bus.label}` : ''}
                  {bus.status === 'out_of_service' ? ' (out of service)' : ''}
                </option>
              ))}
            </SelectField>
          </div>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="route-stops-heading">
          <Headline as="h3" size="row" id="route-stops-heading">
            stops
          </Headline>
          <p className="text-muted-foreground">
            the list is the route: the first stop is where it starts, the last is where it ends. add stops by searching a place, pasting
            coordinates, or tapping the map; the arrows put them in driving order.
          </p>
          <PlaceSearch id="route-stop-search" onPick={addStop} />
          {fieldError('stops') && (
            <p className="text-destructive" id="route-stops-error">
              {fieldError('stops')}
            </p>
          )}

          {/* Expanded, the same map fills the viewport (a fixed box, not the Fullscreen API, which iPhones do not offer) — Leaflet resizes itself. */}
          <div
            ref={mapOverlay}
            className={cn(mapExpanded ? 'fixed inset-0 z-50 flex flex-col bg-background' : 'relative')}
            {...(mapExpanded ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'route map, expanded' } : {})}
          >
            {mapExpanded && (
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <p className="text-lg">
                  tap the map to add a stop · <span className="tabular-nums">{stopCount}</span> {stopCount === 1 ? 'stop' : 'stops'} so far
                </p>
                <TileButton ref={closeMapButton} tone="outline" onClick={() => setMapExpanded(false)} className="min-h-12 gap-3 px-4 py-2 text-base">
                  <Minimize2 className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                  close map
                </TileButton>
              </div>
            )}
            <div className={cn('w-full', mapExpanded ? 'min-h-0 flex-1' : 'h-[28rem] md:h-[34rem]')}>
              <MapView stops={draft.stops} pathData={draft.pathData} interactive onMapClick={(ll) => addStop(ll)} />
            </div>
            {!mapExpanded && (
              <TileButton
                ref={expandButton}
                tone="outline"
                onClick={() => setMapExpanded(true)}
                className="absolute right-3 top-3 z-10 min-h-12 gap-3 px-4 py-2 text-base"
              >
                <Maximize2 className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                expand map
              </TileButton>
            )}
          </div>

          {stopCount === 0 ? (
            <p className="text-muted-foreground">no stops yet — the first one you add is where the route starts.</p>
          ) : (
            <ol className="flex flex-col" aria-label="stops in driving order">
              {draft.stops.map((stop, index) => (
                <li
                  key={index}
                  className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t-2 border-border/50 py-2 first:border-t-0 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:gap-y-1"
                >
                  <span className="tabular-nums text-muted-foreground">{index + 1}</span>
                  <input
                    aria-label={`stop ${index + 1} name`}
                    className="min-w-0 border-2 border-border bg-white px-3 py-2 text-foreground"
                    value={stop.name ?? ''}
                    onChange={(e) => renameStop(index, e.target.value)}
                  />
                  <p className="col-start-2 row-start-2 text-sm tabular-nums text-muted-foreground">
                    {index === 0 ? 'start · ' : index === stopCount - 1 ? 'end · ' : ''}
                    {formatCoordinates(stop)}
                  </p>
                  {/* On a phone the arrows drop under the name; from sm up they sit beside it. */}
                  <div className="col-start-2 row-start-3 flex gap-2 sm:col-start-3 sm:row-start-1">
                    <button
                      type="button"
                      aria-label={`move stop ${index + 1} up`}
                      className="metro-tile flex h-11 w-11 shrink-0 items-center justify-center border-2 border-foreground disabled:opacity-40"
                      disabled={index === 0}
                      onClick={() => moveStop(index, -1)}
                    >
                      <ArrowUp className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`move stop ${index + 1} down`}
                      className="metro-tile flex h-11 w-11 shrink-0 items-center justify-center border-2 border-foreground disabled:opacity-40"
                      disabled={index === stopCount - 1}
                      onClick={() => moveStop(index, 1)}
                    >
                      <ArrowDown className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`remove stop ${index + 1}`}
                      className="metro-tile flex h-11 w-11 shrink-0 items-center justify-center border-2 border-foreground"
                      onClick={() => setStops(draft.stops.filter((_, i) => i !== index))}
                    >
                      <X className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="route-riders-heading">
          <Headline as="h3" size="row" id="route-riders-heading">
            shown to riders
          </Headline>
          <p className="text-muted-foreground">
            riders search routes by these two names. they follow the first and last stop until you type your own.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="route-origin"
              label="start"
              value={draft.origin}
              onChange={(e) => set('origin', e.target.value)}
              placeholder="Waghodia"
              error={fieldError('origin')}
            />
            <Field
              id="route-destination"
              label="end"
              value={draft.destination}
              onChange={(e) => set('destination', e.target.value)}
              placeholder="Parul University"
              error={fieldError('destination')}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="route-path-heading">
          <Headline as="h3" size="row" id="route-path-heading">
            road path and publishing
          </Headline>
          <p className="text-muted-foreground">{pathNote}</p>
          {/* RTE-01: publishing needs a road path through every stop, or this explicit acknowledgement. */}
          {draft.pathSource !== 'ors' && (
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-primary"
                checked={draft.pathSource === 'manual'}
                onChange={(e) => set('pathSource', e.target.checked ? 'manual' : null)}
              />
              <span>
                manual path — the stops are right but the drawn line is not road-verified. riders will see “path not verified” on this route.
                {draft.pathSource !== 'manual' && ' until this is ticked or the road path is plotted, the route can only be saved as a draft.'}
              </span>
            </label>
          )}

          {stillNeeded && (
            <p role="alert" className="text-destructive">
              {stillNeeded}
            </p>
          )}
          {formError && (
            <p role="alert" className="text-destructive">
              {formError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <TileButton tone="outline" onClick={() => void plot()} disabled={plotting} className="min-h-16 text-base">
              {plotting ? 'plotting' : 'plot road path'}
            </TileButton>
            <TileButton tone="outline" onClick={() => void save('draft')} disabled={saving} className="min-h-16 text-base">
              {saving ? 'saving' : editingRoute && editingRoute.status !== 'draft' ? `save draft (riders keep ${riderVersion(editingRoute)})` : 'save draft'}
            </TileButton>
            <TileButton
              tone="blue"
              onClick={() => void save('published')}
              disabled={saving || !draft.pathSource || (!!editingRoute && legacyLocked(editingRoute))}
              className="min-h-16 text-base"
            >
              {saving ? 'saving' : `publish v${(editingRoute?.publishedVersion ?? 0) + 1}`}
            </TileButton>
            <TileButton tone="outline" onClick={reset} className="min-h-16 text-base">
              {editingId ? 'stop editing' : 'clear'}
            </TileButton>
          </div>
          <p className="text-muted-foreground">
            {editingRoute && legacyLocked(editingRoute)
              ? `bus ${editingRoute.busNumber} is on a trip and this route predates versioning — save a draft now, publish once the trip ends.`
              : 'drafts stay hidden from riders until published. a live trip keeps the version it started with; the new one applies from the next trip.'}
          </p>
        </section>
      </form>

      {/* List */}
      <section className="flex flex-col gap-5" aria-labelledby="routes-list-heading">
        <Headline as="h2" size="section">
          <span id="routes-list-heading">saved routes</span>
        </Headline>
        <Field label="search routes" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="bus number, place or shift" />
        {routesError && <p className="text-destructive">routes could not load — retrying. {routesError}</p>}
        {routes.length === 0 ? (
          <p className="text-muted-foreground">no routes yet. save the first one on the left.</p>
        ) : visible.length === 0 ? (
          <p className="text-muted-foreground">nothing matches “{filter}”.</p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((route) => {
              const live = liveBus(route.busNumber);
              const editing = editingId === route.id;
              const deleting = deletingId === route.id;
              const removable = route.status === 'draft';
              const verb = removable ? 'delete' : 'archive';
              return (
                <li key={route.id} className={cn('flex flex-col gap-3 border-t-2 border-border/50 py-4 first:border-t-0', editing && 'bg-primary/10 -mx-3 px-3')}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-2xl font-light">
                        {route.busNumber}
                        {route.publishedVersion && <span className="ml-3 align-middle text-base text-muted-foreground">v{route.publishedVersion}</span>}
                        {live && <span className="ml-3 bg-primary px-2 py-0.5 align-middle text-sm text-primary-foreground">on a trip</span>}
                        {route.status === 'draft' && <span className="ml-3 border-2 border-foreground px-2 py-0.5 align-middle text-sm">draft · hidden from riders</span>}
                        {route.status === 'archived' && <span className="ml-3 border-2 border-foreground px-2 py-0.5 align-middle text-sm">archived · hidden from riders</span>}
                        {route.hasDraft && <span className="ml-3 border-2 border-border px-2 py-0.5 align-middle text-sm">unpublished draft</span>}
                      </p>
                      <p className="text-muted-foreground">
                        {route.kind === 'shuttle' ? 'campus shuttle' : 'city bus'} · {shiftLabel(route.shift)} · {route.origin} → {route.destination} · {route.stops.length} stops
                        {route.pathSource !== 'ors' && ' · path not verified'}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <TileButton
                        tone="outline"
                        onClick={() => edit(route)}
                        aria-label={`edit ${route.busNumber}`}
                        className="min-h-12 w-12 justify-center px-0 py-0"
                      >
                        <Pencil className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                      </TileButton>
                      {route.status !== 'archived' && (
                        <TileButton
                          tone="outline"
                          onClick={() => setDeletingId(deleting ? null : route.id)}
                          disabled={live && !removable}
                          aria-label={`${verb} ${route.busNumber}`}
                          aria-expanded={deleting}
                          className="min-h-12 w-12 justify-center px-0 py-0"
                        >
                          {removable ? <Trash2 className="h-5 w-5" strokeWidth={1.5} aria-hidden /> : <Archive className="h-5 w-5" strokeWidth={1.5} aria-hidden />}
                        </TileButton>
                      )}
                    </div>
                  </div>
                  {live && (
                    <p className="text-muted-foreground">
                      {legacyLocked(route)
                        ? 'this bus is on a trip and the route predates versioning: drafts are fine, publishing and archiving wait until the trip ends.'
                        : removable
                          ? 'this bus is on a trip; riders never see drafts, so this one can still be edited or deleted.'
                          : `this bus is on a trip; riders on it keep ${riderVersion(route)} whatever you publish. moving the route to another bus or archiving it waits until the trip ends.`}
                    </p>
                  )}
                  {deleting && (
                    <Tile tone="outline" className="flex flex-col gap-3 p-4" role="group" aria-label={`confirm ${verb} ${route.busNumber}`}>
                      <p>
                        {removable
                          ? 'this draft was never published, so riders have never seen it. this cannot be undone.'
                          : `riders searching ${route.busNumber} will no longer find this route; its published versions stay for history. edit and publish again to bring it back.`}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <TileButton tone={removable ? 'red' : 'blue'} onClick={() => void remove(route)} className="min-h-14 text-base">
                          yes, {verb} {route.busNumber}
                        </TileButton>
                        <TileButton tone="outline" onClick={() => setDeletingId(null)} className="min-h-14 text-base">
                          keep it
                        </TileButton>
                      </div>
                    </Tile>
                  )}
                  {rowError?.id === route.id && (
                    <p role="alert" className="text-destructive">
                      {rowError.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
