import { NextResponse } from "next/server";
import { PrivateKey, isValidAddress, messages, parseAmount, signTransaction } from "@yozexa/sdk";

import { authorizeClaim, FaucetError, recordClaim } from "@/lib/faucet";
import { chainClient, chainStatus } from "@/lib/chain";

export const dynamic = "force-dynamic";

/** How much a claim pays. Small on purpose: enough to try things, not to hoard. */
const AMOUNT_YZXA = process.env.FAUCET_AMOUNT_YZXA ?? "10";

export async function POST(request: Request): Promise<NextResponse> {
  let body: { address?: string; nonce?: string; solution?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const address = (body.address ?? "").trim();
  if (!isValidAddress(address)) {
    return NextResponse.json({ error: "that is not a valid YOZEXA address" }, { status: 400 });
  }

  const mnemonic = process.env.FAUCET_MNEMONIC;
  if (!mnemonic) {
    return NextResponse.json(
      {
        error:
          "this faucet has no funding key configured, so it cannot pay. An operator must set " +
          "FAUCET_MNEMONIC — from a secret manager, never from the repository.",
      },
      { status: 503 },
    );
  }

  const status = await chainStatus();
  if (!status) {
    return NextResponse.json({ error: "the faucet cannot reach a node right now" }, { status: 503 });
  }

  // The client key is the best identifier available behind a proxy. It is a
  // rate-limiting hint, not an authentication factor, and the proof of work is
  // what actually costs an abuser something.
  const clientKey =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  try {
    authorizeClaim({
      chainId: status.chain_id,
      address,
      nonce: body.nonce ?? "",
      solution: body.solution ?? "",
      clientKey,
    });
  } catch (err) {
    if (err instanceof FaucetError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  try {
    const client = chainClient();
    const key = PrivateKey.fromMnemonic(mnemonic);
    const [account, feeMarket] = await Promise.all([
      client.account(key.address()),
      client.feeMarket(),
    ]);
    const tier = feeMarket.tiers.find((t) => t.name === "normal");
    if (!tier) throw new Error("the node did not offer a fee tier");

    const amount = parseAmount(AMOUNT_YZXA, "YZXA");
    const tx = signTransaction(
      {
        chainId: status.chain_id,
        msgs: [messages.send(key.address(), address, amount)],
        sequence: account.sequence,
        fee: { gasLimit: 300_000, gasPrice: BigInt(tier.gas_price) },
        memo: "YOZEXA testnet faucet",
      },
      key,
    );

    const result = await client.broadcast(tx, "commit");
    if (result.status === "failed") {
      return NextResponse.json(
        { error: result.log || "the faucet transaction failed on chain" },
        { status: 502 },
      );
    }
    recordClaim(address, clientKey);

    return NextResponse.json({
      hash: result.hash,
      status: result.status,
      amount_yzxa: AMOUNT_YZXA,
      chain_id: status.chain_id,
      note: "Testnet YZXA has NO REAL VALUE. It exists so you can build and test.",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
