import { sha256 } from "@noble/hashes/sha256";
import { bech32 } from "@scure/base";

/** Human-readable prefixes. Distinct so the three kinds cannot be confused. */
export const PREFIX_ACCOUNT = "yzx";
export const PREFIX_VALIDATOR = "yzxvaloper";
export const PREFIX_CONSENSUS = "yzxvalcons";

export const ADDRESS_LENGTH = 20;

/**
 * Derive an account address from a compressed secp256k1 public key.
 *
 * Address = SHA-256(compressed public key)[0:20], bech32-encoded with the
 * "yzx" prefix. This is the standard Tendermint/Cosmos derivation; YOZEXA does
 * not invent an address scheme.
 */
export function addressFromPubKey(compressedPubKey: Uint8Array): string {
  if (compressedPubKey.length !== 33) {
    throw new Error(`compressed public key must be 33 bytes, got ${compressedPubKey.length}`);
  }
  const digest = sha256(compressedPubKey).slice(0, ADDRESS_LENGTH);
  return encodeAddress(digest, PREFIX_ACCOUNT);
}

/** Encode 20 raw bytes as a bech32 address. */
export function encodeAddress(raw: Uint8Array, prefix: string = PREFIX_ACCOUNT): string {
  if (raw.length !== ADDRESS_LENGTH) {
    throw new Error(`address must be ${ADDRESS_LENGTH} bytes, got ${raw.length}`);
  }
  return bech32.encode(prefix, bech32.toWords(raw), 120);
}

/** Decode a bech32 address, checking the prefix. */
export function decodeAddress(address: string, prefix: string = PREFIX_ACCOUNT): Uint8Array {
  const trimmed = address.trim();
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) {
    throw new Error(`mixed-case address ${JSON.stringify(address)} is not valid bech32`);
  }
  const decoded = bech32.decode(trimmed.toLowerCase() as `${string}1${string}`, 120);
  if (decoded.prefix !== prefix) {
    throw new Error(`wrong address prefix ${JSON.stringify(decoded.prefix)}, expected ${prefix}`);
  }
  const raw = bech32.fromWords(decoded.words);
  if (raw.length !== ADDRESS_LENGTH) {
    throw new Error(`address payload must be ${ADDRESS_LENGTH} bytes, got ${raw.length}`);
  }
  return Uint8Array.from(raw);
}

/** True when the string is a syntactically valid YOZEXA account address. */
export function isValidAddress(address: string, prefix: string = PREFIX_ACCOUNT): boolean {
  try {
    decodeAddress(address, prefix);
    return true;
  } catch {
    return false;
  }
}

/** True when the string looks like a YOZEXA ID, e.g. "maria.yzx". */
export function isAliasSyntax(input: string): boolean {
  return /^[a-z0-9-]{3,32}\.yzx$/.test(input) && !/^[0-9]+\.yzx$/.test(input);
}

/**
 * Shorten an address for display, keeping enough of both ends that a
 * substitution is visible.
 *
 * Truncating to too few characters is how address-poisoning attacks succeed:
 * an attacker generates an address matching the first and last few characters
 * of one you use, and a UI that shows only those makes them look identical.
 */
export function shortenAddress(address: string, lead = 10, tail = 8): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/**
 * Report whether two addresses are visually confusable when shortened, which
 * is the signal a wallet should warn on.
 */
export function looksConfusable(a: string, b: string, lead = 10, tail = 8): boolean {
  if (a === b) return false;
  return a.slice(0, lead) === b.slice(0, lead) && a.slice(-tail) === b.slice(-tail);
}
