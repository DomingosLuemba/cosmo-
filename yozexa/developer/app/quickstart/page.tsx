import { Code } from "@/components/code";

export const metadata = { title: "Quickstart · YOZEXA Developer" };

export default function QuickstartPage() {
  return (
    <>
      <h1>Quickstart</h1>
      <p className="subtitle">
        From nothing to a settled payment, on a chain running on your own machine.
      </p>

      <h2>1. Run a network</h2>
      <p className="dim">
        A single-validator localnet is the fastest way to see everything work. It produces blocks
        immediately and its YZXA has no value, so you can be careless with it.
      </p>
      <Code language="bash">{`git clone <repo> && cd yozexa/chain
make build

export YOZEXA_PASSPHRASE='choose-something-long'
export YOZEXA_HOME=/tmp/yozexa-localnet

../build/yozexa keys create validator
../build/yozexad init my-node --network localnet --with-genesis \\
    --operator-key validator --passphrase "$YOZEXA_PASSPHRASE"
../build/yozexad start`}</Code>

      <h2>2. Create an account and send a payment</h2>
      <Code language="bash">{`../build/yozexa keys create maria
MARIA=$(../build/yozexa keys show maria | awk '/address/{print $2}')

../build/yozexa tx send "$MARIA" 25 --unit YOZ --from validator
../build/yozexa query balance "$MARIA"`}</Code>
      <p className="dim">
        The CLI simulates before it broadcasts and prints what you are signing, the exact fee, and
        any warnings. It reports <span className="mono">confirmed</span> only once the payment is
        in a committed block.
      </p>

      <h2>3. Audit the supply yourself</h2>
      <Code language="bash">{`../build/yozexa supply verify`}</Code>
      <p className="dim">
        This prints the whole monetary position and a hard <span className="mono">VALID</span> or{" "}
        <span className="mono">INVALID</span> verdict on the 10,000,000 YZXA cap, plus every
        protocol invariant. It exits non-zero on failure, so it can be wired into monitoring.
      </p>

      <h2>4. Do the same from TypeScript</h2>
      <Code language="bash">{`npm install @yozexa/sdk`}</Code>
      <Code language="typescript">{`import { YozexaClient, PrivateKey, messages, parseAmount } from "@yozexa/sdk";

const client = new YozexaClient("http://127.0.0.1:1717");
const key = PrivateKey.fromMnemonic(process.env.MNEMONIC!);

// Resolve a YOZEXA ID to the address the chain will actually credit.
const to = await client.resolveRecipient("maria.yzx");

const result = await client.signAndBroadcast(
  key,
  [messages.send(key.address(), to, parseAmount("25", "YOZ"))],
  { feeTier: "normal", mode: "commit" },
);

console.log(result.status); // "confirmed"`}</Code>

      <h2>5. Show the user what they are signing</h2>
      <p className="dim">
        Never ask someone to approve a hash. Simulate first and display what comes back.
      </p>
      <Code language="typescript">{`const simulation = await client.simulate(tx);

for (const effect of simulation.effects) console.log(effect.description);
// "Send 0.00025 YZXA to yzx1kem73az3whhur34jcslt3rc226rrtvsgxjs3wx"

console.log(\`Network fee: \${simulation.estimated_fee_yzxa} YZXA\`);
for (const warning of simulation.warnings ?? []) console.warn(warning);`}</Code>

      <h2>6. Accept payments as a business</h2>
      <Code language="bash">{`curl -X POST http://localhost:8080/v1/payments \\
  -H "Authorization: Bearer yzk_test_..." \\
  -H "Idempotency-Key: order-1042" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":"25000000000000000000","reference":"ORDER-1042"}'`}</Code>
      <p className="dim">
        Amounts are strings of digits in base units, never JSON numbers — a number cannot carry
        10<sup>18</sup> without losing precision. Always send an{" "}
        <span className="mono">Idempotency-Key</span>: a network timeout must never be able to
        charge a customer twice.
      </p>

      <div className="notice info">
        <strong>Three things to get right from the start.</strong>
        <ol style={{ marginBottom: 0, lineHeight: 1.9 }}>
          <li>
            Never use a floating-point number for a monetary value. Use{" "}
            <span className="mono">bigint</span> in base units.
          </li>
          <li>
            Never treat mempool acceptance as settlement. Wait for{" "}
            <span className="mono">confirmed</span>.
          </li>
          <li>
            Make webhook handlers idempotent. A delivery that timed out after you processed it
            will be retried.
          </li>
        </ol>
      </div>
    </>
  );
}
