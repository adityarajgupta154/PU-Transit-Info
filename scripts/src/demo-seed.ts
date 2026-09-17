import assert from "node:assert/strict";

export const DEMO_PROJECT_ID = "demo-pu-transit";
export const DEMO_DATABASE_HOST = "127.0.0.1:9000";
export const DEMO_AUTH_HOST = "127.0.0.1:9099";
export const DEMO_DATABASE_URL = "http://127.0.0.1:9000";
export const DEMO_DATABASE_NAMESPACE = "demo-pu-transit-default-rtdb";
export const DEMO_AUTH_URL = "http://127.0.0.1:9099";
export const DEMO_PASSWORD = "DemoTransit123!";
export const DEMO_ROUTE_ID = "11111111-1111-4111-8111-111111111111";

type DemoUser = {
  uid: string;
  email: string;
  role: "student" | "driver" | "admin";
  assignedBusId: string;
};

export const DEMO_USERS: readonly DemoUser[] = [
  {
    uid: "demo-student",
    email: "student@paruluniversity.ac.in",
    role: "student",
    assignedBusId: "",
  },
  {
    uid: "demo-driver",
    email: "driver@paruluniversity.ac.in",
    role: "driver",
    assignedBusId: "BUS1",
  },
  {
    uid: "demo-admin",
    email: "admin@paruluniversity.ac.in",
    role: "admin",
    assignedBusId: "",
  },
];

const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TERM",
  "CI",
  "PNPM_HOME",
] as const;

/** The demo deliberately does not inherit credentials, database URLs, or API keys. */
export function demoEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: source.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  };
  for (const name of ENV_ALLOWLIST) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  Object.assign(environment, {
    PU_TRANSIT_DEMO: "1",
    VITE_PU_TRANSIT_DEMO: "1",
    NODE_ENV: "development",
    FIREBASE_PROJECT_ID: DEMO_PROJECT_ID,
    FIREBASE_DATABASE_URL: DEMO_DATABASE_URL,
    FIREBASE_AUTH_EMULATOR_HOST: DEMO_AUTH_HOST,
    FIREBASE_DATABASE_EMULATOR_HOST: DEMO_DATABASE_HOST,
    GCLOUD_PROJECT: DEMO_PROJECT_ID,
  });
  return environment;
}

export function assertDemoEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
  const expected: Record<string, string> = {
    PU_TRANSIT_DEMO: "1",
    FIREBASE_PROJECT_ID: DEMO_PROJECT_ID,
    FIREBASE_DATABASE_URL: DEMO_DATABASE_URL,
    FIREBASE_AUTH_EMULATOR_HOST: DEMO_AUTH_HOST,
    FIREBASE_DATABASE_EMULATOR_HOST: DEMO_DATABASE_HOST,
    GCLOUD_PROJECT: DEMO_PROJECT_ID,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (environment[name] !== value) {
      throw new Error(`Refusing demo seed: ${name} must be exactly ${value}.`);
    }
  }
  if (environment.VITE_PU_TRANSIT_DEMO !== "1") {
    throw new Error("Refusing demo seed: VITE_PU_TRANSIT_DEMO must be exactly 1.");
  }
  if (environment.NODE_ENV !== "development") {
    throw new Error("Refusing demo seed: NODE_ENV must be exactly development.");
  }
}

function databaseUrl(path = ""): string {
  const url = new URL(`${DEMO_DATABASE_URL}/${path ? `${path}/` : ""}.json`);
  url.searchParams.set("ns", DEMO_DATABASE_NAMESPACE);
  return url.toString();
}

async function databaseRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(databaseUrl(path), {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      // Emulator administration uses this header, not the ID-token auth query.
      Authorization: "Bearer owner",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Demo RTDB request failed: HTTP ${response.status}.`);
  }
  return response.json();
}

async function authRequest(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${DEMO_AUTH_URL}${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer owner",
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Demo Auth request failed: HTTP ${response.status}.`);
  }
  return (await response.json()) as Record<string, unknown>;
}

function timestamp(): number {
  return Date.now();
}

