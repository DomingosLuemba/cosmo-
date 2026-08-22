import { chain, tryFetch, relative } from "@/lib/chain";

export const dynamic = "force-dynamic";

export default async function BlocksPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const params = await searchParams;
  const result = await tryFetch(() => chain.blocks(50));

  if ("error" in result) {
    return (
      <>
        <h1>Blocks</h1>
        <div className="notice">{result.error}</div>
      </>
    );
  }

  const blocks = (result.data.blocks ?? []) as Array<{
    height: number;
    time: string;
    transaction_count: number;
    hash: string;
    proposer: string;
    app_hash: string;
  }>;

  return (
    <>
      <h1>Blocks</h1>
      <p className="subtitle">
        Latest height {result.data.latest_height.toLocaleString()}. Every block here is committed
        and final — CometBFT commits cannot be replaced by a longer chain.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Height</th>
              <th>Time</th>
              <th className="num">Txs</th>
              <th>Proposer</th>
              <th>App hash</th>
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.height}>
                <td>
                  <a href={`/block/${b.height}`} className="mono">
                    {b.height.toLocaleString()}
                  </a>
                </td>
                <td className="dim">{relative(b.time)}</td>
                <td className="num">{b.transaction_count}</td>
                <td>
                  <span className="mono dim trunc" style={{ maxWidth: 160 }}>
                    {b.proposer}
                  </span>
                </td>
                <td>
                  <span className="mono dim trunc" style={{ maxWidth: 200 }}>
                    {b.app_hash}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dim" style={{ fontSize: 13, marginTop: 14 }}>
        The app hash is the root of the state tree after the block. Two honest nodes that
        processed the same blocks produce the same app hash; a mismatch halts consensus rather
        than silently forking balances.
      </p>
      {params.before ? null : null}
    </>
  );
}
