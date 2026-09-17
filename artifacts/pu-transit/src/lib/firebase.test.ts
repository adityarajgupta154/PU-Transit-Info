import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  initializeApp: vi.fn((config, name) => ({ options: config, name })),
  getAuth: vi.fn(() => ({ emulatorConfig: null })),
  initializeAuth: vi.fn(() => ({ emulatorConfig: null })),
  connectAuthEmulator: vi.fn(),
}));
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: sdk.initializeApp }));
vi.mock('firebase/auth', () => ({
  ...sdk,
  browserSessionPersistence: 'session',
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('VITE_PU_TRANSIT_DEMO', '');
  vi.stubEnv('PROD', false);
});
afterEach(() => vi.unstubAllEnvs());

describe('Firebase local demo isolation', () => {
  it('leaves the managed Firebase app unchanged without opt-in', async () => {
    const { firebaseConfig } = await import('./firebase');
    expect(firebaseConfig.projectId).toBe('pu-transit-f815d');
    expect(sdk.initializeApp).toHaveBeenCalledWith(firebaseConfig, 'pu-transit');
    expect(sdk.getAuth).toHaveBeenCalledOnce();
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();
  });

  it('uses a separate demo identity and connects before consumers receive auth', async () => {
    vi.stubEnv('VITE_PU_TRANSIT_DEMO', '1');
    const { firebaseConfig, auth } = await import('./firebase');
    expect(firebaseConfig.projectId).toBe('demo-pu-transit');
    expect(firebaseConfig.apiKey).toBe('demo-only-not-a-real-key');
    expect(sdk.initializeApp).toHaveBeenCalledWith(firebaseConfig, 'pu-transit-local-demo');
    expect(sdk.initializeAuth).toHaveBeenCalledWith(expect.anything(), { persistence: 'session' });
    expect(sdk.getAuth).not.toHaveBeenCalled();
    expect(sdk.connectAuthEmulator).toHaveBeenCalledWith(auth, 'http://127.0.0.1:9099');
  });

  it('refuses a production build before initializing Firebase', async () => {
    vi.stubEnv('VITE_PU_TRANSIT_DEMO', '1');
    vi.stubEnv('PROD', true);
    await expect(import('./firebase')).rejects.toThrow('only available on a local');
    expect(sdk.initializeApp).not.toHaveBeenCalled();
  });
});