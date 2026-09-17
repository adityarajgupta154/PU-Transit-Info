import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { mapConfig } from '@/lib/map-config';

// MapLibre 6 ships its worker as a sibling file and resolves it from import.meta.url, which points
// into Vite's pre-bundled deps folder (dev) or a hashed chunk (build) where the file does not exist.
setWorkerUrl(maplibreWorkerUrl);

const VECTOR_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const RASTER_FALLBACK_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const RASTER_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

// MapLibre GL v6 needs WebGL2; adding it without one throws mid-add and leaves Leaflet with a broken layer.
function supportsWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

/**
 * Vector basemap rendered by MapLibre GL inside the Leaflet map, so existing
 * Leaflet markers, polylines and click handling keep working unchanged.
 * Devices without WebGL2 get raster OpenStreetMap tiles instead.
 */
export function VectorBasemap() {
  const map = useMap();

  useEffect(() => {
    const layer: L.Layer = supportsWebGL2()
      ? maplibreGL({
          style: mapConfig.basemapStyleUrl,
          attributionControl: { customAttribution: VECTOR_ATTRIBUTION },
        })
      : L.tileLayer(RASTER_FALLBACK_URL, { attribution: RASTER_ATTRIBUTION, maxZoom: 19 });
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map]);

  return null;
}
