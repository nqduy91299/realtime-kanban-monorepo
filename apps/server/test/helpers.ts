import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { BoardClient, type BoardClientOptions } from "@kanban/client";
import type { Role } from "@kanban/shared";
import { createServer, type RunningServer } from "../src/server.js";

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

export function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "kanban-test-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "board.sqlite");
}

export async function startServer(dbPath = tempDbPath()): Promise<RunningServer & { dbPath: string }> {
  const server = await createServer({ dbPath, dev: true });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await server.close();
  };
  cleanups.push(close);
  return { ...server, close, dbPath };
}

export async function connect(
  server: { port: number },
  boardId = "b1",
  role: Role = "editor",
  options: Partial<BoardClientOptions> = {},
): Promise<BoardClient> {
  const client = new BoardClient({ url: `ws://localhost:${server.port}`, boardId, role, reconnect: false, ...options });
  cleanups.push(() => client.destroy());
  client.connect();
  await client.whenSynced();
  return client;
}

/** Poll until `check` stops throwing, or fail with its last error. */
export async function eventually(check: () => void, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}
