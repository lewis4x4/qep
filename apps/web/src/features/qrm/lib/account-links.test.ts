import { describe, expect, test } from "bun:test";
import {
  accountCommandUrl,
  accountFleetRadarUrl,
  legacyAccountDetailUrl,
} from "./account-links";

describe("accountCommandUrl", () => {
  test("returns the canonical /qrm/accounts/:id/command path", () => {
    expect(accountCommandUrl("company-abc")).toBe("/qrm/accounts/company-abc/command");
  });

  test("preserves UUID-style ids verbatim", () => {
    expect(accountCommandUrl("11111111-2222-3333-4444-555555555555")).toBe(
      "/qrm/accounts/11111111-2222-3333-4444-555555555555/command",
    );
  });

  test("appends a URL-encoded returnTo query when supplied", () => {
    const url = accountCommandUrl("co-1", { returnTo: "/qrm/pipeline?stage=13" });
    expect(url).toBe("/qrm/accounts/co-1/command?returnTo=%2Fqrm%2Fpipeline%3Fstage%3D13");
  });

  test("omits the query entirely when options is undefined or has no returnTo", () => {
    expect(accountCommandUrl("co-1")).toBe("/qrm/accounts/co-1/command");
    expect(accountCommandUrl("co-1", {})).toBe("/qrm/accounts/co-1/command");
  });
});

describe("legacyAccountDetailUrl", () => {
  test("returns the flat /qrm/companies/:id path — reserved for explicit escape hatches", () => {
    expect(legacyAccountDetailUrl("co-1")).toBe("/qrm/companies/co-1");
  });
});

describe("accountFleetRadarUrl", () => {
  test("returns the fleet-radar sub-page path", () => {
    expect(accountFleetRadarUrl("co-1")).toBe("/qrm/companies/co-1/fleet-radar");
  });
});
