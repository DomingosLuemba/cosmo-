import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

import { canonicalize, pruneUndefined, type CanonicalValue } from "./canonical.js";
import type { PrivateKey } from "./keys.js";
import type { Msg } from "./messages.js";

/** What the sender pays for execution. */
export interface Fee {
  /** Maximum gas the transaction may consume. */
  gasLimit: number;
  /** Price per unit of gas, in base units. */
  gasPrice: bigint;
}

/** A signed YOZEXA transaction, in wire form. */
export interface SignedTx {
  body: {
    chain_id: string;
    msgs: Msg[];
    memo?: string;
    timeout_height?: number;
  };
  auth: {
    pubkey: string;
    sequence: number;
    fee: { gas_limit: number; gas_price: string };
  };
  signature: string;
}

export interface BuildOptions {
  chainId: string;
  msgs: Msg[];
  sequence: number;
  fee: Fee;
  memo?: string;
  /** Height at and above which the transaction becomes invalid. */
  timeoutHeight?: number;
}

/**
 * Build the exact bytes the signer commits to.
 *
 * The chain id is inside the signed payload: a transaction signed for a test
 * network can never be valid on mainnet, and the reverse.
 */
export function signBytes(opts: BuildOptions, pubkeyHex: string): Uint8Array {
  const doc: CanonicalValue = {
    chain_id: opts.chainId,
    msgs: opts.msgs as unknown as CanonicalValue,
    memo: opts.memo ?? "",
    timeout_height: opts.timeoutHeight ?? 0,
    pubkey: pubkeyHex,
    sequence: opts.sequence,
    gas_limit: opts.fee.gasLimit,
    gas_price: opts.fee.gasPrice.toString(),
  };
  return new TextEncoder().encode(canonicalize(doc));
}

/** Build and sign a transaction. */
export function signTransaction(opts: BuildOptions, key: PrivateKey): SignedTx {
  if (opts.msgs.length === 0) throw new Error("a transaction must carry at least one message");
  if (opts.msgs.length > 64) throw new Error("a transaction may carry at most 64 messages");
  if (!Number.isSafeInteger(opts.sequence) || opts.sequence < 0) {
    throw new Error("sequence must be a non-negative integer");
  }
  if (!Number.isSafeInteger(opts.fee.gasLimit) || opts.fee.gasLimit <= 0) {
    throw new Error("gas limit must be a positive integer");
  }
  if (opts.fee.gasPrice < 0n) throw new Error("gas price must not be negative");

  const pubkeyHex = key.publicKeyHex();
  const signature = key.sign(signBytes(opts, pubkeyHex));

  const tx: SignedTx = {
    body: {
      chain_id: opts.chainId,
      msgs: opts.msgs,
      ...(opts.memo ? { memo: opts.memo } : {}),
      ...(opts.timeoutHeight ? { timeout_height: opts.timeoutHeight } : {}),
    },
    auth: {
      pubkey: pubkeyHex,
      sequence: opts.sequence,
      fee: { gas_limit: opts.fee.gasLimit, gas_price: opts.fee.gasPrice.toString() },
    },
    signature: base64Encode(signature),
  };
  return pruneUndefined(tx);
}

/** Canonical wire bytes of a signed transaction. */
export function encodeTransaction(tx: SignedTx): string {
  return canonicalize(tx as unknown as CanonicalValue);
}

/** The transaction hash: SHA-256 over the canonical wire bytes, uppercase hex. */
export function transactionHash(tx: SignedTx): string {
  const bytes = new TextEncoder().encode(encodeTransaction(tx));
  return bytesToHex(sha256(bytes)).toUpperCase();
}

function base64Encode(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