function demoDatabase(now: number): Record<string, unknown> {
  const memberships = Object.fromEntries(
    DEMO_USERS.map(({ uid, email, role, assignedBusId }) => [
      uid,
      {
        uid,
        email,
        role,
        status: "approved",
        active: true,
        assignedBusId,
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );

  return {
    memberships,
    buses: {
      BUS1: {
        busId: "BUS1",
        label: "BUS1 · Demo shuttle",
        status: "active",
        reason: "",
        createdAt: now,
        updatedAt: now,
      },
    },
    routes: {
      [DEMO_ROUTE_ID]: {
        id: DEMO_ROUTE_ID,
        shift: "First Shift",
        busNumber: "BUS1",
        origin: "Waghodia Circle",
        destination: "PU Campus",
        stops: [
          { lat: 22.3205, lng: 73.3701, name: "Waghodia Circle" },
          { lat: 22.2887, lng: 73.3634, name: "PU Campus Gate" },
        ],
        status: "published",
        pathSource: "manual",
        kind: "bus",
      },
    },
  };
}

async function assertEmptyNamespace(): Promise<void> {
  const [database, accounts] = await Promise.all([
    databaseRequest(""),
    authRequest(`/identitytoolkit.googleapis.com/v1/projects/${DEMO_PROJECT_ID}/accounts:batchGet?maxResults=1000`, {
      method: "GET",
    }),
  ]);
  if (database !== null && (typeof database !== "object" || Object.keys(database as object).length > 0)) {
    throw new Error(
      `Refusing demo seed: RTDB namespace ${DEMO_DATABASE_NAMESPACE} is not empty. Start a disposable emulator without importing data.`,
    );
  }
  const users = Array.isArray(accounts.users) ? accounts.users : [];
  if (users.length > 0) {
    throw new Error(
      "Refusing demo seed: Auth emulator already has users. Start a disposable emulator without importing data.",
    );
  }
}

async function createAccounts(): Promise<void> {
  const result = await authRequest(
    `/identitytoolkit.googleapis.com/v1/projects/${DEMO_PROJECT_ID}/accounts:batchCreate`,
    {
      method: "POST",
      body: JSON.stringify({
        users: DEMO_USERS.map(({ uid, email }) => ({
          localId: uid,
          email,
          rawPassword: DEMO_PASSWORD,
          emailVerified: true,
          disabled: false,
        })),
      }),
    },
  );
  const errors = Array.isArray(result.error) ? result.error : [];
  if (errors.length > 0) {
    throw new Error("Demo Auth account import was rejected.");
  }

  const imported = (await authRequest(
    `/identitytoolkit.googleapis.com/v1/projects/${DEMO_PROJECT_ID}/accounts:batchGet?maxResults=1000`,
    { method: "GET" },
  )).users;
  assert(Array.isArray(imported) && imported.length === DEMO_USERS.length, "Demo Auth account verification failed.");
  for (const expected of DEMO_USERS) {
    assert(
      imported.some(
        (user) =>
          user &&
          typeof user === "object" &&
          (user as Record<string, unknown>).localId === expected.uid &&
          (user as Record<string, unknown>).email === expected.email &&
          (user as Record<string, unknown>).emailVerified === true,
      ),
      `Demo Auth account verification failed for ${expected.uid}.`,
    );
  }
}

export async function seedDemo(): Promise<void> {
  assertDemoEnvironment();
  await assertEmptyNamespace();
  await createAccounts();
  await databaseRequest("", {
    method: "PATCH",
    body: JSON.stringify(demoDatabase(timestamp())),
  });
  const seeded = await databaseRequest("");
  assert(seeded && typeof seeded === "object", "Demo RTDB seed verification failed.");
  assert(
    (seeded as Record<string, unknown>).memberships &&
      (seeded as Record<string, unknown>).buses &&
      (seeded as Record<string, unknown>).routes,
    "Demo RTDB seed verification failed.",
  );
  console.error(
    "PU Transit demo seeded: student@paruluniversity.ac.in, driver@paruluniversity.ac.in, admin@paruluniversity.ac.in (password: DemoTransit123!).",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDemo().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Demo seed failed.");
    process.exitCode = 1;
  });
}