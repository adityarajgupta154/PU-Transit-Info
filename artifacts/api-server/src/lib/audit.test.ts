import { describe, expect, it } from "vitest";
import { AUDIT_SUMMARY_MAX, boundAuditText, membershipChangeSummary } from "./audit";

describe("audit text bounds", () => {
  it("keeps short text as-is", () => {
    expect(boundAuditText("route saved", AUDIT_SUMMARY_MAX, "n/a")).toBe("route saved");
  });

  it("never exceeds the Rules limit even for maximum-length user fields", () => {
    const summary = `${"o".repeat(200)} to ${"d".repeat(200)}; bus ${"b".repeat(200)}`;
    const bounded = boundAuditText(summary, AUDIT_SUMMARY_MAX, "n/a");
    expect(bounded.length).toBe(AUDIT_SUMMARY_MAX);
    expect(bounded.endsWith("\u2026")).toBe(true);
  });

  it("never sends an empty summary (no-op membership PATCH)", () => {
    const same = { role: "driver", status: "approved", active: true, assignedBusId: "BUS-1" };
    expect(membershipChangeSummary(same, same)).toBe("");
    expect(boundAuditText(membershipChangeSummary(same, same), AUDIT_SUMMARY_MAX, "no field changes")).toBe("no field changes");
  });
});
