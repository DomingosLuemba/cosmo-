/**
 * Faucet abuse-control tests.
 *
 * A faucet gives money away, so the abuse control is the whole product. These
 * test the gates, not the payout.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const {
  DIFFICULTY_BITS,
  FaucetError,
  authorizeClaim,
  isValidSolution,
  issueChallenge,
  leadingZeroBits,
  recordClaim,
  resetFaucetState,
} = await import("../.faucet-test/lib/faucet.js");

function solve(nonce, difficulty = DIFFICULTY_BITS) {
  for (let i = 0; ; i++) {
    const digest = createHash("sha256").update(`${nonce}:${i}`, "utf8").digest();
    if (leadingZeroBits(digest) >= difficulty) return String(i);
  }
}

test("leading zero bits are counted correctly", () => {
  assert.equal(leadingZeroBits(Uint8Array.from([0xff])), 0);
  assert.equal(leadingZeroBits(Uint8Array.from([0x80])), 0);
  assert.equal(leadingZeroBits(Uint8Array.from([0x40])), 1);
  assert.equal(leadingZeroBits(Uint8Array.from([0x01])), 7);
  assert.equal(leadingZeroBits(Uint8Array.from([0x00, 0x40])), 9);
});

test("a claim needs a real proof of work", () => {
  resetFaucetState();
  const address = "yzx1test0000000000000000000000000000000000";
  const { nonce } = issueChallenge(address);

  assert.throws(
    () =>
      authorizeClaim({
        chainId: "yozexa-testnet-1",
        address,
        nonce,
        solution: "0",
        clientKey: "1.2.3.4",
      }),
    /difficulty/,
  );

  const solution = solve(nonce);
  assert.equal(isValidSolution(nonce, solution), true);
  authorizeClaim({ chainId: "yozexa-testnet-1", address, nonce, solution, clientKey: "1.2.3.4" });
});

test("a challenge is bound to its address and burned after one use", () => {
  resetFaucetState();
  const address = "yzx1alice000000000000000000000000000000000";
  const attacker = "yzx1eve00000000000000000000000000000000000";
  const { nonce } = issueChallenge(address);
  const solution = solve(nonce);

  // The same solved challenge cannot be redirected to another address.
  assert.throws(
    () =>
      authorizeClaim({
        chainId: "yozexa-testnet-1",
        address: attacker,
        nonce,
        solution,
        clientKey: "1.2.3.4",
      }),
    /different address/,
  );

  authorizeClaim({ chainId: "yozexa-testnet-1", address, nonce, solution, clientKey: "1.2.3.4" });
  // And it cannot be replayed.
  assert.throws(
    () =>
      authorizeClaim({ chainId: "yozexa-testnet-1", address, nonce, solution, clientKey: "1.2.3.4" }),
    /unknown or has already been used/,
  );
});

test("the faucet refuses to run on mainnet", () => {
  resetFaucetState();
  const address = "yzx1test0000000000000000000000000000000000";
  const { nonce } = issueChallenge(address);
  assert.throws(
    () =>
      authorizeClaim({
        chainId: "yozexa-1",
        address,
        nonce,
        solution: solve(nonce),
        clientKey: "1.2.3.4",
      }),
    /test networks only/,
  );
});

test("cooldowns hold per address and per client", () => {
  resetFaucetState();
  const address = "yzx1repeat00000000000000000000000000000000";
  recordClaim(address, "9.9.9.9");

  const { nonce } = issueChallenge(address);
  const err = (() => {
    try {
      authorizeClaim({
        chainId: "yozexa-testnet-1",
        address,
        nonce,
        solution: solve(nonce),
        clientKey: "9.9.9.9",
      });
      return null;
    } catch (e) {
      return e;
    }
  })();
  assert.ok(err instanceof FaucetError);
  assert.equal(err.status, 429);
  assert.match(err.message, /already claimed recently/);
});
