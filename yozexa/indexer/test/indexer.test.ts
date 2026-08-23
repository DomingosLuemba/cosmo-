/**
 * Indexer tests.
 *
 * The indexer is a projection: it must never invent, lose or duplicate a
 * transfer, and it must refuse to mix two chains into one database. These test
 * exactly that, against a real PostgreSQL, with a fake node so the block data
 * can be controlled precisely.
 *
 * They skip themselves when DATABASE_URL is unset.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate, openPool, type Pool } from "../src/db.js";
import { Indexer } from "../src/indexer.js";

/**
 * Find pay/migrations by walking up from the compiled file.
 *
 * A fixed relative path would be right for the source tree and wrong for the
 * build output, which lands at a different depth.
 */
function migrationsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "pay", "migrations");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("could not locate pay/migrations");
}

const DATABASE_URL = process.env.DATABASE_URL;
const shouldRun = Boolean(DATABASE_URL);

let pool: Pool;

before(async () => {
  if (!shouldRun) return;
  pool = openPool({ connectionString: DATABASE_URL! });
  await migrate(pool, migrationsDir());
});

after(async () => {
  if (!shouldRun) return;
  await pool.end();
});

/** A node that serves exactly the blocks a test defines. */
function fakeNode(options: {
  chainId?: string;
  height: number;
  blocks: Record<number, { time: string; txs: Array<{ hash: string; memo?: string }> }>;
  transfers: Record<string, Array<{ from: string; to: string; amount: string }>>;
  failed?: Set<string>;
}) {
  return {
    status: async () => ({
      chain_id: options.chainId ?? "yozexa-indexer-test",
      height: options.height,
      node_version: "test",
    }),
    block: async (height: number) => {
      const block = options.blocks[height];
      if (!block) throw new Error(`no block ${height}`);
      return {
        height,
        time: block.time,
        hash: `HASH${height}`,
        proposer: "PROPOSER",
        app_hash: `APP${height}`,
        transaction_count: block.txs.length,
        transactions: block.txs,
      };
    },
    txStatus: async (hash: string) => ({
      hash,
      status: options.failed?.has(hash) ? "failed" : "confirmed",
      code: 0,
      confirmations: 1,
      explanation: "",
      events: (options.transfers[hash] ?? []).map((t) => ({
        type: "transfer",
        attributes: [
          { key: "from", value: t.from },
          { key: "to", value: t.to },
          { key: "amount", value: t.amount },
        ],
      })),
    }),
  } as never;
}

async function freshDatabase(): Promise<void> {
  await pool.query("DELETE FROM indexed_transfers");
  await pool.query("DELETE FROM indexed_blocks");
  await pool.query("DELETE FROM indexer_state");
}

