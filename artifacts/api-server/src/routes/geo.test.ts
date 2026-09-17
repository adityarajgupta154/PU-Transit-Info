import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { verifyIdToken, fetchMock, getApps, initializeApp } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  fetchMock: vi.fn(),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({ name: "pu-transit-api" })),
}));

vi.mock("firebase-admin/app", () => ({ getApps, initializeApp }));
vi.mock("firebase-admin/auth", () => ({
  getAuth: vi.fn(() => ({ verifyIdToken })),
}));

import app from "../app";
import { resetRateLimits } from "../middleware/rate-limit";

const ORS_KEY = "unit-test-key";
const boundsPoint = { lat: 22.3, lng: 73.2 };

type Identity = {
  uid: string;
  email: string;
  email_verified: boolean;
};

function memberFor(identity: Identity, overrides: Record<string, unknown> = {}) {
  return {
    uid: identity.uid,
    email: identity.email,
    role: "admin",
    status: "approved",
    active: true,
    assignedBusId: "",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function identityFor(token: string, email = `${token}@paruluniversity.ac.in`): Identity {
  return { uid: token, email, email_verified: true };
}

function orsCalls(): Array<[string, RequestInit | undefined]> {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("https://api.openrouteservice.org"),
  ) as Array<[string, RequestInit | undefined]>;
}

function setAuthorized(
  token: string,
  overrides: Record<string, unknown> = {},
  email = `${token}@paruluniversity.ac.in`,
): Identity {
  const identity = identityFor(token, email);
  const member = memberFor(identity, overrides);
  verifyIdToken.mockImplementation(async (candidate: string) => {
    if (candidate !== token) throw new Error("invalid test token");
    return identity;
  });
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/memberships/")) {
      return new Response(JSON.stringify(member), { status: 200 });
    }
    return new Response(JSON.stringify({ features: [] }), { status: 200 });
  });
  return identity;
}

