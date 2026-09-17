/** The three university shifts. `value` is the stored string; `label` is the tile word. */
export const SHIFTS = [
  { value: 'First Shift', label: 'first shift' },
  { value: 'ADM / Medical Shift', label: 'adm / medical' },
  { value: 'General Shift', label: 'general shift' },
] as const;

export function shiftLabel(value: string): string {
  return SHIFTS.find((s) => s.value === value)?.label ?? value.toLowerCase();
}

/** "gj 06 xx-1234" and "GJ06XX1234" are the same plate. */
export function normalizeBusNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function busNumberMatches(busNumber: string, query: string): boolean {
  const needle = normalizeBusNumber(query);
  return needle.length > 0 && normalizeBusNumber(busNumber).includes(needle);
}

/**
 * The name riders use at a glance: the trailing digit group of a registration
 * ("GJ 06 BX 1414" → "1414"). Short or digit-less numbers are already the name.
 */
export function shortBusNumber(busNumber: string): string {
  const trimmed = busNumber.trim();
  const match = /(\d{2,})\s*$/.exec(trimmed);
  if (!match || normalizeBusNumber(trimmed).length <= 6) return trimmed;
  return match[1];
}
