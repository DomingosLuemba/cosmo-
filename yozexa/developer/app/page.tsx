import { chainStatus } from "@/lib/chain";

export const dynamic = "force-dynamic";

export default async function DeveloperHome() {
  const status = await chainStatus();

  return (
    <>
      <h1>Build on YOZEXA</h1>
      <p className="subtitle">
        A proof-of-stake Layer 1 for payments, with a fixed supply of 10,000,000 YZXA enforced by
        the protocol.
      </p>

      <div className="grid cols-3">
        <a className="card" href="/quickstart" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="label">Start here</div>
          <div className="value" style={{ fontSize: 17 }}>Quickstart</div>
          <div className="hint">Run a node, create a key, send your first payment.</div>
        </a>
        <a className="card" href="/sdk" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="label">TypeScript</div>
          <div className="value" style={{ fontSize: 17 }}>@yozexa/sdk</div>
          <div className="hint">Client, transaction builder and signer.</div>
        </a>
        <a className="card" href="/faucet" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="label">Testnet</div>
          <div className="value" style={{ fontSize: 17 }}>Faucet</div>
          <div className="hint">Free testnet YZXA. No real value.</div>
        </a>
      </div>

      <h2>What you can build today</h2>
      <div className="grid cols-2">
        <div className="card">
          <div className="label">Implemented</div>
          <ul className="dim" style={{ marginBottom: 0, lineHeight: 1.9, fontSize: 14 }}>
            <li>Payments, with pending/confirmed/finalized reported distinctly</li>
            <li>Atomic bulk payments up to 1,000 recipients</li>
            <li>Staking, delegation, rewards and governance</li>
            <li>Spending grants — subscriptions, session keys, agent wallets</li>
            <li>YOZEXA IDs (<span className="mono">maria.yzx</span>)</li>
            <li>Merchant API: links, invoices, refunds, signed webhooks</li>
            <li>Merkle proofs of account state against the block header</li>
          </ul>
        </div>
        <div className="card">
          <div className="label">Not built yet</div>
          <ul className="dim" style={{ marginBottom: 0, lineHeight: 1.9, fontSize: 14 }}>
            <li>Smart contracts (EVM) — planned, no code</li>
            <li>Bridges and IBC — gated behind a security policy</li>
            <li>YOZEXA Flow, the Layer 2 for micropayments — design only</li>
            <li>A DEX — planned</li>
            <li>Fiat on and off ramps — need licensed partners</li>
          </ul>
        </div>
      </div>

      <h2>Network</h2>
      {status ? (
        <div className="card">
          <dl className="kv">
            <dt>Chain id</dt>
            <dd className="mono">{status.chain_id}</dd>
            <dt>Height</dt>
            <dd>{status.height.toLocaleString()}</dd>
            <dt>Node API</dt>
            <dd className="mono">{process.env.YOZEXA_NODE ?? "http://127.0.0.1:1717"}</dd>
          </dl>
        </div>
      ) : (
        <div className="notice">
          No node is reachable from this portal right now. Set{" "}
          <code className="mono">YOZEXA_NODE</code> and reload.
        </div>
      )}
    </>
  );
}
