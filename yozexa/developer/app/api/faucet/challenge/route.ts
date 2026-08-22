import { NextResponse } from "next/server";
import { isValidAddress } from "@yozexa/sdk";

import { issueChallenge, TESTNET_CHAIN_IDS } from "@/lib/faucet";
import { chainStatus } from "@/lib/chain";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let body: { address?: string };
  try {
    body = (await request.json()) as { address?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const address = (body.address ?? "").trim();
  if (!isValidAddress(address)) {
    return NextResponse.json(
      { error: "that is not a valid YOZEXA address (it should start yzx1…)" },
      { status: 400 },
    );
  }

  const status = await chainStatus();
  if (!status) {
    return NextResponse.json({ error: "the faucet cannot reach a node right now" }, { status: 503 });
  }
  if (!TESTNET_CHAIN_IDS.has(status.chain_id)) {
    return NextResponse.json(
      { error: `this faucet serves test networks only, and the node reports ${status.chain_id}` },
      { status: 403 },
    );
  }

  return NextResponse.json(issueChallenge(address));
}