describe("indexer", { skip: !shouldRun }, () => {
  it("projects blocks and their transfers exactly once", async () => {
    await freshDatabase();
    const hash = randomUUID().replace(/-/g, "").toUpperCase();
    const client = fakeNode({
      height: 2,
      blocks: {
        1: { time: "2026-01-01T00:00:00Z", txs: [] },
        2: { time: "2026-01-01T00:00:03Z", txs: [{ hash, memo: "order-1" }] },
      },
      transfers: { [hash]: [{ from: "yzx1a", to: "yzx1b", amount: "1000" }] },
    });

    const indexer = new Indexer({ pool, client });
    await indexer.initialise("yozexa-indexer-test");
    assert.equal(await indexer.indexOnce(), 2);
    assert.equal(await indexer.lastIndexedHeight(), 2);

    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM indexed_transfers",
    );
    assert.equal(rows[0]!.count, "1");

    // Re-running must not duplicate anything.
    assert.equal(await indexer.indexOnce(), 0);
    const again = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM indexed_transfers",
    );
    assert.equal(again.rows[0]!.count, "1");
  });

  it("records every leg of a multi-transfer transaction", async () => {
    await freshDatabase();
    const hash = randomUUID().replace(/-/g, "").toUpperCase();
    const client = fakeNode({
      height: 1,
      blocks: { 1: { time: "2026-01-01T00:00:00Z", txs: [{ hash }] } },
      transfers: {
        [hash]: [
          { from: "yzx1payer", to: "yzx1a", amount: "100" },
          { from: "yzx1payer", to: "yzx1b", amount: "200" },
          { from: "yzx1payer", to: "yzx1c", amount: "300" },
        ],
      },
    });

    const indexer = new Indexer({ pool, client });
    await indexer.initialise("yozexa-indexer-test");
    await indexer.indexOnce();

    const { rows } = await pool.query<{ to_address: string; amount: string; transfer_index: number }>(
      "SELECT to_address, amount, transfer_index FROM indexed_transfers ORDER BY transfer_index",
    );
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => [r.to_address, r.amount]),
      [
        ["yzx1a", "100"],
        ["yzx1b", "200"],
        ["yzx1c", "300"],
      ],
    );
  });

  it("indexes nothing from a failed transaction", async () => {
    await freshDatabase();
    const hash = randomUUID().replace(/-/g, "").toUpperCase();
    const client = fakeNode({
      height: 1,
      blocks: { 1: { time: "2026-01-01T00:00:00Z", txs: [{ hash }] } },
      transfers: { [hash]: [{ from: "yzx1a", to: "yzx1b", amount: "999" }] },
      failed: new Set([hash]),
    });

    const indexer = new Indexer({ pool, client });
    await indexer.initialise("yozexa-indexer-test");
    await indexer.indexOnce();

    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM indexed_transfers",
    );
    assert.equal(rows[0]!.count, "0", "a failed transaction moved nothing but was indexed");
  });

  it("refuses to index a second chain into the same database", async () => {
    await freshDatabase();
    const indexer = new Indexer({
      pool,
      client: fakeNode({ height: 0, blocks: {}, transfers: {} }),
    });
    await indexer.initialise("yozexa-testnet-1");
    await assert.rejects(() => indexer.initialise("yozexa-1"), /separate database per chain/);
  });

  it("reports amounts as strings, never as numbers", async () => {
    await freshDatabase();
    const hash = randomUUID().replace(/-/g, "").toUpperCase();
    // A value far beyond Number.MAX_SAFE_INTEGER: if anything on the path
    // parsed it as a float it would come back wrong.
    const huge = "9007199254740993000000000000";
    const client = fakeNode({
      height: 1,
      blocks: { 1: { time: "2026-01-01T00:00:00Z", txs: [{ hash }] } },
      transfers: { [hash]: [{ from: "yzx1a", to: "yzx1b", amount: huge }] },
    });

    const indexer = new Indexer({ pool, client });
    await indexer.initialise("yozexa-indexer-test");
    await indexer.indexOnce();

    const { rows } = await pool.query<{ amount: string }>("SELECT amount FROM indexed_transfers");
    assert.equal(typeof rows[0]!.amount, "string");
    assert.equal(rows[0]!.amount, huge);
  });

  // `onTransfer` is what settles payments. If the height is recorded before
  // the consumer accepts a block, a consumer that fails means that block is
  // never revisited: the money is on the chain, the order never completes, and
  // nothing anywhere says why.
  it("does not advance past a block whose consumer failed", async () => {
    await freshDatabase();
    const hash = randomUUID().replace(/-/g, "").toUpperCase();
    const client = fakeNode({
      height: 1,
      blocks: { 1: { time: "2026-01-01T00:00:00Z", txs: [{ hash }] } },
      transfers: { [hash]: [{ from: "yzx1a", to: "yzx1b", amount: "1000" }] },
    });

    let attempts = 0;
    const indexer = new Indexer({
      pool,
      client,
      onTransfer: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("settlement failed");
      },
    });
    await indexer.initialise("yozexa-indexer-test");

    await assert.rejects(() => indexer.indexOnce(), /settlement failed/);
    assert.equal(
      await indexer.lastIndexedHeight(),
      0,
      "the height advanced past a block the consumer never accepted",
    );

    // The next pass replays the block, and this time the consumer accepts it.
    await indexer.indexOnce();
    assert.equal(attempts, 2, "the failed block was not replayed");
    assert.equal(await indexer.lastIndexedHeight(), 1);
  });

  // Replaying a block must not duplicate its rows, or a retry would double
  // every transfer it had already written.
  it("replays a block without duplicating what it already wrote", async () => {
    await freshDatabase();
    const hash = randomUUID().replace(/-/g, "").toUpperCase();
    const client = fakeNode({
      height: 1,
      blocks: { 1: { time: "2026-01-01T00:00:00Z", txs: [{ hash }] } },
      transfers: { [hash]: [{ from: "yzx1a", to: "yzx1b", amount: "1000" }] },
    });

    let failed = false;
    const indexer = new Indexer({
      pool,
      client,
      onTransfer: async () => {
        if (!failed) {
          failed = true;
          throw new Error("settlement failed");
        }
      },
    });
    await indexer.initialise("yozexa-indexer-test");
    await assert.rejects(() => indexer.indexOnce());
    await indexer.indexOnce();

    const { rows } = await pool.query<{ n: string }>(
      "SELECT COUNT(*)::text AS n FROM indexed_transfers",
    );
    assert.equal(rows[0]!.n, "1", "the replay duplicated the transfer");
  });
});
