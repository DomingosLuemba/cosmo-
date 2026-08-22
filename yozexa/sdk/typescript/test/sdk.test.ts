import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SUPPLY,
  ONE_YZXA,
  ONE_YOZ,
  parseAmount,
  formatAmount,
  formatYZXA,
  formatYOZ,
  formatForDisplay,
  fiatReference,
  addressFromPubKey,
  decodeAddress,
  isValidAddress,
  isAliasSyntax,
  looksConfusable,
  shortenAddress,
  canonicalize,
  PrivateKey,
  verify,
  signTransaction,
  signBytes,
  transactionHash,
  encodeTransaction,
  messages as msgs,
} from "../dist/index.js";

test("amounts parse and format without losing a single base unit", () => {
  assert.equal(parseAmount("1", "YZXA"), ONE_YZXA);
  assert.equal(parseAmount("0.000000000000000001", "YZXA"), 1n);
  assert.equal(parseAmount("25", "YOZ"), 25n * ONE_YOZ);
  assert.equal(parseAmount("10000000", "YZXA"), MAX_SUPPLY);

  assert.equal(formatYZXA(ONE_YZXA), "1.0");
  assert.equal(formatYZXA(1n), "0.000000000000000001");
  assert.equal(formatYOZ(25n * ONE_YOZ), "25.0");
  assert.equal(formatAmount(1n, "ayzxa"), "1");

  // Round trip must be exact for a spread of awkward values.
  for (const v of [0n, 1n, 999n, ONE_YOZ, ONE_YZXA - 1n, ONE_YZXA, MAX_SUPPLY]) {
    assert.equal(parseAmount(formatYZXA(v), "YZXA"), v, `round trip failed for ${v}`);
  }
});

test("ambiguous or lossy amount strings are rejected, never rounded", () => {
  for (const bad of ["", " ", "-1", "1e18", "1,5", "1.2.3", "abc", "1 000", "0x10", "+1", "Infinity", "NaN"]) {
    assert.throws(() => parseAmount(bad, "YZXA"), new RegExp("."), `accepted ${JSON.stringify(bad)}`);
  }
  // More precision than the unit can hold is an error, not a silent truncation.
  // YZXA has 18 decimal places, YOZ has 13.
  assert.throws(() => parseAmount("0.0000000000000000001", "YZXA"));
  assert.throws(() => parseAmount("0.00000000000001", "YOZ"));
  // ...and everything within the unit's precision is accepted exactly.
  assert.equal(parseAmount("0.0000000000001", "YOZ"), 1n);
});

test("display picks the unit a person can actually read", () => {
  assert.deepEqual(formatForDisplay(25n * ONE_YOZ), { amount: "25.0", unit: "YOZ" });
  assert.deepEqual(formatForDisplay(5n * ONE_YZXA), { amount: "5.0", unit: "YZXA" });
});

test("a fiat figure is never invented when no price is available", () => {
  assert.equal(fiatReference(ONE_YZXA, null, "USD"), null);
  assert.equal(fiatReference(ONE_YZXA, Number.NaN, "USD"), null);
  const ref = fiatReference(ONE_YZXA, 100_000, "USD");
  assert.ok(ref !== null && ref.includes("100,000"), `unexpected reference ${ref}`);
});

test("addresses derive, encode and validate", () => {
  const key = PrivateKey.generate();
  const address = key.address();
  assert.ok(address.startsWith("yzx1"), address);
  assert.ok(isValidAddress(address));
  assert.equal(decodeAddress(address).length, 20);
  assert.equal(addressFromPubKey(key.publicKey()), address);

  // A tampered checksum must not validate.
  const broken = address.slice(0, -1) + (address.endsWith("q") ? "p" : "q");
  assert.equal(isValidAddress(broken), false);
  // Wrong prefix must not validate as an account address.
  assert.equal(isValidAddress("cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu"), false);
});

test("YOZEXA IDs reject the forms that enable impersonation", () => {
  assert.ok(isAliasSyntax("maria.yzx"));
  assert.ok(isAliasSyntax("empresa-boa.yzx"));
  for (const bad of ["marіa.yzx", "MARIA.yzx", "12345.yzx", "ma.yzx", "maria", "maria.eth", "ma ria.yzx"]) {
    assert.equal(isAliasSyntax(bad), false, `accepted ${bad}`);
  }
});

test("address shortening keeps enough to spot a substitution", () => {
  const a = "yzx1kem73az3whhur34jcslt3rc226rrtvsgxjs3wx";
  assert.ok(shortenAddress(a).startsWith("yzx1kem73"));
  assert.ok(shortenAddress(a).endsWith("gxjs3wx"));
  assert.equal(looksConfusable(a, a), false);
  assert.equal(looksConfusable("yzx1abcdefgXXXXhijk", "yzx1abcdefgYYYYhijk", 10, 4), true);
});

