import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  currentUser: null as null | { getIdToken: () => Promise<string> },
}));
vi.mock('./firebase', () => ({ auth: state }));
import { fetchWithAuth } from './api';

afterEach(() => { vi.unstubAllGlobals(); state.currentUser = null; });

describe('API session isolation', () => {
  it('does not send a token after the account changes during refresh', async () => {
    let finish!: (token: string) => void;
    state.currentUser = { getIdToken: () => new Promise(resolve => { finish = resolve; }) };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const request = fetchWithAuth('/api/routes');
    const assertion = expect(request).rejects.toMatchObject({ status: 401 });
    state.currentUser = { getIdToken: async () => 'different-test-token' };
    finish('old-test-token');
    await assertion;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('discards an in-flight response after sign-out', async () => {
    let finish!: (response: Response) => void;
    state.currentUser = { getIdToken: async () => 'test-token' };
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const request = fetchWithAuth('/api/routes');
    const assertion = expect(request).rejects.toMatchObject({ status: 401 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    state.currentUser = null;
    finish(new Response(JSON.stringify([{ id: 'private-test-route' }])));
    await assertion;
  });

  // IDN-02: the API's 403 is the client's revocation signal; the auth context re-checks membership on it.
  it('announces a 403 so the auth context re-checks access at once', async () => {
    state.currentUser = { getIdToken: async () => 'test-token' };
    const forbidden = vi.fn();
    window.addEventListener('pu-transit:forbidden', forbidden);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'suspended', code: 'MEMBERSHIP_REQUIRED' }), { status: 403 })));
    await expect(fetchWithAuth('/api/tracking/BUS1')).rejects.toMatchObject({ status: 403, code: 'MEMBERSHIP_REQUIRED' });
    expect(forbidden).toHaveBeenCalledOnce();

    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    await expect(fetchWithAuth('/api/tracking/BUS1')).rejects.toMatchObject({ status: 503 });
    expect(forbidden).toHaveBeenCalledOnce();
    window.removeEventListener('pu-transit:forbidden', forbidden);
  });
});