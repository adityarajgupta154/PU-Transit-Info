import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fakeUser = { uid: 'u1', emailVerified: true, reload: async () => {}, getIdToken: async () => 't' };
const firebase = vi.hoisted(() => ({ auth: { currentUser: null as unknown } }));
vi.mock('@/lib/firebase', () => firebase);
vi.mock('firebase/auth', () => ({
  onIdTokenChanged: (_auth: unknown, cb: (u: unknown) => void) => { cb(firebase.auth.currentUser); return () => {}; },
}));
const storage = vi.hoisted(() => ({ getMe: vi.fn() }));
vi.mock('@/lib/storage', () => ({ storage }));
import { AuthProvider, useAuth } from './auth-context';

const me = (status: string) => ({ uid: 'u1', emailVerified: true, universityEmail: true, graceEndsAt: null, membership: { uid: 'u1', status, active: status === 'approved', role: 'student' }, bus: null, assignments: [] });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function Status() { return <p data-testid="status">{useAuth().membership?.status ?? 'none'}</p>; }

let root: Root, container: HTMLDivElement;
const status = () => container.querySelector('[data-testid="status"]')?.textContent;
const forbidden = () => act(() => { window.dispatchEvent(new Event('pu-transit:forbidden')); });
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  firebase.auth.currentUser = fakeUser;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

// IDN-02: a 403 from any API call re-reads /auth/me at once, but 403s arriving while a refresh is
// in flight must not abort it (that could starve the refresh forever); they queue one trailing refresh.
describe('auth context on a 403', () => {
  it('coalesces bursts of 403s into one in-flight refresh plus one trailing refresh', async () => {
    const first = deferred<ReturnType<typeof me>>();
    storage.getMe.mockReturnValueOnce(first.promise);
    act(() => root.render(<AuthProvider><Status /></AuthProvider>));
    expect(storage.getMe).toHaveBeenCalledTimes(1);
    first.resolve(me('approved'));
    await settle();
    expect(status()).toBe('approved');

    const slow = deferred<ReturnType<typeof me>>();
    storage.getMe.mockReturnValueOnce(slow.promise);
    forbidden();
    expect(storage.getMe).toHaveBeenCalledTimes(2);
    const slowSignal = storage.getMe.mock.calls[1][0] as AbortSignal;
    forbidden(); forbidden(); forbidden();
    expect(storage.getMe).toHaveBeenCalledTimes(2);
    expect(slowSignal.aborted).toBe(false);

    storage.getMe.mockResolvedValueOnce(me('suspended'));
    slow.resolve(me('approved')); // started before the suspension, so it still says approved
    await settle();
    await settle();
    expect(storage.getMe).toHaveBeenCalledTimes(3); // exactly one trailing refresh
    expect(status()).toBe('suspended');

    await settle();
    expect(storage.getMe).toHaveBeenCalledTimes(3);
    storage.getMe.mockResolvedValueOnce(me('suspended'));
    forbidden(); // nothing in flight: refreshes immediately
    expect(storage.getMe).toHaveBeenCalledTimes(4);
  });
});

// AC-32: the mismatch flag compares the two emails the API compared (its echo of the token email and the
// stored record), so the gate agrees with Rules and the API rather than with a possibly stale Firebase user object.
describe('auth context email binding', () => {
  function Binding() { const { emailMismatch, membership } = useAuth(); return <p data-testid="status">{`${membership?.status ?? 'none'}:${emailMismatch}`}</p>; }

  it('flags a membership approved for another email than the token email, and clears once they match', async () => {
    const withEmails = (email: string, storedEmail: string) => ({ ...me('approved'), email, membership: { ...me('approved').membership, email: storedEmail } });
    storage.getMe.mockResolvedValueOnce(withEmails('student@gmail.com', 'student@paruluniversity.ac.in'));
    act(() => root.render(<AuthProvider><Binding /></AuthProvider>));
    await settle();
    expect(status()).toBe('approved:true');

    storage.getMe.mockResolvedValueOnce(withEmails('student@paruluniversity.ac.in', 'student@paruluniversity.ac.in'));
    forbidden();
    await settle();
    expect(status()).toBe('approved:false');
  });
});
