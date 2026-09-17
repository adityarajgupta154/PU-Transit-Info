import { describe, expect, it } from 'vitest';
import { followEndpoints } from './route-draft';

const depot = { lat: 22.3072, lng: 73.3987, name: 'Waghodia Bus Depot' };
const campus = { lat: 22.2887, lng: 73.3638, name: 'Parul University' };
const gotri = { lat: 22.32, lng: 73.14, name: 'Gotri' };

describe('followEndpoints', () => {
  it('fills empty labels from the first and last stop, and a single stop is both', () => {
    expect(followEndpoints({ origin: '', destination: '', stops: [] }, [depot])).toEqual({ origin: 'Waghodia Bus Depot', destination: 'Waghodia Bus Depot' });
    expect(followEndpoints({ origin: 'Waghodia Bus Depot', destination: 'Waghodia Bus Depot', stops: [depot] }, [depot, campus])).toEqual({
      origin: 'Waghodia Bus Depot',
      destination: 'Parul University',
    });
  });

  it('follows reorders, removals and renames while the labels are still the copied stop names', () => {
    const previous = { origin: 'Waghodia Bus Depot', destination: 'Parul University', stops: [depot, gotri, campus] };
    expect(followEndpoints(previous, [campus, gotri, depot])).toEqual({ origin: 'Parul University', destination: 'Waghodia Bus Depot' });
    expect(followEndpoints(previous, [gotri, campus])).toEqual({ origin: 'Gotri', destination: 'Parul University' });
    expect(followEndpoints(previous, [{ ...depot, name: 'Waghodia depot gate' }, gotri, campus])).toEqual({
      origin: 'Waghodia depot gate',
      destination: 'Parul University',
    });
    expect(followEndpoints(previous, [])).toEqual({ origin: '', destination: '' });
  });

  it('keeps a label the admin wrote by hand', () => {
    const previous = { origin: 'Waghodia', destination: 'Parul University', stops: [depot, campus] };
    expect(followEndpoints(previous, [gotri, depot, campus])).toEqual({ origin: 'Waghodia', destination: 'Parul University' });
    expect(followEndpoints(previous, [campus, depot])).toEqual({ origin: 'Waghodia', destination: 'Waghodia Bus Depot' });
  });

  it('treats a stop without a name as an empty label', () => {
    expect(followEndpoints({ origin: '', destination: '', stops: [] }, [{ lat: 22.3, lng: 73.2 }])).toEqual({ origin: '', destination: '' });
  });
});
