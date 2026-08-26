import { defineConfig } from "vite";

// The game server (npm run server) owns the game; Vite just serves the
// frontend and proxies /state + /api to it. Same-origin for the browser.
export default defineConfig({
  server: {
    port: 5173,
    host: "0.0.0.0", // accessible from the network (remote dev / LAN testing)
    proxy: {
      "/state": "http://localhost:8787",
      "/api": "http://localhost:8787",
    },
  },
  build: {
    outDir: "dist",
  },
});
