/**
 * The YOZEXA indexer.
 *
 * It reads blocks from a node and projects them into PostgreSQL so that
 * merchant tooling, the explorer and reconciliation can query history without
 * every one of them re-walking the chain.
 *
 * The chain remains the source of truth. This database is a cache that can be
 * dropped and rebuilt from height zero at any time. Nothing here can create,
 * destroy or move money.
 */
import { YozexaClient } from "@yozexa/sdk";

import { withTransaction, type Pool, type PoolClient } from "./db.js";

export interface IndexerOptions {
  pool: Pool;
  client: YozexaClient;
  /** How many blocks to fetch per pass. */
  batchSize?: number;
  /** How long to wait when already caught up, in milliseconds. */
  idleMs?: number;
  /** Called after each block is committed, for logging and metrics. */
  onBlock?: (height: number, transfers: number) => void;
  /** Called when a payment-relevant transfer lands. */
  onTransfer?: (transfer: IndexedTransfer) => Promise<void> | void;
}

export interface IndexedTransfer {
  txHash: string;
  blockHeight: number;
  blockTime: Date;
  transferIndex: number;
  from: string;
  to: string;
  /** Base units, as a decimal string — never a number. */
  amount: string;
  memo: string | null;
}

interface BlockSummary {
  height: number;
  time: string;
  hash: string;
  proposer?: string;
  app_hash?: string;
  transaction_count: number;
  transactions?: Array<{
    hash: string;
    signer?: string;
    messages?: string[];
    memo?: string;
  }>;
}

export class Indexer {
  #stopped = false;

  constructor(private readonly options: IndexerOptions) {}

  /** The height the database has fully indexed. */
  async lastIndexedHeight(): Promise<number> {
    const { rows } = await this.options.pool.query<{ last_indexed_height: string }>(
      "SELECT last_indexed_height FROM indexer_state WHERE id = 1",
    );
    return rows.length > 0 ? Number(rows[0]!.last_indexed_height) : 0;
  }

  /** Record which chain this database belongs to, refusing to mix chains. */
  async initialise(chainId: string): Promise<void> {
    const { rows } = await this.options.pool.query<{ chain_id: string }>(
      "SELECT chain_id FROM indexer_state WHERE id = 1",
    );
    if (rows.length === 0) {
      await this.options.pool.query(
        "INSERT INTO indexer_state (id, chain_id, last_indexed_height) VALUES (1, $1, 0)",
        [chainId],
      );
      return;
    }
    if (rows[0]!.chain_id !== chainId) {
      // Indexing a second chain into the same database would silently merge two
      // ledgers. Refuse rather than corrupt the merchant's history.
      throw new Error(
        `this database was indexed from chain ${rows[0]!.chain_id} but the node reports ${chainId}; ` +
          `use a separate database per chain`,
      );
    }
  }

  /**
   * Index one batch of blocks. Returns how many blocks were processed.
   *
   * Each block is committed in its own transaction, so an interrupted run
   * leaves the database at a block boundary and the next pass resumes cleanly.
   */
  async indexOnce(): Promise<number> {
    const status = await this.options.client.status();
    const target = status.height;
    let height = (await this.lastIndexedHeight()) + 1;
    if (height > target) return 0;

    const batchSize = this.options.batchSize ?? 50;
    const last = Math.min(target, height + batchSize - 1);
    let processed = 0;

    for (; height <= last; height++) {
      const block = (await this.options.client.block(height)) as unknown as BlockSummary;
      const transfers = await this.#indexBlock(block);

      // Hand every transfer to the consumer BEFORE recording the height.
      //
      // `onTransfer` is what settles payments. If it throws — a deadlock, a
      // constraint, the process dying — and the height has already advanced,
      // that block is never revisited: the money is on the chain and the order
      // never completes, with nothing anywhere saying why. Leaving the height
      // behind means the next pass replays the block. Consumers must therefore
      // be idempotent, which settleTransfer is: it matches against payments
      // that are still outstanding, and a settled one no longer is.
      for (const transfer of transfers) {
        await this.options.onTransfer?.(transfer);
      }
      await this.#recordHeight(block.height);

      processed++;
      this.options.onBlock?.(height, transfers.length);
    }
    return processed;
  }

