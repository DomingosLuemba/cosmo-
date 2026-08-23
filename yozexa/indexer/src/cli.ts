/** Command line entry point: `node dist/cli.js`. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { YozexaClient } from "@yozexa/sdk";

import { migrate, openPool } from "./db.js";
import { Indexer } from "./indexer.js";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const nodeUrl = process.env.YOZEXA_NODE ?? "http://127.0.0.1:1717";

  const pool = openPool({ connectionString });
  const migrationsDir = process.env.MIGRATIONS_DIR ?? join(here, "..", "..", "pay", "migrations");
  const ran = await migrate(pool, migrationsDir);
  if (ran.length > 0) console.log(`[indexer] applied migrations: ${ran.join(", ")}`);

  const client = new YozexaClient(nodeUrl);
  const status = await client.status();
  console.log(`[indexer] following ${status.chain_id} at ${nodeUrl}`);
  if (status.network_warning) console.log(`[indexer] ${status.network_warning}`);

  const indexer = new Indexer({
    pool,
    client,
    onBlock: (height, transfers) => {
      if (transfers > 0) console.log(`[indexer] block ${height}: ${transfers} transfer(s)`);
    },
  });

  const shutdown = async (): Promise<void> => {
    indexer.stop();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await indexer.run();
}

main().catch((err) => {
  console.error(`[indexer] fatal: ${String(err)}`);
  process.exit(1);
});
