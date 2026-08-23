/**
 * Prometheus metrics for YOZEXA Pay.
 *
 * Pay sits between a merchant and the chain, and its failures are quiet ones:
 * payments that never settle because the node is unreachable, webhooks that
 * pile up undelivered, quotes that cannot be priced. None of those throw. The
 * merchant simply stops being paid, and finds out from a customer.
 *
 * Money is reported in whole YZXA, not base units. Prometheus stores every
 * sample as a float64, which stops counting integers one at a time past 2^53,
 * and a base-unit figure runs far past that. The API serves the exact integer;
 * this is for noticing a change, not for reconciling one.
 */
import type { Pool } from "pg";

const ONE_YZXA = 10n ** 18n;

interface Sample {
  name: string;
  help: string;
  kind: "gauge" | "counter";
  value: number;
  labels?: Record<string, string>;
}

/** Base units to whole YZXA, without routing the integer through a float. */
function toYZXA(baseUnits: string | null): number {
  if (!baseUnits) return 0;
  let n: bigint;
  try {
    n = BigInt(baseUnits);
  } catch {
    return 0;
  }
  const whole = n / ONE_YZXA;
  const fraction = n % ONE_YZXA;
  return Number(whole) + Number(fraction) / 1e18;
}

export async function collect(pool: Pool, nodeUrl: string, environment: string): Promise<Sample[]> {
  const out: Sample[] = [];

  // Payment counts by status. A rising `expired` next to a flat `confirmed`
  // is the shape of a settlement problem, and neither number alone shows it.
  try {
    const { rows } = await pool.query<{ status: string; n: string; total: string }>(
      `SELECT status, COUNT(*)::text AS n, COALESCE(SUM(expected_amount::numeric), 0)::text AS total
         FROM payments GROUP BY status`,
    );
    for (const r of rows) {
      out.push({
        name: "yozexa_pay_payments",
        help: "Payments by status.",
        kind: "gauge",
        value: Number(r.n),
        labels: { status: r.status },
      });
      out.push({
        name: "yozexa_pay_payments_value_yzxa",
        help: "Total value of payments by status, in YZXA. Exact integers are in the API.",
        kind: "gauge",
        value: toYZXA(r.total),
        labels: { status: r.status },
      });
    }
  } catch {
    // Reported below as yozexa_pay_database_up 0.
  }

  // Undelivered webhooks. A merchant whose endpoint has been down does not
  // know their integration has stopped working until this is looked at.
  try {
    const { rows } = await pool.query<{ pending: string; failed: string; oldest: string | null }>(
      `SELECT
         COUNT(*) FILTER (WHERE delivered_at IS NULL AND attempts < 8)::text  AS pending,
         COUNT(*) FILTER (WHERE delivered_at IS NULL AND attempts >= 8)::text AS failed,
         EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE delivered_at IS NULL)))::text AS oldest
       FROM webhook_deliveries`,
    );
    const r = rows[0];
    if (r) {
      out.push({ name: "yozexa_pay_webhooks_pending", kind: "gauge", value: Number(r.pending),
        help: "Webhook deliveries still being retried." });
      out.push({ name: "yozexa_pay_webhooks_exhausted", kind: "gauge", value: Number(r.failed),
        help: "Webhook deliveries that ran out of retries. Each one is a merchant who was never told." });
      out.push({ name: "yozexa_pay_webhooks_oldest_pending_seconds", kind: "gauge",
        value: Number(r.oldest ?? 0),
        help: "Age of the oldest undelivered webhook, in seconds." });
    }
  } catch {
    /* database reported below */
  }

  try {
    const { rows } = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM merchants`);
    out.push({ name: "yozexa_pay_merchants", kind: "gauge", value: Number(rows[0]?.n ?? 0),
      help: "Merchants registered." });
    out.push({ name: "yozexa_pay_database_up", kind: "gauge", value: 1,
      help: "1 when the database answered this scrape. Pay cannot settle anything at 0." });
  } catch {
    out.push({ name: "yozexa_pay_database_up", kind: "gauge", value: 0,
      help: "1 when the database answered this scrape. Pay cannot settle anything at 0." });
  }

  // Whether the chain is reachable. Settlement is watching the chain, so a
  // node Pay cannot reach means payments silently stop being credited.
  let nodeUp = 0;
  let nodeHeight = 0;
  try {
    const r = await fetch(`${nodeUrl}/v1/status`, { signal: AbortSignal.timeout(3_000) });
    if (r.ok) {
      const body = (await r.json()) as { height?: number };
      nodeUp = 1;
      nodeHeight = Number(body.height ?? 0);
    }
  } catch {
    /* stays 0 */
  }
  out.push({ name: "yozexa_pay_node_up", kind: "gauge", value: nodeUp,
    help: "1 when Pay can reach the YOZEXA node. Settlement stops at 0." });
  out.push({ name: "yozexa_pay_node_height", kind: "gauge", value: nodeHeight,
    help: "The chain height Pay last saw. Flat means settlement is not advancing." });

  out.push({ name: "yozexa_pay_info", kind: "gauge", value: 1,
    help: "Always 1. The label carries the environment this instance serves.",
    labels: { environment } });

  return out;
}

/** Render samples in the Prometheus text exposition format. */
export function render(samples: Sample[]): string {
  const seen = new Set<string>();
  let out = "";
  for (const s of samples) {
    if (!seen.has(s.name)) {
      out += `# HELP ${s.name} ${s.help}\n# TYPE ${s.name} ${s.kind}\n`;
      seen.add(s.name);
    }
    out += s.name;
    if (s.labels && Object.keys(s.labels).length > 0) {
      // Sorted, so two scrapes of the same state produce identical text.
      const parts = Object.keys(s.labels)
        .sort()
        .map((k) => `${k}="${escapeLabel(s.labels![k] ?? "")}"`);
      out += `{${parts.join(",")}}`;
    }
    out += ` ${formatValue(s.value)}\n`;
  }
  return out;
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

/** Keep whole numbers whole, so a scrape can be read by eye. */
function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "0";
  return Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : String(v);
}
