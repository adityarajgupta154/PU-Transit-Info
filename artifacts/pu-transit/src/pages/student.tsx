import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, LocateFixed, Search } from 'lucide-react';
import { useRouteVersion, useRoutes, useTrackingFeed } from '@/hooks/use-transit';
import { useBuses } from '@/hooks/use-buses';
import { MapView } from '@/components/map/map-view';
import { Field } from '@/components/metro/field';
import { Headline, Tile, TileButton } from '@/components/metro/tile';
import { StateTile } from '@/components/metro/state-tile';
import { ServiceNotices } from '@/components/service-notices';
import { NoServiceToday } from '@/components/no-service-today';
import { SHIFTS, busNumberMatches, shiftLabel, shortBusNumber } from '@/lib/shifts';
import { stampFor } from '@/lib/tracking-state';
import type { Route } from '@/lib/storage';
import { cn } from '@/lib/utils';

type ViewerLocation = { lat: number; lng: number };

export default function Student() {
  const { routes, error: routesError } = useRoutes();
  const { buses, error: busesError } = useBuses();
  const [shift, setShift] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);
  const selectedRoute = routes.find((route) => route.id === activeRouteId) ?? null;
  const setActiveRoute = (route: Route | null) => setActiveRouteId(route?.id ?? null);
  const [viewer, setViewer] = useState<{ location: ViewerLocation | null; error: string | null; busy: boolean }>({
    location: null,
    error: null,
    busy: false,
  });

  // A11Y-01: after search / select / back, focus moves to the element that now matters (by id),
  // so keyboard and screen-reader users land on the result instead of staying in the search box.
  // A fresh object per request means a repeated identical search still moves focus, and nothing
  // else re-runs the effect.
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (focusRequest) (document.getElementById(focusRequest.id) ?? document.getElementById('results-summary'))?.focus();
  }, [focusRequest]);

  const { status, feed, receivedAt, error: feedError } = useTrackingFeed(selectedRoute?.busNumber ?? null);
  // RTE-02: a trip shows the route version it started with; a newer publish applies from the next trip.
  const pinnedVersion = selectedRoute && feed?.phase === 'active' ? feed.routeVersions?.[selectedRoute.id] : undefined;
  const pinNeeded = pinnedVersion !== undefined && pinnedVersion !== selectedRoute?.publishedVersion;
  const { version: pinned, error: pinError } = useRouteVersion(pinNeeded ? selectedRoute?.id ?? null : null, pinNeeded ? pinnedVersion ?? null : null);
  const activeRoute: Route | null = selectedRoute && pinned ? { ...selectedRoute, ...pinned, id: selectedRoute.id } : selectedRoute;
  const busLabels = useMemo(() => new Map(buses.map((bus) => [bus.busId, bus.label])), [buses]);

  const matches = useMemo(
    () =>
      routes
        .filter((route) => (!shift || route.shift === shift) && busNumberMatches(route.busNumber, query))
        .sort((a, b) => a.busNumber.localeCompare(b.busNumber)),
    [routes, shift, query],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    setQuery(next);
    setActiveRoute(null);
    // A single match goes straight to the bus — no second tap for the common case.
    const exact = routes.filter(
      (route) => (!shift || route.shift === shift) && busNumberMatches(route.busNumber, next),
    );
    if (exact.length === 1) setActiveRoute(exact[0]);
    setFocusRequest({ id: exact.length === 1 ? 'route-heading' : 'results-summary' });
  };

  const locateMe = () => {
    if (!navigator.geolocation) {
      setViewer({ location: null, error: 'this browser has no location service', busy: false });
      return;
    }
    setViewer((v) => ({ ...v, busy: true, error: null }));
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setViewer({ location: { lat: pos.coords.latitude, lng: pos.coords.longitude }, error: null, busy: false }),
      (err) =>
        setViewer({
          location: null,
          busy: false,
          error:
            err.code === err.PERMISSION_DENIED
              ? 'location permission was refused — allow it in the browser to see yourself on the map'
              : 'could not get your location right now',
        }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  const showBusOnMap =
    !!feed?.location && (status === 'live' || status === 'acquiring' || status === 'delayed' || status === 'weak_gps');
  const returning = feed?.direction === 'fromCampus';
  const orderedStops = activeRoute
    ? returning ? [...activeRoute.stops].reverse() : activeRoute.stops
    : [];

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-col gap-4 px-5 pt-4 md:px-8 lg:px-12">
        <NoServiceToday />
        <ServiceNotices routeId={activeRoute?.id} />
      </div>
    <div className="metro-turnstile flex flex-1 flex-col gap-10 px-5 py-6 md:px-8 md:py-12 lg:flex-row lg:gap-8 lg:px-12">
      {/* Left: headline, shift tiles, search, results */}
      <div className={cn('flex flex-col gap-8 lg:w-[40%] lg:shrink-0', activeRoute && 'hidden lg:flex')}>
        {/* Phone: one line clipped at the edge (the panorama device). Desktop: the column is wide enough to wrap. */}
        <Headline clip className="lg:overflow-visible lg:whitespace-normal">find your bus</Headline>

        <div role="group" aria-label="shift" className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2">
          {SHIFTS.map((item) => {
            const selected = shift === item.value;
            return (
              <TileButton
                key={item.value}
                tone={selected ? 'blue' : 'outline'}
                aria-pressed={selected}
                onClick={() => setShift(selected ? null : item.value)}
                className="min-h-20 items-end px-3 py-3 text-base leading-tight md:text-lg"
              >
                {item.label}
              </TileButton>
            );
          })}
        </div>

        <form onSubmit={submit} role="search">
          <Field
            label="bus number"
            placeholder="GJ 06 … or the last four digits"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
            inputMode="text"
            enterKeyHint="search"
            hint={shift ? `searching ${shiftLabel(shift)} only` : 'searching every shift'}
            trailing={
              <TileButton tone="blue" type="submit" className="h-14 shrink-0 py-0">
                <span className="text-xl">search</span>
                <Search className="h-6 w-6" strokeWidth={1.5} aria-hidden />
              </TileButton>
            }
          />
        </form>

        {routesError && <p className="text-destructive">routes could not load — retrying. {routesError}</p>}
        {busesError && <p role="alert" className="text-destructive">bus labels could not refresh — showing the last labels where available. {busesError}</p>}

        {query && (
          <div className="flex flex-col gap-2">
            {matches.length === 0 ? (
              <Tile tone="outline" id="results-summary" tabIndex={-1} className="px-5 py-6">
                <p className="text-xl">no bus matches “{query}”{shift ? ` in ${shiftLabel(shift)}` : ''}</p>
                <p className="mt-2 text-muted-foreground">
                  try fewer characters, or {shift ? 'clear the shift tile to search every shift' : 'check the number on the bus'}.
                </p>
              </Tile>
            ) : (
              <>
                <p id="results-summary" tabIndex={-1} className="text-muted-foreground">
                  {matches.length} {matches.length === 1 ? 'bus' : 'buses'}
                </p>
                {matches.map((route) => {
                  const selected = activeRoute?.id === route.id;
                  return (
                    <TileButton
                      key={route.id}
                      id={`bus-${route.id}`}
                      tone={selected ? 'blue' : 'outline'}
                      aria-pressed={selected}
                      onClick={() => {
                        setActiveRoute(route);
                        setFocusRequest({ id: 'route-heading' });
                      }}
                      className="flex-col items-start gap-1 px-5 py-4"
                    >
                      <span className="flex w-full items-center justify-between gap-4">
                        <span className="min-w-0 break-words text-2xl">
                          {route.busNumber}
                          {busLabels.get(route.busNumber) && <span className={selected ? 'text-primary-foreground' : 'text-muted-foreground'}> · {busLabels.get(route.busNumber)}</span>}
                        </span>
                        <ArrowRight className="h-6 w-6 shrink-0" strokeWidth={1.5} aria-hidden />
                      </span>
                      <span className="text-base">
                        {shiftLabel(route.shift)} · {route.origin} → {route.destination}
                      </span>
                      {(route.kind === 'shuttle' || route.pathSource !== 'ors') && (
                        <span className="text-sm">
                          {[route.kind === 'shuttle' && 'campus shuttle', route.pathSource !== 'ors' && 'path not verified'].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </TileButton>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* Right: the chosen bus */}
      {activeRoute ? (
        <div className="flex min-w-0 flex-1 flex-col gap-4 lg:gap-6">
          <TileButton
            tone="outline"
            onClick={() => {
              setActiveRoute(null);
              setFocusRequest({ id: `bus-${activeRoute.id}` });
            }}
            className="min-h-12 self-start py-2 lg:hidden"
          >
            <ArrowLeft className="h-6 w-6" strokeWidth={1.5} aria-hidden />
            <span>back to results</span>
          </TileButton>

          <div className="flex flex-col gap-1">
            <Headline id="route-heading" tabIndex={-1} clip className="normal-case">
              bus {shortBusNumber(activeRoute.busNumber)}
            </Headline>
            <p className="break-words text-muted-foreground">
              <span className="text-foreground">{activeRoute.busNumber}</span>
              {busLabels.get(activeRoute.busNumber) && <span> · {busLabels.get(activeRoute.busNumber)}</span>}
              {' · '}
              {shiftLabel(activeRoute.shift)} · {returning ? activeRoute.destination : activeRoute.origin} → {returning ? activeRoute.origin : activeRoute.destination}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-base">
              {activeRoute.kind === 'shuttle' && <span className="border border-border px-3 py-1">campus shuttle</span>}
              {activeRoute.pathSource !== 'ors' && (
                <span className="border border-border px-3 py-1" title="the stops are right; the drawn line between them is not road-verified">
                  path not verified
                </span>
              )}
              <span>{feed?.direction ? returning ? 'campus → city' : 'city → campus' : 'direction not set'}</span>
              {feed?.full && feed.phase === 'active' && status !== 'offline' && (
                <span className="bg-secondary px-3 py-1 text-secondary-foreground">bus full · driver reported</span>
              )}
            </div>
          </div>

          <StateTile status={status} feed={feed} receivedAt={receivedAt} />
          {/* The one live region: its text changes only when the state word changes, never with the age. */}
          <p className="sr-only" role="status">
            {feed ? `bus ${shortBusNumber(activeRoute.busNumber)}: ${stampFor(status).label}` : ''}
          </p>
          <p className="-mt-3 text-muted-foreground">{stampFor(status).hint}</p>
          {pinNeeded && pinned && (
            <p className="text-muted-foreground">showing the route this trip started with (v{pinnedVersion}). the updated route applies from the next trip.</p>
          )}
          {pinNeeded && pinError && <p className="text-destructive">could not load the route this trip started with — showing the current route. {pinError}</p>}
          {feedError && <p className="text-destructive">tracker unreachable — showing the last state. {feedError}</p>}

          <div className="flex flex-col gap-2">
            <div className="@container relative h-[30vh] min-h-56 w-full lg:h-[52vh]">
              <MapView
                stops={orderedStops}
                pathData={activeRoute.pathData ?? []}
                busLocation={showBusOnMap ? feed?.location : undefined}
                busStatus={status}
                interactive
                viewerLocation={viewer.location}
              />
              {/* Opt-in only: nothing asks for the phone's location until this tile is pressed. */}
              <TileButton
                tone={viewer.location ? 'blue' : 'outline'}
                onClick={locateMe}
                disabled={viewer.busy}
                aria-pressed={!!viewer.location}
                className="absolute right-3 top-3 z-[500] min-h-12 py-2"
              >
                <LocateFixed className="h-6 w-6" strokeWidth={1.5} aria-hidden />
                {/* Icon-only when the map is under 15rem wide (a 360 px phone at 200 % text), so the tile never covers the zoom control. */}
                <span className="@max-[15rem]:sr-only">{viewer.busy ? 'finding you' : viewer.location ? 'showing you' : 'my location'}</span>
              </TileButton>
            </div>
            {viewer.error && <p className="text-destructive">{viewer.error}</p>}
          </div>

          <section className="flex flex-col gap-2 lg:gap-4" aria-labelledby="stops-heading">
            <Headline as="h2" size="section" className="text-[2rem] lg:pt-2">
              <span id="stops-heading">stops</span>
            </Headline>
            {activeRoute.stops.length === 0 ? (
              <p className="text-muted-foreground">no stops recorded for this route yet.</p>
            ) : (
              <ol className="flex flex-col">
                {orderedStops.map((stop, index) => (
                  <li key={index} className="flex items-baseline gap-5 border-t-2 border-border/50 py-4 first:border-t-0">
                    <span className="w-10 shrink-0 text-[1.75rem] font-light tabular-nums text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0 text-[1.5rem] font-light leading-tight [overflow-wrap:anywhere]">
                      {stop.name?.trim() || `${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      ) : (
        <div className="hidden flex-1 lg:block" aria-hidden />
      )}
    </div>
    </div>
  );
}
