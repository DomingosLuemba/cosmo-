# `@yozexa/sdk`

TypeScript client, transaction builder and signer for the YOZEXA Network.

```bash
npm install @yozexa/sdk
```

## Send a payment

```ts
import { YozexaClient, PrivateKey, messages, parseAmount } from "@yozexa/sdk";

const client = new YozexaClient("https://rpc.yozexa.example");
const key = PrivateKey.fromMnemonic(process.env.MNEMONIC!);

// Resolve a YOZEXA ID to the address the chain will actually credit.
const to = await client.resolveRecipient("maria.yzx");

const result = await client.signAndBroadcast(
  key,
  [messages.send(key.address(), to, parseAmount("25", "YOZ"))],
  { feeTier: "normal", mode: "commit" },
);

console.log(result.status); // "confirmed"
```

## Three things this SDK will not do

**It will not use `number` for money.** Every amount is a `bigint` in base units
(`ayzxa`, 10^-18 YZXA). A JavaScript number cannot represent 10^18 exactly, so
using one for a balance is a way to lose or invent money. Amounts cross the wire
as decimal strings for the same reason.

**It will not call a pending transaction settled.** `pending`, `confirmed` and
`finalized` are distinct states. `waitForSettlement()` resolves on `confirmed`,
`finalized` or `failed` — never on `pending`.

**It will not build an unlimited spending permission.** `messages.grant()`
requires a positive total and an expiry no more than a year out, because the
chain refuses anything else.

## Show the user what they are signing

```ts
const simulation = await client.simulate(tx);

for (const effect of simulation.effects) console.log(effect.description);
// "Send 0.00025 YZXA to yzx1kem73az3whhur34jcslt3rc226rrtvsgxjs3wx"

console.log(`Network fee: ${simulation.estimated_fee_yzxa} YZXA`);
for (const warning of simulation.warnings ?? []) console.warn(warning);
```

Never ask someone to approve a hash. `simulate()` returns the plain-language
effects, the exact fee and any warnings; displaying them is the wallet's job.

## Spending permissions for agents and subscriptions

```ts
import { messages, parseAmount } from "@yozexa/sdk";

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
);
```

The agent holds a key that is *structurally incapable* of draining the account:
the chain enforces the total, the daily rate, the recipient list, the
per-transaction ceiling and the expiry, whatever software the agent runs. The
owner can revoke it in one transaction with `messages.revoke()`.

The main private key is never given to an agent.

## Testing

```bash
npm test                                  # unit tests
YOZEXA_NODE=127.0.0.1:1717 npm run test:interop
```

The interop suite signs real transactions and makes a real node accept them,
which is what proves this SDK's canonical encoding matches the chain's byte for
byte. It skips itself when `YOZEXA_NODE` is unset.

## API

| | |
|---|---|
| `YozexaClient` | `status`, `account`, `supply`, `verifySupply`, `feeMarket`, `validators`, `delegations`, `grants`, `vesting`, `blocks`, `block`, `invariants`, `simulate`, `broadcast`, `txStatus`, `resolveRecipient`, `signAndBroadcast`, `waitForSettlement` |
| `PrivateKey` | `generate`, `fromBytes`, `fromHex`, `fromMnemonic`, `generateMnemonic`, `publicKey`, `address`, `sign` |
| `messages` | `send`, `multiSend`, `burn`, `delegate`, `undelegate`, `withdrawRewards`, `vote`, `registerAlias`, `grant`, `revoke`, `exec` |
| units | `parseAmount`, `formatAmount`, `formatYZXA`, `formatYOZ`, `formatForDisplay`, `fiatReference` |
| addresses | `addressFromPubKey`, `decodeAddress`, `isValidAddress`, `isAliasSyntax`, `shortenAddress`, `looksConfusable` |

Licence: Apache-2.0.
