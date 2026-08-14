import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Contract: deployed Netlify CSP must allow MapLibreCanvas OSM raster tiles.
 * Tile hosts are defined in apps/web/src/components/primitives/MapLibreCanvas.tsx.
 */
const OSM_TILE_HOSTS = [
  "https://a.tile.openstreetmap.org",
  "https://b.tile.openstreetmap.org",
  "https://c.tile.openstreetmap.org",
] as const;

function readNetlifyToml(): string {
  return readFileSync(join(import.meta.dir, "../../../netlify.toml"), "utf-8");
}

function extractConnectSrc(cspLine: string): string {
  const match = cspLine.match(/connect-src\s+([^;]+)/);
  if (!match) throw new Error("connect-src directive missing from CSP");
  return match[1];
}

describe("netlify.toml Content-Security-Policy", () => {
  test("allows MapLibre OSM raster tile hosts in connect-src", () => {
    const toml = readNetlifyToml();
    const cspLine = toml
      .split("\n")
      .find((line) => line.includes("Content-Security-Policy ="));
    expect(cspLine).toBeDefined();

    const connectSrc = extractConnectSrc(cspLine!);
    for (const host of OSM_TILE_HOSTS) {
      expect(connectSrc).toContain(host);
    }
    expect(connectSrc).not.toContain("connect-src *");
  });
});
