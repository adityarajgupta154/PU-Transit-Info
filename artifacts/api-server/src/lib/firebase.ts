import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export const FIREBASE_PROJECT_ID = "pu-transit-f815d";
export const FIREBASE_DATABASE_URL =
  "https://pu-transit-f815d-default-rtdb.firebaseio.com";
export const DEMO_FIREBASE_PROJECT_ID = "demo-pu-transit";
export const DEMO_FIREBASE_DATABASE_URL = "http://127.0.0.1:9000";
export const DEMO_FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
export const DEMO_FIREBASE_DATABASE_EMULATOR_HOST = "127.0.0.1:9000";
export const DEMO_FIREBASE_DATABASE_INSTANCE = "demo-pu-transit-default-rtdb";
const FIREBASE_APP_NAME = "pu-transit-api";
const DEMO_FIREBASE_APP_NAME = "pu-transit-api-demo";
const REQUEST_TIMEOUT_MS = 8_000;
const AUTH_HEALTH_TIMEOUT_MS = 1_000;

export type FirebaseErrorCode =
  | "config"
  | "unavailable"
  | "rules"
  | "conflict";

export type FirebaseErrorDetail = {
  /** Database path (no query string, so never the auth token). */
  path?: string;
  /** HTTP status Firebase answered with. */
  status?: number;
  /** Firebase's own error text, e.g. "Permission denied" or "Auth token is expired". */
  reason?: string;
};

export class FirebaseServiceError extends Error {
  readonly code: FirebaseErrorCode;
  readonly detail: FirebaseErrorDetail;

  constructor(code: FirebaseErrorCode, message: string, detail: FirebaseErrorDetail = {}) {
    super(message);
    this.name = "FirebaseServiceError";
    this.code = code;
    this.detail = detail;
  }
}

/** Firebase answers denials with `{"error": "..."}`; keep a short, token-free excerpt. */
/**
 * Firebase's own error text ("Permission denied", "Auth token is expired", ...), kept only
 * when it is plain prose: short words, letters and basic punctuation. Anything else — a
 * body that echoes the request URL, a token, HTML — is dropped rather than logged or shown.
 */
const PLAIN_REASON = /^[A-Za-z][A-Za-z ,.'-]{0,79}$/;
const LONGEST_WORD = 24;

async function firebaseErrorReason(response: Response, token: string): Promise<string | undefined> {
  const text = (await response.text().catch(() => "")).slice(0, 4096);
  let candidate = text.trim();
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") candidate = parsed.error.trim();
  } catch {
    // not JSON — the raw body is the candidate
  }
  if (!PLAIN_REASON.test(candidate)) return undefined;
  if (candidate.split(" ").some((word) => word.length > LONGEST_WORD)) return undefined;
  if (token && (candidate.includes(token) || candidate.includes(encodeURIComponent(token)))) return undefined;
  return candidate;
}

export type FirebaseRead<T = unknown> = {
  value: T | null;
  etag?: string;
};

function configError(message: string): FirebaseServiceError {
  return new FirebaseServiceError("config", message);
}

export function isFirebaseDemoMode(): boolean {
  return process.env.PU_TRANSIT_DEMO === "1";
}

type FirebaseRuntimeConfig = {
  demo: boolean;
  projectId: string;
  databaseUrl: string;
};

