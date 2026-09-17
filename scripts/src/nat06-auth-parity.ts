// NAT-06: the credential-free negative auth cases, sent through the native
// client's transport — the shared customFetch with a token getter, exactly as
// app/_layout.tsx wires it — against a live API. The API verifies signatures
// with Google's public certs, so every case here must come back 401 from the
// same middleware the web hits; a 503 means verification itself is broken.
//
//   pnpm --filter @workspace/scripts run nat06:auth -- --base https://<domain>
//
// Cases that need a real account (unverified email, suspended driver) are
// device steps in docs/rehearsal-log-nat06.md; this script sends no real token.
import { createSign, generateKeyPairSync } from 'node:crypto';
import { getAuthMe, setAuthTokenGetter, setBaseUrl, startTracking } from '@workspace/api-client-react';

const PROJECT_ID = 'pu-transit-f815d'; // same project both apps hard-code in lib/firebase.ts
const args = process.argv.slice(2);
const base = args[args.indexOf('--base') + 1] || 'http://127.0.0.1:8080';
const b64 = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

function forgedToken(alg: 'RS256' | 'none', expiresInSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg, typ: 'JWT', kid: 'nat06-not-a-google-key' }));
  const payload = b64(JSON.stringify({
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    auth_time: now - 60,
    user_id: 'nat06-forged-driver',
    sub: 'nat06-forged-driver',
    iat: now - 60,
    exp: now + expiresInSec,
    email: 'forged.driver@paruluniversity.ac.in',
    email_verified: true,
    firebase: { identities: { email: ['forged.driver@paruluniversity.ac.in'] }, sign_in_provider: 'password' },
  }));
  if (alg === 'none') return `${header}.${payload}.`;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${b64(signature)}`;
}

const cases: Array<{ name: string; token: string | null; expect: string }> = [
  { name: 'no token', token: null, expect: 'AUTH_REQUIRED' },
  { name: 'garbage bearer', token: 'not-a-jwt', expect: 'AUTH_INVALID' },
  { name: 'forged RS256, genuine-looking claims', token: forgedToken('RS256', 3600), expect: 'AUTH_INVALID' },
  { name: 'forged, already expired', token: forgedToken('RS256', -3600), expect: 'AUTH_INVALID' },
  { name: 'unsigned (alg none)', token: forgedToken('none', 3600), expect: 'AUTH_INVALID' },
];

type Outcome = { status: number; code: string };

async function outcome(call: () => Promise<unknown>): Promise<Outcome> {
  try {
    await call();
    return { status: 200, code: 'OK' };
  } catch (error) {
    const e = error as { status?: number; data?: { code?: string } | null; message?: string };
    return { status: e.status ?? 0, code: e.data?.code ?? e.message ?? 'unknown' };
  }
}

setBaseUrl(base);
console.log(`NAT-06 negative auth via native transport — ${base}\n`);
let failed = 0;
for (const c of cases) {
  setAuthTokenGetter(() => c.token); // same hook app/_layout.tsx feeds with auth.currentUser.getIdToken()
  const me = await outcome(() => getAuthMe());
  const start = await outcome(() =>
    startTracking('BUS-NAT06', { tripId: 'nat06', publisherId: 'nat06', expectedGeneration: 0, requestedAt: Date.now() }),
  );
  const pass = me.status === 401 && me.code === c.expect && start.status === 401 && start.code === c.expect;
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.name.padEnd(38)} expected 401 ${c.expect.padEnd(14)} me: ${me.status} ${me.code}  start: ${start.status} ${start.code}`);
}
console.log(failed ? `\n${failed} case(s) did not match — do not sign this off.` : '\nAll cases rejected identically to the web/API suites.');
process.exit(failed ? 1 : 0);