describe("Geo API OpenRouteService boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyIdToken.mockReset();
    fetchMock.mockReset();
    resetRateLimits();
    process.env.FIREBASE_PROJECT_ID = "pu-transit-f815d";
    process.env.FIREBASE_DATABASE_URL =
      "https://pu-transit-f815d-default-rtdb.firebaseio.com";
    process.env.UNIVERSITY_EMAIL_DOMAINS = "paruluniversity.ac.in";
    process.env.ORS_API_KEY = ORS_KEY;
    vi.stubGlobal("fetch", fetchMock);
  });

  it("suggests places from ORS autocomplete, boxed to Vadodara, and never puts the key in the URL", async () => {
    setAuthorized("geo-geocode-success");
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/memberships/")) {
        return new Response(
          JSON.stringify(memberFor(identityFor("geo-geocode-success"))),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          features: [
            {
              geometry: { type: "Point", coordinates: [boundsPoint.lng, boundsPoint.lat] },
              properties: {
                name: "Waghodia Bus Depot",
                label: "Waghodia Bus Depot, Vadodara, GJ, India",
                layer: "venue",
                neighbourhood: "Waghodia",
                locality: "Vadodara",
                county: "Vadodara",
              },
            },
            {
              // Same venue from a second source: reported once.
              geometry: { type: "Point", coordinates: [boundsPoint.lng, boundsPoint.lat] },
              properties: { name: "Waghodia Bus Depot", neighbourhood: "Waghodia", locality: "Vadodara" },
            },
            {
              // Name repeated in the area fields: no detail.
              geometry: { type: "Point", coordinates: [73.3638, 22.2887] },
              properties: { name: "Parul University", locality: "Parul University", county: "Parul University" },
            },
            {
              // Only a label: it stands in for the name.
              geometry: { type: "Point", coordinates: [73.19, 22.31] },
              properties: { label: "Alkapuri, Vadodara, GJ, India", county: "Vadodara" },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const response = await request(app)
      .post("/api/geo/geocode")
      .set("Authorization", "Bearer geo-geocode-success")
      .send({ query: "Wagh" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      places: [
        { name: "Waghodia Bus Depot", detail: "Waghodia, Vadodara", lat: boundsPoint.lat, lng: boundsPoint.lng },
        { name: "Parul University", detail: "", lat: 22.2887, lng: 73.3638 },
        { name: "Alkapuri, Vadodara, GJ, India", detail: "Vadodara", lat: 22.31, lng: 73.19 },
      ],
    });
    const [url, init] = orsCalls()[0]!;
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://api.openrouteservice.org/geocode/autocomplete");
    expect(parsed.searchParams.get("text")).toBe("Wagh");
    expect(parsed.searchParams.get("boundary.country")).toBe("IN");
    expect(parsed.searchParams.get("boundary.rect.min_lat")).toBe("22.15");
    expect(parsed.searchParams.get("boundary.rect.max_lat")).toBe("22.45");
    expect(parsed.searchParams.get("boundary.rect.min_lon")).toBe("72.95");
    expect(parsed.searchParams.get("boundary.rect.max_lon")).toBe("73.4");
    expect(parsed.searchParams.get("focus.point.lat")).toBe("22.3072");
    expect(parsed.searchParams.get("focus.point.lon")).toBe("73.1812");
    expect(parsed.searchParams.get("layers")).toBe("venue,address,street,locality,localadmin,borough,neighbourhood");
    expect(parsed.searchParams.get("size")).toBe("8");
    expect(url).not.toContain("api_key");
    expect((init?.headers as Record<string, string>).Authorization).toBe(ORS_KEY);
    expect(JSON.stringify(response.body)).not.toContain(ORS_KEY);
  });

  it("returns an empty list for no matches, drops places outside Vadodara, and caps the list at eight", async () => {
    setAuthorized("geo-geocode-null");
    const feature = (lng: number, lat: number, name: string) => ({
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { name },
    });
    const provider = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ features: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: [feature(77.2, 28.6, "New Delhi"), feature(73.403, 22.31, "Waghodia PHC"), feature(73.2, 22.3, "Sayajigunj")],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            features: Array.from({ length: 12 }, (_, index) => feature(73.2 + index * 0.001, 22.3, `Place ${index + 1}`)),
          }),
          { status: 200 },
        ),
      );
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/memberships/")) {
        return new Response(
          JSON.stringify(memberFor(identityFor("geo-geocode-null"))),
          { status: 200 },
        );
      }
      return provider();
    });

    const send = (query: string) =>
      request(app).post("/api/geo/geocode").set("Authorization", "Bearer geo-geocode-null").send({ query });
    const empty = await send("Unknown");
    const outside = await send("New Delhi");
    const many = await send("Place");

    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ places: [] });
    expect(outside.status).toBe(200);
    expect(outside.body).toEqual({ places: [{ name: "Sayajigunj", detail: "", lat: 22.3, lng: 73.2 }] });
    expect(many.status).toBe(200);
    expect(many.body.places).toHaveLength(8);
    expect(many.body.places[0]).toEqual({ name: "Place 1", detail: "", lat: 22.3, lng: 73.2 });
  });

  it("returns the complete directions path in lat/lng order", async () => {
    setAuthorized("geo-directions-success");
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/memberships/")) {
        return new Response(
          JSON.stringify(memberFor(identityFor("geo-directions-success"))),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          features: [
            {
              geometry: {
                type: "LineString",
                coordinates: [
                  [73.1, 22.2],
                  [73.15, 22.25],
                  [73.2, 22.3],
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const response = await request(app)
      .post("/api/geo/directions")
      .set("Authorization", "Bearer geo-directions-success")
      .send({ start: { lat: 22.2, lng: 73.1 }, end: boundsPoint, via: [{ lat: 22.25, lng: 73.15 }] });

    expect(response.status).toBe(200);
    expect(response.body.path).toEqual([
      { lat: 22.2, lng: 73.1 },
      { lat: 22.25, lng: 73.15 },
      boundsPoint,
    ]);
    const [, init] = orsCalls()[0]!;
    // RTE-01: intermediate stops travel to ORS in order, so the geometry covers every leg.
    expect(JSON.parse(String(init?.body))).toEqual({
      coordinates: [
        [73.1, 22.2],
        [73.15, 22.25],
        [73.2, 22.3],
      ],
    });
    expect(init?.redirect).toBe("error");
  });

  it("denies anonymous, unverified, non-admin, pending, suspended, inactive, expired, and mismatched callers before ORS", async () => {
    const anonymous = await request(app)
      .post("/api/geo/geocode")
      .send({ query: "Station" });
    const anonymousDirections = await request(app)
      .post("/api/geo/directions")
      .send({ start: { lat: 22.2, lng: 73.1 }, end: boundsPoint });
    expect(anonymous.status).toBe(401);
    expect(anonymousDirections.status).toBe(401);

    verifyIdToken.mockRejectedValueOnce({ code: "auth/invalid-id-token" });
    const invalidToken = await request(app)
      .post("/api/geo/geocode")
      .set("Authorization", "Bearer invalid-geo-token")
      .send({ query: "Station" });
    verifyIdToken.mockRejectedValueOnce({ code: "auth/invalid-id-token" });
    const invalidTokenDirections = await request(app)
      .post("/api/geo/directions")
      .set("Authorization", "Bearer invalid-geo-token")
      .send({ start: { lat: 22.2, lng: 73.1 }, end: boundsPoint });
    expect(invalidToken.status).toBe(401);
    expect(invalidTokenDirections.status).toBe(401);

    const cases = [
      {
        token: "geo-unverified",
        identity: { ...identityFor("geo-unverified"), email_verified: false },
        member: {},
      },
      {
        token: "geo-student",
        identity: identityFor("geo-student"),
        member: { role: "student" },
      },
      {
        token: "geo-pending",
        identity: identityFor("geo-pending"),
        member: { status: "pending" },
      },
      {
        token: "geo-suspended",
        identity: identityFor("geo-suspended"),
        member: { status: "suspended" },
      },
      {
        token: "geo-inactive",
        identity: identityFor("geo-inactive"),
        member: { active: false },
      },
      {
        token: "geo-expired",
        identity: identityFor("geo-expired", "geo-expired@gmail.com"),
        member: { createdAt: Date.now() - 31 * 24 * 60 * 60 * 1000 },
      },
      {
        token: "geo-mismatch",
        identity: identityFor("geo-mismatch"),
        member: { email: "other@paruluniversity.ac.in" },
      },
    ];

    for (const testCase of cases) {
      verifyIdToken.mockResolvedValueOnce(testCase.identity);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify(memberFor(testCase.identity, testCase.member)),
          { status: 200 },
        ),
      );
      const response = await request(app)
        .post("/api/geo/geocode")
        .set("Authorization", `Bearer ${testCase.token}`)
        .send({ query: "Station" });
      verifyIdToken.mockResolvedValueOnce(testCase.identity);
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify(memberFor(testCase.identity, testCase.member)),
          { status: 200 },
        ),
      );
      const directions = await request(app)
        .post("/api/geo/directions")
        .set("Authorization", `Bearer ${testCase.token}`)
        .send({ start: { lat: 22.2, lng: 73.1 }, end: boundsPoint });
      expect(response.status).toBe(403);
      expect(directions.status).toBe(403);
    }
    expect(orsCalls()).toHaveLength(0);
  });

  it("returns an explicit error when ORS is not configured", async () => {
    setAuthorized("geo-no-secret");
    delete process.env.ORS_API_KEY;

    const response = await request(app)
      .post("/api/geo/geocode")
      .set("Authorization", "Bearer geo-no-secret")
      .send({ query: "Station" });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: "OpenRouteService is not configured",
      code: "ORS_NOT_CONFIGURED",
    });
    expect(orsCalls()).toHaveLength(0);
  });

  it("rejects invalid and unknown request fields before ORS", async () => {
    setAuthorized("geo-invalid-input");
    const requests = [
      ["/api/geo/geocode", { query: "   " }],
      ["/api/geo/geocode", { query: "Station", extra: true }],
      ["/api/geo/geocode", { query: "x".repeat(201) }],
      ["/api/geo/directions", { start: boundsPoint, end: { ...boundsPoint, extra: 1 } }],
      ["/api/geo/directions", { start: { lat: 22.1, lng: 73.2 }, end: boundsPoint }],
      ["/api/geo/directions", { start: boundsPoint }],
      ["/api/geo/directions", { start: boundsPoint, end: boundsPoint, via: [{ lat: 22.1, lng: 73.2 }] }],
      ["/api/geo/directions", { start: boundsPoint, end: boundsPoint, via: Array.from({ length: 49 }, () => boundsPoint) }],
    ] as const;

    for (const [path, body] of requests) {
      const response = await request(app)
        .post(path)
        .set("Authorization", "Bearer geo-invalid-input")
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe("INVALID_REQUEST");
    }
    expect(orsCalls()).toHaveLength(0);
  });

  it("rate limits an authenticated caller without truncating provider traffic", async () => {
    setAuthorized("geo-rate-limit");
    let providerCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/memberships/")) {
        return new Response(
          JSON.stringify(memberFor(identityFor("geo-rate-limit"))),
          { status: 200 },
        );
      }
      providerCalls += 1;
      return new Response(JSON.stringify({ features: [] }), { status: 200 });
    });

    const responses = [];
    for (let index = 0; index < 31; index += 1) {
      responses.push(
        await request(app)
          .post("/api/geo/geocode")
          .set("Authorization", "Bearer geo-rate-limit")
          .send({ query: `Station ${index}` }),
      );
    }

    expect(responses.at(-1)?.status).toBe(429);
    expect(responses.at(-1)?.headers["retry-after"]).toBeDefined();
    expect(providerCalls).toBe(30);
  });

  it("maps provider auth and server failures to controlled provider errors", async () => {
    setAuthorized("geo-provider-errors");
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/memberships/")) {
        return new Response(
          JSON.stringify(memberFor(identityFor("geo-provider-errors"))),
          { status: 200 },
        );
      }
      return new Response("provider key unit-test-key", {
        status: fetchMock.mock.calls.filter(([candidate]) =>
          String(candidate).startsWith("https://api.openrouteservice.org"),
        ).length === 1
          ? 401
          : 500,
      });
    });

    const authFailure = await request(app)
      .post("/api/geo/geocode")
      .set("Authorization", "Bearer geo-provider-errors")
      .send({ query: "Station" });
    const serverFailure = await request(app)
      .post("/api/geo/geocode")
      .set("Authorization", "Bearer geo-provider-errors")
      .send({ query: "Station" });

    expect(authFailure.status).toBe(502);
    expect(authFailure.body.code).toBe("ORS_PROVIDER_ERROR");
    expect(serverFailure.status).toBe(502);
    expect(serverFailure.body.code).toBe("ORS_PROVIDER_ERROR");
    expect(JSON.stringify(authFailure.body)).not.toContain(ORS_KEY);
    expect(JSON.stringify(serverFailure.body)).not.toContain(ORS_KEY);
  });

  it("rejects malformed, empty, and invalid provider geometry", async () => {
    setAuthorized("geo-malformed");
    const responses = [
      new Response("", { status: 200 }),
      new Response(JSON.stringify({}), { status: 200 }),
      new Response(
        JSON.stringify({
          features: [{ geometry: { type: "LineString", coordinates: [73.1, 22.2] } }],
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          features: [{ geometry: { type: "Point", coordinates: [73.1, 22.2] } }],
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          features: [{ geometry: { type: "LineString", coordinates: [] } }],
        }),
        { status: 200 },
      ),
    ];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/memberships/")) {
        return new Response(
          JSON.stringify(memberFor(identityFor("geo-malformed"))),
          { status: 200 },
        );
      }
      return responses.shift()!;
    });

    const malformedGeocode = await request(app)
      .post("/api/geo/geocode")
      .set("Authorization", "Bearer geo-malformed")
      .send({ query: "Station" });
    const emptyGeocode = await request(app)
      .post("/api/geo/geocode")
      .set("Authorization", "Bearer geo-malformed")
      .send({ query: "Station" });
    const geocodeWrongType = await request(app)
      .post("/api/geo/geocode")
      .set("Authorization", "Bearer geo-malformed")
      .send({ query: "Station" });
    const wrongType = await request(app)
      .post("/api/geo/directions")
      .set("Authorization", "Bearer geo-malformed")
      .send({ start: { lat: 22.2, lng: 73.1 }, end: boundsPoint });
    const emptyPath = await request(app)
      .post("/api/geo/directions")
      .set("Authorization", "Bearer geo-malformed")
      .send({ start: { lat: 22.2, lng: 73.1 }, end: boundsPoint });

    for (const response of [
      malformedGeocode,
      emptyGeocode,
      geocodeWrongType,
      wrongType,
      emptyPath,
    ]) {
      expect(response.status).toBe(502);
      expect(response.body.code).toBe("ORS_INVALID_RESPONSE");
    }
  });

  it("bounds chunked provider responses without a content-length header", async () => {
    setAuthorized("geo-oversize");
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/memberships/")) {
        return new Response(JSON.stringify(memberFor(identityFor("geo-oversize"))), {
          status: 200,
        });
      }
      const chunks = [new Uint8Array(1_100_000), new Uint8Array(1_100_000)];
      let index = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index === chunks.length) {
            controller.close();
            return;
          }
          controller.enqueue(chunks[index]!);
          index += 1;
        },
      });
      return new Response(body, { status: 200 });
    });

    const response = await request(app)
      .post("/api/geo/geocode")
      .set("Authorization", "Bearer geo-oversize")
      .send({ query: "Station" });

    expect(response.status).toBe(502);
    expect(response.body.code).toBe("ORS_RESPONSE_TOO_LARGE");
  });

  it("handles network and timeout failures without exposing provider details", async () => {
    setAuthorized("geo-network-timeout");
    fetchMock
      .mockImplementationOnce(async () =>
        new Response(
          JSON.stringify(memberFor(identityFor("geo-network-timeout"))),
          { status: 200 },
        ),
      )
      .mockRejectedValueOnce(new TypeError("network unit-test-key"));

    const network = await request(app)
      .post("/api/geo/geocode")
      .set("Authorization", "Bearer geo-network-timeout")
      .send({ query: "Station" });
    expect(network.status).toBe(502);
    expect(network.body.code).toBe("ORS_NETWORK_ERROR");
    expect(JSON.stringify(network.body)).not.toContain(ORS_KEY);
  });

  it("starts the end-to-end timeout before the provider fetch settles", async () => {
    setAuthorized("geo-timeout");
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/memberships/")) {
        return new Response(JSON.stringify(memberFor(identityFor("geo-timeout"))), {
          status: 200,
        });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });
    });

    const response = await request(app)
      .post("/api/geo/geocode")
      .set("Authorization", "Bearer geo-timeout")
      .send({ query: "Station" });
    expect(response.status).toBe(502);
    expect(response.body.code).toBe("ORS_TIMEOUT");
  }, 20_000);
});