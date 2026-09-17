import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { VectorBasemap } from './vector-basemap';

// Fix Leaflet's default icon path issues
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
import { mapConfig } from '@/lib/map-config';

delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
});

const PU_LOCATION: [number, number] = [22.2887, 73.3634]; // Parul University coordinates
const VADODARA_CENTER: [number, number] = mapConfig.defaultCenter;
const VADODARA_BOUNDS = L.latLngBounds(
  [mapConfig.vadodaraBounds.south, mapConfig.vadodaraBounds.west],
  [mapConfig.vadodaraBounds.north, mapConfig.vadodaraBounds.east],
);
const EMPTY_VIEW = L.latLngBounds([VADODARA_CENTER, PU_LOCATION]);
const ROAD_PATH_STYLE: L.PathOptions = { color: '#0A76D6', weight: 4, opacity: 0.85, dashArray: undefined }; // the explicit undefined clears a dash set earlier
const STRAIGHT_LINE_STYLE: L.PathOptions = { ...ROAD_PATH_STYLE, dashArray: '8, 8' };
// Top padding clears the zoom bar and the "expand map" / "my location" tiles that sit over the map.
const FIT_PADDING: L.FitBoundsOptions = { paddingTopLeft: [72, 88], paddingBottomRight: [32, 40], animate: false };

// Together with maxBounds on the container this keeps the whole viewport inside Vadodara:
// no panning past the city, and no zooming out far enough to see beyond it.
function LockToVadodara() {
  const map = useMap();

  useEffect(() => {
    const applyMinZoom = () => {
      map.setMinZoom(0); // getBoundsZoom clamps to the current minimum, so start unconstrained
      map.setMinZoom(map.getBoundsZoom(VADODARA_BOUNDS, true));
    };
    applyMinZoom();
    map.on('resize', applyMinZoom);
    // Leaflet only notices window resizes; this also covers a container that changes size or becomes visible.
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(map.getContainer());
    return () => {
      observer.disconnect();
      map.off('resize', applyMinZoom);
    };
  }, [map]);

  return null;
}

/**
 * Frames the route (and the bus, if known) once per route. Re-fits only when the set of stops
 * changes, so a moving bus or a user pan is never yanked back.
 */
