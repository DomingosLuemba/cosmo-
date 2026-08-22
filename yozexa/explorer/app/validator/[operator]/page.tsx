import { chain, tryFetch, formatUnix, bpsToPercent } from "@/lib/chain";
import { formatYZXA } from "@yozexa/sdk";

export const dynamic = "force-dynamic";

export default async function ValidatorPage({ params }: { params: Promise<{ operator: string }> }) {
  const { operator } = await params;
  const detail = await tryFetch(
    () => chain.validator(operator) as Promise<Record<string, string | number | boolean>>,
  );

  if ("error" in detail) {
    return (
      <>
        <h1>Validator</h1>
        <div className="notice">{detail.error}</div>
      </>
    );
  }

  const v = detail.data;

  return (
    <>
      <h1>{String(v.moniker || "Validator")}</h1>
      <p className="mono subtitle" style={{ wordBreak: "break-all" }}>{String(v.operator)}</p>

      <div className="grid cols-3">
        <div className="card">
          <div className="label">Bonded stake</div>
          <div className="value mono">{String(v.tokens_yzxa)}</div>
          <div className="hint">{bpsToPercent(v.voting_power_bps as string)} of voting power</div>
        </div>
        <div className="card">
          <div className="label">Commission</div>
          <div className="value">{(Number(v.commission_bps) / 100).toFixed(2)}%</div>
          <div className="hint">
            capped at {(Number(v.max_commission_bps) / 100).toFixed(2)}%, permanently
          </div>
        </div>
        <div className="card">
          <div className="label">Status</div>
          <div className="value" style={{ fontSize: 17 }}>
            {v.tombstoned ? (
              <span className="pill danger">Tombstoned</span>
            ) : v.jailed ? (
              <span className="pill warn">Jailed</span>
            ) : v.active ? (
              <span className="pill ok">Active</span>
            ) : (
              <span className="pill dim">Inactive</span>
            )}
          </div>
          {v.jailed && !v.tombstoned ? (
            <div className="hint">jailed until {formatUnix(Number(v.jailed_until_unix))}</div>
          ) : null}
        </div>
      </div>

      {v.tombstoned ? (
        <div className="notice">
          <strong>This validator double signed and has been permanently removed.</strong>
          <p style={{ margin: "8px 0 0" }}>
            5% of its stake was burned, along with any stake that was unbonding at the time of the
            infraction. Its consensus key can never validate again — not under this operator, not
            under a new one, and not by any governance vote.
          </p>
        </div>
      ) : null}

      <h2>Details</h2>
      <div className="card">
        <dl className="kv">
          <dt>Consensus key</dt>
          <dd className="mono" style={{ fontSize: 12 }}>{String(v.consensus_pubkey)}</dd>
          <dt>Min self-delegation</dt>
          <dd className="mono">{formatYZXA(BigInt(String(v.min_self_delegation || "0")))} YZXA</dd>
          <dt>Unwithdrawn commission</dt>
          <dd className="mono">{formatYZXA(BigInt(String(v.commission_owed || "0")))} YZXA</dd>
          {v.website ? (
            <>
              <dt>Website</dt>
              <dd>{String(v.website)}</dd>
            </>
          ) : null}
          {v.details ? (
            <>
              <dt>About</dt>
              <dd>{String(v.details)}</dd>
            </>
          ) : null}
        </dl>
      </div>
    </>
  );
}
