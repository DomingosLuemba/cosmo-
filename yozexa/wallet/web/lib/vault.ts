/**
 * The wallet vault: encrypted key storage in the browser.
 *
 * Rules this file exists to enforce:
 *
 *   - A private key is never stored in the clear, never logged, and never sent
 *     anywhere. The wallet server sees nothing; it serves static pages.
 *   - The decrypted key lives in memory only while the wallet is unlocked, and
 *     is zeroed on lock.
 *   - The recovery phrase is shown exactly once, at creation, and is never
 *     persisted in a form the user can recover without their passphrase.
 *
 * Encryption: scrypt (N=2^17, r=8, p=1) stretches the passphrase into a 32-byte
 * key, which encrypts the private key with AES-256-GCM through WebCrypto. The
 * account address is authenticated as additional data, so a ciphertext cannot
 * be moved between vault entries to make a key decrypt "as" another account.
 *
 * This matches the CLI keyring's KDF; the cipher differs (AES-GCM rather than
 * XChaCha20-Poly1305) because AES-GCM is what browsers provide natively, and
 * pulling in a JavaScript stream cipher to avoid that would be worse.
 */
import { scryptAsync } from "@noble/hashes/scrypt";
import { PrivateKey } from "@yozexa/sdk";

const STORAGE_KEY = "yozexa.vault.v1";

const SCRYPT = { N: 1 << 17, r: 8, p: 1, dkLen: 32 } as const;

export interface VaultEntry {
  /** A user-chosen label. */
  name: string;
  address: string;
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  /** base64 */
  ciphertext: string;
  kdf: string;
  cipher: string;
  createdAt: string;
  /** Whether the key came from a recovery phrase the user has written down. */
  fromMnemonic: boolean;
  /** Set once the user confirms they have stored the phrase. */
  backedUp: boolean;
}

export interface Vault {
  version: 1;
  entries: VaultEntry[];
  activeAddress: string | null;
}

function emptyVault(): Vault {
  return { version: 1, entries: [], activeAddress: null };
}

export function loadVault(): Vault {
  if (typeof window === "undefined") return emptyVault();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyVault();
    const parsed = JSON.parse(raw) as Vault;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return emptyVault();
    return parsed;
  } catch {
    // A corrupt or inaccessible store must not brick the wallet, and must not
    // silently discard anything either — the user still has their phrase.
    return emptyVault();
  }
}

export function saveVault(vault: Vault): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await scryptAsync(new TextEncoder().encode(passphrase), salt, SCRYPT);
  return crypto.subtle.importKey("raw", material as unknown as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export class WrongPassphrase extends Error {
  constructor() {
    super("That passphrase does not unlock this wallet.");
    this.name = "WrongPassphrase";
  }
}

/** Encrypt a key into a vault entry. */
export async function encryptKey(
  name: string,
  key: PrivateKey,
  passphrase: string,
  fromMnemonic: boolean,
): Promise<VaultEntry> {
  if (passphrase.length < 8) {
    throw new Error("Choose a passphrase of at least 8 characters.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveKey(passphrase, salt);
  const address = key.address();

  const secret = key.toBytes();
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(address) },
      aesKey,
      secret as unknown as BufferSource,
    ),
  );
  secret.fill(0);

  return {
    name,
    address,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    kdf: `scrypt(N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p})`,
    cipher: "AES-256-GCM",
    createdAt: new Date().toISOString(),
    fromMnemonic,
    backedUp: false,
  };
}

/** Decrypt a vault entry back into a usable key. */
export async function decryptKey(entry: VaultEntry, passphrase: string): Promise<PrivateKey> {
  const aesKey = await deriveKey(passphrase, fromBase64(entry.salt));
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(entry.iv) as unknown as BufferSource,
        additionalData: new TextEncoder().encode(entry.address),
      },
      aesKey,
      fromBase64(entry.ciphertext) as unknown as BufferSource,
    );
  } catch {
    throw new WrongPassphrase();
  }
  const secret = new Uint8Array(plaintext);
  const key = PrivateKey.fromBytes(secret);
  secret.fill(0);

  // Confirm the decrypted key really controls the stored address, so a tampered
  // vault cannot make the wallet sign for an account it does not control.
  if (key.address() !== entry.address) {
    throw new Error("This vault entry is inconsistent: the key does not control the stored address.");
  }
  return key;
}

export function addEntry(vault: Vault, entry: VaultEntry): Vault {
  const entries = vault.entries.filter((e) => e.address !== entry.address);
  entries.push(entry);
  return { ...vault, entries, activeAddress: entry.address };
}

export function removeEntry(vault: Vault, address: string): Vault {
  const entries = vault.entries.filter((e) => e.address !== address);
  return {
    ...vault,
    entries,
    activeAddress: vault.activeAddress === address ? (entries[0]?.address ?? null) : vault.activeAddress,
  };
}

export function activeEntry(vault: Vault): VaultEntry | null {
  if (!vault.activeAddress) return vault.entries[0] ?? null;
  return vault.entries.find((e) => e.address === vault.activeAddress) ?? vault.entries[0] ?? null;
}

export function markBackedUp(vault: Vault, address: string): Vault {
  return {
    ...vault,
    entries: vault.entries.map((e) => (e.address === address ? { ...e, backedUp: true } : e)),
  };
}
