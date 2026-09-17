import { mapConfig } from './map-config';

export type LatLng = { lat: number; lng: number };

const bounds = mapConfig.vadodaraBounds;

export function inVadodara({ lat, lng }: LatLng): boolean {
  return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;
}

/** "22.28875, 73.36384" — five decimals is about a metre, enough to place a stop exactly. */
export function formatCoordinates({ lat, lng }: LatLng): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

const NUMBER = '[-+]?\\d{1,3}(?:\\.\\d+)?';
// "22.2887, 73.3634" · "22.2887 73.3634" · "22.2887° N, 73.3634° E" · "22.2887N 73.3634E"
const DECIMAL_PAIR = new RegExp(`^(${NUMBER})\\s*°?\\s*([NSEW])?(?:\\s*[,;/]\\s*|\\s+)(${NUMBER})\\s*°?\\s*([NSEW])?$`, 'i');
// Google Maps links: ".../@22.2887,73.3634,17z", "?q=22.2887,73.3634", "ll=", "query=", "destination=", "geo:22.2887,73.3634"
const LINK_PAIR = new RegExp(`(?:@|geo:|[?&](?:q|ll|query|center|destination|daddr|saddr|sll)=)(${NUMBER})\\s*,\\s*(${NUMBER})`, 'i');
// 22°17'19.3"N 73°21'48.2"E — what Google Maps shows in a place panel.
const DMS = /(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)?\s*["″]?\s*([NSEW])/gi;

/** Copied links often carry "%2C" for the comma between the two numbers. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function finitePair(a: string, b: string): [number, number] | null {
  const first = Number(a);
  const second = Number(b);
  return Number.isFinite(first) && Number.isFinite(second) ? [first, second] : null;
}

function orient(
  first: number,
  second: number,
  firstLetter?: string,
  secondLetter?: string,
  { guessOrder = false } = {},
): LatLng | null {
  const letters = `${firstLetter ?? ''}${secondLetter ?? ''}`.toUpperCase();
  let lat = first;
  let lng = second;
  if (/^[EW]/.test(letters) || /[NS]$/.test(letters)) {
    // Letters say the pair was written longitude first.
    [lat, lng] = [second, first];
  } else if (guessOrder && !letters && !inVadodara({ lat, lng }) && inVadodara({ lat: second, lng: first })) {
    // A bare pair with no letters where only the swapped order lands in the city: the admin pasted lng, lat.
    // Links and DMS are latitude-first by definition, so they are never swapped — an outside point stays outside.
    [lat, lng] = [second, first];
  }
  if (/S/.test(letters)) lat = -Math.abs(lat);
  if (/W/.test(letters)) lng = -Math.abs(lng);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Reads a coordinate pair typed or pasted into the stop search: decimal degrees in either order, with or
 * without degree signs and N/E letters, a degrees-minutes-seconds pair, or a Google Maps link.
 * Returns null when the text is not a coordinate pair at all (it is then treated as a place name).
 * The caller checks `inVadodara` — a pair outside the city is a real answer, not "not coordinates".
 */
export function parseCoordinates(text: string): LatLng | null {
  const input = text.trim();
  if (!input) return null;

  const link = LINK_PAIR.exec(decoded(input));
  if (link) {
    const pair = finitePair(link[1], link[2]);
    return pair ? orient(pair[0], pair[1]) : null;
  }

  const dms = Array.from(input.matchAll(DMS));
  if (dms.length === 2) {
    const values = dms.map((part) => {
      const degrees = Number(part[1]) + Number(part[2]) / 60 + Number(part[3] ?? 0) / 3600;
      return { degrees, letter: part[4].toUpperCase() };
    });
    const lat = values.find((v) => v.letter === 'N' || v.letter === 'S');
    const lng = values.find((v) => v.letter === 'E' || v.letter === 'W');
    if (!lat || !lng) return null;
    return orient(lat.degrees, lng.degrees, lat.letter, lng.letter);
  }

  // "lat: 22.28, lng: 73.36" and "lat 22.28 long 73.36" are the same pair.
  const bare = input.replace(/\b(?:lat(?:itude)?|l(?:o)?ng(?:itude)?|lon)\b\s*[:=]?/gi, ' ').trim();
  const match = DECIMAL_PAIR.exec(bare);
  if (!match) return null;
  const pair = finitePair(match[1], match[3]);
  return pair ? orient(pair[0], pair[1], match[2], match[4], { guessOrder: true }) : null;
}
