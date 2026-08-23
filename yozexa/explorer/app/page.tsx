import { chain, tryFetch, formatIso, relative } from "@/lib/chain";
import { formatYZXA } from "@yozexa/sdk";

import { SearchBox } from "./search-box";

export default async function OverviewPage() {
  const [status, supply, blocks, validators, emission] = await Promise.all([
    tryFetch(() => chain.status()),
    tryFetch(() => chain.supply()),
    tryFetch(() => chain.blocks(12)),
    tryFetch(() => chain.validators()),
    tryFetch(() => chain.invariants()),
  ]);

  if ("error" in status) {
    return (
      <>
        <h1>YOZEXA Explorer</h1>
        <div className="notice">
          <strong>Cannot reach a YOZEXA node.</strong>
          <p style={{ margin: "8px 0 0" }}>{status.error}</p>
          <p className="dim" style={{ margin: "8px 0 0", fontSize: 13 }}>
            Set <code className="mono">YOZEXA_NODE</code> to a node&rsquo;s HTTP API and reload.
            The explorer has no database of its own, so with no node there is nothing to show —
            which is the honest failure mode.
          </p>
        </div>
      </>
    );
  }

  const s = status.data;
  const sup = "data" in supply ? supply.data : null;
  const minted = sup ? BigInt(String(sup.minted_supply)) : 0n;
  const burned = sup ? BigInt(String(sup.burned_supply)) : 0n;
  const max = sup ? BigInt(String(sup.max_supply)) : 1n;
  const mintedPct = max > 0n ? Number((minted * 10_000n) / max) / 100 : 0;

  const validatorList = (("data" in validators ? validators.data.validators : null) ??
    []) as Array<Record<string, unknown>>;
  const active = validatorList.filter((v) => v.active === true).length;
  const totalBonded = "data" in validators ? BigInt(validators.data.total_bonded || "0") : 0n;

  const invariantsOk = "data" in emission ? emission.data.ok : null;

  return (
    <>
      <h1>YOZEXA Network</h1>
      <p className="subtitle">
        Chain <span className="mono">{s.chain_id}</span> · height{" "}
        {s.height.toLocaleString()} · {relative(s.latest_block_time)}
      </p>

      <SearchBox />

      <div className="grid cols-4">
        <div className="card">
          <div className="label">Block height</div>
          <div className="value">{s.height.toLocaleString()}</div>
          <div className="hint">{formatIso(s.latest_block_time)}</div>
        </div>
        <div className="card">
          <div className="label">Circulating supply</div>
          <div className="value mono">{formatYZXA(minted - burned)}</div>
          <div className="hint">of 10,000,000 YZXA maximum, forever</div>
        </div>
        <div className="card">
          <div className="label">Minted so far</div>
          <div className="value mono">{formatYZXA(minted)}</div>
          <div className="bar">
            <div style={{ width: `${Math.min(100, mintedPct)}%` }} />
          </div>
          <div className="hint">{mintedPct.toFixed(2)}% of the hard cap</div>
        </div>
        <div className="card">
          <div className="label">Active validators</div>
          <div className="value">
            {active} <span className="dim" style={{ fontSize: 15 }}>/ {validatorList.length}</span>
          </div>
          <div className="hint">{formatYZXA(totalBonded)} YZXA bonded</div>
        </div>
      </div>

      {invariantsOk === false ? (
        <div className="notice">
          <strong>This node reports a violated protocol invariant.</strong>
          <p style={{ margin: "8px 0 0" }}>
            That means its ledger does not add up. See{" "}
            <a href="/supply">the supply audit</a> for which check failed. A node in this state
            should not be trusted for settlement.
          </p>
        </div>
      ) : null}

      <h2>Latest blocks</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Height</th>
              <th>Time</th>
              <th className="num">Transactions</th>
              <th>Hash</th>
            </tr>
          </thead>
          <tbody>
            {"data" in blocks && (blocks.data.blocks ?? []).length > 0 ? (
              (blocks.data.blocks ?? []).map((b) => {
                const block = b as { height: number; time: string; transaction_count: number; hash: string };
                return (
                  <tr key={block.height}>
                    <td>
                      <a href={`/block/${block.height}`} className="mono">
                        {block.height.toLocaleString()}
                      </a>
                    </td>
                    <td className="dim">{relative(block.time)}</td>
                    <td className="num">{block.transaction_count}</td>
                    <td>
                      <span className="mono dim trunc">{block.hash}</span>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className="dim">
                  No blocks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: 12 }}>
        <a href="/blocks">All blocks →</a>
      </p>
    </>
  );
}
