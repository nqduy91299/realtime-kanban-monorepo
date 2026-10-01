import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 4000);
const dbPath = process.env.DB_PATH ?? "kanban.sqlite";

const dev = process.env.NODE_ENV !== "production";

const server = await createServer({ port, dbPath, dev });
console.log(`kanban server on ws://localhost:${server.port}/boards/<id> (db: ${dbPath}${dev ? ", dev mode" : ""})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
