import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests in real Google Chrome (the installed app, so no browser download).
 * Playwright starts its own servers on their own ports, so a running `pnpm dev` is never touched:
 *   4100  Node server, in-memory database, dev mode (for the dev panel's "reject next")
 *   5273  Vite dev server (most tests)
 *   4273  production build + preview (the service-worker test needs a real build)
 */
const SERVER = "ws://localhost:4100";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    baseURL: "http://localhost:5273",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @kanban/server start",
      env: { PORT: "4100", DB_PATH: ":memory:" },
      port: 4100,
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @kanban/web exec vite --port 5273 --strictPort",
      env: { KANBAN_SERVER: SERVER },
      port: 5273,
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @kanban/web exec sh -c 'vite build --outDir dist-e2e && vite preview --outDir dist-e2e --port 4273 --strictPort'",
      env: { KANBAN_SERVER: SERVER },
      port: 4273,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
