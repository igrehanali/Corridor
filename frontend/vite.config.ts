import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          map: ["maplibre-gl", "react-map-gl"],
          deck: ["@deck.gl/core", "@deck.gl/layers", "@deck.gl/mapbox"],
        },
      },
    },
  },
  test: { environment: "node" },
} as never);
