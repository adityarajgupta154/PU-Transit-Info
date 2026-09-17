import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { NoServiceToday } from './no-service-today';
import { serviceDateLabel, serviceDateToday } from '@/lib/service-date';

const testState = vi.hoisted(() => ({ data: [] as unknown[], error: null as unknown }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { uid: 'student' } }) }));
vi.mock('@/lib/storage', () => ({ storage: {} }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: testState.data, error: testState.error }) }));
afterEach(() => {
  vi.useRealTimers();
  testState.data = [];
  testState.error = null;
});

it("IST day boundary: 23:59 IST on 8 Nov is still 8 Nov, and 00:30 IST is 9 Nov even though UTC is still 8 Nov", () => {
  expect(serviceDateToday(Date.UTC(2026, 10, 8, 18, 29))).toBe('2026-11-08');
  expect(serviceDateToday(Date.UTC(2026, 10, 8, 19, 0))).toBe('2026-11-09');
  expect(serviceDateLabel('2026-11-08')).toBe('Sun, 8 Nov');
});

it("shows the office's reason only on the marked IST date; otherwise, and on error, renders nothing", () => {
  vi.useFakeTimers().setSystemTime(Date.UTC(2026, 10, 8, 18, 29)); // 23:59 IST, 8 Nov
  testState.data = [
    { date: '2026-11-08', noService: true, note: 'Diwali holiday', updatedBy: 'admin', updatedAt: 1 },
    { date: '2026-11-09', noService: true, updatedBy: 'admin', updatedAt: 1 },
  ];
  const page = renderToStaticMarkup(<NoServiceToday />);
  expect(page).toContain('no bus service today');
  expect(page).toContain('Diwali holiday');
  expect(page).toContain('Sun, 8 Nov');

  vi.setSystemTime(Date.UTC(2026, 10, 9, 19, 0)); // 00:30 IST, 10 Nov: nothing marked → nothing claimed
  expect(renderToStaticMarkup(<NoServiceToday />)).toBe('');

  vi.setSystemTime(Date.UTC(2026, 10, 8, 19, 0)); // 00:30 IST, 9 Nov: marked without a note
  const bare = renderToStaticMarkup(<NoServiceToday />);
  expect(bare).toContain('no bus service today');
  expect(bare).not.toContain('Diwali');

  // the admin removed today's entry but the refetch failed: the cached copy must not keep the claim alive
  testState.error = new Error('offline');
  expect(renderToStaticMarkup(<NoServiceToday />)).toBe('');
});
