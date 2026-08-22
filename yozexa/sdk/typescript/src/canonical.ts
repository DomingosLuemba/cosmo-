/**
 * Canonical JSON — the exact encoding the chain hashes and signs.
 *
 * This is a restricted profile of RFC 8785: object keys sorted by their UTF-16
 * code-unit sequence (which matches Go's byte-wise sort for the ASCII keys this
 * protocol uses), no insignificant whitespace, integers only, and monetary
 * values carried as strings.
 *
 * It must produce byte-identical output to `chain/codec/canonical.go`. If it
 * did not, a transaction signed here would fail to verify on the chain — or,
 * far worse, a different transaction would verify.
 */

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export function canonicalize(value: CanonicalValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`canonical JSON accepts integers only, got ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error(`integer ${value} is outside the safe range; carry it as a string`);
    }
    return value.toString();
  }
  if (typeof value === "string") return encodeString(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${encodeString(k)}:${canonicalize(value[k] as CanonicalValue)}`);
  return `{${parts.join(",")}}`;
}

function encodeString(s: string): string {
  let out = '"';
  for (const ch of s) {
    switch (ch) {
      case '"':
        out += '\\"';
        break;
      case "\\":
        out += "\\\\";
        break;
      case "\b":
        out += "\\b";
        break;
      case "\f":
        out += "\\f";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      default: {
        const code = ch.codePointAt(0) ?? 0;
        out += code < 0x20 ? `\\u${code.toString(16).padStart(4, "0")}` : ch;
      }
    }
  }
  return out + '"';
}

/** Strip properties whose value is undefined, recursively. */
export function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(pruneUndefined) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = pruneUndefined(v);
    }
    return out as T;
  }
  return value;
}
