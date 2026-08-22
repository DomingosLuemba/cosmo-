import { chain, tryFetch } from "@/lib/chain";

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<string, string> = {
  finalized: "ok",
  confirmed: "ok",
  pending: "warn",
  failed: "danger",
  unknown: "dim",
};

export default async function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const result = await tryFetch(() => chain.txStatus(hash));

  if ("error" in result) {
    return (
      <>
        <h1>Transaction</h1>
        <p className="mono dim" style={{ wordBreak: "break-all" }}>{hash}</p>
        <div className="notice">{result.error}</div>
      </>
    );
  }

  const tx = result.data;

  return (
    <>
      <h1>Transaction</h1>
      <p className="mono subtitle" style={{ wordBreak: "break-all" }}>{tx.hash}</p>

      <div className="card">
        <dl className="kv">
          <dt>Status</dt>
          <dd>
            <span className={`pill ${STATUS_PILL[tx.status] ?? "dim"}`}>{tx.status}</span>
          </dd>
          <dt>What that means</dt>
          <dd>{tx.explanation}</dd>
          {tx.height ? (
            <>
              <dt>Block</dt>
              <dd>
                <a href={`/block/${tx.height}`} className="mono">
                  {tx.height.toLocaleString()}
                </a>{" "}
                <span className="dim">
                  · {tx.confirmations} block{tx.confirmations === 1 ? "" : "s"} on top
                </span>
              </dd>
            </>
          ) : null}
          {tx.gas_used ? (
            <>
              <dt>Gas used</dt>
              <dd className="mono">{tx.gas_used.toLocaleString()}</dd>
            </>
          ) : null}
          {tx.log ? (
            <>
              <dt>Result</dt>
              <dd className="mono" style={{ fontSize: 13 }}>{tx.log}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {tx.status === "failed" ? (
        <div className="notice info" style={{ marginTop: 18 }}>
          This transaction was included in a block but its execution failed. The fee was charged;
          nothing else changed. Charging a failed transaction is what stops spamming failures from
          being free.
        </div>
      ) : null}
    </>
  );
}
