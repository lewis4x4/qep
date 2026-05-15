import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

describe("OneDrive OAuth state binding", () => {
  test("connect URL stores and sends a state nonce", () => {
    const source = readFileSync(resolve(root, "src/components/IntegrationPanel.tsx"), "utf8");
    expect(source).toContain("ONE_DRIVE_OAUTH_STATE_KEY");
    expect(source).toContain("window.localStorage.setItem(ONE_DRIVE_OAUTH_STATE_KEY, state)");
    expect(source).toContain('url.searchParams.set("state", state)');
  });

  test("connect URL requests file, mail, and refresh scopes", () => {
    const source = readFileSync(resolve(root, "src/components/IntegrationPanel.tsx"), "utf8");
    expect(source).toContain('"Files.Read.All"');
    expect(source).toContain('"Mail.Read"');
    expect(source).toContain('"Mail.Send"');
    expect(source).toContain('"offline_access"');
    expect(source).toContain('url.searchParams.set("scope", M365_OAUTH_SCOPES)');
  });

  test("callback requires returned state to match the stored nonce", () => {
    const source = readFileSync(resolve(root, "src/components/IntegrationCallbackPage.tsx"), "utf8");
    expect(source).toContain("returnedState !== expectedState");
    expect(source).toContain("window.localStorage.removeItem(ONE_DRIVE_OAUTH_STATE_KEY)");
    expect(source).toContain("OneDrive authorization state did not match");
  });
});
