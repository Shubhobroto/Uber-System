/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative asset paths, so the build works from any host sub-path (GitHub Pages, Netlify, Vercel).
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    // MapLibre is most of the bundle; a separate chunk caches well across deploys.
    rollupOptions: { output: { manualChunks: { maplibre: ["maplibre-gl"] } } },
    chunkSizeWarningLimit: 1100,
  },
  test: {
    environment: "node",
  },
});
