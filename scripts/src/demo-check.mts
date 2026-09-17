// Run against `pnpm demo`. Never accepts a URL or credentials from the environment.
import assert from "node:assert/strict";
import {
  assertDemoEnvironment, DEMO_AUTH_URL, DEMO_DATABASE_NAMESPACE,
  DEMO_DATABASE_URL, DEMO_PASSWORD, DEMO_PROJECT_ID, DEMO_USERS,
} from "./demo-seed.js";

assertDemoEnvironment();
const origin = "http://127.0.0.1:5173";
async function request(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(12_000) });
}
async function api(path: string, token?: string, method = "GET", body?: unknown) {
  return request(`${origin}/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

assert.equal((await api("/healthz")).status, 200, "Same-origin API health");
assert.equal((await api("/routes")).status, 401, "Anonymous reads must be denied");
const tokens: Record<string, string> = {};
for (const user of DEMO_USERS) {
  const signIn = await request(
    `${DEMO_AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only-not-a-real-key`,
    { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: DEMO_PASSWORD, returnSecureToken: true }) },
  );
  assert.equal(signIn.status, 200, `Local Auth sign-in for ${user.role}`);
  const session = await signIn.json();
  assert.equal(session.localId, user.uid);
  assert.equal(typeof session.idToken, "string");
  const claims = JSON.parse(Buffer.from(session.idToken.split(".")[1], "base64url").toString());
  assert.equal(claims.aud, DEMO_PROJECT_ID, "Only emulator-project identities");
  tokens[user.role] = session.idToken;
  const me = await api("/auth/me", session.idToken);
  assert.equal(me.status, 200, `API Auth for ${user.role}`);
  const profile = await me.json();
  assert.equal(profile.membership?.role, user.role);
  const routes = await api("/routes", session.idToken);
  assert.equal(routes.status, 200, `Rules-backed route read for ${user.role}`);
  assert((await routes.json()).some((route: { busNumber: string }) => route.busNumber === "BUS1"));

  const refresh = await request(`${DEMO_AUTH_URL}/securetoken.googleapis.com/v1/token?key=demo-only-not-a-real-key`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: session.refreshToken }),
  });
  assert.equal(refresh.status, 200, `Emulator token refresh for ${user.role}`);
  assert.equal((await api("/auth/me", (await refresh.json()).id_token)).status, 200);
}

for (const role of ["student", "driver"]) {
  assert.equal((await api("/memberships", tokens[role])).status, 403, `${role} cannot list memberships`);
  assert.equal((await api("/buses/BUS1", tokens[role], "PATCH", { label: "Forbidden" })).status, 403);
}
assert.equal((await api("/memberships", tokens.admin)).status, 200);
assert.equal((await api("/migration/preview", tokens.admin)).status, 503, "No legacy PostgreSQL in demo");

const buses = await (await api("/buses", tokens.admin)).json();
const bus = buses.find((entry: { busId: string }) => entry.busId === "BUS1");
assert(bus, "Synthetic assigned bus exists");
const label = "BUS1 · Demo checked";
try {
  assert.equal((await api("/buses/BUS1", tokens.admin, "PATCH", { label })).status, 200);
  const persisted = await (await api("/buses", tokens.student)).json();
  assert.equal(persisted.find((entry: { busId: string }) => entry.busId === "BUS1")?.label, label);
  // Direct RTDB access must enforce the same Rules, without relying on API role checks.
  const denied = await request(
    `${DEMO_DATABASE_URL}/buses/BUS1/label.json?ns=${DEMO_DATABASE_NAMESPACE}&auth=${encodeURIComponent(tokens.student)}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify("Forbidden") },
  );
  assert([401, 403].includes(denied.status), "Student RTDB mutation must be denied by Rules");
} finally {
  assert.equal((await api("/buses/BUS1", tokens.admin, "PATCH", { label: bus.label })).status, 200);
}
console.log("Demo check passed: three real emulator sign-ins/refreshes, same-origin API, role denials, Rules denial, persisted admin edit, no PostgreSQL.");