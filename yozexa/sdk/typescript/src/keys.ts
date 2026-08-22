import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

import { addressFromPubKey } from "./address.js";

/**
 * A YOZEXA account key.
 *
 * The private scalar never leaves this object except through `toBytes`, which
 * callers must treat as secret material. Nothing in this SDK logs, serialises
 * or transmits it.
 */
export class PrivateKey {
  readonly #scalar: Uint8Array;

  private constructor(scalar: Uint8Array) {
    this.#scalar = scalar;
  }

  /** Generate a key from the platform CSPRNG. */
  static generate(): PrivateKey {
    return PrivateKey.fromBytes(secp256k1.utils.randomPrivateKey());
  }

  /** Load a 32-byte scalar, rejecting values outside the curve order. */
  static fromBytes(scalar: Uint8Array): PrivateKey {
    if (scalar.length !== 32) {
      throw new Error(`private key must be 32 bytes, got ${scalar.length}`);
    }
    if (!secp256k1.utils.isValidPrivateKey(scalar)) {
      throw new Error("private key is not a valid secp256k1 scalar");
    }
    return new PrivateKey(Uint8Array.from(scalar));
  }

  /** Load a hex-encoded scalar. */
  static fromHex(hex: string): PrivateKey {
    return PrivateKey.fromBytes(hexToBytes(hex.replace(/^0x/, "")));
  }

  /**
   * Derive a key from a BIP-39 mnemonic.
   *
   * Derivation: seed = BIP-39(mnemonic, passphrase); private key = seed[0:32].
   * This matches `chain/keyring` exactly and is documented in
   * docs/WALLET_SECURITY.md so any wallet can reproduce it.
   */
  static fromMnemonic(mnemonic: string, passphrase = ""): PrivateKey {
    const normalised = mnemonic.trim().replace(/\s+/g, " ");
    if (!validateMnemonic(normalised, wordlist)) {
      throw new Error("the recovery phrase is not a valid BIP-39 mnemonic");
    }
    const seed = mnemonicToSeedSync(normalised, passphrase);
    return PrivateKey.fromBytes(seed.slice(0, 32));
  }

  /** Generate a fresh 24-word recovery phrase (256 bits of entropy). */
  static generateMnemonic(): string {
    return generateMnemonic(wordlist, 256);
  }

  /** The compressed public key. */
  publicKey(): Uint8Array {
    return secp256k1.getPublicKey(this.#scalar, true);
  }

  /** The compressed public key as hex, the form the wire format uses. */
  publicKeyHex(): string {
    return bytesToHex(this.publicKey());
  }

  /** The bech32 account address this key controls. */
  address(): string {
    return addressFromPubKey(this.publicKey());
  }

  /**
   * Sign a message: deterministic ECDSA over SHA-256(message), returned as
   * fixed-width r‖s.
   *
   * `@noble/curves` produces low-S signatures by default, which the chain
   * requires: a high-S twin of a valid signature would be a second set of bytes
   * for the same intent, and therefore a different transaction hash.
   */
  sign(message: Uint8Array): Uint8Array {
    const digest = sha256(message);
    const signature = secp256k1.sign(digest, this.#scalar, { lowS: true });
    return signature.toCompactRawBytes();
  }

  /** The raw scalar. Secret material — do not log, store or transmit it. */
  toBytes(): Uint8Array {
    return Uint8Array.from(this.#scalar);
  }
}

/** Verify a fixed-width r‖s signature against SHA-256(message). */
export function verify(
  publicKey: Uint8Array | string,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  if (signature.length !== 64) return false;
  const pub = typeof publicKey === "string" ? hexToBytes(publicKey) : publicKey;
  try {
    // lowS: reject a malleable high-S signature rather than accepting both
    // encodings of the same intent.
    return secp256k1.verify(signature, sha256(message), pub, { lowS: true });
  } catch {
    return false;
  }
}

export { bytesToHex, hexToBytes, randomBytes };
