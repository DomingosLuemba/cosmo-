"use client";

import type { HistoryEntry, YozexaClient } from "@yozexa/sdk";

import type { Movement, MovementKind } from "@/components/yzx/transaction-row";

/**
 * An account's movements, read from the chain.
 *
 * Two sources, in order of preference:
 *
 *  1. The node's transaction index (`/v1/history`), which returns everything
 *     the account has ever done in one request.
 *  2. Failing that, a walk back through recent blocks.
 *
 * The fallback exists because a node can be run with indexing disabled, and a
 * wallet that then shows an empty list would be telling the holder they have
 * no history when the truth is that this node cannot answer. It reaches back
 * only as far as it scans, and `MovementsResult.complete` says so, so the UI
 * can be honest about what it is showing.
 */

export interface MovementsResult {
  movements: Movement[];
  /** False when this is a bounded scan rather than the account's full history. */
  complete: boolean;
  /** What to tell the reader when the list is not complete. */
  note?: string;
}

const SCAN_DEPTH = 100;

export async function recentMovements(
  client: YozexaClient,
  address: string,
  options: { blocks?: number; limit?: number } = {},
): Promise<MovementsResult> {
  const limit = options.limit ?? 50;

  try {
    const history = await client.history(address, { limit: Math.min(limit, 100) });
    if (history.complete) {
      return {
        movements: history.entries.flatMap((entry) => movementsFromEntry(entry, address)).slice(0, limit),
        complete: true,
      };
    }
  } catch {
    // Fall through to the scan: an older node has no history endpoint.
  }

  return scanBlocks(client, address, options.blocks ?? SCAN_DEPTH, limit);
}

/** Turn one indexed transaction into the movements it means for this account. */
function movementsFromEntry(entry: HistoryEntry, address: string): Movement[] {
  const out: Movement[] = [];
  let index = 0;

  for (const event of entry.events ?? []) {
    const kind = movementKind(event.type);
    if (!kind) continue;

    const attrs = new Map((event.attributes ?? []).map((a) => [a.key, a.value]));
    const from = attrs.get("from") ?? attrs.get("delegator") ?? "";
    const to = attrs.get("to") ?? attrs.get("validator") ?? "";
    const amount = attrs.get("amount");
    if (!amount || !/^\d+$/.test(amount) || BigInt(amount) === 0n) continue;

    const incoming = to === address;
    const outgoing = from === address;
    if (!incoming && !outgoing) continue;

    out.push({
      id: `${entry.hash}-${index++}`,
      kind: incoming && kind === "sent" ? "received" : kind,
      counterparty: incoming ? from : to,
      ...(entry.memo ? { title: entry.memo } : {}),
      amount: BigInt(amount),
      incoming,
      // A pruned node returns no time. Showing the epoch would be a lie; the
      // row renders the height instead when the date is unusable.
      at: entry.time ? new Date(entry.time) : new Date(0),
      status: entry.failed ? "failed" : "finalized",
      hash: entry.hash,
    });
  }
  return out;
}

/**
 * The fallback: walk back through blocks that contain transactions.
 *
 * The block list carries transaction counts, so empty blocks cost nothing —
 * only blocks that actually did something are fetched.
 */
async function scanBlocks(
  client: YozexaClient,
  address: string,
  depth: number,
  limit: number,
): Promise<MovementsResult> {
  const { blocks } = await client.blocks(depth);
  const found: Movement[] = [];

  for (const summary of blocks) {
    const block = summary as { height: number; time: string; transaction_count: number };
    if (Number(block.transaction_count) === 0) continue;
    if (found.length >= limit) break;

    const detail = (await client.block(Number(block.height))) as {
      time: string;
      transactions?: Array<{ hash: string; memo?: string }>;
    };

    for (const tx of detail.transactions ?? []) {
      const status = await client.txStatus(tx.hash).catch(() => null);
      if (!status) continue;
      const events = (status as unknown as { events?: unknown }).events;
      found.push(
        ...movementsFromEntry(
          {
            hash: tx.hash,
            height: Number(block.height),
            time: detail.time,
            code: status.code,
            gas_used: status.gas_used ?? 0,
            ...(tx.memo ? { memo: tx.memo } : {}),
            events: Array.isArray(events) ? events : [],
            failed: status.status === "failed",
          },
          address,
        ),
      );
    }
  }

  return {
    movements: found.slice(0, limit),
    complete: false,
    note: SCAN_NOTE,
  };
}

function movementKind(eventType: string | undefined): MovementKind | null {
  switch (eventType) {
    case "transfer":
      return "sent";
    case "withdraw_rewards":
      return "staking";
    case "burn":
      return "burn";
    default:
      return null;
  }
}

/** How far back a scan reached, for the note the UI shows beneath a list. */
export const SCAN_NOTE =
  "This node does not index transactions, so this list is a scan of recent blocks rather than " +
  "your full history. Everything is always available in the YOZEXA Explorer.";
