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
import { serviceDateAt, serviceDayBounds } from "../lib/assignments";
import { fakeDatabase as fakeDb, member, bus, route } from "./fake-database";

const ROOT_UID = "hqKU3amnTzVBT3yF3p4DMRnirDq1";
const BUS = "GJ06BX1414";
const ROUTE = "8f3c2a1e-6b7d-4a5e-9c1f-0d2e3f4a5b6c";
const TRIP = "4b6e2f4c-1d5e-4c0a-9d3f-2a7b8c9d0e1f";
const PUBLISHER = "9c1f0d2e-3f4a-4b6c-8d7e-1a2b3c4d5e6f";

const signIn = (uid: string): void => {
  verifyIdToken.mockImplementation(async (token: string) => {
    if (token !== `${uid}-token`) throw new Error("bad token");
    return { uid, email: `${uid}@paruluniversity.ac.in`, email_verified: true };
  });
};

describe("owner admin driver capability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimits();
    process.env.FIREBASE_PROJECT_ID = "pu-transit-f815d";
    process.env.FIREBASE_DATABASE_URL = "https://pu-transit-f815d-default-rtdb.firebaseio.com";
    process.env.UNIVERSITY_EMAIL_DOMAINS = "paruluniversity.ac.in";
    fetchFirebase.mockReset();
    vi.stubGlobal("fetch", fetchFirebase);
  });

  it("keeps root admin role, exposes the bus and dated assignments, and completes a trip", async () => {
    signIn(ROOT_UID);
    const serviceDate = serviceDateAt(Date.now());
    const assignmentId = `${serviceDate}_firstshift_${BUS}`;
    const bounds = serviceDayBounds(serviceDate)!;
    const db = fakeDb(fetchFirebase, {
      memberships: {
        [ROOT_UID]: member(ROOT_UID, "admin", BUS),
        admin: member("admin", "admin"),
      },
      buses: { [BUS]: bus(BUS) },
      routes: { [ROUTE]: { ...route(ROUTE, BUS), publishedVersion: 1 } },
      assignments: {
        [ROOT_UID]: {
          [assignmentId]: {
            id: assignmentId,
            driverUid: ROOT_UID,
            driverEmail: `${ROOT_UID}@paruluniversity.ac.in`,
            busId: BUS,
            routeId: ROUTE,
            routeVersion: 1,
            shift: "First Shift",
            serviceDate,
            ...bounds,
            createdAt: 1,
            createdBy: "admin",
          },
        },
      },
    });

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${ROOT_UID}-token`);
    expect(me.status).toBe(200);
    expect(me.body.membership).toMatchObject({ uid: ROOT_UID, role: "admin", assignedBusId: BUS });
    expect(me.body.bus).toMatchObject({ busId: BUS });
    expect(me.body.assignments).toHaveLength(1);

    const selfAssignment = await request(app)
      .patch(`/api/memberships/${ROOT_UID}`)
      .set("Authorization", `Bearer ${ROOT_UID}-token`)
      .send({ assignedBusId: BUS });
    expect(selfAssignment.status).toBe(200);
    expect(selfAssignment.body).toMatchObject({ uid: ROOT_UID, role: "admin", assignedBusId: BUS });

    const selfExpiry = await request(app)
      .patch(`/api/memberships/${ROOT_UID}`)
      .set("Authorization", `Bearer ${ROOT_UID}-token`)
      .send({ expiresAt: Date.now() + 60_000 });
    expect(selfExpiry.status).toBe(403);
    expect(selfExpiry.body.code).toBe("SELF_DEMOTION_FORBIDDEN");

    const start = await request(app)
      .post(`/api/tracking/${BUS}/start`)
      .set("Authorization", `Bearer ${ROOT_UID}-token`)
      .send({ tripId: TRIP, publisherId: PUBLISHER, expectedGeneration: 0, requestedAt: Date.now() });
    expect(start.status).toBe(201);

    const sample = await request(app)
      .post(`/api/tracking/${BUS}/sample`)
      .set("Authorization", `Bearer ${ROOT_UID}-token`)
      .send({
        tripId: TRIP,
        publisherId: PUBLISHER,
        generation: 1,
        sequence: 1,
        capturedAt: Date.now(),
        lat: 22.3,
        lng: 73.2,
        accuracy: 10,
      });
    expect(sample.status).toBe(200);

    const heartbeat = await request(app)
      .post(`/api/tracking/${BUS}/heartbeat`)
      .set("Authorization", `Bearer ${ROOT_UID}-token`)
      .send({ tripId: TRIP, publisherId: PUBLISHER, generation: 1, sequence: 2 });
    expect(heartbeat.status).toBe(200);

    const end = await request(app)
      .post(`/api/tracking/${BUS}/end`)
      .set("Authorization", `Bearer ${ROOT_UID}-token`)
      .send({ tripId: TRIP, publisherId: PUBLISHER, generation: 1, requestedAt: Date.now() });
    expect(end.status).toBe(200);
    expect(end.body.feed.phase).toBe("ended");
    expect(db.at(["tracking", BUS, "driverUid"])).toBe(ROOT_UID);
  });

  it("keeps ordinary admins from driving and from editing root", async () => {
    signIn("admin");
    fakeDb(fetchFirebase, {
      memberships: {
        admin: member("admin", "admin"),
        [ROOT_UID]: member(ROOT_UID, "admin", BUS),
      },
      buses: { [BUS]: bus(BUS) },
      routes: { [ROUTE]: { ...route(ROUTE, BUS), publishedVersion: 1 } },
    });

    const start = await request(app)
      .post(`/api/tracking/${BUS}/start`)
      .set("Authorization", "Bearer admin-token")
      .send({ tripId: TRIP, publisherId: PUBLISHER, expectedGeneration: 0, requestedAt: Date.now() });
    expect(start.status).toBe(403);
    expect(start.body.code).toBe("ROLE_REQUIRED");

    const edit = await request(app)
      .patch(`/api/memberships/${ROOT_UID}`)
      .set("Authorization", "Bearer admin-token")
      .send({ assignedBusId: "" });
    expect(edit.status).toBe(403);
    expect(edit.body.code).toBe("ROOT_ADMIN_PROTECTED");

    const assignment = await request(app)
      .post("/api/assignments")
      .set("Authorization", "Bearer admin-token")
      .send({ driverUid: ROOT_UID, busId: BUS, routeId: ROUTE, serviceDate: serviceDateAt(Date.now()) });
    expect(assignment.status).toBe(403);
    expect(assignment.body.code).toBe("ROOT_ADMIN_PROTECTED");
  });

  it("does not change ordinary driver lifecycle access", async () => {
    signIn("driver");
    const db = fakeDb(fetchFirebase, {
      memberships: { driver: member("driver", "driver", BUS) },
      buses: { [BUS]: bus(BUS) },
      routes: { [ROUTE]: { ...route(ROUTE, BUS), publishedVersion: 1 } },
    });

    const start = await request(app)
      .post(`/api/tracking/${BUS}/start`)
      .set("Authorization", "Bearer driver-token")
      .send({ tripId: TRIP, publisherId: PUBLISHER, expectedGeneration: 0, requestedAt: Date.now() });
    expect(start.status).toBe(201);
    expect(db.at(["tracking", BUS, "driverUid"])).toBe("driver");
  });
});