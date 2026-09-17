// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ConfigEnv, UserConfig } from 'vite';

let envDir: string;
beforeEach(() => {
  vi.resetModules();
  envDir = mkdtempSync(path.join(tmpdir(), 'pu-demo-env-'));
  vi.stubEnv('PORT', '5173');
  vi.stubEnv('BASE_PATH', '/');
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('REPL_ID', undefined);
  vi.stubEnv('PU_TRANSIT_DEMO', undefined);
  vi.stubEnv('VITE_PU_TRANSIT_DEMO', undefined);
});
afterEach(() => {
  rmSync(envDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('effective Vite demo configuration', () => {
  it('rejects one-sided flags from .env.local and mode files', async () => {
    const { localDemoForMode } = await import('./vite.config');
    writeFileSync(path.join(envDir, '.env.local'), 'VITE_PU_TRANSIT_DEMO=1\n');
    expect(() => localDemoForMode('development', envDir)).toThrow('Local demo requires');
    rmSync(path.join(envDir, '.env.local'));
    writeFileSync(path.join(envDir, '.env.development'), 'PU_TRANSIT_DEMO=1\n');
    expect(() => localDemoForMode('development', envDir)).toThrow('Local demo requires');
  });

  it('accepts paired flags and respects explicit process precedence', async () => {
    const { localDemoForMode } = await import('./vite.config');
    writeFileSync(path.join(envDir, '.env.local'), 'PU_TRANSIT_DEMO=1\nVITE_PU_TRANSIT_DEMO=1\n');
    expect(localDemoForMode('development', envDir)).toBe(true);
    vi.stubEnv('VITE_PU_TRANSIT_DEMO', 'bad');
    expect(() => localDemoForMode('development', envDir)).toThrow('Local demo requires');
  });

  it('rejects demo build/preview and only configures a proxy for demo serve', async () => {
    const { default: config } = await import('./vite.config');
    const resolve = config as (env: ConfigEnv) => Promise<UserConfig>;
    const normal = await resolve({ command: 'serve', mode: 'development' });
    expect(normal.server?.proxy).toBeUndefined();
    expect(normal.server?.host).toBe('0.0.0.0');
    vi.stubEnv('PU_TRANSIT_DEMO', '1');
    vi.stubEnv('VITE_PU_TRANSIT_DEMO', '1');
    const demo = await resolve({ command: 'serve', mode: 'development' });
    expect(demo.server?.host).toBe('127.0.0.1');
    expect(demo.server?.proxy).toEqual({ '/api': 'http://127.0.0.1:3001' });
    await expect(resolve({ command: 'build', mode: 'development' })).rejects.toThrow('cannot be built');
    await expect(resolve({ command: 'serve', mode: 'development', isPreview: true })).rejects.toThrow('cannot be built');
  });
});