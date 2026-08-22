import { chain, tryFetch, bpsToPercent } from "@/lib/chain";
import { formatYZXA } from "@yozexa/sdk";

export const dynamic = "force-dynamic";

export default async function ValidatorsPage() {
  const result = await tryFetch(() => chain.validators());

  if ("error" in result) {
    return (
      <>
        <h1>Validators</h1>
        <div className="notice">{result.error}</div>
      </>
    );
  }

  const validators = (result.data.validators ?? []) as Array<Record<string, string | number | boolean>>;
  const totalBonded = BigInt(result.data.total_bonded || "0");
  const sorted = [...validators].sort((a, b) => {
    const at = BigInt(String(a.tokens || "0"));
    const bt = BigInt(String(b.tokens || "0"));
    return bt > at ? 1 : bt < at ? -1 : 0;
  });

  return (
    <>
      <h1>Validators</h1>
      <p className="subtitle">
        {formatYZXA(totalBonded)} YZXA bonded across {validators.length} validators.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Validator</th>
              <th className="num">Stake</th>
              <th className="num">Voting power</th>
              <th className="num">Commission</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((v, i) => (
              <tr key={String(v.operator)}>
                <td className="dim num">{i + 1}</td>
                <td>
                  <a href={`/validator/${v.operator}`}>{String(v.moniker || v.operator)}</a>
                  <div className="mono dim trunc" style={{ fontSize: 11, maxWidth: 240 }}>
                    {String(v.operator)}
                  </div>
                </td>
                <td className="num mono">{String(v.tokens_yzxa)}</td>
                <td className="num">{bpsToPercent(v.voting_power_bps as string)}</td>
                <td className="num">{(Number(v.commission_bps) / 100).toFixed(2)}%</td>
                <td>
                  {v.tombstoned ? (
                    <span className="pill danger">Tombstoned</span>
                  ) : v.jailed ? (
                    <span className="pill warn">Jailed</span>
                  ) : v.active ? (
                    <span className="pill ok">Active</span>
                  ) : (
                    <span className="pill dim">Inactive</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="notice info" style={{ marginTop: 20 }}>
        <strong>Staking carries real risk.</strong> A validator that goes offline is jailed and
        loses a small amount of stake; one that double signs loses 5% and is permanently removed.
        Delegators are slashed alongside the validator they chose. No yield shown anywhere on this
        network is guaranteed.
      </div>
    </>
  );
}