function FitToRoute({
  stops,
  busLocation,
}: {
  stops: { lat: number; lng: number }[];
  busLocation?: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  const routeKey = stops.map((s) => `${s.lat},${s.lng}`).join('|');
  const firstBus = useRef(busLocation);
  firstBus.current = busLocation;

  useEffect(() => {
    if (!routeKey) {
      // Nothing to frame yet: show the city and the campus together so the campus mark is in view.
      if (!firstBus.current) map.fitBounds(EMPTY_VIEW, { ...FIT_PADDING, paddingBottomRight: [72, 72] }); // room for the campus stamp
      return;
    }
    const points = stops.map((s) => L.latLng(s.lat, s.lng));
    if (firstBus.current) points.push(L.latLng(firstBus.current.lat, firstBus.current.lng));
    if (points.length === 1) {
      map.setView(points[0], mapConfig.defaultZoom, { animate: false });
      return;
    }
    map.fitBounds(L.latLngBounds(points), FIT_PADDING);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- routeKey is the identity of `stops`
  }, [map, routeKey]);

  return null;
}

interface MapViewProps {
  stops?: { lat: number; lng: number; name?: string }[];
  pathData?: { lat: number; lng: number }[];
  busLocation?: { lat: number; lng: number } | null;
  busStatus?: string | null;
  interactive?: boolean;
  onMapClick?: (latlng: { lat: number; lng: number }) => void;
  /** The rider's own position; only ever set after they pressed "my location". */
  viewerLocation?: { lat: number; lng: number } | null;
}

/** Leaflet's container is a tab stop (arrow keys pan); give it a name instead of its whole text content. */
function NameContainer() {
  const map = useMap();
  useEffect(() => {
    map.getContainer().setAttribute('role', 'region');
    map.getContainer().setAttribute('aria-label', 'route map');
  }, [map]);
  return null;
}

function MapEvents({ onClick }: { onClick?: (latlng: { lat: number; lng: number }) => void }) {
  const map = useMap();
  
  useEffect(() => {
    if (!onClick) return;
    const handleClick = (e: L.LeafletMouseEvent) => {
      onClick(e.latlng);
    };
    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [map, onClick]);
  
  return null;
}

const BUS_GLYPH =
  '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>';

// Map stamps follow the tile tones: blue square = live bus, ink-outlined = last known, numbered ink squares = stops.
const busIconFor = (isLive: boolean) =>
  L.divIcon({
    className: 'bg-transparent border-none',
    html: `<div class="${isLive ? 'bg-primary text-primary-foreground' : 'bg-white text-foreground border-2 border-foreground'} flex items-center justify-center w-11 h-11">${BUS_GLYPH}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });

const stopIconFor = (index: number) =>
  L.divIcon({
    className: 'bg-transparent border-none',
    html: `<div class="w-6 h-6 bg-foreground text-background text-[13px] leading-none font-medium flex items-center justify-center tabular-nums">${index + 1}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });

const viewerIcon = L.divIcon({
  className: 'bg-transparent border-none',
  html: `<div class="w-5 h-5 bg-white border-4 border-foreground outline outline-2 outline-white"></div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

// The campus stamp: the round PU badge (the app's identity asset, at its 36px band size) centred on the
// campus, name beneath it. Not interactive, so a tap here still adds a stop at that point.
const LOGO_SRC = `${import.meta.env.BASE_URL}logo.png`;
const puIcon = L.divIcon({
  className: 'bg-transparent border-none',
  html: `<div class="flex w-28 flex-col items-center gap-1"><img src="${LOGO_SRC}" alt="" width="36" height="36" draggable="false" class="h-9 w-9 shrink-0 rounded-full bg-white outline outline-2 outline-white" /><span class="bg-foreground text-background px-2 py-1 text-[11px] font-medium whitespace-nowrap">Parul University</span></div>`,
  iconSize: [112, 64],
  iconAnchor: [56, 18], // the centre of the badge, not of the box, sits on the campus
});

export function MapView({ stops = [], pathData = [], busLocation, busStatus, interactive = true, onMapClick, viewerLocation = null }: MapViewProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="w-full h-full bg-foreground/10 flex items-center justify-center text-foreground">loading map</div>;
  }

  const isLive = busStatus === 'live' || busStatus === 'acquiring';
  const busIcon = busIconFor(isLive);
  const roadPath = pathData.length > 0;

  const center = stops.length > 0 ? [stops[0].lat, stops[0].lng] as [number, number] : VADODARA_CENTER;
  
  // Either use detailed pathData (from ORS) or straight lines between stops
  const polylinePositions = pathData.length > 0 
        ? pathData.map(p => [p.lat, p.lng] as [number, number])
        : stops.map(s => [s.lat, s.lng] as [number, number]);

  return (
    <div className="w-full h-full relative z-0">
      <MapContainer 
        center={center} 
        zoom={mapConfig.defaultZoom} 
        maxBounds={VADODARA_BOUNDS}
        maxBoundsViscosity={1}
        style={{ width: '100%', height: '100%' }}
        zoomControl={interactive}
        dragging={interactive}
        scrollWheelZoom={interactive}
        doubleClickZoom={interactive}
      >
        <LockToVadodara />
        <NameContainer />
        <VectorBasemap />
        <FitToRoute stops={stops} busLocation={busLocation} />
        
        {interactive && onMapClick && <MapEvents onClick={onMapClick} />}

        {/* Campus label, unless a numbered stop already sits on or beside the campus (it is about a kilometre across) */}
        {!stops.some((s) => Math.abs(s.lat - PU_LOCATION[0]) < 0.008 && Math.abs(s.lng - PU_LOCATION[1]) < 0.008) && (
          <Marker position={PU_LOCATION} icon={puIcon} keyboard={false} interactive={false} />
        )}
        
        {viewerLocation && (
          <Marker position={[viewerLocation.lat, viewerLocation.lng]} icon={viewerIcon} keyboard={false}>
            <Popup className="font-sans"><strong>you are here</strong></Popup>
          </Marker>
        )}

        {/* Markers are not tab stops (keyboard={false}): the stops list under the map carries the same information. */}
        {stops.map((stop, i) => (
          <Marker key={i} position={[stop.lat, stop.lng]} icon={stopIconFor(i)} keyboard={false}>
            {stop.name && (
              <Popup className="font-sans">
                <strong>{i + 1}. {stop.name}</strong>
              </Popup>
            )}
          </Marker>
        ))}

        {/* pathOptions, not style props: react-leaflet only restyles a live layer through pathOptions, so a
            plotted road path replacing the dashed straight lines would otherwise stay dashed. */}
        {polylinePositions.length > 1 && (
          <Polyline positions={polylinePositions} pathOptions={roadPath ? ROAD_PATH_STYLE : STRAIGHT_LINE_STYLE} />
        )}

        {busLocation && (
          <Marker position={[busLocation.lat, busLocation.lng]} icon={busIcon} keyboard={false}>
            <Popup className="font-sans">
              <strong>{isLive ? 'live position' : 'last known position'}</strong>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
