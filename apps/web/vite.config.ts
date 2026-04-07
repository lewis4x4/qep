import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
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

export default defineConfig({
  plugins: [react()],
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
    // Maplibre-gl is a monolithic WebGL renderer (~1MB raw / ~280KB gzip)
    // and lives in its own route-split chunk that ONLY downloads when the
    // user opens /fleet or /portal/fleet. The 500KB warning is noise for
    // this case — bump just past maplibre's real size so genuinely-too-big
    // chunks (>1.2MB) still warn.
    chunkSizeWarningLimit: 1200,
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
