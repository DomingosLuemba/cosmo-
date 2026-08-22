import { chain, tryFetch, formatUnix } from "@/lib/chain";
import { formatYZXA } from "@yozexa/sdk";

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<string, string> = {
  deposit_period: "dim",
  voting_period: "warn",
  passed: "ok",
  executed: "ok",
  rejected: "dim",
  vetoed: "danger",
  failed: "danger",
  expired: "dim",
};

export default async function GovernancePage() {
  const [proposals, params] = await Promise.all([
    tryFetch(() => chain.proposals()),
    tryFetch(() => chain.params()),
  ]);

  if ("error" in proposals) {
    return (
      <>
        <h1>Governance</h1>
        <div className="notice">{proposals.error}</div>
      </>
    );
  }

  const list = (proposals.data.proposals ?? []) as Array<Record<string, string | number>>;
  const p = "data" in params ? (params.data as Record<string, string | number>) : null;

  return (
    <>
      <h1>Governance</h1>
      <p className="subtitle">
        Voting power is bonded stake, not balance. The people who can lose money from a bad
        decision are the ones who decide.
      </p>

      {p ? (
        <div className="grid cols-4">
          <div className="card">
            <div className="label">Quorum</div>
            <div className="value">{(Number(p.quorum_bps) / 100).toFixed(1)}%</div>
            <div className="hint">of bonded stake must vote</div>
          </div>
          <div className="card">
            <div className="label">Threshold</div>
            <div className="value">{(Number(p.threshold_bps) / 100).toFixed(1)}%</div>
            <div className="hint">yes, of non-abstain votes</div>
          </div>
          <div className="card">
            <div className="label">Veto</div>
            <div className="value">{(Number(p.veto_bps) / 100).toFixed(1)}%</div>
            <div className="hint">rejects outright and burns the deposit</div>
          </div>
          <div className="card">
            <div className="label">Timelock</div>
            <div className="value">{Math.round(Number(p.timelock_seconds) / 3600)}h</div>
            <div className="hint">between passing and taking effect</div>
          </div>
        </div>
      ) : null}

      <h2>Proposals</h2>
      {list.length === 0 ? (
        <div className="notice info">No proposals have been submitted on this network yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Kind</th>
                <th>Status</th>
                <th className="num">Deposit</th>
                <th>Closes</th>
              </tr>
            </thead>
            <tbody>
              {list.map((prop) => (
                <tr key={String(prop.id)}>
                  <td className="mono">{String(prop.id)}</td>
                  <td>{String(prop.title)}</td>
                  <td className="mono dim" style={{ fontSize: 12 }}>{String(prop.kind)}</td>
                  <td>
                    <span className={`pill ${STATUS_PILL[String(prop.status)] ?? "dim"}`}>
                      {String(prop.status).replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="num mono">{formatYZXA(BigInt(String(prop.deposit ?? "0")))}</td>
                  <td className="dim">
                    {prop.voting_end_unix ? formatUnix(prop.voting_end_unix) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="notice info" style={{ marginTop: 22 }}>
        <strong>What governance cannot do.</strong> There is no proposal type that mints YZXA and
        none that changes a balance directly. The supply cap is a compile-time constant, not a
        parameter, so there is nothing for a proposal to change. A parameter proposal that would
        disable equivocation slashing is refused at submission and again at execution. A treasury
        spend moves existing funds, is capped per epoch, and fails if the treasury cannot cover it.
      </div>
    </>
  );
}
