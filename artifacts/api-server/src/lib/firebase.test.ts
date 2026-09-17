import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getApps, initializeApp, getAuth, verifyIdToken } = vi.hoisted(() => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn((options: unknown, name: string) => ({ options, name })),
  verifyIdToken: vi.fn(),
  getAuth: vi.fn(() => ({ verifyIdToken })),
}));

vi.mock("firebase-admin/app", () => ({ getApps, initializeApp }));
vi.mock("firebase-admin/auth", () => ({ getAuth }));

import {
  DEMO_FIREBASE_AUTH_EMULATOR_HOST,
  DEMO_FIREBASE_DATABASE_EMULATOR_HOST,
  DEMO_FIREBASE_DATABASE_URL,
  DEMO_FIREBASE_PROJECT_ID,
  readFirebase,
  verifyFirebaseIdToken,
} from "./firebase";

const productionEnvironment = {
  NODE_ENV: "development",
  FIREBASE_PROJECT_ID: "pu-transit-f815d",
  FIREBASE_DATABASE_URL: "https://pu-transit-f815d-default-rtdb.firebaseio.com",
};

function setEnvironment(values: Record<string, string>): void {
  for (const key of [
    "PU_TRANSIT_DEMO",
    "NODE_ENV",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_DATABASE_URL",
    "FIREBASE_AUTH_EMULATOR_HOST",
    "FIREBASE_DATABASE_EMULATOR_HOST",
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, values);
}

describe("Firebase runtime boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnvironment(productionEnvironment);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps production RTDB requests on the allowlisted target", async () => {
    const fetchFirebase = vi.mocked(fetch);
    fetchFirebase.mockResolvedValue(new Response("null", { status: 200 }));

    await readFirebase("routes", "user-token");

    expect(fetchFirebase).toHaveBeenCalledOnce();
    const url = String(fetchFirebase.mock.calls[0]?.[0]);
    expect(url).toContain(
      "https://pu-transit-f815d-default-rtdb.firebaseio.com/routes.json",
    );
    expect(url).toContain("auth=user-token");
    expect(url).not.toContain("ns=");
  });

  it("reports a Rules denial with the refused path and Firebase's reason, never the token", async () => {
    const fetchFirebase = vi.mocked(fetch);
    fetchFirebase.mockImplementation(
      async () => new Response(JSON.stringify({ error: "Permission denied" }), { status: 401 }),
    );

    await expect(readFirebase("assignments/user-1", "user-token")).rejects.toMatchObject({
      code: "rules",
      detail: { path: "assignments/user-1", status: 401, reason: "Permission denied" },
    });
    await expect(readFirebase("assignments/user-1", "user-token")).rejects.toSatisfy(
      (error: unknown) => !JSON.stringify((error as { detail: unknown }).detail).includes("user-token"),
    );
  });

  it.each([
    ["JSON echoing the token", JSON.stringify({ error: "Bad request for auth=user-token" })],
    ["JSON echoing the encoded token", JSON.stringify({ error: `denied ${encodeURIComponent("user-token")}` })],
    ["a raw body echoing the URL", "<html>GET /assignments/user-1.json?auth=user-token denied</html>"],
    ["a JWT-shaped body", "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl"],
    ["a long prose body", "x ".repeat(100)],
  ])("drops a Firebase error body that is not plain prose (%s)", async (_name, body) => {
    const fetchFirebase = vi.mocked(fetch);
    fetchFirebase.mockImplementation(async () => new Response(body, { status: 403 }));

    const error = await readFirebase("assignments/user-1", "user-token").catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "rules", detail: { path: "assignments/user-1", status: 403 } });
    expect((error as { detail: { reason?: string } }).detail.reason).toBeUndefined();
  });

  it("keeps Firebase's plain-prose reasons, JSON or raw", async () => {
    const fetchFirebase = vi.mocked(fetch);
    fetchFirebase.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "Auth token is expired" }), { status: 401 }));
    fetchFirebase.mockImplementationOnce(async () => new Response("Service Unavailable", { status: 503 }));

    await expect(readFirebase("routes", "user-token")).rejects.toMatchObject({
      code: "rules",
      detail: { path: "routes", status: 401, reason: "Auth token is expired" },
    });
    await expect(readFirebase("routes", "user-token")).rejects.toMatchObject({
      code: "unavailable",
      detail: { path: "routes", status: 503, reason: "Service Unavailable" },
    });
  });

  it("targets only the local demo and names its RTDB instance", async () => {
    setEnvironment({
      PU_TRANSIT_DEMO: "1",
      NODE_ENV: "development",
      FIREBASE_PROJECT_ID: DEMO_FIREBASE_PROJECT_ID,
      FIREBASE_DATABASE_URL: DEMO_FIREBASE_DATABASE_URL,
      FIREBASE_AUTH_EMULATOR_HOST: DEMO_FIREBASE_AUTH_EMULATOR_HOST,
      FIREBASE_DATABASE_EMULATOR_HOST: DEMO_FIREBASE_DATABASE_EMULATOR_HOST,
    });
    const fetchFirebase = vi.mocked(fetch);
    fetchFirebase.mockResolvedValue(new Response("null", { status: 200 }));

    await readFirebase("routes", "emulator-user");

    const url = String(fetchFirebase.mock.calls[0]?.[0]);
    expect(url).toContain("http://127.0.0.1:9000/routes.json");
    expect(url).toContain("auth=emulator-user");
    expect(url).toContain("ns=demo-pu-transit-default-rtdb");
    expect(url).not.toContain("firebaseio.com");
  });

  it("fails closed without making an outbound request for invalid demo config", async () => {
    setEnvironment({
      PU_TRANSIT_DEMO: "1",
      NODE_ENV: "development",
      FIREBASE_PROJECT_ID: "pu-transit-f815d",
      FIREBASE_DATABASE_URL: "https://pu-transit-f815d-default-rtdb.firebaseio.com",
    });
    const fetchFirebase = vi.mocked(fetch);

    await expect(readFirebase("routes", "token")).rejects.toMatchObject({
      code: "config",
    });
    expect(fetchFirebase).not.toHaveBeenCalled();
  });

  it("rejects emulator hosts unless demo mode is explicit", async () => {
    setEnvironment({
      ...productionEnvironment,
      FIREBASE_AUTH_EMULATOR_HOST: DEMO_FIREBASE_AUTH_EMULATOR_HOST,
    });

    await expect(verifyFirebaseIdToken("unsigned-token")).rejects.toMatchObject({
      code: "config",
    });
    expect(getAuth).not.toHaveBeenCalled();
  });

  it("requires the auth emulator to be healthy before verifying a demo token", async () => {
    setEnvironment({
      PU_TRANSIT_DEMO: "1",
      NODE_ENV: "development",
      FIREBASE_PROJECT_ID: DEMO_FIREBASE_PROJECT_ID,
      FIREBASE_DATABASE_URL: DEMO_FIREBASE_DATABASE_URL,
      FIREBASE_AUTH_EMULATOR_HOST: DEMO_FIREBASE_AUTH_EMULATOR_HOST,
      FIREBASE_DATABASE_EMULATOR_HOST: DEMO_FIREBASE_DATABASE_EMULATOR_HOST,
    });
    vi.mocked(fetch).mockRejectedValue(new Error("connection refused"));

    await expect(verifyFirebaseIdToken("emulator-token")).rejects.toEqual(
      expect.objectContaining({
        code: "unavailable",
        message: "Firebase authentication is unavailable",
      }),
    );
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("uses a separate demo Admin app while preserving SDK token verification", async () => {
    setEnvironment({
      PU_TRANSIT_DEMO: "1",
      NODE_ENV: "development",
      FIREBASE_PROJECT_ID: DEMO_FIREBASE_PROJECT_ID,
      FIREBASE_DATABASE_URL: DEMO_FIREBASE_DATABASE_URL,
      FIREBASE_AUTH_EMULATOR_HOST: DEMO_FIREBASE_AUTH_EMULATOR_HOST,
      FIREBASE_DATABASE_EMULATOR_HOST: DEMO_FIREBASE_DATABASE_EMULATOR_HOST,
    });
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));
    verifyIdToken.mockResolvedValue({ uid: "emulator-user", email: "user@example.test" });

    await verifyFirebaseIdToken("real-emulator-token");

    expect(initializeApp).toHaveBeenCalledWith(
      { projectId: DEMO_FIREBASE_PROJECT_ID, databaseURL: DEMO_FIREBASE_DATABASE_URL },
      "pu-transit-api-demo",
    );
    expect(verifyIdToken).toHaveBeenCalledWith("real-emulator-token");
  });

  it("maps an unsigned production token rejection to an auth failure", async () => {
    verifyIdToken.mockRejectedValue({ code: "auth/invalid-id-token" });

    await expect(verifyFirebaseIdToken("eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyIn0.")).rejects.toEqual(
      expect.objectContaining({
        code: "rules",
        message: "Firebase token verification failed",
      }),
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});