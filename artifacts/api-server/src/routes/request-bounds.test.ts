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
import { fakeDatabase as fakeDb, signInAs as signIn, member, bus, route } from "./fake-database";

const ROUTE = "8f3c2a1e-6b7d-4a5e-9c1f-0d2e3f4a5b6c";
const point = (index: number) => ({ lat: 22.3 + index / 1e5, lng: 73.2 + index / 1e5 });
const routeBody = (extra: Record<string, unknown>) => {
  const { id: _id, ...input } = route(ROUTE, "GJ06BX1414");
  return { ...input, status: "draft", ...extra };
};
const writes = () => fetchFirebase.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method && init.method !== "GET").length;

describe("Request bounds (SEC-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    process.env.FIREBASE_PROJECT_ID = "pu-transit-f815d";
    process.env.FIREBASE_DATABASE_URL = "https://pu-transit-f815d-default-rtdb.firebaseio.com";
    process.env.UNIVERSITY_EMAIL_DOMAINS = "paruluniversity.ac.in";
    fetchFirebase.mockReset();
    vi.stubGlobal("fetch", fetchFirebase);
  });

  it("refuses a body over 32 kB with 413 before authentication or any database call", async () => {
    const res = await request(app)
      .post("/api/tracking/GJ06BX1414/heartbeat")
      .set("Authorization", "Bearer driver-token")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ tripId: "x".repeat(33 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "Request body too large", code: "PAYLOAD_TOO_LARGE" });
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(fetchFirebase).not.toHaveBeenCalled();
  });

  it("refuses malformed JSON with 400", async () => {
    const res = await request(app)
      .post("/api/tracking/GJ06BX1414/heartbeat")
      .set("Content-Type", "application/json")
      .send('{"tripId":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REQUEST");
  });

  it("carries a 5000-point road path, but the 5001st point, the 501st stop or a 201-character field is refused with 400 and nothing written", async () => {
    signIn(verifyIdToken, "admin");
    const db = fakeDb(fetchFirebase, {
      memberships: { admin: member("admin", "admin") },
      buses: { GJ06BX1414: bus("GJ06BX1414") },
    });
    const save = (body: object) => request(app).post("/api/routes").set("Authorization", "Bearer admin-token").send(body);

    // ~230 kB: far over the general cap, under the route cap.
    const full = await save(routeBody({ pathData: Array.from({ length: 5000 }, (_, index) => point(index)) }));
    expect(full.status).toBe(201);
    const written = writes();

    for (const body of [
      routeBody({ pathData: Array.from({ length: 5001 }, (_, index) => point(index)) }),
      routeBody({ stops: Array.from({ length: 501 }, (_, index) => ({ ...point(index), name: `Stop ${index}` })) }),
      routeBody({ origin: "x".repeat(201) }),
      routeBody({ shift: "" }),
      routeBody({ stops: [{ lat: 22.3, lng: 73.2, name: "x".repeat(201) }] }),
      routeBody({ stops: [{ lat: 22.3, lng: 73.2, name: "Gate", extra: true }] }),
    ]) {
      const refused = await save(body);
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe("INVALID_REQUEST");
    }
    expect(writes()).toBe(written);
    expect(Object.keys(db.at(["routes"]) as object)).toHaveLength(1);
  });

  it("refuses a route body over 512 kB with 413 before validation", async () => {
    signIn(verifyIdToken, "admin");
    fakeDb(fetchFirebase, { memberships: { admin: member("admin", "admin") } });
    const res = await request(app)
      .post("/api/routes")
      .set("Authorization", "Bearer admin-token")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(routeBody({ origin: "x".repeat(600 * 1024) })));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
    expect(fetchFirebase).not.toHaveBeenCalled();
  });

  it("refuses a driver uid that is not a plain database key, in assignment bodies, handover bodies and paths, before any write", async () => {
    signIn(verifyIdToken, "admin");
    fakeDb(fetchFirebase, {
      memberships: { admin: member("admin", "admin"), driver: member("driver", "driver", "GJ06BX1414") },
      buses: { GJ06BX1414: bus("GJ06BX1414") },
    });
    const auth = (req: request.Test) => req.set("Authorization", "Bearer admin-token");
    for (const driverUid of ["driver/../admin", "driver.admin", "$driver", "driver#1", "driver[0]", ""]) {
      const assignment = { driverUid, busId: "GJ06BX1414", routeId: ROUTE, serviceDate: "2099-01-01" };
      expect((await auth(request(app).post("/api/assignments")).send(assignment)).status).toBe(400);
      expect((await auth(request(app).post("/api/tracking/GJ06BX1414/handover")).send({ nextDriverUid: driverUid })).status).toBe(400);
    }
    expect((await auth(request(app).delete("/api/assignments/driver%2F..%2Fadmin/2099-01-01_first-shift_GJ06BX1414"))).status).toBe(400);
    expect(writes()).toBe(0);
  });

  it("refuses membership fields over their bounds with 400 and leaves the record untouched", async () => {
    signIn(verifyIdToken, "admin");
    const db = fakeDb(fetchFirebase, {
      memberships: { admin: member("admin", "admin"), driver: member("driver", "driver", "GJ06BX1414") },
    });
    const before = structuredClone(db.at(["memberships", "driver"]));
    const patch = (body: object) => request(app).patch("/api/memberships/driver").set("Authorization", "Bearer admin-token").send(body);
    for (const body of [
      { assignedBusId: "A".repeat(129) },
      { role: "x".repeat(300) },
      { status: "approved", note: "x".repeat(10) },
      { expiresAt: "2099-01-01" },
    ]) {
      const refused = await patch(body);
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe("INVALID_REQUEST");
    }
    expect(writes()).toBe(0);
    expect(db.at(["memberships", "driver"])).toEqual(before);
  });
});
