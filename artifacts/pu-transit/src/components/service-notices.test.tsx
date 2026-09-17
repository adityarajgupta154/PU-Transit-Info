import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { ServiceNotices } from './service-notices';

vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: { uid: 'student' } }) }));
vi.mock('@/lib/storage', () => ({ storage: {} }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [
      { id: 'global', text: 'Campus gate changed', routeId: '', until: 100_000 },
      { id: 'a', text: 'Route A delayed', routeId: 'a', until: 100_000 },
      { id: 'b', text: 'Route B delayed', routeId: 'b', until: 100_000 },
      { id: 'old', text: 'Expired notice', routeId: '', until: 1 },
    ],
    error: null, isPending: false,
  }),
}));
afterEach(() => vi.useRealTimers());

it('shows global and selected-route notices only, and drops them at expiry', () => {
  vi.useFakeTimers().setSystemTime(50_000);
  const page = renderToStaticMarkup(<ServiceNotices routeId="a" />);
  expect(page).toContain('Campus gate changed');
  expect(page).toContain('Route A delayed');
  expect(page).not.toContain('Route B delayed');
  expect(page).not.toContain('Expired notice');
  expect(renderToStaticMarkup(<ServiceNotices />)).not.toContain('Route A delayed');
  vi.setSystemTime(100_000);
  expect(renderToStaticMarkup(<ServiceNotices routeId="a" />)).toBe('');
});