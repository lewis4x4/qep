#!/usr/bin/env node
/**
 * Bundle-size guard for apps/web/dist/assets (run after a production build).
 *
 * Two caps, both from apps/web/bundle-size-limits.json:
 *   1. indexEntryMaxBytes — sum of index-*.js (the eager startup payload).
 *   2. routeChunkMaxBytes — EVERY other .js chunk individually (route/
 *      feature chunks). N7.1: previously only index-*.js was measured, so
 *      route chunks grew unguarded. Known-heavy chunks are grandfathered
 *      via routeChunkExemptions (prefix match) — shrink that list, don't
 *      grow it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const assetsDir = join(repoRoot, "apps/web/dist/assets");
const limitsPath = join(repoRoot, "apps/web/bundle-size-limits.json");

const limits = JSON.parse(readFileSync(limitsPath, "utf8"));
const maxBytes = Number(limits.indexEntryMaxBytes);
const routeChunkMaxBytes = Number(limits.routeChunkMaxBytes);
const exemptions = Array.isArray(limits.routeChunkExemptions) ? limits.routeChunkExemptions : [];

if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
  console.error("bundle-size-limits.json: indexEntryMaxBytes must be a positive number");
  process.exit(1);
}
if (!Number.isFinite(routeChunkMaxBytes) || routeChunkMaxBytes <= 0) {
  console.error("bundle-size-limits.json: routeChunkMaxBytes must be a positive number");
  process.exit(1);
}

let jsFiles;
try {
  jsFiles = readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
} catch (error) {
  console.error(`Missing ${assetsDir}. Run apps/web production build first.`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const indexFiles = jsFiles.filter((name) => /^index-.*\.js$/.test(name));
if (indexFiles.length === 0) {
  console.error(`No index-*.js files under ${assetsDir}`);
  process.exit(1);
}

let failed = false;

// ── 1. Eager startup payload ────────────────────────────────────────────
let totalBytes = 0;
for (const name of indexFiles) {
  totalBytes += statSync(join(assetsDir, name)).size;
}
const kb = (totalBytes / 1024).toFixed(1);
const maxKb = (maxBytes / 1024).toFixed(1);
if (totalBytes > maxBytes) {
  failed = true;
  console.error(
    `Index entry bundle ${totalBytes} bytes (${kb} KiB) exceeds limit ${maxBytes} bytes (${maxKb} KiB).`,
  );
  console.error(`Files: ${indexFiles.join(", ")}`);
} else {
  console.log(
    `Index entry bundle OK: ${totalBytes} bytes (${kb} KiB) ≤ ${maxBytes} bytes (${maxKb} KiB); ${indexFiles.length} file(s).`,
  );
}

// ── 2. Per-route-chunk cap ──────────────────────────────────────────────
const isExempt = (name) => exemptions.some((prefix) => name.startsWith(prefix));
const routeChunks = jsFiles.filter((name) => !/^index-/.test(name));
const offenders = [];
let exemptCount = 0;
for (const name of routeChunks) {
  if (isExempt(name)) {
    exemptCount += 1;
    continue;
  }
  const size = statSync(join(assetsDir, name)).size;
  if (size > routeChunkMaxBytes) {
    offenders.push({ name, size });
  }
}

if (offenders.length > 0) {
  failed = true;
  const routeMaxKb = (routeChunkMaxBytes / 1024).toFixed(1);
  console.error(`Route chunks over ${routeChunkMaxBytes} bytes (${routeMaxKb} KiB):`);
  for (const { name, size } of offenders.sort((a, b) => b.size - a.size)) {
    console.error(`  ${size} bytes  ${name}`);
  }
  console.error(
    "Split the chunk (React.lazy sub-panels / dynamic imports) or, if genuinely irreducible, add a routeChunkExemptions prefix with justification.",
  );
} else {
  console.log(
    `Route chunks OK: ${routeChunks.length - exemptCount} measured ≤ ${routeChunkMaxBytes} bytes (${exemptCount} exempt).`,
  );
}

if (failed) {
  console.error("Bump apps/web/bundle-size-limits.json intentionally if growth is approved.");
  process.exit(1);
}
