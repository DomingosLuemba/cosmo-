/**
 * Cross-implementation tests against a live YOZEXA node.
 *
 * These are the tests that matter most for this SDK. A signature is only useful
 * if the chain agrees, byte for byte, on what was signed — so rather than
 * assert against a fixture, these sign real transactions and make a real node
 * accept them.
 *
 * They are skipped when no node is reachable, so the suite still runs offline.
 * Point YOZEXA_NODE at a localnet to run them:
 *
 *     YOZEXA_NODE=127.0.0.1:1717 node --test test/interop.test.ts
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";

import { YozexaClient, PrivateKey, messages as msgs, ONE_YOZ, parseAmount } from "../dist/index.js";

const NODE = process.env.YOZEXA_NODE ?? "127.0.0.1:1717";
const client = new YozexaClient({ url: NODE, timeoutMs: 15_000 });

let reachable = false;
let chainId = "";

before(async () => {
  try {
    const status = await client.status();
    chainId = status.chain_id;
    reachable = true;
  } catch {
    reachable = false;
  }
});

test("the node reports its chain and warns that it is not mainnet", { skip: !process.env.YOZEXA_NODE }, async (t) => {
  if (!reachable) return t.skip(`no node at ${NODE}`);
  const status = await client.status();
  assert.ok(status.chain_id.length > 0);
  assert.ok(status.height >= 0);
  if (status.chain_id !== "yozexa-1") {
    assert.ok(
      status.network_warning?.includes("NO REAL VALUE"),
      "a non-mainnet node must warn that its tokens have no real value",
    );
  }
});

test("the SDK's sign bytes are accepted by the chain", { skip: !process.env.YOZEXA_NODE }, async (t) => {
  if (!reachable) return t.skip(`no node at ${NODE}`);

  // An unfunded account: the transaction is well-formed and correctly signed,
  // so the node must reject it for lack of funds — NOT for a bad signature.
  // That distinction is exactly what this test is checking.
  const key = PrivateKey.generate();
  const to = PrivateKey.generate().address();
  const { tiers } = await client.feeMarket();
  const normal = tiers.find((tier) => tier.name === "normal");
  assert.ok(normal);

  const { signTransaction } = await import("../dist/index.js");
  const tx = signTransaction(
    {
      chainId,
      msgs: [msgs.send(key.address(), to, 25n * ONE_YOZ)],
      sequence: 0,
      fee: { gasLimit: 200_000, gasPrice: BigInt(normal.gas_price) },
    },
    key,
  );

  const simulation = await client.simulate(tx);
  assert.equal(simulation.valid, true, `the chain rejected the SDK's signature: ${simulation.error}`);
  assert.equal(simulation.signer, key.address());
  assert.ok(simulation.effects.length >= 1);
  assert.match(simulation.effects[0]!.description, /Send/);
  assert.ok(BigInt(simulation.estimated_fee) > 0n);
});

test("a transaction signed for another chain is refused", { skip: !process.env.YOZEXA_NODE }, async (t) => {
  if (!reachable) return t.skip(`no node at ${NODE}`);

  const key = PrivateKey.generate();
  const { signTransaction } = await import("../dist/index.js");
  const tx = signTransaction(
    {
      chainId: chainId === "yozexa-1" ? "yozexa-testnet-1" : "yozexa-1",
      msgs: [msgs.send(key.address(), PrivateKey.generate().address(), 1n)],
      sequence: 0,
      fee: { gasLimit: 200_000, gasPrice: 1_000_000_000n },
    },
    key,
  );
  await assert.rejects(() => client.simulate(tx), /chain id/i);
});

test("a tampered amount invalidates the signature at the node", { skip: !process.env.YOZEXA_NODE }, async (t) => {
  if (!reachable) return t.skip(`no node at ${NODE}`);

  const key = PrivateKey.generate();
  const to = PrivateKey.generate().address();
  const { signTransaction } = await import("../dist/index.js");
  const tx = signTransaction(
    {
      chainId,
      msgs: [msgs.send(key.address(), to, ONE_YOZ)],
      sequence: 0,
      fee: { gasLimit: 200_000, gasPrice: 1_000_000_000n },
    },
    key,
  );
  // Rewrite the amount after signing.
  (tx.body.msgs[0]!.value as Record<string, unknown>).amount = parseAmount("1000", "YZXA").toString();
  await assert.rejects(() => client.simulate(tx), /signature/i);
});

test("the node's own supply audit reports a valid cap", { skip: !process.env.YOZEXA_NODE }, async (t) => {
  if (!reachable) return t.skip(`no node at ${NODE}`);
  const report = await client.verifySupply();
  assert.equal(report.supply_cap, "VALID");

  const invariants = await client.invariants();
  assert.equal(invariants.ok, true, JSON.stringify(invariants.results.filter((r) => !r.ok)));
});
