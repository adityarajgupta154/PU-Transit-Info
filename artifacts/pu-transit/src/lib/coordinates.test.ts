import { describe, expect, it } from 'vitest';
import { formatCoordinates, inVadodara, parseCoordinates } from './coordinates';

const campus = { lat: 22.2887, lng: 73.3634 };

describe('parseCoordinates', () => {
  it('reads decimal pairs in every common spelling', () => {
    for (const text of [
      '22.2887, 73.3634',
      '22.2887,73.3634',
      '22.2887 73.3634',
      '22.2887; 73.3634',
      '  22.2887 / 73.3634  ',
      '22.2887° N, 73.3634° E',
      '22.2887N 73.3634E',
      '22.2887 n, 73.3634 e',
      'lat: 22.2887, lng: 73.3634',
      'Latitude 22.2887 Longitude 73.3634',
      'lat=22.2887 lon=73.3634',
    ]) {
      expect(parseCoordinates(text), text).toEqual(campus);
    }
  });

  it('accepts a pair written longitude first when only that order lands in Vadodara, or when the letters say so', () => {
    expect(parseCoordinates('73.3634, 22.2887')).toEqual(campus);
    expect(parseCoordinates('73.3634° E, 22.2887° N')).toEqual(campus);
    expect(parseCoordinates('73.3634E 22.2887N')).toEqual(campus);
  });

  it('never reorders a link or geo URI: their order is defined, so a point outside stays outside', () => {
    // Swapping would silently move this (a point in the Arabian Sea, off no Vadodara road) onto the campus.
    expect(parseCoordinates('https://www.google.com/maps/@73.3634,22.2887,17z')).toEqual({ lat: 73.3634, lng: 22.2887 });
    expect(parseCoordinates('geo:73.3634,22.2887')).toEqual({ lat: 73.3634, lng: 22.2887 });
  });

  it('reads the point out of a Google Maps link or geo URI', () => {
    expect(parseCoordinates('https://www.google.com/maps/place/Parul+University/@22.2887,73.3634,17z/data=!3m1!4b1')).toEqual(campus);
    expect(parseCoordinates('https://www.google.com/maps?q=22.2887,73.3634')).toEqual(campus);
    expect(parseCoordinates('https://maps.google.com/?ll=22.2887,73.3634&z=16')).toEqual(campus);
    expect(parseCoordinates('https://www.google.com/maps/search/?api=1&query=22.2887%2C73.3634')).toEqual(campus);
    expect(parseCoordinates('https://www.google.com/maps/dir/?api=1&destination=22.2887,73.3634')).toEqual(campus);
    expect(parseCoordinates('geo:22.2887,73.3634')).toEqual(campus);
  });

  it('reads degrees, minutes and seconds in either order', () => {
    const dms = parseCoordinates(`22°17'19.3"N 73°21'48.2"E`);
    expect(dms?.lat).toBeCloseTo(22.28869, 4);
    expect(dms?.lng).toBeCloseTo(73.36339, 4);
    const swapped = parseCoordinates(`73°21'48.2"E 22°17'19.3"N`);
    expect(swapped?.lat).toBeCloseTo(22.28869, 4);
    expect(swapped?.lng).toBeCloseTo(73.36339, 4);
    expect(parseCoordinates(`22°17′19″N 73°21′48″E`)?.lat).toBeCloseTo(22.28861, 4);
  });

  it('keeps a pair outside the city as a pair, so the form can say it is out of bounds', () => {
    expect(parseCoordinates('28.6139, 77.2090')).toEqual({ lat: 28.6139, lng: 77.209 });
    expect(parseCoordinates('22.28S 73.36W')).toEqual({ lat: -22.28, lng: -73.36 });
    expect(inVadodara({ lat: 28.6139, lng: 77.209 })).toBe(false);
    expect(inVadodara(campus)).toBe(true);
  });

  it('treats anything else as a place name', () => {
    for (const text of ['', '   ', 'Waghodia', 'Sector 22, Gotri', '12 Alkapuri', '22.28', '91.5, 73.3', '22.28, 181', 'stop 1 2', 'https://www.google.com/maps/place/Parul+University']) {
      expect(parseCoordinates(text), text).toBeNull();
    }
  });
});

describe('formatCoordinates', () => {
  it('prints five decimals in lat, lng order', () => {
    expect(formatCoordinates({ lat: 22.288749, lng: 73.3634 })).toBe('22.28875, 73.36340');
  });
});
