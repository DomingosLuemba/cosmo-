import { YozexaClient } from "@yozexa/sdk";

/**
 * The node this explorer reads from.
 *
 * The explorer is a *view* of the chain. It holds no keys, signs nothing and
 * has no database of its own: every number on every page comes from a node, so
 * anyone can verify it by querying the same endpoint.
 */
export const NODE_URL = process.env.YOZEXA_NODE ?? "http://127.0.0.1:1717";

export const chain = new YozexaClient({ url: NODE_URL, timeoutMs: 10_000 });

/** Pages must render even when the node is unreachable, saying so plainly. */
export async function tryFetch<T>(fn: () => Promise<T>): Promise<{ data: T } | { error: string }> {
  try {
    return { data: await fn() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Format a unix seconds timestamp for display. */
export function formatUnix(unix: number | string | null | undefined): string {
  const value = Number(unix);
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Date(value * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** Format an ISO timestamp for display. */
export function formatIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.replace("T", " ").replace("Z", "").slice(0, 19) + " UTC";
}

/** Relative time, for "3 seconds ago" style hints. */
export function relative(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/** Percentage from a basis-point string, for validator voting power. */
export function bpsToPercent(bps: string | number | undefined): string {
  const value = Number(bps ?? 0);
  if (!Number.isFinite(value)) return "0.00%";
  return `${(value / 100).toFixed(2)}%`;
}
