import type { GeoDirectionsResult, GeoGeocodeResult, GeoPlace, GeoPoint } from '@workspace/api-client-react';
import { fetchWithAuth } from './api';
import { inVadodara } from './coordinates';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isGeoPoint(value: unknown): value is GeoPoint {
    return isRecord(value) &&
        typeof value.lat === 'number' &&
        Number.isFinite(value.lat) &&
        typeof value.lng === 'number' &&
        Number.isFinite(value.lng);
}

function isGeoPlace(value: unknown): value is GeoPlace {
    return isRecord(value) &&
        isGeoPoint(value) &&
        typeof value.name === 'string' &&
        value.name.length > 0 &&
        typeof value.detail === 'string';
}

function isGeocodeResult(value: unknown): value is GeoGeocodeResult {
    return isRecord(value) && Array.isArray(value.places) && value.places.every(isGeoPlace);
}

function isDirectionsResult(value: unknown): value is GeoDirectionsResult {
    return isRecord(value) &&
        Array.isArray(value.path) &&
        value.path.length > 0 &&
        value.path.every(isGeoPoint);
}

export type Place = { name: string; detail: string; lat: number; lng: number };

/**
 * Vadodara place suggestions for what the admin has typed so far, best match first.
 * Empty when nothing in the city matches. The server boxes the search to Vadodara; the check here only
 * guards against a stale or misbehaving proxy so a stop can never land outside the map.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
    const data: unknown = await fetchWithAuth('/api/geo/geocode', {
        method: 'POST',
        body: JSON.stringify({ query }),
        signal,
    });

    if (!isGeocodeResult(data)) {
        throw new Error('Place search returned a malformed response.');
    }
    return data.places.filter(inVadodara).map(({ name, detail, lat, lng }) => ({ name, detail, lat, lng }));
}

/** Road path through every waypoint in order (first = start, last = end), so each leg is routed (RTE-01). */
export async function getRouteFromORS(waypoints: GeoPoint[]): Promise<{ lat: number; lng: number }[]> {
    if (waypoints.length < 2) throw new Error('At least two stops are needed to plot a road path.');
    if (waypoints.length > 50) throw new Error('A road path can be plotted through at most 50 stops.');
    const points = waypoints.map(({ lat, lng }) => ({ lat, lng }));
    const data: unknown = await fetchWithAuth('/api/geo/directions', {
        method: 'POST',
        body: JSON.stringify({
            start: points[0],
            end: points[points.length - 1],
            via: points.slice(1, -1),
        }),
    });

    if (!isDirectionsResult(data)) {
        throw new Error('Directions API returned no directions.');
    }
    return data.path.map(({ lat, lng }) => ({ lat, lng }));
}
