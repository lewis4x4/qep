import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("auth entry route wiring", () => {
  const appSource = readFileSync(resolve(import.meta.dir, "../src/App.tsx"), "utf8");

  test("registers forgot-password for logged-out visitors", () => {
    expect(appSource).toContain('path="/forgot-password" element={<LoginPage authError={error} />}');
    expect(appSource).toContain('path="/reset-password" element={<LoginPage authError={error} />}');
  });

  test("redirects signed-in login and forgot-password away from the public 404 catch-all", () => {
    expect(appSource).toContain('path="/login"');
    expect(appSource).toContain('path="/portal/login"');
    expect(appSource).toContain('path="/forgot-password"');
    expect(appSource).toContain('path="/reset-password"');
    expect(appSource).toContain('signedInAuthEntryRedirect("/login")');
    expect(appSource).toContain('signedInAuthEntryRedirect("/forgot-password")');
    expect(appSource).not.toContain('signedInAuthEntryRedirect("/reset-password")');
    expect(appSource).not.toContain('path="/portal/forgot-password"');
    expect(appSource).not.toContain('path="/portal/reset-password"');
    expect(appSource).toContain("resolveSignedInAuthEntryRedirect");
    expect(appSource).toContain("signedInAuthEntryRedirect");
    expect(appSource).toContain("<NotFoundPage homeHref={homeRoute} />");
  });

  test("keeps signed-in reset-password on the set-password surface", () => {
    const signedInResetRoutes = appSource.match(
      /path="\/reset-password"[\s\S]{0,120}element=\{<LoginPage authError=\{error\} \/>/g,
    );
    expect(signedInResetRoutes?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  test("routes unknown logged-out portal subpaths to portal login via App.tsx, not the catch-all", () => {
    expect(appSource).toContain('path="/portal/*" element={<Navigate to="/portal/login" replace />}');
  });
});
