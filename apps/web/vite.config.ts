import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";
import { execSync } from "node:child_process";

/**
 * Wave 6.11 Flare — stamp git SHA + build timestamp + app version into
 * the bundle as VITE_GIT_SHA / VITE_BUILD_TIMESTAMP / VITE_APP_VERSION
 * so every flare report carries an exact deploy fingerprint.
 *
 * Falls back to "local" / epoch zero when git or pkg.json is unavailable
 * (e.g. CI environments without a checkout history).
 */
function getGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim() || "local";
  } catch {
    return "local";
  }
}

function getAppVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("./package.json");
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const GIT_SHA = process.env.VITE_GIT_SHA ?? getGitSha();
const APP_VERSION = process.env.VITE_APP_VERSION ?? getAppVersion();
const BUILD_TIMESTAMP = process.env.VITE_BUILD_TIMESTAMP ?? new Date().toISOString();

/** When SENTRY_* are set in CI, upload source maps and use hidden sourcemaps in the bundle. */
const sentrySourceMapUpload =
  Boolean(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);

export default defineConfig({
  plugins: [
    react(),
    ...(sentrySourceMapUpload
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG!,
            project: process.env.SENTRY_PROJECT!,
            authToken: process.env.SENTRY_AUTH_TOKEN!,
          }),
        ]
      : []),
  ],
  define: {
    "import.meta.env.VITE_GIT_SHA": JSON.stringify(GIT_SHA),
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(APP_VERSION),
    "import.meta.env.VITE_BUILD_TIMESTAMP": JSON.stringify(BUILD_TIMESTAMP),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    ...(sentrySourceMapUpload ? { sourcemap: "hidden" as const } : {}),
    // Two monolithic libs live in dedicated route-split chunks:
    //   * maplibre-gl (~1MB raw / ~280KB gzip) — only loads on map routes.
    //   * @react-pdf/renderer (~1.55MB raw / ~517KB gzip) — only loads when
    //     a user taps "Download PDF" in quote-builder (dynamic import in
    //     useQuotePDF.ts). Never in the initial bundle.
    // Neither affects initial page weight. Bump the warning threshold past
    // react-pdf's real size so genuinely-too-big chunks (>1.6MB) still warn.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("@tanstack/react-query")) {
            return "vendor-react-query";
          }

          if (id.includes("@supabase/supabase-js")) {
            return "vendor-supabase";
          }

          if (id.includes("@radix-ui") || id.includes("lucide-react")) {
            return "vendor-ui";
          }

          if (
            id.includes("react-markdown") ||
            id.includes("remark-gfm")
          ) {
            return "vendor-markdown";
          }

          // Explicit maplibre chunk so the name is stable across builds
          // (vite was naming it maplibre-gl-<hash>.js automatically; pin
          // it to vendor-maplibre for cache predictability + clearer
          // build output).
          if (id.includes("maplibre-gl")) {
            return "vendor-maplibre";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
