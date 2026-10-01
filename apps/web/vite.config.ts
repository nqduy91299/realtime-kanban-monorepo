import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Where the Node server is. The E2E tests run their own on another port.
const backend = process.env.KANBAN_SERVER ?? "ws://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The browser talks to ws://localhost:5173/boards/..., Vite forwards it to the Node server.
    proxy: { "/boards": { target: backend, ws: true } },
  },
  // `pnpm --filter @kanban/web preview` serves the production build (with the service worker).
  preview: {
    port: 4173,
    proxy: { "/boards": { target: backend, ws: true } },
  },
});
