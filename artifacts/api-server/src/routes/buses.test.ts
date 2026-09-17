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
import { db } from "@workspace/db";

import { fakeDatabase as fakeDb, signInAs as signIn, member, bus, route, liveFeed, type Json } from "./fake-database";

const fakeDatabase = (initial: Json) => fakeDb(fetchFirebase, initial);
const signInAs = (uid: string) => signIn(verifyIdToken, uid);

const ROUTE_A = "8f3c2a1e-6b7d-4a5e-9c1f-0d2e3f4a5b6c";
const ROUTE_B = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("Bus registry (FLT-01/FLT-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    process.env.FIREBASE_PROJECT_ID = "pu-transit-f815d";
    process.env.FIREBASE_DATABASE_URL = "https://pu-transit-f815d-default-rtdb.firebaseio.com";
    process.env.UNIVERSITY_EMAIL_DOMAINS = "paruluniversity.ac.in";
    fetchFirebase.mockReset();
    vi.stubGlobal("fetch", fetchFirebase);
  });

  it("requires a Firebase token on every registry route", async () => {
    expect((await request(app).get("/api/buses")).status).toBe(401);
    expect((await request(app).post("/api/buses").send({ registration: "GJ06BX1414" })).status).toBe(401);
    expect((await request(app).patch("/api/buses/GJ06BX1414").send({ status: "active" })).status).toBe(401);
    expect(fetchFirebase).not.toHaveBeenCalled();
  });

  it("registers under the normalized key and names the existing record on a duplicate", async () => {
    signInAs("admin");
    const db = fakeDatabase({ memberships: { admin: member("admin", "admin") } });

    const created = await request(app)
      .post("/api/buses")
      .set("Authorization", "Bearer admin-token")
      .send({ registration: " gj 06-bx 1414 ", label: "Waghodia 14" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ busId: "GJ06BX1414", label: "Waghodia 14", status: "active", reason: "" });
    expect(typeof created.body.createdAt).toBe("number");
    expect(db.audits).toEqual([{ action: "bus.save", target: "GJ06BX1414", summary: 'registered "Waghodia 14"' }]);

    const duplicate = await request(app)
      .post("/api/buses")
      .set("Authorization", "Bearer admin-token")
      .send({ registration: "GJ06 BX 1414" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("BUS_EXISTS");
    expect(duplicate.body.error).toContain('"Waghodia 14"');
    expect(db.audits).toHaveLength(1);

    for (const registration of ["-", "a", "1".repeat(21), "बस"]) {
      const bad = await request(app)
        .post("/api/buses")
        .set("Authorization", "Bearer admin-token")
        .send({ registration });
      expect(bad.status, registration).toBe(400);
    }
  });

  it("lists active buses for members and every bus for admins", async () => {
    const data = {
      memberships: { admin: member("admin", "admin"), student: member("student", "student") },
      buses: { GJ06BX1414: bus("GJ06BX1414"), GJ06BX2020: bus("GJ06BX2020", "out_of_service") },
    };
    signInAs("student");
    fakeDatabase(data);
    const forStudent = await request(app).get("/api/buses").set("Authorization", "Bearer student-token");
    expect(forStudent.status).toBe(200);
    expect(forStudent.body.map((b: { busId: string }) => b.busId)).toEqual(["GJ06BX1414"]);

    signInAs("admin");
    fakeDatabase(data);
    const forAdmin = await request(app).get("/api/buses").set("Authorization", "Bearer admin-token");
    expect(forAdmin.body.map((b: { busId: string }) => b.busId)).toEqual(["GJ06BX1414", "GJ06BX2020"]);

    signInAs("student");
    fakeDatabase(data);
    const write = await request(app)
      .post("/api/buses")
      .set("Authorization", "Bearer student-token")
      .send({ registration: "GJ06BX3030" });
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("ROLE_REQUIRED");
  });

  it("refuses to deactivate a bus with a live trip and explains why", async () => {
    signInAs("admin");
    const db = fakeDatabase({
      memberships: { admin: member("admin", "admin") },
      buses: { GJ06BX1414: bus("GJ06BX1414") },
      tracking: { GJ06BX1414: { feed: liveFeed("GJ06BX1414") } },
    });
    const response = await request(app)
      .patch("/api/buses/GJ06BX1414")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "out_of_service", reason: "gearbox" });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("BUS_ACTIVE_TRIP");
    expect(response.body.error).toContain("live trip");
    expect(response.body.error).toContain("4b6e2f4c-1d5e-4c0a-9d3f-2a7b8c9d0e1f");
    expect(db.at(["buses", "GJ06BX1414", "status"])).toBe("active");
    expect(db.audits).toEqual([]);
  });

  it.each(["live trip", "no live trip", "read denied"] as const)(
    "handles a commit-time deactivation refusal with %s without applying or auditing it",
    async (case_) => {
      signInAs("admin");
      const busId = "GJ06BX1414";
      const db = fakeDatabase({
        memberships: { admin: member("admin", "admin") },
        buses: { [busId]: bus(busId) },
      });
      const live = fetchFirebase.getMockImplementation()!;
      let writes = 0;
      fetchFirebase.mockImplementation(async (input: string, init?: RequestInit) => {
        const url = new URL(input);
        expect(url.searchParams.get("auth")).toBe("admin-token");
        if (url.pathname === `/buses/${busId}.json` && init?.method === "PUT") {
          writes++;
          expect(new Headers(init.headers).get("If-Match")).toBeTruthy();
          // The preflight saw no trip. Only tracking changes, so the bus
          // ETag still matches; Firebase refuses under the cross-record Rule.
          if (case_ !== "no live trip") db.store.tracking = { [busId]: { feed: liveFeed(busId) } };
          return new Response("{}", { status: 403 });
        }
        if (writes && case_ === "read denied" && url.pathname === `/tracking/${busId}/feed.json`) {
          return new Response("{}", { status: 403 });
        }
        return live(input, init);
      });
      const response = await request(app).patch(`/api/buses/${busId}`)
        .set("Authorization", "Bearer admin-token").send({ status: "out_of_service", reason: "gearbox" });
      expect(response.status).toBe(case_ === "live trip" ? 409 : 503);
      expect(response.body.code).toBe(case_ === "live trip" ? "BUS_ACTIVE_TRIP" : "FIREBASE_UNAVAILABLE");
      if (case_ === "live trip") expect(response.body.error).toContain("end it from Fleet first");
      expect(writes).toBe(1);
      expect(db.at(["buses", busId])).toEqual(bus(busId));
      expect(db.audits).toEqual([]);
    },
  );

  it("deactivates an idle bus with an audit row, keeps its routes stored and hides them from students", async () => {
    signInAs("admin");
    const data = {
      memberships: { admin: member("admin", "admin"), student: member("student", "student") },
      buses: { GJ06BX1414: bus("GJ06BX1414"), GJ06BX2020: bus("GJ06BX2020") },
      routes: { [ROUTE_A]: route(ROUTE_A, "GJ06BX1414"), [ROUTE_B]: route(ROUTE_B, "GJ06BX2020") },
    };
    const db = fakeDatabase(data);
    const response = await request(app)
      .patch("/api/buses/GJ06BX1414")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "out_of_service", reason: "gearbox" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ busId: "GJ06BX1414", status: "out_of_service", reason: "gearbox" });
    expect(db.audits).toEqual([
      { action: "bus.deactivate", target: "GJ06BX1414", summary: "out of service: gearbox" },
    ]);
    expect(db.at(["routes", ROUTE_A, "busNumber"])).toBe("GJ06BX1414");

    const adminRoutes = await request(app).get("/api/routes").set("Authorization", "Bearer admin-token");
    expect(adminRoutes.body.map((r: { id: string }) => r.id).sort()).toEqual([ROUTE_A, ROUTE_B].sort());

    signInAs("student");
    const studentRoutes = await request(app).get("/api/routes").set("Authorization", "Bearer student-token");
    expect(studentRoutes.status).toBe(200);
    expect(studentRoutes.body.map((r: { id: string }) => r.id)).toEqual([ROUTE_B]);

    signInAs("admin");
    const back = await request(app)
      .patch("/api/buses/GJ06BX1414")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "active" });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ status: "active", reason: "" });
    expect(db.audits.map((a) => a.action)).toEqual(["bus.deactivate", "bus.reactivate"]);
  });

  it.each([
    ["active", "out_of_service", "label"],
    ["active", "out_of_service", "status"],
    ["out_of_service", "active", "label"],
    ["out_of_service", "active", "status"],
  ] as const)("preserves concurrent label and %s → %s edits when %s saves first", async (initialStatus, status, first) => {
    verifyIdToken.mockImplementation(async (token: string) => {
      const uid = token === "labelAdmin-token" ? "labelAdmin" : "statusAdmin";
      return { uid, email: `${uid}@paruluniversity.ac.in`, email_verified: true };
    });
    const busId = "GJ06BX1414";
    const db = fakeDatabase({
      memberships: { labelAdmin: member("labelAdmin", "admin"), statusAdmin: member("statusAdmin", "admin") },
      buses: { [busId]: { ...bus(busId, initialStatus), reason: initialStatus === "active" ? "" : "gearbox" } },
    });
    const live = fetchFirebase.getMockImplementation()!;
    let releaseReads!: () => void;
    const bothRead = new Promise<void>((resolve) => { releaseReads = resolve; });
    let releaseFirstWrite!: () => void;
    const firstWritten = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    let reads = 0;
    const writeStatuses: number[] = [];
    fetchFirebase.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname !== `/buses/${busId}.json`) return live(input, init);
      if (init?.method === "GET" && reads < 2) {
        // Capture the same old snapshot for both admins before either may write.
        const response = await live(input, init);
        if (++reads === 2) releaseReads();
        await bothRead;
        return response;
      }
      if (init?.method === "PUT") {
        const editor = url.searchParams.get("auth") === "labelAdmin-token" ? "label" : "status";
        if (editor !== first) await firstWritten;
        const response = await live(input, init);
        writeStatuses.push(response.status);
        if (editor === first) releaseFirstWrite();
        return response;
      }
      return live(input, init);
    });

    const responses = await Promise.all([
      request(app).patch(`/api/buses/${busId}`).set("Authorization", "Bearer labelAdmin-token").send({ label: "North campus" }),
      request(app).patch(`/api/buses/${busId}`).set("Authorization", "Bearer statusAdmin-token").send({
        status, ...(status === "out_of_service" ? { reason: "gearbox" } : {}),
      }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(db.at(["buses", busId])).toMatchObject({
      busId, label: "North campus", status, reason: status === "active" ? "" : "gearbox", createdAt: 1,
    });
    expect(db.at(["buses", busId, "updatedAt"])).toBeGreaterThan(1);
    expect(writeStatuses).toEqual([200, 412, 200]);
    expect(db.audits).toHaveLength(2);
    expect(db.audits).toEqual(expect.arrayContaining([
      { action: "bus.save", target: busId, summary: `label "${busId}" -> "North campus"` },
      {
        action: status === "active" ? "bus.reactivate" : "bus.deactivate",
        target: busId,
        summary: status === "active" ? "back in service" : "out of service: gearbox",
      },
    ]));
  });

  it("rechecks active trips after a conflicting save before deactivating", async () => {
    signInAs("admin");
    const busId = "GJ06BX1414";
    const db = fakeDatabase({
      memberships: { admin: member("admin", "admin") },
      buses: { [busId]: bus(busId) },
    });
    const live = fetchFirebase.getMockImplementation()!;
    let writes = 0;
    fetchFirebase.mockImplementation(async (input: string, init?: RequestInit) => {
      if (new URL(input).pathname === `/buses/${busId}.json` && init?.method === "PUT") {
        writes++;
        // Another admin saves a label and a driver starts before our write lands.
        db.store.buses = { [busId]: bus(busId, "active", "Other admin's label") };
        db.store.tracking = { [busId]: { feed: liveFeed(busId) } };
      }
      return live(input, init);
    });
    const response = await request(app).patch(`/api/buses/${busId}`)
      .set("Authorization", "Bearer admin-token").send({ status: "out_of_service", reason: "gearbox" });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("BUS_ACTIVE_TRIP");
    expect(writes).toBe(1);
    expect(db.at(["buses", busId])).toMatchObject({ status: "active", label: "Other admin's label" });
    expect(db.audits).toEqual([]);
  });

  it.each([
    ["repeated conflicts", 412, 409, "BUS_CONFLICT", 3],
    ["Rules denial", 403, 503, "FIREBASE_UNAVAILABLE", 1],
    ["provider failure", 500, 503, "FIREBASE_UNAVAILABLE", 1],
  ] as const)("fails safely on %s without auditing an unapplied edit", async (_name, firebaseStatus, status, code, attempts) => {
    signInAs("admin");
    const busId = "GJ06BX1414";
    const db = fakeDatabase({
      memberships: { admin: member("admin", "admin") },
      buses: { [busId]: bus(busId) },
    });
    const live = fetchFirebase.getMockImplementation()!;
    const writes: { token: string | null; etag: string | null }[] = [];
    fetchFirebase.mockImplementation(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === `/buses/${busId}.json` && init?.method === "PUT") {
        writes.push({ token: url.searchParams.get("auth"), etag: new Headers(init.headers).get("If-Match") });
        return new Response("{}", { status: firebaseStatus });
      }
      return live(input, init);
    });
    const response = await request(app).patch(`/api/buses/${busId}`)
      .set("Authorization", "Bearer admin-token").send({ label: "North campus" });
    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
    if (firebaseStatus === 403) {
      // A Rules denial after the API's own gate passed names the refused path (never the token)
      // so an unpublished rules file is diagnosable from the client.
      expect(response.body.error).toContain(`Firebase refused buses/${busId}`);
      expect(response.body.error).toContain("publish the current rules from Setup");
      expect(response.body.error).not.toContain("admin-token");
    } else {
      expect(response.body.error).not.toContain("Firebase refused");
    }
    expect(writes).toHaveLength(attempts);
    expect(writes).toEqual(Array.from({ length: attempts }, () => ({ token: "admin-token", etag: expect.any(String) })));
    expect(db.at(["buses", busId])).toEqual(bus(busId));
    expect(db.audits).toEqual([]);
  });

  it("does not write without a Firebase version or let clients change immutable fields", async () => {
    signInAs("admin");
    const busId = "GJ06BX1414";
    const db = fakeDatabase({
      memberships: { admin: member("admin", "admin") },
      buses: { [busId]: bus(busId) },
    });
    const patch = (body: object) => request(app).patch(`/api/buses/${busId}`).set("Authorization", "Bearer admin-token").send(body);
    for (const body of [{ busId: "GJ06BX2020" }, { createdAt: 2 }, { updatedAt: 2 }]) {
      expect((await patch(body)).status).toBe(400);
    }
    const live = fetchFirebase.getMockImplementation()!;
    fetchFirebase.mockImplementation(async (input: string, init?: RequestInit) => {
      const response = await live(input, init);
      response.headers.delete("etag");
      return response;
    });
    const response = await patch({ label: "North campus" });
    expect(response.status).toBe(503);
    expect(response.body.code).toBe("FIREBASE_UNAVAILABLE");
    expect(fetchFirebase.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    expect(db.at(["buses", busId])).toEqual(bus(busId));
    expect(db.audits).toEqual([]);
  });

  it("reports audit failures after applying an edit without retrying the bus write", async () => {
    signInAs("admin");
    const busId = "GJ06BX1414";
    const db = fakeDatabase({
      memberships: { admin: member("admin", "admin") },
      buses: { [busId]: bus(busId) },
    });
    const live = fetchFirebase.getMockImplementation()!;
    fetchFirebase.mockImplementation(async (input: string, init?: RequestInit) =>
      init?.method === "POST" && new URL(input).pathname === "/audit.json"
        ? new Response("{}", { status: 500 })
        : live(input, init));
    const response = await request(app).patch(`/api/buses/${busId}`)
      .set("Authorization", "Bearer admin-token").send({ label: "North campus" });
    expect(response.status).toBe(502);
    expect(response.body.code).toBe("AUDIT_FAILED");
    expect(db.at(["buses", busId, "label"])).toBe("North campus");
    expect(fetchFirebase.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
    expect(db.audits).toEqual([]);
  });

  it("only assigns registered, in-service buses and stores the canonical key", async () => {
    signInAs("admin");
    const db = fakeDatabase({
      memberships: { admin: member("admin", "admin"), driver: member("driver", "driver", "GJ06BX1414") },
      buses: { GJ06BX1414: bus("GJ06BX1414"), GJ06BX2020: bus("GJ06BX2020", "out_of_service") },
    });
    const patch = (assignedBusId: string) =>
      request(app).patch("/api/memberships/driver").set("Authorization", "Bearer admin-token").send({ assignedBusId });

    const unknown = await patch("GJ06BX9999");
    expect(unknown.status).toBe(409);
    expect(unknown.body.code).toBe("BUS_NOT_REGISTERED");
    const parked = await patch("GJ06BX2020");
    expect(parked.status).toBe(409);
    expect(parked.body.code).toBe("BUS_OUT_OF_SERVICE");
    expect(db.at(["memberships", "driver", "assignedBusId"])).toBe("GJ06BX1414");

    const raw = await patch("gj-06-bx-1414");
    expect(raw.status).toBe(200);
    expect(raw.body.assignedBusId).toBe("GJ06BX1414");

    // An unchanged assignment to a parked bus must not block other membership edits.
    db.store.buses = { GJ06BX1414: bus("GJ06BX1414", "out_of_service") };
    const suspend = await request(app)
      .patch("/api/memberships/driver")
      .set("Authorization", "Bearer admin-token")
      .send({ status: "suspended" });
    expect(suspend.status).toBe(200);
    expect(suspend.body).toMatchObject({ status: "suspended", active: false, assignedBusId: "GJ06BX1414" });
  });

  it("only saves routes for registered buses and stores the canonical key", async () => {
    signInAs("admin");
    const db = fakeDatabase({
      memberships: { admin: member("admin", "admin") },
      buses: { GJ06BX1414: bus("GJ06BX1414") },
    });
    const { id: _id, ...input } = route(ROUTE_A, "PU-99");
    const unknown = await request(app).post("/api/routes").set("Authorization", "Bearer admin-token").send(input);
    expect(unknown.status).toBe(409);
    expect(unknown.body.code).toBe("BUS_NOT_REGISTERED");
    expect(db.at(["routes"])).toBeUndefined();

    const saved = await request(app)
      .post("/api/routes")
      .set("Authorization", "Bearer admin-token")
      .send({ ...input, busNumber: "gj-06-bx-1414" });
    expect(saved.status).toBe(201);
    expect(saved.body.busNumber).toBe("GJ06BX1414");
  });
  it("denies Start on a parked or unregistered bus and tells the driver why (FLT-03)", async () => {
    signInAs("driver");
    const db = fakeDatabase({
      memberships: { driver: member("driver", "driver", "GJ06BX1414") },
      buses: { GJ06BX1414: { ...bus("GJ06BX1414", "out_of_service"), reason: "gearbox" } },
    });
    const start = () =>
      request(app)
        .post("/api/tracking/GJ06BX1414/start")
        .set("Authorization", "Bearer driver-token")
        .send({
          tripId: "4b6e2f4c-1d5e-4c0a-9d3f-2a7b8c9d0e1f",
          publisherId: "9c1f0d2e-3f4a-4b6c-8d7e-1a2b3c4d5e6f",
          expectedGeneration: 0,
          requestedAt: Date.now(),
        });

    const parked = await start();
    expect(parked.status).toBe(403);
    expect(parked.body.code).toBe("BUS_OUT_OF_SERVICE");
    expect(parked.body.error).toContain("gearbox");
    expect(db.at(["tracking"])).toBeUndefined();

    const me = await request(app).get("/api/auth/me").set("Authorization", "Bearer driver-token");
    expect(me.status).toBe(200);
    expect(me.body.bus).toMatchObject({ busId: "GJ06BX1414", status: "out_of_service", reason: "gearbox" });

    db.store.buses = {};
    const unregistered = await start();
    expect(unregistered.status).toBe(403);
    expect(unregistered.body.code).toBe("BUS_NOT_REGISTERED");
    expect((await request(app).get("/api/auth/me").set("Authorization", "Bearer driver-token")).body.bus).toBeNull();
  });

  it.each(["parked", "still active", "read denied"] as const)(
    "handles a commit-time Start refusal when the bus is %s using only the driver's token",
    async (case_) => {
      signInAs("driver");
      const busId = "GJ06BX1414";
      const db = fakeDatabase({
        memberships: { driver: member("driver", "driver", busId) },
        buses: { [busId]: bus(busId) },
      });
      const live = fetchFirebase.getMockImplementation()!;
      let writes = 0;
      fetchFirebase.mockImplementation(async (input: string, init?: RequestInit) => {
        const url = new URL(input);
        expect(url.searchParams.get("auth")).toBe("driver-token");
        if (url.pathname === `/tracking/${busId}.json` && init?.method === "PUT") {
          writes++;
          expect(new Headers(init.headers).get("If-Match")).toBeTruthy();
          if (case_ !== "still active") {
            db.store.buses = { [busId]: { ...bus(busId, "out_of_service"), reason: "gearbox" } };
          }
          return new Response("{}", { status: 403 });
        }
        if (writes && case_ === "read denied" && url.pathname === `/buses/${busId}.json`) {
          return new Response("{}", { status: 403 });
        }
        return live(input, init);
      });
      const response = await request(app).post(`/api/tracking/${busId}/start`)
        .set("Authorization", "Bearer driver-token").send({
          tripId: "4b6e2f4c-1d5e-4c0a-9d3f-2a7b8c9d0e1f",
          publisherId: "9c1f0d2e-3f4a-4b6c-8d7e-1a2b3c4d5e6f",
          expectedGeneration: 0,
          requestedAt: Date.now(),
        });
      expect(response.status).toBe(case_ === "parked" ? 403 : 503);
      expect(response.body.code).toBe(case_ === "parked" ? "BUS_OUT_OF_SERVICE" : "FIREBASE_UNAVAILABLE");
      if (case_ === "parked") expect(response.body.error).toContain("gearbox");
      expect(writes).toBe(1);
      expect(db.at(["tracking"])).toBeUndefined();
      expect(db.audits).toEqual([]);
    },
  );

  it("does not read the registry for suspended drivers (Rules would refuse) so /auth/me still reports the membership", async () => {
    signInAs("driver");
    fakeDatabase({
      memberships: { driver: { ...member("driver", "driver", "GJ06BX1414"), status: "suspended" } },
      buses: { GJ06BX1414: bus("GJ06BX1414") },
    });
    const me = await request(app).get("/api/auth/me").set("Authorization", "Bearer driver-token");
    expect(me.status).toBe(200);
    expect(me.body.membership.status).toBe("suspended");
    expect(me.body.bus).toBeNull();
    expect(fetchFirebase.mock.calls.some(([url]) => String(url).includes("/buses"))).toBe(false);
  });
});

