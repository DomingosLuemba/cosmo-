import { chain, tryFetch, formatUnix } from "@/lib/chain";
import { formatYZXA, formatYOZ } from "@yozexa/sdk";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  const resolved = await tryFetch(() => chain.resolveRecipient(decodeURIComponent(address)));

  if ("error" in resolved) {
    return (
      <>
        <h1>Account</h1>
        <div className="notice">{resolved.error}</div>
      </>
    );
  }

  const addr = resolved.data;
  const [account, delegations, grants] = await Promise.all([
    tryFetch(() => chain.account(addr)),
    tryFetch(() => chain.delegations(addr)),
    tryFetch(() => chain.grants(addr)),
  ]);

  if ("error" in account) {
    return (
      <>
        <h1>Account</h1>
        <div className="notice">{account.error}</div>
      </>
    );
  }

  const a = account.data;
  const balance = BigInt(a.balance);
  const locked = BigInt(a.locked);
  const spendable = BigInt(a.spendable);
  const lockedPct = balance > 0n ? Number((locked * 10_000n) / balance) / 100 : 0;

  const stakes = ("data" in delegations ? delegations.data.delegations : null) ?? [];
  const permissions = ("data" in grants ? grants.data.grants : null) ?? [];

  return (
    <>
      <h1>{a.alias || "Account"}</h1>
      <p className="mono subtitle" style={{ wordBreak: "break-all" }}>{a.address}</p>

      <div className="grid cols-3">
        <div className="card">
          <div className="label">Balance</div>
          <div className="value mono">{formatYZXA(balance)}</div>
          <div className="hint">{formatYOZ(balance)} YOZ</div>
        </div>
        <div className="card">
          <div className="label">Spendable now</div>
          <div className="value mono">{formatYZXA(spendable)}</div>
          {locked > 0n ? (
            <>
              <div className="bar locked">
                <div style={{ width: `${lockedPct}%` }} />
              </div>
              <div className="hint">{formatYZXA(locked)} YZXA still locked by vesting</div>
            </>
          ) : (
            <div className="hint">No vesting lock on this account</div>
          )}
        </div>
        <div className="card">
          <div className="label">Sequence</div>
          <div className="value">{a.sequence}</div>
          <div className="hint">the next nonce this account must sign with</div>
        </div>
      </div>

      {a.vesting ? (
        <>
          <h2>Vesting position</h2>
          <div className="card">
            <dl className="kv">
              <dt>Category</dt>
              <dd style={{ textTransform: "capitalize" }}>{a.vesting.category}</dd>
              <dt>Allocation</dt>
              <dd className="mono">{formatYZXA(BigInt(a.vesting.total))} YZXA</dd>
              <dt>Vested to date</dt>
              <dd className="mono">{formatYZXA(BigInt(a.vesting.vested))} YZXA</dd>
              <dt>Still locked</dt>
              <dd className="mono">{formatYZXA(BigInt(a.vesting.locked))} YZXA</dd>
              <dt>Cliff</dt>
              <dd>{formatUnix(a.vesting.cliff_unix)}</dd>
              <dt>Schedule ends</dt>
              <dd>{formatUnix(a.vesting.end_unix)}</dd>
            </dl>
            <p className="dim" style={{ fontSize: 13, marginBottom: 0, marginTop: 14 }}>
              The lock is enforced by the state machine inside the transfer path. The holder of
              this account cannot spend or stake a locked unit even with full control of their
              private key, and no governance proposal can shorten the schedule.
            </p>
          </div>
        </>
      ) : null}

      {stakes.length > 0 ? (
        <>
          <h2>Staking positions</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Validator</th>
                  <th className="num">Staked</th>
                  <th className="num">Pending rewards</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stakes.map((d, i) => {
                  const row = d as Record<string, string | number | boolean>;
                  return (
                    <tr key={i}>
                      <td>
                        <a href={`/validator/${row.validator}`}>
                          {String(row.moniker || row.validator)}
                        </a>
                      </td>
                      <td className="num mono">{String(row.staked_yzxa)}</td>
                      <td className="num mono">
                        {formatYZXA(BigInt(String(row.pending_rewards || "0")))}
                      </td>
                      <td>
                        {row.tombstoned ? (
                          <span className="pill danger">Tombstoned</span>
                        ) : row.jailed ? (
                          <span className="pill warn">Jailed</span>
                        ) : (
                          <span className="pill ok">Active</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {permissions.length > 0 ? (
        <>
          <h2>Spending permissions issued</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Grantee</th>
                  <th className="num">Total limit</th>
                  <th className="num">Spent</th>
                  <th className="num">Per period</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map((g, i) => {
                  const row = g as Record<string, string | number>;
                  return (
                    <tr key={i}>
                      <td>
                        <a href={`/account/${row.grantee}`} className="mono trunc" style={{ maxWidth: 200 }}>
                          {String(row.grantee)}
                        </a>
                      </td>
                      <td className="num mono">{formatYZXA(BigInt(String(row.total)))}</td>
                      <td className="num mono">{formatYZXA(BigInt(String(row.spent_total)))}</td>
                      <td className="num mono">
                        {Number(row.period_seconds) > 0
                          ? formatYZXA(BigInt(String(row.per_period)))
                          : "—"}
                      </td>
                      <td className="dim">{formatUnix(row.expires_at_unix)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="dim" style={{ fontSize: 13, marginTop: 12 }}>
            Every permission carries a total and an expiry. An unlimited spending permission
            cannot be expressed on YOZEXA, and the account holder can revoke any of these in one
            transaction.
          </p>
        </>
      ) : null}
    </>
  );
}
