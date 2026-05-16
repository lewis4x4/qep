#!/usr/bin/env node
/**
 * Fails when apps/web/dist/assets/index-*.js total exceeds bundle-size-limits.json.
 * Run after `bun run build:web` or full `bun run build`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const assetsDir = join(repoRoot, "apps/web/dist/assets");
const limitsPath = join(repoRoot, "apps/web/bundle-size-limits.json");

const limits = JSON.parse(readFileSync(limitsPath, "utf8"));
const maxBytes = Number(limits.indexEntryMaxBytes);
if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
  console.error("bundle-size-limits.json: indexEntryMaxBytes must be a positive number");
  process.exit(1);
}

let indexFiles;
try {
  indexFiles = readdirSync(assetsDir).filter((name) => /^index-.*\.js$/.test(name));
} catch (error) {
  console.error(`Missing ${assetsDir}. Run apps/web production build first.`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (indexFiles.length === 0) {
  console.error(`No index-*.js files under ${assetsDir}`);
  process.exit(1);
}

let totalBytes = 0;
for (const name of indexFiles) {
  totalBytes += statSync(join(assetsDir, name)).size;
}

const kb = (totalBytes / 1024).toFixed(1);
const maxKb = (maxBytes / 1024).toFixed(1);

if (totalBytes > maxBytes) {
  console.error(
    `Index entry bundle ${totalBytes} bytes (${kb} KiB) exceeds limit ${maxBytes} bytes (${maxKb} KiB).`,
  );
  console.error(`Files: ${indexFiles.join(", ")}`);
  console.error("Bump apps/web/bundle-size-limits.json intentionally if growth is approved.");
  process.exit(1);
}

console.log(
  `Index entry bundle OK: ${totalBytes} bytes (${kb} KiB) ≤ ${maxBytes} bytes (${maxKb} KiB); ${indexFiles.length} file(s).`,
);
