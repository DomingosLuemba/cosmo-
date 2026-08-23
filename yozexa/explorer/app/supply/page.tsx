import { chain, tryFetch } from "@/lib/chain";
import { formatYZXA } from "@yozexa/sdk";

export const dynamic = "force-dynamic";

/**
 * The supply dashboard.
 *
 * Every number here is read from the node and can be reproduced by anyone
 * running `yozexa supply verify` against the same chain. There is no figure on
 * this page that a human types in.
 */
export default async function SupplyPage() {
  const [report, emission] = await Promise.all([
    tryFetch(() => chain.verifySupply()),
    tryFetch(() => chain.emission()),
  ]);

  if ("error" in report) {
    return (
      <>
        <h1>Supply</h1>
        <div className="notice">{report.error}</div>
      </>
    );
  }

  const r = report.data as Record<string, unknown>;
  const big = (key: string): bigint => BigInt(String(r[key] ?? "0"));

  const max = big("maximum_supply");
  const minted = big("current_minted");
  const burned = big("burned");
  const circulating = big("circulating");
  const remaining = big("remaining_mintable");
  const locked = big("vesting_locked");

  const modules = (r.module_balances ?? {}) as Record<string, string>;
  const invariants = (r.invariants ?? []) as Array<{ name: string; ok: boolean; message?: string }>;
  const capValid = r.supply_cap === "VALID";
  const failed = invariants.filter((i) => !i.ok);

  const pct = (value: bigint): number => (max > 0n ? Number((value * 10_000n) / max) / 100 : 0);

  const em = "data" in emission ? emission.data : null;

  return (
    <>
      <h1>YZXA supply</h1>
      <p className="subtitle">
        Read live from a node at height {String(r.height)}. Reproduce it yourself with{" "}
        <code className="mono">yozexa supply verify</code>.
      </p>

      <div
        className="card"
        style={{
          borderColor: capValid ? undefined : "var(--danger)",
          background: capValid ? undefined : "color-mix(in srgb, var(--danger) 10%, transparent)",
        }}
      >
        <div className="label">Supply cap</div>
        <div className="value" style={{ color: capValid ? "var(--ok)" : "var(--danger)" }}>
          {String(r.supply_cap)}
        </div>
        <div className="hint">
          {capValid
            ? "Minted supply is within the 10,000,000 YZXA hard cap. This is re-checked by every node at the end of every block; a violation halts the node rather than letting the ledger drift."
            : "The hard cap is violated on this node. Do not treat its state as authoritative."}
        </div>
      </div>

      <div className="grid cols-3" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="label">Maximum supply</div>
          <div className="value mono">{formatYZXA(max)}</div>
          <div className="hint">a compile-time constant, not a governance parameter</div>
        </div>
        <div className="card">
          <div className="label">Minted supply</div>
          <div className="value mono">{formatYZXA(minted)}</div>
          <div className="bar">
            <div style={{ width: `${pct(minted)}%` }} />
          </div>
          <div className="hint">{pct(minted).toFixed(2)}% of the cap</div>
        </div>
        <div className="card">
          <div className="label">Circulating supply</div>
          <div className="value mono">{formatYZXA(circulating)}</div>
          <div className="hint">minted minus burned</div>
        </div>
        <div className="card">
          <div className="label">Burned supply</div>
          <div className="value mono">{formatYZXA(burned)}</div>
          <div className="hint">
            permanently destroyed; burning never restores headroom to mint
          </div>
        </div>
        <div className="card">
          <div className="label">Locked supply</div>
          <div className="value mono">{formatYZXA(locked)}</div>
          <div className="hint">founder and team vesting, enforced by the protocol</div>
        </div>
        <div className="card">
          <div className="label">Remaining mintable</div>
          <div className="value mono">{formatYZXA(remaining)}</div>
          <div className="hint">everything the protocol may still create, ever</div>
        </div>
      </div>

      {em ? (
        <>
          <h2>Future emission</h2>
          <div className="grid cols-4">
            <div className="card">
              <div className="label">Emission reserve</div>
              <div className="value mono">{formatYZXA(BigInt(String(em.reserve)))}</div>
              <div className="hint">50% of the cap, held by nobody</div>
            </div>
            <div className="card">
              <div className="label">Paid out so far</div>
              <div className="value mono">{formatYZXA(BigInt(String(em.total_emitted)))}</div>
            </div>
            <div className="card">
              <div className="label">Current block reward</div>
              <div className="value mono">{formatYZXA(BigInt(String(em.current_block_reward)))}</div>
              <div className="hint">era {String(em.current_era)}</div>
            </div>
            <div className="card">
              <div className="label">Next era</div>
              <div className="value mono">
                {formatYZXA(BigInt(String(em.next_era_block_reward)))}
              </div>
              <div className="hint">
                at height {Number(em.next_era_height).toLocaleString()} — the reward halves
              </div>
            </div>
          </div>
        </>
      ) : null}

      <h2>Protocol accounts</h2>
      <p className="dim" style={{ fontSize: 13, marginTop: -6 }}>
        These addresses are derived from a hash of their name. No private key exists that can sign
        for them, so their balances move only through protocol logic.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th className="num">Balance</th>
              <th>What it is</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(MODULE_LABELS).map(([key, label]) => (
              <tr key={key}>
                <td className="mono">{key}</td>
                <td className="num mono">{formatYZXA(BigInt(modules[key] ?? "0"))}</td>
                <td className="dim">{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Invariants</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Result</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {invariants.map((i) => (
              <tr key={i.name}>
                <td className="mono">{i.name}</td>
                <td>
                  {i.ok ? <span className="pill ok">Pass</span> : <span className="pill danger">Fail</span>}
                </td>
                <td className="dim" style={{ fontSize: 13 }}>{i.message ?? INVARIANT_MEANING[i.name] ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {failed.length === 0 ? (
        <p className="dim" style={{ fontSize: 13, marginTop: 12 }}>
          Every invariant holds. These are checked in production at the end of every block, not
          only in tests.
        </p>
      ) : null}
    </>
  );
}

const MODULE_LABELS: Record<string, string> = {
  bonded_pool: "Stake currently bonded to validators",
  unbonding_pool: "Stake unbonding, still slashable",
  reward_pool: "Accrued staking rewards not yet claimed",
  treasury: "Ecosystem treasury — governance controlled, timelocked, capped per epoch",
  security_fund: "Audits, bug bounties and emergency security work",
  ecosystem_fund: "Grants and developer programmes",
  liquidity_fund: "Market liquidity allocation",
  gov_deposit: "Governance proposal deposits held in escrow",
};

const INVARIANT_MEANING: Record<string, string> = {
  "supply-cap": "Minted supply is within the 10,000,000 YZXA hard cap",
  conservation: "Every balance on the chain adds up to minted minus burned",
  "bonded-pool": "The bonded pool holds exactly the sum of validator stake",
  "unbonding-pool": "The unbonding pool holds exactly the sum of queued entries",
  "reward-pool": "The reward pool can cover everything it has promised",
  shares: "A validator holds tokens if and only if it has shares",
  vesting: "Every vesting account still holds what it has locked",
  emission: "Emission has never exceeded its 5,000,000 YZXA reserve",
};