test("canonical JSON sorts keys and never emits a float", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalize({ z: [1, { y: 2, x: 3 }] }), '{"z":[1,{"x":3,"y":2}]}');
  assert.equal(canonicalize("a\"b\\c\nd"), '"a\\"b\\\\c\\nd"');
  assert.throws(() => canonicalize(1.5));
});

test("signing produces a verifiable, deterministic signature", () => {
  const key = PrivateKey.generate();
  const message = new TextEncoder().encode("YOZEXA");
  const first = key.sign(message);
  const second = key.sign(message);
  assert.deepEqual(first, second, "signing is not deterministic");
  assert.equal(first.length, 64);
  assert.ok(verify(key.publicKey(), message, first));

  // Any mutation must break verification.
  const tampered = Uint8Array.from(first);
  tampered[10] ^= 0xff;
  assert.equal(verify(key.publicKey(), message, tampered), false);
  // A different key must not verify.
  assert.equal(verify(PrivateKey.generate().publicKey(), message, first), false);
});

test("a mnemonic round-trips to the same account", () => {
  const mnemonic = PrivateKey.generateMnemonic();
  assert.equal(mnemonic.split(" ").length, 24);
  const a = PrivateKey.fromMnemonic(mnemonic);
  const b = PrivateKey.fromMnemonic(mnemonic);
  assert.equal(a.address(), b.address());
  // A BIP-39 passphrase must produce a different account.
  assert.notEqual(PrivateKey.fromMnemonic(mnemonic, "extra").address(), a.address());
  assert.throws(() => PrivateKey.fromMnemonic("not a real mnemonic phrase at all"));
});

test("message builders refuse the shapes the chain would reject", () => {
  const from = PrivateKey.generate().address();
  const to = PrivateKey.generate().address();

  assert.throws(() => msgs.send(from, from, 1n), /same account/);
  assert.throws(() => msgs.send(from, to, 0n), /positive/);
  assert.throws(() => msgs.multiSend(from, []), /at least one/);
  assert.throws(
    () => msgs.multiSend(from, [{ to, amount: 1n }, { to, amount: 2n }]),
    /duplicate/,
  );

  const ok = msgs.send(from, to, 25n * ONE_YOZ);
  assert.equal(ok.type, "bank/send");
  assert.equal(ok.value.amount, "250000000000000");
});

test("an unlimited or unexpiring grant cannot be built", () => {
  const granter = PrivateKey.generate().address();
  const grantee = PrivateKey.generate().address();
  const future = new Date(Date.now() + 3600_000);

  assert.throws(() => msgs.grant(granter, grantee, { total: 0n }, future), /positive total/);
  assert.throws(
    () => msgs.grant(granter, grantee, { total: ONE_YZXA }, new Date(Date.now() - 1000)),
    /future/,
  );
  assert.throws(
    () => msgs.grant(granter, grantee, { total: ONE_YZXA }, new Date(Date.now() + 400 * 24 * 3600_000)),
    /one year/,
  );
  assert.throws(
    () => msgs.grant(granter, grantee, { total: ONE_YZXA, periodSeconds: 60 }, future),
    /per-period/,
  );

  const g = msgs.grant(
    granter,
    grantee,
    { total: 20n * ONE_YZXA, perPeriod: 5n * ONE_YZXA, periodSeconds: 3600 },
    future,
    { allowedRecipients: [grantee], requireApprovalAbove: 3n * ONE_YZXA },
  );
  assert.equal(g.type, "auth/grant");
  assert.deepEqual(g.value.allowed_msg_types, ["bank/send"]);
});

test("nested delegated execution is refused", () => {
  const a = PrivateKey.generate().address();
  const b = PrivateKey.generate().address();
  const inner = msgs.exec(b, a, [msgs.send(a, b, 1n)]);
  assert.throws(() => msgs.exec(b, a, [inner]), /nested/);
});

test("a signed transaction hashes stably and binds every field", () => {
  const key = PrivateKey.generate();
  const to = PrivateKey.generate().address();
  const opts = {
    chainId: "yozexa-test-1",
    msgs: [msgs.send(key.address(), to, ONE_YZXA)],
    sequence: 0,
    fee: { gasLimit: 200_000, gasPrice: 1_000_000_000n },
  };
  const tx = signTransaction(opts, key);

  assert.equal(transactionHash(tx), transactionHash(tx));
  assert.ok(verify(key.publicKey(), signBytes(opts, key.publicKeyHex()), Buffer.from(tx.signature, "base64")));

  // Changing the chain id changes the signed bytes: a testnet signature is
  // worthless on mainnet.
  const other = { ...opts, chainId: "yozexa-1" };
  assert.notEqual(
    new TextDecoder().decode(signBytes(opts, key.publicKeyHex())),
    new TextDecoder().decode(signBytes(other, key.publicKeyHex())),
  );

  // Encoding is canonical: keys sorted, no whitespace.
  const encoded = encodeTransaction(tx);
  assert.ok(encoded.startsWith('{"auth":'), encoded.slice(0, 40));
  assert.equal(encoded.includes(" "), false);
});
