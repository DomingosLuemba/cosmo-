import { chain, tryFetch, formatUnix } from "@/lib/chain";
import { formatYZXA } from "@yozexa/sdk";

export const dynamic = "force-dynamic";

/**
 * Public accounting of every allocation that could otherwise be a matter of
 * trust: the founder's, the team's, and the funds governance controls.
 */
export default async function TransparencyPage() {
  const [vesting, report] = await Promise.all([
    tryFetch(() => chain.vesting()),
    tryFetch(() => chain.verifySupply()),
  ]);

  if ("error" in vesting) {
    return (
      <>
        <h1>Transparency</h1>
        <div className="notice">{vesting.error}</div>
      </>
    );
  }

  const positions = (vesting.data.vesting ?? []) as Array<Record<string, string | number>>;
  const modules = ("data" in report ? (report.data.module_balances as Record<string, string>) : {}) ?? {};

  const byCategory = (category: string) => positions.filter((p) => p.category === category);
  const sum = (rows: Array<Record<string, string | number>>, key: string): bigint =>
    rows.reduce((acc, r) => acc + BigInt(String(r[key] ?? "0")), 0n);

  const founder = byCategory("founder");
  const team = byCategory("team");

  return (
    <>
      <h1>Transparency</h1>
      <p className="subtitle">
        Who holds what, and what they can actually move. Read live from the chain.
      </p>

      <div className="grid cols-2">
        <div className="card">
          <div className="label">Founder allocation</div>
          <div className="value mono">{formatYZXA(sum(founder, "total"))}</div>
          <div className="hint">
            {formatYZXA(sum(founder, "locked"))} YZXA still locked · 2-year cliff, 8-year schedule
          </div>
        </div>
        <div className="card">
          <div className="label">Team allocation</div>
          <div className="value mono">{formatYZXA(sum(team, "total"))}</div>
          <div className="hint">
            {formatYZXA(sum(team, "locked"))} YZXA still locked · 1-year cliff, 6-year schedule
          </div>
        </div>
        <div className="card">
          <div className="label">Treasury</div>
          <div className="value mono">{formatYZXA(BigInt(modules.treasury ?? "0"))}</div>
          <div className="hint">governance only, behind a timelock and a per-epoch cap</div>
        </div>
        <div className="card">
          <div className="label">Security fund</div>
          <div className="value mono">{formatYZXA(BigInt(modules.security_fund ?? "0"))}</div>
          <div className="hint">audits, bug bounties, emergency security work</div>
        </div>
        <div className="card">
          <div className="label">Ecosystem fund</div>
          <div className="value mono">{formatYZXA(BigInt(modules.ecosystem_fund ?? "0"))}</div>
          <div className="hint">grants and developer programmes</div>
        </div>
        <div className="card">
          <div className="label">Liquidity fund</div>
          <div className="value mono">{formatYZXA(BigInt(modules.liquidity_fund ?? "0"))}</div>
          <div className="hint">market liquidity allocation</div>
        </div>
      </div>

      <h2>Vesting positions</h2>
      {positions.length === 0 ? (
        <div className="notice info">
          This network has no vesting positions. On a local or test network that is expected —
          founder and team allocations exist in the mainnet genesis.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Account</th>
                <th className="num">Allocation</th>
                <th className="num">Vested</th>
                <th className="num">Locked</th>
                <th>Cliff</th>
                <th>Ends</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const total = BigInt(String(p.total));
                const lockedAmount = BigInt(String(p.locked));
                const lockedPct = total > 0n ? Number((lockedAmount * 10_000n) / total) / 100 : 0;
                return (
                  <tr key={String(p.address)}>
                    <td style={{ textTransform: "capitalize" }}>{String(p.category)}</td>
                    <td>
                      <a href={`/account/${p.address}`} className="mono trunc" style={{ maxWidth: 180 }}>
                        {String(p.address)}
                      </a>
                    </td>
                    <td className="num mono">{formatYZXA(total)}</td>
                    <td className="num mono">{formatYZXA(BigInt(String(p.vested)))}</td>
                    <td className="num mono">
                      {formatYZXA(lockedAmount)}
                      <div className="bar locked">
                        <div style={{ width: `${lockedPct}%` }} />
                      </div>
                    </td>
                    <td className="dim">{formatUnix(p.cliff_unix)}</td>
                    <td className="dim">{formatUnix(p.end_unix)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="notice info" style={{ marginTop: 22 }}>
        <strong>What &ldquo;locked&rdquo; means here.</strong> The lock lives inside the state
        machine&rsquo;s transfer path. A holder cannot spend or stake a locked unit even with full
        control of their private key, and there is no message, no parameter and no governance
        proposal in the protocol that shortens a schedule or releases a balance early. Every node
        re-checks, at the end of every block, that each vesting account still holds what it has
        locked.
      </div>
    </>
  );
}
