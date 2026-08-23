/**
 * The testnet faucet.
 *
 * A faucet is a service that gives money away, so the only interesting part is
 * the abuse control. This one refuses to run on anything that is not a test
 * network, rate-limits per address and per client, and requires a proof of
 * work before it will pay.
 *
 * Proof of work rather than a third-party CAPTCHA: it costs the requester real
 * compute, works offline, needs no external service, and does not send a
 * developer's IP address to an advertising company in exchange for a
 * checkbox.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Leading zero bits a solution must have. ~1 second on a laptop at 20. */
export const DIFFICULTY_BITS = 20;

/** How long a challenge stays valid. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** How long an address must wait between claims. */
export const ADDRESS_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/** How long a client must wait between claims. */
export const CLIENT_COOLDOWN_MS = 60 * 60 * 1000;

/** Chain ids the faucet will serve. Mainnet is deliberately absent. */
export const TESTNET_CHAIN_IDS = new Set([
  "yozexa-localnet-1",
  "yozexa-devnet-1",
  "yozexa-testnet-1",
  "yozexa-adversarial-1",
]);

interface Challenge {
  nonce: string;
  issuedAt: number;
  address: string;
}

// In-memory state. Honest about its scope: this limits one process. A
// multi-instance faucet needs shared state (Redis or the database), and the
// deployment notes say so rather than this pretending to be global.
const challenges = new Map<string, Challenge>();
const addressLastClaim = new Map<string, number>();
const clientLastClaim = new Map<string, number>();

export class FaucetError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "FaucetError";
  }
}

/** Issue a challenge the requester must solve before claiming. */
export function issueChallenge(address: string): { nonce: string; difficulty: number; expiresIn: number } {
  sweep();
  const nonce = randomBytes(16).toString("hex");
  challenges.set(nonce, { nonce, issuedAt: Date.now(), address });
  return { nonce, difficulty: DIFFICULTY_BITS, expiresIn: CHALLENGE_TTL_MS / 1000 };
}

/** Count the leading zero bits of a digest. */
export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    for (let mask = 0x80; mask > 0; mask >>= 1) {
      if (byte & mask) return bits;
      bits++;
    }
    return bits;
  }
  return bits;
}

/** True when `solution` solves `nonce` at the required difficulty. */
export function isValidSolution(nonce: string, solution: string, difficulty = DIFFICULTY_BITS): boolean {
  const digest = createHash("sha256").update(`${nonce}:${solution}`, "utf8").digest();
  return leadingZeroBits(digest) >= difficulty;
}

/**
 * Check every gate before a claim is paid.
 *
 * Throws with a specific reason rather than a generic refusal, because a
 * developer who cannot tell why a faucet said no will assume it is broken.
 */
export function authorizeClaim(input: {
  chainId: string;
  address: string;
  nonce: string;
  solution: string;
  clientKey: string;
}): void {
  if (!TESTNET_CHAIN_IDS.has(input.chainId)) {
    throw new FaucetError(
      `this faucet serves test networks only, and the node reports ${input.chainId}`,
      403,
    );
  }

  const challenge = challenges.get(input.nonce);
  if (!challenge) {
    throw new FaucetError("that challenge is unknown or has already been used; request a new one");
  }
  if (Date.now() - challenge.issuedAt > CHALLENGE_TTL_MS) {
    challenges.delete(input.nonce);
    throw new FaucetError("that challenge has expired; request a new one");
  }
  // The challenge is bound to the address it was issued for, so a solution
  // cannot be computed once and reused for a different account.
  const a = Buffer.from(challenge.address, "utf8");
  const b = Buffer.from(input.address, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new FaucetError("that challenge was issued for a different address");
  }
  if (!isValidSolution(input.nonce, input.solution)) {
    throw new FaucetError("that solution does not meet the required difficulty");
  }

  const now = Date.now();
  const lastForAddress = addressLastClaim.get(input.address);
  if (lastForAddress && now - lastForAddress < ADDRESS_COOLDOWN_MS) {
    const hours = Math.ceil((ADDRESS_COOLDOWN_MS - (now - lastForAddress)) / 3_600_000);
    throw new FaucetError(`this address already claimed recently; try again in about ${hours}h`, 429);
  }
  const lastForClient = clientLastClaim.get(input.clientKey);
  if (lastForClient && now - lastForClient < CLIENT_COOLDOWN_MS) {
    const minutes = Math.ceil((CLIENT_COOLDOWN_MS - (now - lastForClient)) / 60_000);
    throw new FaucetError(`you claimed recently; try again in about ${minutes} minutes`, 429);
  }

  // Burn the challenge so one solution pays exactly once.
  challenges.delete(input.nonce);
}

/** Record a successful claim, starting both cooldowns. */
export function recordClaim(address: string, clientKey: string): void {
  const now = Date.now();
  addressLastClaim.set(address, now);
  clientLastClaim.set(clientKey, now);
}

function sweep(): void {
  const now = Date.now();
  for (const [nonce, challenge] of challenges) {
    if (now - challenge.issuedAt > CHALLENGE_TTL_MS) challenges.delete(nonce);
  }
  for (const [key, at] of addressLastClaim) {
    if (now - at > ADDRESS_COOLDOWN_MS) addressLastClaim.delete(key);
  }
  for (const [key, at] of clientLastClaim) {
    if (now - at > CLIENT_COOLDOWN_MS) clientLastClaim.delete(key);
  }
}

/** For tests and diagnostics. */
export function resetFaucetState(): void {
  challenges.clear();
  addressLastClaim.clear();
  clientLastClaim.clear();
}
