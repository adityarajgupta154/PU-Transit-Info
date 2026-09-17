import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './auth-gate';
import { useAuth } from '@/contexts/auth-context';

const DAY_MS = 24 * 60 * 60 * 1000;

// React 19 only flushes timer-driven updates inside act when this test flag is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/contexts/auth-context', () => ({ useAuth: vi.fn() }));
vi.mock('lucide-react', () => ({ ArrowRight: () => null }));
vi.mock('wouter', () => ({
  Link: ({ children, ...props }: ComponentProps<'a'> & { children?: ReactNode }) => <a {...props}>{children}</a>,
}));
vi.mock('@/components/metro/tile', () => ({
  Headline: ({ children }: ComponentProps<'h1'>) => <h1>{children}</h1>,
  Tile: ({ children, ...props }: ComponentProps<'div'>) => <div {...props}>{children}</div>,
  TileButton: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

const mockedUseAuth = vi.mocked(useAuth);

describe('AuthGate personal-email grace timer', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockedUseAuth.mockReturnValue({
      user: { uid: 'student-1' } as never,
      bus: null,
      assignments: [],
      membership: {
        uid: 'student-1',
        email: 'student@example.com',
        role: 'student',
        status: 'approved',
        active: true,
        assignedBusId: '',
        requestedRole: null,
        expiresAt: null,
        root: false,
        createdAt: 0,
        updatedAt: 0,
      },
      isLoading: false,
      error: null,
      refreshMembership: vi.fn(),
      isEmailVerified: true,
      universityEmail: false,
      graceEndsAt: 2 * DAY_MS + 500,
      emailMismatch: false,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('updates after two daily ticks, then hard-blocks exactly at expiry', () => {
    act(() => {
      root.render(
        <AuthGate allowedRoles={['student']}>
          <p data-testid="protected-content">protected</p>
        </AuthGate>,
      );
    });
    expect(container.querySelector('[data-testid="banner-personal-email-grace"]')?.textContent).toContain('3 days left');
    expect(container.querySelector('[data-testid="protected-content"]')).not.toBeNull();

    act(() => vi.advanceTimersByTime(500));
    expect(container.querySelector('[data-testid="banner-personal-email-grace"]')?.textContent).toContain('2 days left');

    act(() => vi.advanceTimersByTime(DAY_MS));
    expect(container.querySelector('[data-testid="banner-personal-email-grace"]')?.textContent).toContain('1 day left');
    expect(container.querySelector('[data-testid="protected-content"]')).not.toBeNull();

    act(() => vi.advanceTimersByTime(DAY_MS));
    expect(container.textContent).toContain('access period ended');
    expect(container.querySelector('[data-testid="protected-content"]')).toBeNull();
  });

  it('blocks an approved, active member whose access end has passed, naming the date and the office (IDN-01)', () => {
    vi.setSystemTime(Date.UTC(2026, 8, 14, 6));
    const current = mockedUseAuth();
    mockedUseAuth.mockReturnValue({
      ...current,
      universityEmail: true,
      graceEndsAt: null,
      // valid through 13 Sep 2026 IST: the expiry is that day's IST midnight
      membership: { ...current.membership!, email: 'student@paruluniversity.ac.in', expiresAt: Date.UTC(2026, 8, 13, 18, 30) },
    });
    act(() => {
      root.render(
        <AuthGate allowedRoles={['student']}>
          <p data-testid="protected-content">protected</p>
        </AuthGate>,
      );
    });
    expect(container.textContent).toContain('access expired');
    expect(container.textContent).toContain('ran until 13 Sept 2026');
    expect(container.textContent).toContain('ask the transport office');
    expect(container.querySelector('a[href="/account"]')?.textContent).toContain('check status');
    expect(container.querySelector('[data-testid="protected-content"]')).toBeNull();
  });

  it('stops a member whose sign-in email no longer matches the approved one and names both (AC-32)', () => {
    const current = mockedUseAuth();
    mockedUseAuth.mockReturnValue({
      ...current,
      user: { uid: 'student-1', email: 'student@gmail.com' } as never,
      universityEmail: false,
      graceEndsAt: null,
      emailMismatch: true,
      membership: { ...current.membership!, email: 'student@paruluniversity.ac.in' },
    });
    act(() => {
      root.render(
        <AuthGate allowedRoles={['student']}>
          <p data-testid="protected-content">protected</p>
        </AuthGate>,
      );
    });
    expect(container.textContent).toContain('email changed');
    expect(container.textContent).toContain('approved for student@paruluniversity.ac.in');
    expect(container.textContent).toContain('signed in as student@gmail.com');
    expect(container.textContent).toContain('only a verified university email');
    expect(container.querySelector('a[href="/account"]')?.textContent).toContain('account');
    expect(container.querySelector('[data-testid="protected-content"]')).toBeNull();

    // a suspended record with a changed email is suspended first: switching email would not restore it
    mockedUseAuth.mockReturnValue({ ...mockedUseAuth(), membership: { ...current.membership!, email: 'student@paruluniversity.ac.in', status: 'suspended' } });
    act(() => {
      root.render(
        <AuthGate allowedRoles={['student']}>
          <p data-testid="protected-content">protected</p>
        </AuthGate>,
      );
    });
    expect(container.textContent).toContain('access suspended');
    expect(container.textContent).not.toContain('email changed');
  });

  it('drops an open session exactly when the access end passes (IDN-01)', () => {
    const current = mockedUseAuth();
    mockedUseAuth.mockReturnValue({
      ...current,
      universityEmail: true,
      graceEndsAt: null,
      membership: { ...current.membership!, email: 'student@paruluniversity.ac.in', expiresAt: DAY_MS + 250 },
    });
    act(() => {
      root.render(
        <AuthGate allowedRoles={['student']}>
          <p data-testid="protected-content">protected</p>
        </AuthGate>,
      );
    });
    expect(container.querySelector('[data-testid="protected-content"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(DAY_MS + 249));
    expect(container.querySelector('[data-testid="protected-content"]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(container.textContent).toContain('access expired');
    expect(container.querySelector('[data-testid="protected-content"]')).toBeNull();
  });

  it('denies an ordinary admin the driver page', () => {
    const current = mockedUseAuth();
    mockedUseAuth.mockReturnValue({
      ...current,
      membership: { ...current.membership!, role: 'admin', root: false },
    });
    act(() => {
      root.render(
        <AuthGate allowedRoles={['driver']}>
          <p data-testid="protected-content">driver controls</p>
        </AuthGate>,
      );
    });
    expect(container.textContent).toContain('not your page');
    expect(container.textContent).toContain('signed in as admin');
    expect(container.querySelector('[data-testid="protected-content"]')).toBeNull();
  });

  it('lets the protected owner drive while retaining admin access to student pages', () => {
    const current = mockedUseAuth();
    mockedUseAuth.mockReturnValue({
      ...current,
      membership: { ...current.membership!, role: 'admin', root: true },
    });
    act(() => {
      root.render(
        <AuthGate allowedRoles={['driver']}>
          <p data-testid="protected-content">driver controls</p>
        </AuthGate>,
      );
    });
    expect(container.querySelector('[data-testid="protected-content"]')).not.toBeNull();

    act(() => {
      root.render(
        <AuthGate allowedRoles={['student', 'admin']}>
          <p data-testid="student-content">student search</p>
        </AuthGate>,
      );
    });
    expect(container.querySelector('[data-testid="student-content"]')).not.toBeNull();
  });
});