describe("Route publishing (RTE-01)", () => {
  const setup = () => {
    signInAs("admin");
    return fakeDatabase({
      memberships: { admin: member("admin", "admin"), student: member("student", "student") },
      buses: { GJ06BX1414: bus("GJ06BX1414") },
    });
  };
  const post = (body: object) =>
    request(app).post("/api/routes").set("Authorization", "Bearer admin-token").send(body);
  const { id: _id, ...base } = route(ROUTE_A, "GJ06BX1414");
  // Two stops ~1.1 km apart with a road path that runs between them.
  const stops = [
    { lat: 22.3, lng: 73.2, name: "Gate" },
    { lat: 22.31, lng: 73.2, name: "Market" },
  ];
  const roadPath = [
    { lat: 22.3, lng: 73.2 },
    { lat: 22.305, lng: 73.2004 },
    { lat: 22.31, lng: 73.2 },
  ];

  it("refuses to publish without a verified path or the manual acknowledgement, but keeps drafts admin-only", async () => {
    const db = setup();
    const { pathSource: _p, ...unverified } = base;
    const refused = await post(unverified);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("ROUTE_PATH_UNVERIFIED");
    expect(db.at(["routes"])).toBeUndefined();

    const draft = await post({ ...unverified, status: "draft" });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ status: "draft" });
    expect(draft.body.pathSource).toBeUndefined();

    const manual = await post(base);
    expect(manual.status).toBe(201);
    expect(manual.body).toMatchObject({ status: "published", pathSource: "manual" });

    const adminRoutes = await request(app).get("/api/routes").set("Authorization", "Bearer admin-token");
    expect(adminRoutes.body.map((r: { status: string }) => r.status).sort()).toEqual(["draft", "published"]);
    signInAs("student");
    const studentRoutes = await request(app).get("/api/routes").set("Authorization", "Bearer student-token");
    expect(studentRoutes.body).toEqual([manual.body]);
  });

  it("checks an ors path against every stop before accepting it, on drafts too", async () => {
    setup();
    const ok = await post({ ...base, stops, pathData: roadPath, pathSource: "ors" });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ status: "published", pathSource: "ors" });

    const endpointOnly = [roadPath[0], roadPath[2]];
    const farStops = [...stops, { lat: 22.305, lng: 73.21, name: "Bapod" }]; // ~1 km east of the line
    for (const status of ["published", "draft"]) {
      const off = await post({ ...base, status, stops: farStops, pathData: endpointOnly, pathSource: "ors" });
      expect(off.status).toBe(409);
      expect(off.body.code).toBe("ROUTE_PATH_UNVERIFIED");
      expect(off.body.error).toContain("Bapod");
      expect(off.body.error).not.toContain("Market");
    }
    const noPath = await post({ ...base, stops, pathData: [], pathSource: "ors" });
    expect(noPath.status).toBe(409);
    expect(noPath.body.code).toBe("ROUTE_PATH_UNVERIFIED");
  });

  it("imports legacy PostgreSQL routes as drafts and leaves existing records alone", async () => {
    const db_ = fakeDatabase({
      memberships: { admin: member("admin", "admin"), student: member("student", "student") },
      buses: { GJ06BX1414: bus("GJ06BX1414") },
      routes: { [ROUTE_B]: route(ROUTE_B, "GJ06BX1414") },
    });
    signInAs("admin");
    const { status: _s, pathSource: _p, ...legacy } = route(ROUTE_A, "GJ06BX1414");
    const { status: _s2, pathSource: _p2, ...existing } = route(ROUTE_B, "GJ06BX1414");
    vi.mocked(db.select).mockReturnValue({ from: async () => [legacy, existing, { ...legacy, id: ROUTE_A, busNumber: "" }] } as never);

    const response = await request(app).post("/api/migration/import").set("Authorization", "Bearer admin-token").send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ importedRoutes: 1, skippedRoutes: 2 });
    expect(db_.at(["routes", ROUTE_A, "status"])).toBe("draft");
    expect(db_.at(["routes", ROUTE_A, "pathSource"])).toBeUndefined();
    expect(db_.at(["routes", ROUTE_B, "status"])).toBe("published");

    signInAs("student");
    const studentRoutes = await request(app).get("/api/routes").set("Authorization", "Bearer student-token");
    expect(studentRoutes.body.map((r: { id: string }) => r.id)).toEqual([ROUTE_B]);
  });

  it("reads records saved before RTE-01 as published and unverified", async () => {
    const { status: _s, pathSource: _p, ...legacy } = route(ROUTE_B, "GJ06BX1414");
    signInAs("student");
    fakeDatabase({
      memberships: { student: member("student", "student") },
      buses: { GJ06BX1414: bus("GJ06BX1414") },
      routes: { [ROUTE_B]: legacy },
    });
    const response = await request(app).get("/api/routes").set("Authorization", "Bearer student-token");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ ...legacy, status: "published" }]);
  });
});

