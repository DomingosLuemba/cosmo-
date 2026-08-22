import { Code } from "@/components/code";

export const metadata = { title: "API reference · YOZEXA Developer" };

export default function ApiReferencePage() {
  return (
    <>
      <h1>API reference</h1>
      <p className="subtitle">
        Two distinct APIs. The node&rsquo;s is public and unauthenticated; YOZEXA Pay&rsquo;s is a
        commercial service that needs a key.
      </p>

      <h2>Node API</h2>
      <p className="dim">
        Anyone can run a node and serve this. Monetary values are decimal strings in base units
        (ayzxa, 10<sup>-18</sup> YZXA); fields suffixed <span className="mono">_yzxa</span> or{" "}
        <span className="mono">_yoz</span> are for display only.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Returns</th>
            </tr>
          </thead>
          <tbody>
            {NODE_ENDPOINTS.map(([path, description]) => (
              <tr key={path}>
                <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{path}</td>
                <td className="dim">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Simulate before you sign</h2>
      <Code language="bash">{`POST /v1/simulate
{ "tx": { …signed transaction… } }`}</Code>
      <Code language="json">{`{
  "valid": true,
  "signer": "yzx1…",
  "gas_required": 21568,
  "estimated_fee_yzxa": "0.000054384",
  "effects": [
    { "kind": "payment",
      "description": "Send 0.00025 YZXA to yzx1kem73…",
      "amount_yoz": "25.0" }
  ],
  "warnings": []
}`}</Code>
      <p className="dim">
        A wallet&rsquo;s job is to display these, not to summarise them away. Showing a hash and a
        button is not consent.
      </p>

      <h2>Broadcast, and what the states mean</h2>
      <Code language="bash">{`POST /v1/tx
{ "tx": { … }, "mode": "sync" | "commit" }`}</Code>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Meaning</th>
              <th>Safe to release goods?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="pill warn">pending</span></td>
              <td className="dim">Accepted by a mempool. Not settled.</td>
              <td className="dim">No</td>
            </tr>
            <tr>
              <td><span className="pill ok">confirmed</span></td>
              <td className="dim">In a committed block. BFT commits are final.</td>
              <td className="dim">Yes</td>
            </tr>
            <tr>
              <td><span className="pill ok">finalized</span></td>
              <td className="dim">Confirmed with at least one block on top.</td>
              <td className="dim">Yes</td>
            </tr>
            <tr>
              <td><span className="pill danger">failed</span></td>
              <td className="dim">Executed and reverted. The fee was charged; nothing else moved.</td>
              <td className="dim">No</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>YOZEXA Pay API</h2>
      <Code language="bash">{`Authorization: Bearer yzk_live_…`}</Code>
      <p className="dim">
        A <span className="mono">yzk_test_</span> key can never act on mainnet and a{" "}
        <span className="mono">yzk_live_</span> key can never act on a test network. Only a
        SHA-256 hash of each key is stored: a lost key cannot be recovered, only rotated.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {PAY_ENDPOINTS.map(([method, path, description]) => (
              <tr key={`${method} ${path}`}>
                <td className="mono" style={{ fontSize: 12 }}>{method}</td>
                <td className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{path}</td>
                <td className="dim">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Idempotency is not optional</h2>
      <Code language="bash">{`curl -X POST https://api.yozexa.example/v1/payments \\
  -H "Authorization: Bearer yzk_test_…" \\
  -H "Idempotency-Key: order-1042" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":"25000000000000000000","reference":"ORDER-1042"}'`}</Code>
      <p className="dim">
        Replaying a key returns the original response and creates nothing new. Replaying it with a
        <em>different</em> body is refused with 409 rather than quietly returning the earlier
        answer. Without this, a network timeout charges a customer twice — and a network timeout
        is not an edge case, it is the normal behaviour of the internet.
      </p>

      <h2>Verify every webhook</h2>
      <Code language="bash">{`X-Yozexa-Signature: t=1766000000,v1=<hex HMAC_SHA256(secret, t + "." + body)>`}</Code>
      <Code language="typescript">{`import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret: string, body: string, header: string, tolerance = 300): boolean {
  const parts = new Map(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.get("t"));
  const provided = parts.get("v1");
  if (!Number.isFinite(t) || !provided) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > tolerance) return false;

  const expected = createHmac("sha256", secret).update(\`\${t}.\${body}\`, "utf8").digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}`}</Code>
      <p className="dim">
        Verify the signature and the timestamp <strong>before</strong> parsing the body. An
        unverified webhook is a message anyone on the internet can send you. Make handlers
        idempotent: a delivery that timed out after you processed it will be retried.
      </p>
    </>
  );
}

const NODE_ENDPOINTS: Array<[string, string]> = [
  ["GET /v1/status", "chain id, height, supply, and a warning on any non-mainnet chain"],
  ["GET /v1/supply", "max, minted, burned, circulating, remaining mintable"],
  ["GET /v1/supply/verify", "full audit report with a VALID or INVALID cap verdict"],
  ["GET /v1/invariants", "every protocol invariant evaluated against live state"],
  ["GET /v1/account/{address}", "balance, spendable, locked, sequence, alias, vesting"],
  ["GET /v1/account/{address}/proof", "Merkle proof of the account against the block header"],
  ["GET /v1/feemarket", "base fee and the three wallet fee tiers"],
  ["GET /v1/emission", "era, current block reward, reserve remaining"],
  ["GET /v1/validators", "the validator set with stake, commission and status"],
  ["GET /v1/delegations/{address}", "stake positions with pending rewards"],
  ["GET /v1/vesting", "every public vesting position"],
  ["GET /v1/grants/{granter}", "delegated spending permissions"],
  ["GET /v1/proposals", "governance proposals"],
  ["GET /v1/alias/{name}", "resolve a YOZEXA ID"],
  ["GET /v1/blocks, /v1/block/{height}", "blocks and their transactions"],
  ["GET /v1/tx/{hash}", "a transaction with its finality state and an explanation"],
  ["POST /v1/simulate", "what a transaction would do, in words"],
  ["POST /v1/tx", "broadcast a signed transaction"],
];

const PAY_ENDPOINTS: Array<[string, string, string]> = [
  ["POST", "/v1/payments", "create a payment intent"],
  ["GET", "/v1/payments/{id}", "payment status"],
  ["GET", "/v1/payments", "list and filter payments"],
  ["POST", "/v1/payment-links", "create a reusable payment link"],
  ["POST", "/v1/invoices", "create an invoice"],
  ["POST", "/v1/invoices/{id}/send", "send it and create its payment"],
  ["POST", "/v1/refunds", "record a refund against a settled payment"],
  ["GET", "/v1/balances", "settlement balances, plus the live on-chain balance"],
  ["GET", "/v1/transactions", "the ledger, for reconciliation"],
  ["POST", "/v1/webhooks", "register an endpoint and receive its signing secret once"],
  ["GET", "/v1/webhooks/{id}/deliveries", "delivery attempts and their responses"],
];
