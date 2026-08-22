/**
 * Database access for the indexer and for YOZEXA Pay.
 *
 * Both read the same tables, so the pool and the migration runner live here
 * rather than being duplicated.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import pg from "pg";

const { Pool } = pg;

// node-postgres returns NUMERIC as a string by default, which is what we want:
// a monetary value must never be parsed into a float64 on its way out of the
// database. This makes that explicit rather than relying on the default.
pg.types.setTypeParser(1700, (value: string) => value); // NUMERIC
pg.types.setTypeParser(20, (value: string) => value); // BIGINT

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export interface DatabaseOptions {
  connectionString: string;
  max?: number;
}

/** Open a connection pool. */
export function openPool(options: DatabaseOptions): pg.Pool {
  return new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    // Fail fast rather than hanging a payment request behind a dead database.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
}

/**
 * Apply migrations that have not run yet, in filename order, each inside its
 * own transaction so a failure leaves the schema at a known point.
 */
export async function migrate(pool: pg.Pool, migrationsDir: string): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
  );

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      ran.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${String(err)}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

/** Run a function inside a transaction, rolling back on any error. */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