  async #indexBlock(block: BlockSummary): Promise<IndexedTransfer[]> {
    const blockTime = new Date(block.time);
    const transfers: IndexedTransfer[] = [];

    // A block's transfers are derived from its transactions. The node returns
    // message types per transaction; for the amounts we re-read the transaction
    // so the numbers come from the chain rather than from a guess.
    for (const tx of block.transactions ?? []) {
      const detail = await this.#transferEvents(tx.hash);
      detail.forEach((t, index) => {
        transfers.push({
          txHash: tx.hash,
          blockHeight: block.height,
          blockTime,
          transferIndex: index,
          from: t.from,
          to: t.to,
          amount: t.amount,
          memo: tx.memo ?? null,
        });
      });
    }

    await withTransaction(this.options.pool, async (client: PoolClient) => {
      await client.query(
        `INSERT INTO indexed_blocks (height, hash, block_time, tx_count, proposer, app_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (height) DO NOTHING`,
        [
          block.height,
          block.hash,
          blockTime,
          block.transaction_count,
          block.proposer ?? null,
          block.app_hash ?? null,
        ],
      );
      for (const t of transfers) {
        await client.query(
          `INSERT INTO indexed_transfers
             (tx_hash, block_height, block_time, transfer_index, from_address, to_address, amount, memo)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tx_hash, transfer_index) DO NOTHING`,
          [t.txHash, t.blockHeight, t.blockTime, t.transferIndex, t.from, t.to, t.amount, t.memo],
        );
      }
    });

    return transfers;
  }

  /**
   * Record how far indexing has got.
   *
   * Separate from #indexBlock, and called only after every consumer has
   * accepted the block's transfers, so a consumer that fails leaves the height
   * behind and the block is replayed rather than skipped. The rows themselves
   * are written with ON CONFLICT DO NOTHING, so a replay is harmless.
   */
  async #recordHeight(height: number): Promise<void> {
    await this.options.pool.query(
      `INSERT INTO indexer_state (id, chain_id, last_indexed_height, updated_at)
       VALUES (1, (SELECT chain_id FROM indexer_state WHERE id = 1), $1, now())
       ON CONFLICT (id) DO UPDATE SET last_indexed_height = $1, updated_at = now()`,
      [height],
    );
  }

  /** Read the transfer events a transaction emitted. */
  async #transferEvents(hash: string): Promise<Array<{ from: string; to: string; amount: string }>> {
    const status = await this.options.client.txStatus(hash);
    // A failed transaction moved nothing except its fee, so it produces no
    // transfers to index.
    if (status.status === "failed") return [];

    const raw = (status as unknown as { events?: unknown }).events;
    const events = Array.isArray(raw) ? raw : [];
    const out: Array<{ from: string; to: string; amount: string }> = [];

    for (const event of events) {
      const e = event as { type?: string; attributes?: Array<{ key?: string; value?: string }> };
      if (e.type !== "transfer") continue;
      const attributes = new Map((e.attributes ?? []).map((a) => [a.key ?? "", a.value ?? ""]));
      const from = attributes.get("from");
      const to = attributes.get("to");
      const amount = attributes.get("amount");
      if (from && to && amount && /^\d+$/.test(amount) && BigInt(amount) > 0n) {
        out.push({ from, to, amount });
      }
    }
    return out;
  }

  /** Run until stopped, catching up and then following the chain head. */
  async run(): Promise<void> {
    const status = await this.options.client.status();
    await this.initialise(status.chain_id);

    const idleMs = this.options.idleMs ?? 1_000;
    while (!this.#stopped) {
      let processed = 0;
      try {
        processed = await this.indexOnce();
      } catch (err) {
        // A transient node or database failure must not kill the indexer: it
        // is a projection and can always catch up.
        console.error(`[indexer] pass failed, retrying: ${String(err)}`);
        await sleep(idleMs * 5);
        continue;
      }
      if (processed === 0) await sleep(idleMs);
    }
  }

  stop(): void {
    this.#stopped = true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
