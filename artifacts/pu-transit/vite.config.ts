import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

export function localDemoForMode(mode: string, envDir = import.meta.dirname): boolean {
  // Vite loads .env* after evaluating this file; inspect the same effective values
  // now so a stale one-sided client flag cannot evade the opt-in/build guard.
  const env = { ...loadEnv(mode, envDir, ''), ...process.env };
  const localDemo = env.PU_TRANSIT_DEMO === '1';
  if ((env.PU_TRANSIT_DEMO !== undefined || env.VITE_PU_TRANSIT_DEMO !== undefined) &&
      (!localDemo || env.VITE_PU_TRANSIT_DEMO !== '1' || env.NODE_ENV !== 'development')) {
    throw new Error('Local demo requires PU_TRANSIT_DEMO=1, VITE_PU_TRANSIT_DEMO=1 and NODE_ENV=development. Use pnpm demo.');
  }
  return localDemo;
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig(async ({ command, isPreview, mode }) => {
  const localDemo = localDemoForMode(mode);
  if (localDemo && (command !== 'serve' || isPreview)) {
    throw new Error('The local demo cannot be built or published. Use pnpm demo.');
  }
  return {
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: localDemo ? '127.0.0.1' : '0.0.0.0',
    allowedHosts: true,
    // Only the opt-in local demo needs this; managed /api routing is unchanged.
    ...(localDemo ? { proxy: { '/api': 'http://127.0.0.1:3001' } } : {}),
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
  };
});