function getFirebaseRuntimeConfig(): FirebaseRuntimeConfig {
  const demoFlag = process.env.PU_TRANSIT_DEMO;
  if (demoFlag !== undefined && demoFlag !== "1") {
    throw configError("Firebase demo configuration is invalid");
  }

  const demo = demoFlag === "1";
  const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const databaseEmulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;

  if (demo) {
    if (
      process.env.NODE_ENV !== "development" ||
      process.env.FIREBASE_PROJECT_ID !== DEMO_FIREBASE_PROJECT_ID ||
      process.env.FIREBASE_DATABASE_URL !== DEMO_FIREBASE_DATABASE_URL ||
      authEmulatorHost !== DEMO_FIREBASE_AUTH_EMULATOR_HOST ||
      databaseEmulatorHost !== DEMO_FIREBASE_DATABASE_EMULATOR_HOST
    ) {
      throw configError("Firebase demo configuration is invalid");
    }
    return {
      demo: true,
      projectId: DEMO_FIREBASE_PROJECT_ID,
      databaseUrl: DEMO_FIREBASE_DATABASE_URL,
    };
  }

  // firebase-admin accepts unsigned Auth Emulator tokens whenever this
  // variable is present, so an emulator host is never tolerated implicitly.
  if (authEmulatorHost !== undefined || databaseEmulatorHost !== undefined) {
    throw configError("Firebase emulator configuration requires explicit demo mode");
  }

  if (process.env.FIREBASE_PROJECT_ID !== FIREBASE_PROJECT_ID) {
    throw configError("Firebase project configuration is invalid");
  }
  if (process.env.FIREBASE_DATABASE_URL !== FIREBASE_DATABASE_URL) {
    throw configError("Firebase database configuration is invalid");
  }

  return {
    demo: false,
    projectId: FIREBASE_PROJECT_ID,
    databaseUrl: FIREBASE_DATABASE_URL,
  };
}

export function getUniversityEmailDomains(): string[] {
  const configured = process.env.UNIVERSITY_EMAIL_DOMAINS;
  const values = (configured ?? "paruluniversity.ac.in")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);

  if (
    values.length === 0 ||
    values.some(
      (domain) =>
        domain.length > 253 ||
        domain.startsWith(".") ||
        domain.endsWith(".") ||
        domain.includes("@") ||
        !/^[a-z0-9.-]+$/.test(domain),
    )
  ) {
    throw configError("University email domain configuration is invalid");
  }

  return values;
}

function getDatabaseUrl(): string {
  const config = getFirebaseRuntimeConfig();
  const databaseUrl = config.databaseUrl;

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw configError("Firebase database configuration is invalid");
  }

  if (
    (config.demo &&
      (parsed.protocol !== "http:" ||
        parsed.hostname !== "127.0.0.1" ||
        parsed.port !== "9000")) ||
    (!config.demo &&
      (parsed.protocol !== "https:" ||
        parsed.hostname !== "pu-transit-f815d-default-rtdb.firebaseio.com")) ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw configError("Firebase database configuration is invalid");
  }

  return databaseUrl;
}

function getFirebaseApp(): App {
  const config = getFirebaseRuntimeConfig();
  const appName = config.demo ? DEMO_FIREBASE_APP_NAME : FIREBASE_APP_NAME;

  const existing = getApps().find((app) => app.name === appName);
  if (existing) {
    if (existing.options.projectId !== config.projectId) {
      throw configError("Firebase project configuration is invalid");
    }
    return existing;
  }

  try {
    return initializeApp(
      config.demo
        ? { projectId: config.projectId, databaseURL: config.databaseUrl }
        : { projectId: config.projectId },
      appName,
    );
  } catch {
    throw new FirebaseServiceError(
      "unavailable",
      "Firebase authentication is unavailable",
    );
  }
}

