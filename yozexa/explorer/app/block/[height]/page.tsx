import { chain, tryFetch, formatIso } from "@/lib/chain";
import { formatYZXA } from "@yozexa/sdk";

export const dynamic = "force-dynamic";

export default async function BlockPage({ params }: { params: Promise<{ height: string }> }) {
  const { height } = await params;
  const result = await tryFetch(() => chain.block(Number(height)));

  if ("error" in result) {
    return (
      <>
        <h1>Block {height}</h1>
        <div className="notice">{result.error}</div>
      </>
    );
  }

  const block = result.data as {
    height: number;
    time: string;
    hash: string;
    proposer: string;
    app_hash: string;
    transaction_count: number;
    transactions?: Array<{
      hash: string;
      signer?: string;
      messages?: string[];
      memo?: string;
      fee_max?: string;
    }>;
  };
  const number = Number(height);

  return (
    <>
      <h1>Block {block.height.toLocaleString()}</h1>
      <p className="subtitle">{formatIso(block.time)}</p>

      <div className="card">
        <dl className="kv">
          <dt>Hash</dt>
          <dd className="mono">{block.hash}</dd>
          <dt>App hash</dt>
          <dd className="mono">{block.app_hash}</dd>
          <dt>Proposer</dt>
          <dd className="mono">{block.proposer}</dd>
          <dt>Transactions</dt>
          <dd>{block.transaction_count}</dd>
          <dt>Finality</dt>
          <dd>
            <span className="pill ok">Final</span>{" "}
            <span className="dim">committed by more than two thirds of voting power</span>
          </dd>
        </dl>
      </div>

      <h2>Transactions</h2>
      {block.transactions && block.transactions.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hash</th>
                <th>Signer</th>
                <th>Messages</th>
                <th className="num">Max fee</th>
              </tr>
            </thead>
            <tbody>
              {block.transactions.map((tx) => (
                <tr key={tx.hash}>
                  <td>
                    <a href={`/tx/${tx.hash}`} className="mono trunc" style={{ maxWidth: 220 }}>
                      {tx.hash}
                    </a>
                  </td>
                  <td>
                    {tx.signer ? (
                      <a href={`/account/${tx.signer}`} className="mono trunc" style={{ maxWidth: 180 }}>
                        {tx.signer}
                      </a>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {(tx.messages ?? []).join(", ") || "—"}
                  </td>
                  <td className="num mono">
                    {tx.fee_max ? formatYZXA(BigInt(tx.fee_max)) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="notice info">This block carried no transactions.</div>
      )}

      <p style={{ marginTop: 20 }}>
        {number > 1 ? <a href={`/block/${number - 1}`}>← Block {number - 1}</a> : null}
        {"  "}
        <a href={`/block/${number + 1}`} style={{ marginLeft: 16 }}>
          Block {number + 1} →
        </a>
      </p>
    </>
  );
}
