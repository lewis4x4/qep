import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "../..");

describe("staging E2E command contract", () => {
  test("honors the deploy-preview URL supplied by CI", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(appRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const command = packageJson.scripts["test:e2e:staging"];

    expect(command).toContain(
      "PLAYWRIGHT_BASE_URL=${PLAYWRIGHT_BASE_URL:-https://qualityequipmentparts.netlify.app}",
    );
    expect(command).not.toContain(
      "PLAYWRIGHT_BASE_URL=https://qualityequipmentparts.netlify.app ",
    );
  });
});
