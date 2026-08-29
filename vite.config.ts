import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5177,
    allowedHosts: [".trycloudflare.com"],
    proxy: { "/api": "http://localhost:4100" },
  },
  preview: { host: "0.0.0.0", port: 4173 },
  build: {
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("leaflet")) return "maps";
          if (id.includes("hls.js")) return "media";
          if (id.includes("node_modules/react")) return "react";
        },
      },
    },
  },
});
