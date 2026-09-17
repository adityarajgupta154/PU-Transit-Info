import { cert, initializeApp, type Credential, type ServiceAccount } from "firebase-admin/app";

export class SetupError extends Error {}

export function requireProject(value: string | undefined): string {
  if (!value || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value)) {
    throw new SetupError("FIREBASE_PROJECT_ID must contain a valid Firebase project ID.");
  }
  return value;
}

export function parseServiceAccount(raw: string | undefined, projectId: string): ServiceAccount {
  if (!raw) throw new SetupError("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  const value = raw.trim();
  let account: ServiceAccount & { type?: string; project_id?: string };
  try {
    account = JSON.parse(value);
  } catch {
    let reason = "contains invalid JSON syntax";
    if (value.startsWith("```")) reason = "contains Markdown code fences";
    else if (/^https?:\/\//i.test(value)) reason = "contains a link, not the JSON file contents";
    else if (/^['"]?[^\r\n{}]*\.json['"]?$/i.test(value)) reason = "contains a filename or file path, not the JSON file contents";
    else if (/^FIREBASE_SERVICE_ACCOUNT_JSON\s*=/.test(value)) reason = "contains an environment-variable assignment instead of just its JSON value";
    else if (value.startsWith("-----BEGIN")) reason = "contains only a private key, not the complete service-account JSON";
    else if (/^AIza[0-9A-Za-z_-]+$/.test(value)) reason = "contains a Firebase web API key, not a server service-account JSON";
    else if (!value.startsWith("{")) reason = "does not start with a JSON object";
    else if (!value.endsWith("}")) reason = "is incomplete; the closing JSON brace is missing";
    throw new SetupError(`FIREBASE_SERVICE_ACCOUNT_JSON ${reason}. Paste the complete downloaded service-account JSON without extra formatting.`);
  }
  if (!account || account.type !== "service_account" || account.project_id !== projectId) {
    throw new SetupError("The credential must be a service account for the configured Firebase project.");
  }
  return account;
}

export function parseServiceAccountFields(
  clientEmail: string | undefined,
  privateKey: string | undefined,
  projectId: string,
): ServiceAccount {
  const email = clientEmail?.trim();
  if (!email || !privateKey) {
    throw new SetupError("Both FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are required when using separate credential fields.");
  }
  if (!email.endsWith(`@${projectId}.iam.gserviceaccount.com`)) {
    throw new SetupError("FIREBASE_CLIENT_EMAIL must be the service-account email from the configured project's downloaded JSON, not a personal email.");
  }
  const key = privateKey.replace(/\\n/g, "\n").trim();
  if (!key.startsWith("-----BEGIN PRIVATE KEY-----") || !key.endsWith("-----END PRIVATE KEY-----")) {
    throw new SetupError("FIREBASE_PRIVATE_KEY must contain the complete private_key value, including its BEGIN and END lines, without surrounding quotes.");
  }
  return { projectId, clientEmail: email, privateKey: key };
}

export function createFirebaseClient() {
  const projectId = requireProject(process.env.FIREBASE_PROJECT_ID);
  const { FIREBASE_CLIENT_EMAIL: email, FIREBASE_PRIVATE_KEY: key } = process.env;
  const account = email !== undefined || key !== undefined
    ? parseServiceAccountFields(email, key, projectId)
    : parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, projectId);
  let credential: Credential;
  try {
    credential = cert(account);
  } catch {
    throw new SetupError("The service-account JSON is missing valid server credentials.");
  }
  const app = initializeApp({ credential, projectId });

  async function request<T>(
    url: string,
    operation: string,
    init: RequestInit = {},
    authenticated = true,
  ): Promise<T> {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !/^(?:[a-z0-9-]+\.googleapis\.com|[a-z0-9-]+\.firebaseio\.com|[a-z0-9-]+(?:\.[a-z0-9-]+)?\.firebasedatabase\.app)$/.test(parsed.hostname) ||
      parsed.username || parsed.password || parsed.port
    ) {
      throw new SetupError("Refusing to send Firebase credentials to an unexpected host.");
    }
    let authorization: Record<string, string> = {};
    if (authenticated) {
      try {
        const token = await credential.getAccessToken();
        authorization = { Authorization: `Bearer ${token.access_token}` };
      } catch {
        throw new SetupError("Firebase server authentication failed. Check the service account key and whether it has been revoked.");
      }
    }
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: { "Content-Type": "application/json", ...init.headers, ...authorization },
      });
    } catch {
      throw new SetupError(`${operation}: network request failed or timed out.`);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new SetupError(`${operation}: expected a JSON response (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const error = (data as { error?: { status?: unknown; details?: unknown } } | null)?.error;
      const details = Array.isArray(error?.details) ? error.details : [];
      const candidates = [
        error?.status,
        ...details.map((detail: { reason?: unknown } | null) => detail?.reason),
      ].filter((value): value is string => typeof value === "string" && /^[A-Z_]+$/.test(value));
      throw new SetupError(`${operation}: HTTP ${response.status}${candidates.length ? ` (${candidates.join(", ")})` : ""}.`);
    }
    return data as T;
  }
  return { app, projectId, request };
}

export function reportSetupError(error: unknown) {
  // SDK/network error objects can contain request credentials; never serialize them.
  console.error(error instanceof SetupError ? error.message : "Firebase setup failed unexpectedly; no credentials were logged.");
  process.exitCode = 1;
}