import { readFile } from "node:fs/promises";
import { deleteApp } from "firebase-admin/app";
import { createFirebaseClient, reportSetupError } from "./firebase-admin-client.js";

type Project = { projectId: string; projectNumber: string; state: string };
type Instance = { name: string; databaseUrl: string; state: string; type: string };
type AuthConfig = {
  signIn?: { email?: { enabled?: boolean; passwordRequired?: boolean } };
  authorizedDomains?: string[];
};
type RuleNode = { ".read"?: unknown; ".write"?: unknown; [key: string]: unknown };

const canonicalRulesPath = new URL("../../firebase/database.rules.json", import.meta.url);

function stableStringify(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
}

function countPublicRules(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  return Object.entries(value).reduce((count, [key, child]) => {
    const open = (key === ".read" || key === ".write") &&
      (child === true || (typeof child === "string" && child.trim() === "true"));
    return count + Number(open) + countPublicRules(child);
  }, 0);
}

async function main() {
  const { app, projectId, request } = createFirebaseClient();
  try {
    const project = await request<Project>(
      `https://firebase.googleapis.com/v1beta1/projects/${projectId}`,
      "Read Firebase project",
    );
    console.log(JSON.stringify({ projectId: project.projectId, projectNumber: project.projectNumber, state: project.state }));

    const inspections = [
      async () => {
        const config = await request<AuthConfig>(
          `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`,
          "Inspect Firebase Authentication",
        );
        return {
          service: "authentication",
          emailPasswordEnabled: config.signIn?.email?.enabled === true && config.signIn?.email?.passwordRequired === true,
          authorizedDomains: config.authorizedDomains ?? [],
        };
      },
      async () => {
        const result = await request<{ instances?: Instance[]; nextPageToken?: string }>(
          `https://firebasedatabase.googleapis.com/v1beta/projects/${project.projectNumber}/locations/-/instances?pageSize=100`,
          "List Realtime Database instances",
        );
        const instances = [];
        for (const instance of result.instances ?? []) {
          const summary: Record<string, unknown> = { ...instance };
          if (instance.state === "ACTIVE") {
            const url = instance.databaseUrl.replace(/\/$/, "");
            const [root, rules] = await Promise.all([
              request<Record<string, unknown> | null>(`${url}/.json?shallow=true`, "Inspect database root without downloading records"),
              request<{ rules: RuleNode }>(`${url}/.settings/rules.json`, "Inspect database rules"),
            ]);
            summary.topLevelRecordCount = root && typeof root === "object" ? Object.keys(root).length : 0;
            summary.databaseEmpty = root === null;
            summary.unconditionallyPublicRuleCount = countPublicRules(rules.rules);
            // Published Rules are compared structurally so formatting differences from the console editor do not matter.
            const canonical = JSON.parse(await readFile(canonicalRulesPath, "utf8")) as { rules: RuleNode };
            summary.publishedRulesMatchRepository = stableStringify(rules.rules) === stableStringify(canonical.rules);
          }
          instances.push(summary);
        }
        return { service: "realtime-database", instances, additionalPageExists: Boolean(result.nextPageToken) };
      },
      async () => {
        const result = await request<{ databases?: { name: string; locationId: string; type: string }[] }>(
          `https://firestore.googleapis.com/v1/projects/${projectId}/databases`,
          "List Firestore databases",
        );
        return { service: "firestore", databases: result.databases?.map(({ name, locationId, type }) => ({ name, locationId, type })) ?? [] };
      },
      async () => {
        const result = await request<{ apps?: { appId: string; displayName?: string }[]; nextPageToken?: string }>(
          `https://firebase.googleapis.com/v1beta1/projects/${projectId}/webApps?pageSize=100`,
          "Inspect registered Firebase web apps",
        );
        return { service: "web-apps", count: result.apps?.length ?? 0, additionalPageExists: Boolean(result.nextPageToken) };
      },
    ];
    const results = await Promise.allSettled(inspections.map(inspect => inspect()));
    for (const result of results) {
      if (result.status === "fulfilled") console.log(JSON.stringify(result.value));
      else reportSetupError(result.reason);
    }
  } finally {
    await deleteApp(app);
  }
}

main().catch(reportSetupError);