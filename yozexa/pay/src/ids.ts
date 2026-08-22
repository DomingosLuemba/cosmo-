import { randomBytes } from "node:crypto";

/**
 * Identifiers.
 *
 * Prefixed so that an id is self-describing in a log, a support ticket or a
 * database dump, and 128 bits of entropy so they are unguessable — a payment id
 * appears in URLs, and a guessable one leaks a merchant's order volume.
 */
const ALPHABET = "0123456789abcdefghijkmnopqrstuvwxyz"; // no "l", to avoid 1/l confusion

export function newId(prefix: string, bytes = 16): string {
  const raw = randomBytes(bytes);
  let out = "";
  for (const byte of raw) out += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${out}`;
}

export const newMerchantId = (): string => newId("mch");
export const newPaymentId = (): string => newId("pay");
export const newLinkId = (): string => newId("lnk");
export const newInvoiceId = (): string => newId("inv");
export const newRefundId = (): string => newId("ref");
export const newWebhookId = (): string => newId("whe");
export const newDeliveryId = (): string => newId("whd");
export const newApiKeyId = (): string => newId("akey");

/** A short, URL-safe slug for a payment link. */
export function newSlug(): string {
  const raw = randomBytes(8);
  let out = "";
  for (const byte of raw) out += ALPHABET[byte % ALPHABET.length];
  return out;
}
