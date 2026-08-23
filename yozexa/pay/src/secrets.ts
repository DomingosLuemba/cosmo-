/**
 * Secrets the service must be able to *use*, not just compare.
 *
 * An API key is only ever compared, so it is stored as a hash and a leaked
 * database yields nothing usable. A webhook signing secret is different: the
 * service has to sign every delivery with it, so a hash is useless and it must
 * be stored in a recoverable form.
 *
 * Recoverable means encrypted with a key that is NOT in the database:
 * `WEBHOOK_SIGNING_KEY`, 32 bytes of base64, held in the deployment's secret
 * manager. A database dump alone therefore still yields nothing.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

export class MissingSigningKey extends Error {
  constructor() {
    super(
      "WEBHOOK_SIGNING_KEY is not set. It must be 32 bytes of base64 and must come from a secret " +
        "manager, not from the database and not from the repository.",
    );
    this.name = "MissingSigningKey";
  }
}

function serviceKey(): Buffer {
  const raw = process.env.WEBHOOK_SIGNING_KEY;
  if (!raw) throw new MissingSigningKey();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`WEBHOOK_SIGNING_KEY must decode to 32 bytes, got ${key.length}`);
  }
  return key;
}

/** True when a signing key is configured. */
export function hasSigningKey(): boolean {
  try {
    serviceKey();
    return true;
  } catch {
    return false;
  }
}

/** Generate a fresh service key, for `openssl rand -base64 32` parity. */
export function generateServiceKey(): string {
  return randomBytes(32).toString("base64");
}

/**
 * Encrypt a secret at rest.
 *
 * `context` is bound as additional authenticated data — the endpoint id — so a
 * ciphertext cannot be moved between rows to make one endpoint sign with
 * another's secret.
 */
export function encryptSecret(plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, serviceKey(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

/** Decrypt a secret stored by encryptSecret. */
export function decryptSecret(stored: string, context: string): string {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("stored secret is not in the expected format");
  }
  const [, ivB64, tagB64, ciphertextB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, serviceKey(), Buffer.from(ivB64!, "base64"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64!, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
