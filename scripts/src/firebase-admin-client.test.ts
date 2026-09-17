import assert from "node:assert/strict";
import test from "node:test";
import { parseServiceAccount, parseServiceAccountFields, requireProject, SetupError } from "./firebase-admin-client.js";

test("Firebase setup rejects malformed credentials and the wrong project before network access", () => {
  const projectId = "test-project-123";
  assert.equal(requireProject(projectId), projectId);
  for (const invalid of [undefined, "", "UPPERCASE", "https://firebase.example", "../another-project"]) {
    assert.throws(() => requireProject(invalid), SetupError);
  }
  for (const invalid of [
    undefined,
    "",
    "downloaded-firebase-key.json",
    "```json\n{}\n```",
    '{"type":',
    "null",
    "{}",
    JSON.stringify({ type: "authorized_user", project_id: projectId }),
    JSON.stringify({ type: "service_account", project_id: "different-project" }),
  ]) {
    assert.throws(() => parseServiceAccount(invalid, projectId), SetupError);
  }
  // Deliberately synthetic metadata: the SDK validates/signs real keys separately.
  const fixture = { type: "service_account", project_id: projectId };
  assert.deepEqual(parseServiceAccount(JSON.stringify(fixture), projectId), fixture);
  assert.deepEqual(parseServiceAccount(`\uFEFF  ${JSON.stringify(fixture)}\n`, projectId), fixture);
});

test("credential format diagnostics describe the problem without echoing input", () => {
  for (const [input, hint] of [
    ["private-download-name.json", "filename or file path"],
    ["https://example.invalid/private-download", "contains a link"],
    ["```json\nprivate-input\n```", "Markdown code fences"],
    ['FIREBASE_SERVICE_ACCOUNT_JSON={"private-input":true}', "environment-variable assignment"],
    ["-----BEGIN PRIVATE KEY-----private-input", "only a private key"],
    ["AIzaSyntheticInputNotARealKey", "Firebase web API key"],
    ['{"private-input":', "closing JSON brace is missing"],
  ]) {
    assert.throws(() => parseServiceAccount(input, "test-project-123"), (error: unknown) => {
      assert(error instanceof SetupError);
      assert(error.message.includes(hint));
      assert(!error.message.includes(input));
      assert(!error.message.includes("private-input"));
      return true;
    });
  }
});

test("separate credential fields require the target project's service account and normalize JSON newline escapes", () => {
  const projectId = "test-project-123";
  const email = `example-account@${projectId}.iam.gserviceaccount.com`;
  // Format-only fixture, not a usable private key. The Firebase SDK checks key validity.
  const key = "-----BEGIN PRIVATE KEY-----\\nSYNTHETIC-TEST-ONLY\\n-----END PRIVATE KEY-----\\n";
  assert.deepEqual(parseServiceAccountFields(email, key, projectId), {
    projectId, clientEmail: email, privateKey: key.replace(/\\n/g, "\n").trim(),
  });
  for (const [badEmail, badKey] of [
    [undefined, key],
    [email, undefined],
    ["", key],
    [email, ""],
    ["person@example.invalid", key],
    ["example-account@wrong-project.iam.gserviceaccount.com", key],
    [email, "not-a-private-key"],
    [email, JSON.stringify(key)],
  ]) {
    assert.throws(() => parseServiceAccountFields(badEmail, badKey, projectId), SetupError);
  }
});