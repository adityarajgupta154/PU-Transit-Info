export type GeoPoint = { lat: number; lng: number };
/** One place suggestion: a short name, a distinguishing area (may be empty) and its point. */
export type GeoPlace = GeoPoint & { name: string; detail: string };

export const VADODARA_BOUNDS = {
  south: 22.15,
  north: 22.45,
  west: 72.95,
  east: 73.4,
} as const;
/** Where the geocoder ranks from: central Vadodara (the map's default centre). */
const VADODARA_FOCUS = { lat: 22.3072, lng: 73.1812 } as const;

// Pelias autocomplete (partial words, ranked by the focus point) rather than /search:
// the admin sees suggestions while typing, and the rect boundary keeps them inside Vadodara.
const ORS_AUTOCOMPLETE_URL = "https://api.openrouteservice.org/geocode/autocomplete";
// Places an admin would name a stop after; countries, regions and postal codes are never stops.
const PLACE_LAYERS = "venue,address,street,locality,localadmin,borough,neighbourhood";
const MAX_PLACES = 8;
const MAX_PLACE_TEXT = 120;
const ORS_DIRECTIONS_URL =
  "https://api.openrouteservice.org/v2/directions/driving-car/geojson";
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_PROVIDER_BODY_BYTES = 2 * 1024 * 1024;
const MAX_PATH_POINTS = 5_000;

export type OrsErrorCategory =
  | "not_configured"
  | "provider_http"
  | "invalid_response"
  | "response_too_large"
  | "network"
  | "timeout";

export class OrsError extends Error {
  constructor(
    readonly category: OrsErrorCategory,
    readonly status?: number,
  ) {
    super(`OpenRouteService ${category}`);
    this.name = "OrsError";
  }
}

function apiKey(): string {
  const value = process.env.ORS_API_KEY?.trim();
  if (!value) throw new OrsError("not_configured");
  return value;
}

function inVadodara(point: GeoPoint): boolean {
  return (
    point.lat >= VADODARA_BOUNDS.south &&
    point.lat <= VADODARA_BOUNDS.north &&
    point.lng >= VADODARA_BOUNDS.west &&
    point.lng <= VADODARA_BOUNDS.east
  );
}

function pointFromCoordinates(value: unknown): GeoPoint | null {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    typeof value[0] !== "number" ||
    typeof value[1] !== "number" ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1])
  ) {
    return null;
  }
  return { lat: value[1], lng: value[0] };
}

async function readResponseBody(
  response: Response,
  controller: AbortController,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROVIDER_BODY_BYTES) {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        throw new OrsError("response_too_large", response.status);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size).toString("utf8");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const key = apiKey();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: key,
        },
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new OrsError(timedOut ? "timeout" : "network");
    }

    let body: string;
    try {
      body = await readResponseBody(response, controller);
    } catch (error) {
      if (error instanceof OrsError) throw error;
      throw new OrsError(timedOut ? "timeout" : "network");
    }

    if (Buffer.byteLength(body, "utf8") > MAX_PROVIDER_BODY_BYTES) {
      throw new OrsError("response_too_large", response.status);
    }
    if (!response.ok) {
      throw new OrsError("provider_http", response.status);
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new OrsError("invalid_response", response.status);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_PLACE_TEXT) : "";
}

/** Builds one suggestion from a Pelias feature; null when it has no usable name or lies outside Vadodara. */
function placeFromFeature(feature: unknown): GeoPlace | null {
  const object = objectOf(feature);
  const geometry = object ? objectOf(object.geometry) : null;
  if (!object || !geometry || geometry.type !== "Point") {
    throw new OrsError("invalid_response");
  }
  const point = pointFromCoordinates(geometry.coordinates);
  if (!point) throw new OrsError("invalid_response");
  if (!inVadodara(point)) return null;

  const properties = objectOf(object.properties) ?? {};
  const name = text(properties.name) || text(properties.label);
  if (!name) return null;
  // The area that tells two same-named places apart: neighbourhood, then locality (or county), minus the name itself.
  const detail = [text(properties.neighbourhood), text(properties.locality) || text(properties.county)]
    .filter((part, index, parts) => part && part !== name && parts.indexOf(part) === index)
    .join(", ")
    .slice(0, MAX_PLACE_TEXT);
  return { name, detail, lat: point.lat, lng: point.lng };
}

/** Vadodara place suggestions for a partial query, best match first. Empty when nothing in the city matches. */
export async function searchPlaces(query: string): Promise<GeoPlace[]> {
  const url = new URL(ORS_AUTOCOMPLETE_URL);
  url.searchParams.set("text", query);
  url.searchParams.set("size", String(MAX_PLACES));
  url.searchParams.set("layers", PLACE_LAYERS);
  url.searchParams.set("boundary.country", "IN");
  url.searchParams.set("boundary.rect.min_lat", String(VADODARA_BOUNDS.south));
  url.searchParams.set("boundary.rect.min_lon", String(VADODARA_BOUNDS.west));
  url.searchParams.set("boundary.rect.max_lat", String(VADODARA_BOUNDS.north));
  url.searchParams.set("boundary.rect.max_lon", String(VADODARA_BOUNDS.east));
  url.searchParams.set("focus.point.lat", String(VADODARA_FOCUS.lat));
  url.searchParams.set("focus.point.lon", String(VADODARA_FOCUS.lng));

  const data = objectOf(await requestJson(url.toString()));
  const features = data?.features;
  if (!Array.isArray(features)) throw new OrsError("invalid_response");

  const places: GeoPlace[] = [];
  for (const feature of features) {
    const place = placeFromFeature(feature);
    if (!place) continue;
    // Pelias can return the same venue from two sources; one entry per name and point is enough.
    if (places.some((seen) => seen.name === place.name && seen.lat === place.lat && seen.lng === place.lng)) continue;
    places.push(place);
    if (places.length === MAX_PLACES) break;
  }
  return places;
}

export async function getGeoDirections(
  start: GeoPoint,
  end: GeoPoint,
  via: GeoPoint[] = [],
): Promise<GeoPoint[]> {
  const data = await requestJson(ORS_DIRECTIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      coordinates: [start, ...via, end].map((point) => [point.lng, point.lat]),
    }),
  });

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new OrsError("invalid_response");
  }
  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features) || features.length === 0) {
    throw new OrsError("invalid_response");
  }
  const first = features[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    throw new OrsError("invalid_response");
  }
  const geometry = (first as { geometry?: unknown }).geometry;
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) {
    throw new OrsError("invalid_response");
  }
  if ((geometry as { type?: unknown }).type !== "LineString") {
    throw new OrsError("invalid_response");
  }
  const coordinates = (geometry as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0 || coordinates.length > MAX_PATH_POINTS) {
    throw new OrsError(
      coordinates && Array.isArray(coordinates) && coordinates.length > MAX_PATH_POINTS
        ? "response_too_large"
        : "invalid_response",
    );
  }

  const path: GeoPoint[] = [];
  for (const coordinate of coordinates) {
    const point = pointFromCoordinates(coordinate);
    if (!point || !inVadodara(point)) throw new OrsError("invalid_response");
    path.push(point);
  }
  return path;
}