import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    // WRANGLER_CONFIG=wrangler.production.jsonc for deploys (see package.json).
    cloudflare({ configPath: process.env.WRANGLER_CONFIG || undefined }),
  ],
  resolve: {
    dedupe: ["yjs", "y-protocols", "react", "react-dom"],
  },
  optimizeDeps: {
    exclude: ["revise"],
  },
  build: {
    chunkSizeWarningLimit: 5000,
  },
});
