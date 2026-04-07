import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
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