describe("Route versions and publishing (RTE-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    process.env.FIREBASE_PROJECT_ID = "pu-transit-f815d";
    process.env.FIREBASE_DATABASE_URL = "https://pu-transit-f815d-default-rtdb.firebaseio.com";
    process.env.UNIVERSITY_EMAIL_DOMAINS = "paruluniversity.ac.in";
    fetchFirebase.mockReset();
    vi.stubGlobal("fetch", fetchFirebase);
  });

  const BUS = "GJ06BX1414";
  const OTHER_BUS = "GJ06BX2222";
  const ROUTE_C = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
  const ROUTE_D = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  const as = (uid: string) => ({ Authorization: `Bearer ${uid}-token` });
  const post = (uid: string, body: object) => request(app).post("/api/routes").set(as(uid)).send(body);
  const list = (uid: string) => request(app).get("/api/routes").set(as(uid));
  const { id: _id, ...base } = route(ROUTE_A, BUS);

  it("publishes numbered snapshots, parks edits of a published route as a draft riders never see, and serves old versions", async () => {
    signInAs("admin");
    const db = fakeDatabase({
      memberships: { admin: member("admin", "admin"), student: member("student", "student") },
      buses: { [BUS]: bus(BUS) },
    });

    const v1 = await post("admin", base);
    expect(v1.status).toBe(201);
    expect(v1.body).toMatchObject({ status: "published", publishedVersion: 1 });
    const id = v1.body.id as string;
    expect(v1.body.hasDraft).toBeUndefined();
    expect(db.at(["routeVersions", id, "1"])).toMatchObject({ n: 1, origin: "Waghodia", busNumber: BUS, createdBy: "admin" });
    expect(db.audits.at(-1)?.summary).toContain("published v1");

    const draft = await post("admin", { ...base, id: id, origin: "Bapod", status: "draft" });
    expect(draft.status).toBe(200);
    expect(draft.body).toMatchObject({ origin: "Bapod", status: "published", publishedVersion: 1, hasDraft: true });
    expect(db.at(["routes", id, "origin"])).toBe("Waghodia"); // riders' node untouched
    expect(db.at(["routeDrafts", id])).toMatchObject({ origin: "Bapod", status: "draft" });
    expect(db.audits.at(-1)?.summary).toContain("riders keep v1");
    expect((await list("admin")).body).toEqual([draft.body]);
    signInAs("student");
    expect((await list("student")).body).toEqual([v1.body]);

    signInAs("admin");
    const v2 = await post("admin", { ...base, id: id, origin: "Bapod", status: "published" });
    expect(v2.status).toBe(200);
    expect(v2.body).toMatchObject({ origin: "Bapod", publishedVersion: 2 });
    expect(v2.body.hasDraft).toBeUndefined();
    expect(db.at(["routeDrafts", id])).toBeUndefined();
    expect(db.at(["routeVersions", id, "2", "origin"])).toBe("Bapod");
    signInAs("student");
    expect((await list("student")).body).toEqual([v2.body]);

    const old = await request(app).get(`/api/routes/${id}/versions/1`).set(as("student"));
    expect(old.status).toBe(200);
    expect(old.body).toMatchObject({ n: 1, origin: "Waghodia", stops: base.stops, createdBy: "admin" });
    expect((await request(app).get(`/api/routes/${id}/versions/3`).set(as("student"))).status).toBe(404);
    expect((await request(app).get(`/api/routes/${id}/versions/0`).set(as("student"))).status).toBe(400);
    expect((await post("student", { ...base, publishedVersion: 9 })).status).toBe(403);

    signInAs("admin");
    expect((await post("admin", { ...base, publishedVersion: 9 })).status).toBe(400); // the API numbers versions, not the client

    // RTE-03: a published route is archived, never deleted; its versions and any pending draft stay.
    const refused = await request(app).delete(`/api/routes/${id}`).set(as("admin"));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "ROUTE_PUBLISHED", error: expect.stringContaining("archive it instead") });
    expect(db.at(["routes", id, "publishedVersion"])).toBe(2);
    expect((await post("admin", { ...base, id: id, origin: "Parked", status: "draft" })).status).toBe(200);
    const archived = await request(app).post(`/api/routes/${id}/archive`).set(as("admin"));
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ id, status: "archived", publishedVersion: 2, origin: "Bapod" });
    expect(db.at(["routeDrafts", id, "origin"])).toBe("Parked");
    expect(db.audits.at(-1)).toMatchObject({ action: "route.archive", target: id, summary: expect.stringContaining("archived") });
    expect((await request(app).post(`/api/routes/${id}/archive`).set(as("admin"))).status).toBe(200); // idempotent
    expect((await list("admin")).body).toEqual([expect.objectContaining({ id, status: "archived", hasDraft: true, origin: "Parked" })]);
    signInAs("student");
    expect((await list("student")).body).toEqual([]); // hidden from search
    expect((await request(app).get(`/api/routes/${id}/versions/2`).set(as("student"))).status).toBe(200); // history kept
    signInAs("admin");
    expect((await request(app).delete(`/api/routes/${id}`).set(as("admin"))).body.code).toBe("ROUTE_PUBLISHED");
    const restored = await post("admin", { ...base, id: id, origin: "Bapod", status: "published" });
    expect(restored.status).toBe(200); // publishing again is the way back
    expect(restored.body).toMatchObject({ status: "published", publishedVersion: 3 });
    expect(db.at(["routeDrafts", id])).toBeUndefined();

    // Never-published drafts are the only thing that can go for good, and cannot be archived.
    const scratch = await post("admin", { ...base, origin: "Scratch", status: "draft" });
    expect(scratch.status).toBe(201);
    const noArchive = await request(app).post(`/api/routes/${scratch.body.id}/archive`).set(as("admin"));
    expect(noArchive.status).toBe(409);
    expect(noArchive.body).toMatchObject({ code: "ROUTE_NOT_PUBLISHED", error: expect.stringContaining("delete it instead") });
    expect((await request(app).delete(`/api/routes/${scratch.body.id}`).set(as("admin"))).status).toBe(204);
    expect(db.at(["routes", scratch.body.id])).toBeUndefined();
    expect(db.audits.at(-1)?.action).toBe("route.delete");
    expect((await request(app).post("/api/routes/nope/archive").set(as("admin"))).status).toBe(404);
  });

  it("pins the bus's published versions at Start and keeps them through a republish; only unversioned routes still lock (AC-19)", async () => {
    const versioned = { ...route(ROUTE_A, BUS), publishedVersion: 2 };
    const db = fakeDatabase({
      memberships: { admin: member("admin", "admin"), student: member("student", "student"), driver: member("driver", "driver", BUS) },
      buses: { [BUS]: bus(BUS), [OTHER_BUS]: bus(OTHER_BUS) },
      routes: {
        [ROUTE_A]: versioned,
        [ROUTE_B]: { ...route(ROUTE_B, BUS), status: "draft" },
        [ROUTE_C]: route(ROUTE_C, BUS), // published before versioning: nothing to pin
        [ROUTE_D]: { ...route(ROUTE_D, OTHER_BUS), publishedVersion: 5 },
      },
    });
    signInAs("driver");
    const start = await request(app)
      .post(`/api/tracking/${BUS}/start`)
      .set(as("driver"))
      .send({ tripId: "4b6e2f4c-1d5e-4c0a-9d3f-2a7b8c9d0e1f", publisherId: "9c1f0d2e-3f4a-4b6c-8d7e-1a2b3c4d5e6f", expectedGeneration: 0, requestedAt: Date.now() });
    expect(start.status).toBe(201);
    expect(start.body.feed.routeVersions).toEqual({ [ROUTE_A]: 2 });
    expect(db.at(["tracking", BUS, "feed", "routeVersions"])).toEqual({ [ROUTE_A]: 2 });

    signInAs("admin");
    const republished = await post("admin", { ...base, id: ROUTE_A, destination: "New Campus Gate", status: "published" });
    expect(republished.status).toBe(200); // no lock: the trip keeps v2
    expect(republished.body.publishedVersion).toBe(3);
    signInAs("student");
    const feed = await request(app).get(`/api/tracking/${BUS}`).set(as("student"));
    expect(feed.body.routeVersions).toEqual({ [ROUTE_A]: 2 });
    expect(feed.body.phase).toBe("active");

    signInAs("admin");
    const moved = await post("admin", { ...base, id: ROUTE_A, busNumber: OTHER_BUS, status: "published" });
    expect(moved.status).toBe(409); // riders would be sent to the other bus while this trip runs
    expect(moved.body).toMatchObject({ code: "ROUTE_LOCKED_ACTIVE_TRIP", error: expect.stringContaining("moving this route") });
    expect(db.at(["routes", ROUTE_A, "busNumber"])).toBe(BUS);
    const legacy = await post("admin", { ...base, id: ROUTE_C, destination: "Moved", status: "published" });
    expect(legacy.status).toBe(409);
    expect(legacy.body.code).toBe("ROUTE_LOCKED_ACTIVE_TRIP");
    expect(db.at(["routes", ROUTE_C, "destination"])).toBe("PU Campus");
    const parked = await post("admin", { ...base, id: ROUTE_C, destination: "Moved", status: "draft" });
    expect(parked.status).toBe(200); // a draft never touches what riders see
    expect(parked.body).toMatchObject({ hasDraft: true, destination: "Moved" });
    expect(parked.body.publishedVersion).toBeUndefined();
    // RTE-03 / AC-20: nothing a live trip follows can be archived or deleted; the draft on the same bus can go.
    for (const id of [ROUTE_A, ROUTE_C]) {
      const archive = await request(app).post(`/api/routes/${id}/archive`).set(as("admin"));
      expect(archive.status).toBe(409);
      expect(archive.body).toMatchObject({ code: "ROUTE_LOCKED_ACTIVE_TRIP", error: expect.stringContaining("following this route") });
      expect(db.at(["routes", id, "status"])).toBe("published");
      const removal = await request(app).delete(`/api/routes/${id}`).set(as("admin"));
      expect(removal.status).toBe(409);
      expect(removal.body.code).toBe("ROUTE_PUBLISHED");
    }
    expect((await request(app).delete(`/api/routes/${ROUTE_B}`).set(as("admin"))).status).toBe(204);
    expect((await request(app).post(`/api/routes/${ROUTE_D}/archive`).set(as("admin"))).status).toBe(200); // other bus is idle
  });

  it("creates under a client-chosen id once and lands a retried save on the same route, while an edit of a gone route still 404s (RTE-04, AC-21)", async () => {
    signInAs("admin");
    const db = fakeDatabase({
      memberships: { admin: member("admin", "admin") },
      buses: { [BUS]: bus(BUS) },
    });
    const put = (body: object) => request(app).put(`/api/routes/${ROUTE_C}`).set(as("admin")).send(body);

    const created = await put({ ...base, status: "draft" });
    expect(created.status).toBe(201);
    expect(created.body.id).toBe(ROUTE_C);
    // The client never saw that response and sends the same draft again: same node, audited as a replay.
    const replayed = await put({ ...base, status: "draft" });
    expect(replayed.status).toBe(200);
    expect(replayed.body.id).toBe(ROUTE_C);
    expect(Object.keys(db.at(["routes"]) as object)).toEqual([ROUTE_C]);
    expect((await list("admin")).body).toHaveLength(1);
    const saves = () => db.audits.filter((entry) => entry.action === "route.save").map((entry) => entry.summary);
    expect(saves()).toEqual([expect.stringContaining("; draft"), expect.stringContaining("draft (replayed, unchanged)")]);

    // A lost publish response, then the same publish again: still v1 and one version snapshot.
    expect((await put(base)).body.publishedVersion).toBe(1);
    const republished = await put(base);
    expect(republished.status).toBe(200);
    expect(republished.body.publishedVersion).toBe(1);
    expect(Object.keys(db.at(["routeVersions", ROUTE_C]) as object)).toEqual(["1"]);
    expect(saves().at(-1)).toContain("published v1 (replayed, unchanged)");

    // The write landed but its audit line did not (502): the exact retry still leaves an audit line behind.
    const live = fetchFirebase.getMockImplementation()!;
    let auditDown = true;
    fetchFirebase.mockImplementation(async (input: string, init?: RequestInit) => {
      if (auditDown && init?.method === "POST" && String(input).includes("/audit")) {
        auditDown = false;
        return new Response("{}", { status: 500 });
      }
      return live(input, init);
    });
    const unaudited = await put({ ...base, destination: "Moved" });
    expect(unaudited.status).toBe(502);
    expect(unaudited.body.code).toBe("AUDIT_FAILED");
    expect(db.at(["routes", ROUTE_C, "publishedVersion"])).toBe(2);
    const before = saves().length;
    const retried = await put({ ...base, destination: "Moved" });
    expect(retried.status).toBe(200);
    expect(retried.body.publishedVersion).toBe(2); // no v3 for a retry
    expect(saves()).toHaveLength(before + 1);
    expect(saves().at(-1)).toContain("Moved; bus GJ06BX1414; published v2 (replayed, unchanged)");

    expect((await put({ ...base, id: ROUTE_D })).status).toBe(400); // body id must match the path
    expect((await request(app).put("/api/routes/not-a-uuid").set(as("admin")).send(base)).status).toBe(400); // Rules key routes by UUID
    // POST with an id is still the edit path: a route that no longer exists is not re-created.
    expect((await post("admin", { ...base, id: ROUTE_D })).status).toBe(404);
    expect(db.at(["routes", ROUTE_D])).toBeUndefined();
  });
});
