import { describe, expect, it } from 'vitest';
import { busNumberMatches, normalizeBusNumber, shortBusNumber } from './shifts';

describe('bus numbers', () => {
  it('normalizes plates regardless of spacing, dashes and case', () => {
    expect(normalizeBusNumber(' gj 06-bx 1414 ')).toBe('GJ06BX1414');
    expect(busNumberMatches('GJ 06 BX 1414', '1414')).toBe(true);
    expect(busNumberMatches('GJ 06 BX 1414', 'bx14')).toBe(true);
    expect(busNumberMatches('GJ 06 BX 1414', '')).toBe(false);
  });

  it('shortens a registration to its trailing digit group', () => {
    expect(shortBusNumber('GJ 06 BX 1414')).toBe('1414');
    expect(shortBusNumber('GJ06BX0042')).toBe('0042');
  });

  it('leaves short or digit-less numbers alone', () => {
    expect(shortBusNumber('14')).toBe('14');
    expect(shortBusNumber('PU-14')).toBe('PU-14');
    expect(shortBusNumber('CAMPUS SHUTTLE')).toBe('CAMPUS SHUTTLE');
  });
});
