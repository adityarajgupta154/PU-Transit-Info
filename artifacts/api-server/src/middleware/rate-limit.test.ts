import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { verifyIdToken, fetchFirebase, getApps, initializeApp } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  fetchFirebase: vi.fn(),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({ name: "pu-transit-api" })),
}));

vi.mock("firebase-admin/app", () => ({ getApps, initializeApp }));
vi.mock("firebase-admin/auth", () => ({ getAuth: vi.fn(() => ({ verifyIdToken })) }));
vi.mock("@workspace/db", () => ({ db: { select: vi.fn() }, routesTable: {} }));

import app from "../app";
import { resetRateLimits } from "./rate-limit";
import { fakeDatabase as fakeDb, signInAs as signIn, member, bus } from "../routes/fake-database";

const BUS = "GJ06BX1414";
const start = { tripId: "4b6e2f4c-1d5e-4c0a-9d3f-2a7b8c9d0e1f", publisherId: "9c1f0d2e-3f4a-4b6c-8d7e-1a2b3c4d5e6f" };
const driver = (path: string, body: object) =>
  request(app).post(`/api/tracking/${BUS}/${path}`).set("Authorization", "Bearer driver-token").send(body);

describe("Rate limits (SEC-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    process.env.FIREBASE_PROJECT_ID = "pu-transit-f815d";
    process.env.FIREBASE_DATABASE_URL = "https://pu-transit-f815d-default-rtdb.firebaseio.com";
    process.env.UNIVERSITY_EMAIL_DOMAINS = "paruluniversity.ac.in";
    fetchFirebase.mockReset();
    vi.stubGlobal("fetch", fetchFirebase);
    fakeDb(fetchFirebase, {
      memberships: { driver: member("driver", "driver", BUS), other: member("other", "driver", BUS) },
      buses: { [BUS]: bus(BUS) },
    });
  });
  afterEach(() => vi.useRealTimers());

  it("lets a bus report about once a second, then answers 429 with Retry-After until the minute ends", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 8, 14, 5), toFake: ["Date"] });
    signIn(verifyIdToken, "driver");
    expect((await driver("start", { ...start, expectedGeneration: 0, requestedAt: Date.now() })).status).toBe(201);

    const statuses: number[] = [];
    for (let sequence = 1; sequence <= 60; sequence += 1) {
      statuses.push((await driver("heartbeat", { ...start, generation: 1, sequence })).status);
    }
    expect(statuses.slice(0, 59)).toEqual(Array(59).fill(200)); // start + 59 heartbeats = 60 requests
    expect(statuses[59]).toBe(429);

    vi.setSystemTime(Date.now() + 20_000);
    const refused = await driver("heartbeat", { ...start, generation: 1, sequence: 61 });
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ error: "Too many requests, slow down", code: "RATE_LIMITED" });
    expect(refused.headers["retry-after"]).toBe("40");

    // Another driver behind the same IP still reports: the per-uid bucket is theirs alone.
    signIn(verifyIdToken, "other");
    const other = await request(app).post(`/api/tracking/${BUS}/heartbeat`).set("Authorization", "Bearer other-token").send({ ...start, generation: 1, sequence: 1 });
    expect(other.status).not.toBe(429);

    vi.setSystemTime(Date.now() + 40_000);
    signIn(verifyIdToken, "driver");
    expect((await driver("heartbeat", { ...start, generation: 1, sequence: 62 })).status).toBe(200);
  });

  it("caps membership creation per account and refuses before any database read", async () => {
    verifyIdToken.mockResolvedValue({ uid: "fresh", email: "fresh@paruluniversity.ac.in", email_verified: true });
    const join = () => request(app).post("/api/auth/membership").set("Authorization", "Bearer t").send({ role: "student" });
    for (let index = 0; index < 5; index += 1) expect((await join()).status).not.toBe(429);
    const reads = fetchFirebase.mock.calls.length;
    const sixth = await join();
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);
    expect(fetchFirebase.mock.calls.length).toBe(reads);
  });

  it("caps one client across accounts: 12 fresh accounts spend the membership client budget, the 13th is refused", async () => {
    const identity = (uid: string) => ({ uid, email: `${uid}@paruluniversity.ac.in`, email_verified: true });
    const join = (uid: string) => request(app).post("/api/auth/membership").set("Authorization", "Bearer t").send({ role: "student" });
    for (let account = 0; account < 12; account += 1) {
      verifyIdToken.mockResolvedValue(identity(`cohort-${account}`));
      for (let attempt = 0; attempt < 5; attempt += 1) expect((await join(`cohort-${account}`)).status).not.toBe(429);
    }
    verifyIdToken.mockResolvedValue(identity("cohort-12"));
    const refused = await join("cohort-12");
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe("RATE_LIMITED");
  });

  it("limits route writes per admin: the 31st in a minute is refused even when the route does not exist", async () => {
    fakeDb(fetchFirebase, { memberships: { admin: member("admin", "admin") } });
    signIn(verifyIdToken, "admin");
    const remove = () => request(app).delete("/api/routes/8f3c2a1e-6b7d-4a5e-9c1f-0d2e3f4a5b6c").set("Authorization", "Bearer admin-token");
    for (let index = 0; index < 30; index += 1) expect((await remove()).status).toBe(404);
    expect((await remove()).status).toBe(429);
  });

  it("does not count unauthenticated requests: those stop at 401", async () => {
    for (let index = 0; index < 70; index += 1) {
      expect((await request(app).post(`/api/tracking/${BUS}/heartbeat`).send({})).status).toBe(401);
    }
  });
});
