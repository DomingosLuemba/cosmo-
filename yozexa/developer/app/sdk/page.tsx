import { Code } from "@/components/code";

export const metadata = { title: "SDK · YOZEXA Developer" };

export default function SdkPage() {
  return (
    <>
      <h1>@yozexa/sdk</h1>
      <p className="subtitle">TypeScript client, transaction builder and signer.</p>

      <Code language="bash">{`npm install @yozexa/sdk`}</Code>

      <h2>Three things it will not do</h2>
      <div className="grid cols-3">
        <div className="card">
          <div className="label">No floats for money</div>
          <div className="hint" style={{ fontSize: 13 }}>
            Every amount is a <span className="mono">bigint</span> in base units and crosses the
            wire as a decimal string. A JavaScript number cannot represent 10<sup>18</sup> exactly.
          </div>
        </div>
        <div className="card">
          <div className="label">No premature settlement</div>
          <div className="hint" style={{ fontSize: 13 }}>
            <span className="mono">pending</span>, <span className="mono">confirmed</span> and{" "}
            <span className="mono">finalized</span> are distinct.{" "}
            <span className="mono">waitForSettlement()</span> never resolves on pending.
          </div>
        </div>
        <div className="card">
          <div className="label">No unlimited approvals</div>
          <div className="hint" style={{ fontSize: 13 }}>
            <span className="mono">messages.grant()</span> requires a total and an expiry, because
            the chain refuses anything else.
          </div>
        </div>
      </div>

      <h2>Send a payment</h2>
      <Code language="typescript">{`import { YozexaClient, PrivateKey, messages, parseAmount } from "@yozexa/sdk";

const client = new YozexaClient("https://rpc.yozexa.example");
const key = PrivateKey.fromMnemonic(process.env.MNEMONIC!);

const to = await client.resolveRecipient("maria.yzx");
const result = await client.signAndBroadcast(
  key,
  [messages.send(key.address(), to, parseAmount("25", "YOZ"))],
  { feeTier: "normal", mode: "commit" },
);`}</Code>

      <h2>Wait for settlement properly</h2>
      <Code language="typescript">{`const settled = await client.waitForSettlement(result.hash, { timeoutMs: 60_000 });
// settled.status is "confirmed", "finalized" or "failed" — never "pending"
console.log(settled.explanation);`}</Code>

      <h2>Bound what an agent can spend</h2>
      <Code language="typescript">{`import { messages, parseAmount } from "@yozexa/sdk";

const grant = messages.grant(
  owner.address(),
  agentKey.address(),
  {
    total: parseAmount("20", "YZXA"),
    perPeriod: parseAmount("5", "YZXA"),
    periodSeconds: 24 * 60 * 60,
  },
  new Date(Date.now() + 24 * 60 * 60 * 1000),
  {
    allowedRecipients: [apiProviderAddress],
    requireApprovalAbove: parseAmount("2", "YZXA"),
  },
);`}</Code>
      <p className="dim">
        The chain enforces the total, the daily rate, the recipient list, the per-transaction
        ceiling and the expiry — whatever software the agent runs. It never holds the main key,
        and the owner revokes with <span className="mono">messages.revoke()</span> in one
        transaction.
      </p>

      <h2>Pay many people atomically</h2>
      <Code language="typescript">{`await client.signAndBroadcast(key, [
  messages.multiSend(key.address(), [
    { to: alice, amount: parseAmount("1200", "YZXA") },
    { to: bruno, amount: parseAmount("1450", "YZXA") },
    { to: cátia, amount: parseAmount("1300", "YZXA") },
  ]),
], { mode: "commit" });`}</Code>
      <p className="dim">
        Either every leg lands or the transaction fails and nobody is paid. That atomicity is what
        makes it safe for payroll: there is no state where half the staff were paid.
      </p>

      <h2>Verify state without trusting the node</h2>
      <Code language="bash">{`curl https://rpc.yozexa.example/v1/account/yzx1…/proof`}</Code>
      <p className="dim">
        Returns a Merkle proof of the account row against the app hash in the block header, so a
        balance can be checked without trusting whoever served it. Absence is provable too.
      </p>
    </>
  );
}
