import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { resetRateLimits } from "../middleware/rate-limit";
import { fakeDatabase as fakeDb, member, bus, route, type Json } from "./fake-database";

const fakeDatabase = (initial: Json) => fakeDb(fetchFirebase, initial);
const BUS = "GJ06BX2020";
const ROUTE = "8f3c2a1e-6b7d-4a5e-9c1f-0d2e3f4a5b6c";
const DAY = 86_400_000;
const past = () => Date.now() - DAY;
const future = () => Date.now() + 30 * DAY;

function seed(extra: Json = {}): Json {
  return {
    memberships: {
      admin: member("admin", "admin"),
      lapsed: { ...member("lapsed", "student"), expiresAt: past() },
      current: { ...member("current", "student"), expiresAt: future() },
      driver: { ...member("driver", "driver", BUS), expiresAt: past() },
    },
    buses: { [BUS]: bus(BUS) },
    routes: { [ROUTE]: { ...route(ROUTE, BUS), publishedVersion: 3 } },
    ...extra,
  };
}

const get = (path: string, uid: string) => request(app).get(path).set("Authorization", `Bearer ${uid}-token`);
const patch = (uid: string, body: object, as = "admin") =>
  request(app).patch(`/api/memberships/${uid}`).set("Authorization", `Bearer ${as}-token`).send(body);

describe("Membership expiry (IDN-01 / AUTH-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    process.env.FIREBASE_PROJECT_ID = "pu-transit-f815d";
    process.env.FIREBASE_DATABASE_URL = "https://pu-transit-f815d-default-rtdb.firebaseio.com";
    process.env.UNIVERSITY_EMAIL_DOMAINS = "paruluniversity.ac.in";
    fetchFirebase.mockReset();
    vi.stubGlobal("fetch", fetchFirebase);
    verifyIdToken.mockImplementation(async (token: string) => {
      const uid = token.replace(/-token$/, "");
      if (uid === token) throw new Error("bad token");
      return { uid, email: `${uid}@paruluniversity.ac.in`, email_verified: true };
    });
  });

  it("refuses protected reads with a distinct code once expiresAt has passed, while a future expiry still admits", async () => {
    fakeDatabase(seed());
    const lapsed = await get("/api/buses", "lapsed");
    expect(lapsed.status).toBe(403);
    expect(lapsed.body.code).toBe("MEMBERSHIP_EXPIRED");
    expect(lapsed.body.error).toMatch(/expired on \d{4}-\d{2}-\d{2}T.*ask the transport office/);
    expect((await get("/api/routes", "lapsed")).body.code).toBe("MEMBERSHIP_EXPIRED");
    const start = await request(app).post(`/api/tracking/${BUS}/start`).set("Authorization", "Bearer driver-token").send({});
    expect(start.status).toBe(403);
    expect(start.body.code).toBe("MEMBERSHIP_EXPIRED");
    expect((await get("/api/buses", "current")).status).toBe(200);
  });

  it("/auth/me still returns the record (with expiresAt) so the client can show 'expired', but no driver preflight data", async () => {
    fakeDatabase(seed());
    const me = await get("/api/auth/me", "driver");
    expect(me.status).toBe(200);
    expect(me.body.membership).toMatchObject({ status: "approved", active: true, expiresAt: expect.any(Number) });
    expect(me.body.membership.expiresAt).toBeLessThan(Date.now());
    expect(me.body.bus).toBeNull();
    expect(me.body.assignments).toEqual([]);
    expect((await get("/api/auth/me", "admin")).body.membership.expiresAt).toBeNull();
  });

  it("lets an admin set, extend and clear the expiry, audited as dates; the record keeps its other fields", async () => {
    const db = fakeDatabase(seed());
    const until = future();
    const set = await patch("lapsed", { expiresAt: until });
    expect(set.status, set.text).toBe(200);
    expect(set.body.expiresAt).toBe(until);
    expect(db.at(["memberships", "lapsed", "expiresAt"])).toBe(until);
    expect(db.at(["memberships", "lapsed", "status"])).toBe("approved");
    expect((await get("/api/buses", "lapsed")).status).toBe(200); // access is back at once

    const cleared = await patch("lapsed", { expiresAt: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.expiresAt).toBeNull();
    expect(db.at(["memberships", "lapsed", "expiresAt"])).toBeUndefined();

    // an unrelated update leaves the expiry alone
    await patch("current", { role: "staff" });
    expect(db.at(["memberships", "current", "expiresAt"])).toBeGreaterThan(Date.now());

    expect(db.audits.map((a) => a.summary)).toEqual([
      expect.stringMatching(/^expiresAt \d{4}-.*Z -> \d{4}-.*Z$/),
      expect.stringMatching(/^expiresAt \d{4}-.*Z -> null$/),
      "role 'student' -> 'staff'",
    ]);
  });

  it("rejects malformed expiries and an admin expiring themself; a future self-expiry is allowed", async () => {
    const db = fakeDatabase(seed());
    for (const expiresAt of [0, -5, 1.5, 8_640_000_000_000_001, "2026-10-01", true]) {
      const bad = await patch("lapsed", { expiresAt });
      expect(bad.status, String(expiresAt)).toBe(400);
    }
    const self = await patch("admin", { expiresAt: past() });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe("SELF_DEMOTION_FORBIDDEN");
    expect(db.at(["memberships", "admin", "expiresAt"])).toBeUndefined();
    expect((await patch("admin", { expiresAt: future() })).status).toBe(200);
    expect((await patch("lapsed", { expiresAt: 8_640_000_000_000_000 })).status).toBe(200); // Date's maximum still audits
    expect(db.audits.at(-1)?.summary).toMatch(/-> \+275760-09-13T00:00:00.000Z$/);
  });

  it("treats an expired driver as ineligible for assignments and an expired admin as no admin", async () => {
    fakeDatabase(seed());
    const assigned = await request(app)
      .post("/api/assignments")
      .set("Authorization", "Bearer admin-token")
      .send({ driverUid: "driver", busId: BUS, routeId: ROUTE, serviceDate: "2030-01-01" });
    expect(assigned.status).toBe(409);
    expect(assigned.body.code).toBe("DRIVER_NOT_ELIGIBLE");
    expect(assigned.body.error).toMatch(/expired/);

    fakeDatabase(seed({ memberships: { admin: { ...member("admin", "admin"), expiresAt: past() }, lapsed: member("lapsed", "student") } }));
    const asExpiredAdmin = await patch("lapsed", { status: "suspended" });
    expect(asExpiredAdmin.status).toBe(403);
    expect(asExpiredAdmin.body.code).toBe("MEMBERSHIP_EXPIRED");
  });
});
