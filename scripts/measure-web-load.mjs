// Production-build lab benchmark; no login, API credentials or installed dependencies.
// Usage: node scripts/measure-web-load.mjs <dist-dir> <results.json> <playwright-core-module>
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { gzipSync } from 'node:zlib';

const [distArg, output, playwrightModule] = process.argv.slice(2);
assert(distArg && output && playwrightModule, 'Pass dist directory, output JSON and playwright-core module path');
const dist = resolve(distArg);
const { chromium } = await import(playwrightModule);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const path = extname(pathname) ? resolve(dist, `.${pathname}`) : resolve(dist, 'index.html');
    assert(path.startsWith(`${dist}/`));
    const body = await readFile(path);
    const zipped = gzipSync(body);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Content-Encoding': 'gzip', 'Content-Length': zipped.length, 'Cache-Control': 'no-store' });
    res.end(zipped);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const manifest = JSON.parse(await readFile(resolve(dist, '.vite/manifest.json'), 'utf8'));
const files = new Set();
function visit(key) {
  const chunk = manifest[key];
  files.add(chunk.file);
  for (const css of chunk.css ?? []) files.add(css);
  for (const dependency of chunk.imports ?? []) visit(dependency);
}
visit(Object.keys(manifest).find((key) => manifest[key].isEntry));
const initialAssets = await Promise.all([...files].map(async (file) => {
  const body = await readFile(resolve(dist, file));
  return { file, bytes: body.length, gzipBytes: gzipSync(body).length };
}));
const browser = await chromium.launch({ executablePath: '/repl/tools/bin/chromium', headless: true, args: ['--no-sandbox'] });
const samples = [];
try {
  // Interleave pages to avoid measuring one page only during a busy/idle interval.
  for (let run = 1; run <= 5; run++) {
    for (const path of ['/', '/about', '/account']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 45000 });
      await page.locator('h1').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      const sample = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation')[0];
        return {
          fcpMs: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
          domContentLoadedMs: navigation.domContentLoadedEventEnd,
          loadMs: navigation.loadEventEnd,
          heading: document.querySelector('h1')?.textContent,
          mapRendered: !!document.querySelector('.leaflet-container'),
          assets: performance.getEntriesByType('resource').filter((r) => new URL(r.name).origin === location.origin).map((r) => ({
            path: new URL(r.name).pathname, encodedBytes: r.encodedBodySize, decodedBytes: r.decodedBodySize,
          })),
        };
      });
      assert.equal(errors.length, 0, errors.join('\n'));
      assert.equal(sample.mapRendered, false);
      assert(Number.isFinite(sample.fcpMs) && sample.loadMs > 0, 'Missing navigation/paint metrics');
      samples.push({ run, path, ...sample });
      console.log(`${path} #${run}: FCP ${sample.fcpMs.toFixed(0)}ms; load ${sample.loadMs.toFixed(0)}ms`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const medians = ['/', '/about', '/account'].map((path) => {
  const rows = samples.filter((s) => s.path === path);
  return { path, fcpMs: median(rows.map((s) => s.fcpMs)), loadMs: median(rows.map((s) => s.loadMs)), domContentLoadedMs: median(rows.map((s) => s.domContentLoadedMs)) };
});
await writeFile(output, JSON.stringify({
  measuredAt: new Date().toISOString(), chromium: browser.version(),
  conditions: 'Production build, localhost gzip, fresh signed-out contexts, cache disabled, 390x844, reduced motion, 150ms latency, 1.6Mbps down/750Kbps up, 4x CPU slowdown, five runs/page',
  initialAssets, medians, samples,
}, null, 2) + '\n');
console.log(JSON.stringify({ initialAssets, medians }, null, 2));