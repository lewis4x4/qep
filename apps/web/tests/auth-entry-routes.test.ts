import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("auth entry route wiring", () => {
  const appSource = readFileSync(resolve(import.meta.dir, "../src/App.tsx"), "utf8");

  test("registers forgot-password for logged-out visitors", () => {
    expect(appSource).toContain('path="/forgot-password" element={<LoginPage authError={error} />}');
  });

  test("redirects signed-in auth entry routes away from the public 404 catch-all", () => {
    expect(appSource).toContain('path="/login"');
    expect(appSource).toContain('path="/portal/login"');
    expect(appSource).toContain('path="/forgot-password"');
    expect(appSource).toContain("resolveSignedInAuthEntryRedirect");
    expect(appSource).toContain("signedInAuthEntryRedirect");
    expect(appSource).toContain("<NotFoundPage homeHref={homeRoute} />");
  });
});
