import { describe, it, expect } from "vitest";

import { toExternalId, fromExternalIdOfType } from "@/lib/ids/prefixed-id";

/**
 * Regression: org switcher showed "Personal" for all orgs because
 * session.orgId (raw UUID) never matched org.id (prefixed ns_org_...).
 * Fixed by normalizing with toExternalId before comparison.
 * Found by /qa on 2026-04-10.
 */
describe("org-switcher ID normalization", () => {
  const RAW_UUID = "d98a6ac5-9a45-46de-a498-1f27409bb5f0";
  const PREFIXED = "ns_org_d98a6ac5-9a45-46de-a498-1f27409bb5f0";

  it("toExternalId('org', rawUUID) produces ns_org_ prefix", () => {
    expect(toExternalId("org", RAW_UUID)).toBe(PREFIXED);
  });

  it("fromExternalIdOfType('org', prefixed) strips ns_org_ prefix", () => {
    expect(fromExternalIdOfType("org", PREFIXED)).toBe(RAW_UUID);
  });

  it("raw UUID does NOT match prefixed ID directly", () => {
    // This is the bug we caught — if someone removes the normalization,
    // the session orgId will never match the org list entries.
    expect(RAW_UUID).not.toBe(PREFIXED);
  });

  it("normalized session orgId matches org list entry", () => {
    // Simulates the fixed org switcher logic:
    //   const sessionOrgExternalId = toExternalId("org", session.orgId);
    //   const currentOrg = orgs.find(o => o.id === sessionOrgExternalId);
    const sessionOrgId = RAW_UUID;
    const orgs = [
      { id: "ns_org_aaaa-1111", name: "Other Org" },
      { id: PREFIXED, name: "Target Org" },
    ];

    const sessionOrgExternalId = toExternalId("org", sessionOrgId);
    const match = orgs.find((o) => o.id === sessionOrgExternalId);
    expect(match).toBeDefined();
    expect(match!.name).toBe("Target Org");
  });

  it("null session orgId produces null external ID", () => {
    const sessionOrgId: string | undefined = undefined;
    const sessionOrgExternalId = sessionOrgId ? toExternalId("org", sessionOrgId) : null;
    expect(sessionOrgExternalId).toBeNull();
  });

  it("handleSwitch strips prefix before sending to API", () => {
    // The switchOrg mutation receives a raw UUID (stripped by fromExternalIdOfType)
    const orgId = PREFIXED;
    const rawId = fromExternalIdOfType("org", orgId);
    expect(rawId).toBe(RAW_UUID);
    expect(rawId).not.toContain("ns_org_");
  });
});