async function checkAuthEmulator(config: FirebaseRuntimeConfig): Promise<void> {
  if (!config.demo) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(
      `http://${DEMO_FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${encodeURIComponent(config.projectId)}/config`,
      {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new FirebaseServiceError(
        "unavailable",
        "Firebase authentication is unavailable",
      );
    }
  } catch (error) {
    if (error instanceof FirebaseServiceError) throw error;
    throw new FirebaseServiceError(
      "unavailable",
      "Firebase authentication is unavailable",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyFirebaseIdToken(token: string): Promise<Record<string, unknown>> {
  if (!token) {
    throw new FirebaseServiceError("config", "Firebase token is missing");
  }

  try {
    const config = getFirebaseRuntimeConfig();
    await checkAuthEmulator(config);
    const decoded = await getAuth(getFirebaseApp()).verifyIdToken(token);
    return decoded as unknown as Record<string, unknown>;
  } catch (error) {
    if (error instanceof FirebaseServiceError) {
      throw error;
    }

    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "";

    if (
      code === "auth/id-token-expired" ||
      code === "auth/id-token-revoked" ||
      code === "auth/invalid-id-token" ||
      code === "auth/argument-error" ||
      code === "auth/invalid-credential"
    ) {
      throw new FirebaseServiceError("rules", "Firebase token verification failed");
    }

    throw new FirebaseServiceError(
      "unavailable",
      "Firebase authentication is unavailable",
    );
  }
}

function databasePath(path: string): string {
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));
  return `/${segments.join("/")}.json`;
}

async function databaseRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {},
  query: Record<string, string | number> = {},
): Promise<{ response: Response; value: T | null; etag?: string }> {
  const databaseUrl = getDatabaseUrl();
  const runtimeConfig = getFirebaseRuntimeConfig();
  const search = new URLSearchParams({ auth: token });
  for (const [key, value] of Object.entries(query)) search.set(key, String(value));
  if (runtimeConfig.demo) search.set("ns", DEMO_FIREBASE_DATABASE_INSTANCE);
  const url = `${databaseUrl}${databasePath(path)}?${search.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
    });

    const etag = response.headers.get("etag") ?? undefined;
    if (response.status === 404) {
      return { response, value: null, etag };
    }
    if (response.status === 401 || response.status === 403) {
      throw new FirebaseServiceError("rules", "Firebase database access was denied", {
        path,
        status: response.status,
        reason: await firebaseErrorReason(response, token),
      });
    }
    if (response.status === 412) {
      throw new FirebaseServiceError("conflict", "Firebase write conflicted", { path, status: 412 });
    }
    if (!response.ok) {
      throw new FirebaseServiceError("unavailable", "Firebase database is unavailable", {
        path,
        status: response.status,
        reason: await firebaseErrorReason(response, token),
      });
    }

    let value: T | null = null;
    const text = await response.text();
    if (text) {
      try {
        value = JSON.parse(text) as T;
      } catch {
        throw new FirebaseServiceError(
          "unavailable",
          "Firebase database returned invalid data",
        );
      }
    }
    return { response, value, etag };
  } catch (error) {
    if (error instanceof FirebaseServiceError) {
      throw error;
    }
    throw new FirebaseServiceError(
      "unavailable",
      "Firebase database is unavailable",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function readFirebase<T>(
  path: string,
  token: string,
  withEtag = false,
): Promise<FirebaseRead<T>> {
  const result = await databaseRequest<T>(path, token, {
    method: "GET",
    headers: withEtag ? { "X-Firebase-ETag": "true" } : undefined,
  });
  return { value: result.value, etag: result.etag };
}

export async function readFirebaseQuery<T>(
  path: string,
  token: string,
  query: Record<string, string | number>,
): Promise<FirebaseRead<T>> {
  const result = await databaseRequest<T>(path, token, { method: "GET" }, query);
  return { value: result.value, etag: result.etag };
}

export async function pushFirebase<T>(
  path: string,
  token: string,
  value: unknown,
): Promise<T | null> {
  const result = await databaseRequest<T>(path, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  return result.value;
}

/** PATCH at path "" with `{ "a/b": value, "c/d": null }` is the atomic multi-path update. */
export async function writeFirebase<T>(
  path: string,
  token: string,
  method: "PUT" | "PATCH" | "DELETE",
  value?: unknown,
  headers: Record<string, string> = {},
): Promise<T | null> {
  const result = await databaseRequest<T>(path, token, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: method === "DELETE" ? undefined : JSON.stringify(value),
  });
  return result.value;
}

export async function conditionalCreateFirebase<T>(
  path: string,
  token: string,
  value: unknown,
): Promise<{ created: boolean; value: T | null }> {
  const current = await readFirebase<T>(path, token, true);
  if (current.value !== null) {
    return { created: false, value: current.value };
  }

  try {
    const result = await databaseRequest<T>(path, token, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": current.etag ?? "null_etag",
      },
      body: JSON.stringify(value),
    });
    return { created: true, value: result.value };
  } catch (error) {
    if (error instanceof FirebaseServiceError && error.code === "conflict") {
      const raced = await readFirebase<T>(path, token);
      return { created: false, value: raced.value };
    }
    throw error;
  }
}

export function serverTimestamp(): { ".sv": "timestamp" } {
  return { ".sv": "timestamp" };
}