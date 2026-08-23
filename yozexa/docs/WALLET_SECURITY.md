# YOZEXA Wallet Security

## Self-custody

The user controls the keys. YOZEXA Labs cannot move a user's funds, cannot
freeze an account, and cannot recover a lost seed phrase. That is the deal, and
every YOZEXA wallet must say so in plain language before it shows a user their
recovery phrase.

## Key derivation

```
mnemonic  = BIP-39, 24 words, 256 bits of entropy from the OS CSPRNG
seed      = BIP-39 seed (mnemonic, optional passphrase)
priv key  = seed[0:32], reduced into the secp256k1 scalar field
address   = SHA-256(compressed public key)[0:20], bech32 with prefix "yzx"
```

Documented here so any wallet can reproduce it and a user is never locked into
one implementation.

## Storage at rest

| Platform | Requirement |
|---|---|
| CLI / desktop | scrypt (N=2^17, r=8, p=1) + XChaCha20-Poly1305, file mode 0600, keyring directory 0700 — implemented in `chain/keyring` |
| iOS | Secure Enclave for the encryption key; key material never in `UserDefaults`, never in a plist, never in a log |
| Android | Android Keystore, hardware-backed where available; `EncryptedSharedPreferences` for metadata only |
| Web | Encrypted at rest with a key derived from a user passphrase; never in `localStorage` in the clear; consider a hardware wallet or passkey-gated flow for anything of value |

A private key is never written in plaintext, never logged, never included in an
error message, and never sent to a server. Decrypted key bytes are zeroed after
use.

The keyring binds the account address as AEAD associated data, so a ciphertext
cannot be moved between records to make a key decrypt "as" another account.

## Authentication

Support, per platform:

- Face ID / Touch ID (iOS), BiometricPrompt (Android);
- passkeys / WebAuthn;
- hardware wallets and security keys;
- a passphrase as the fallback that always works.

Biometrics gate *access to the key*, they are not the key. A device without
biometrics must still be usable with a passphrase.

## Recovery

**Seed phrase.** 24 words, shown once, with an explicit warning that anyone who
reads them controls the account and that nobody can recover them.

**Social recovery (designed, not yet implemented).** An account nominates
guardians — for example 3 of 5 — who can collectively rotate the account's
signing key after a delay. Guardians can **never spend funds**; they can only
help recover access, and only after a challenge window during which the original
key holder can cancel. This requires the smart-account work in
[SMART_CONTRACTS.md](SMART_CONTRACTS.md) and is not available today. Do not
present it to users as if it were.

## Signing screens

A wallet must never ask a user to approve `0x8474938…`. Before any signature it
must show:

- what moves, in words: "Send 25 YOZ (0.00025 YZXA) to maria.yzx";
- the resolved destination address, not only the alias;
- the exact network fee, in YZXA and in the user's display currency;
- any permission being granted, with its total, its rate, its recipients and its
  expiry;
- warnings the node returned.

`POST /v1/simulate` returns exactly this: a list of plain-language effects, the
gas required, the exact fee, and warnings. The wallet's job is to display them,
not to summarise them away.

## Anti-phishing and anti-poisoning

Required wallet behaviour (protocol support exists; wallet implementation is
per-platform):

| Attack | Defence |
|---|---|
| Address poisoning — attacker sends dust from an address that looks like one you use | Never offer an address from incoming history as a send target without marking it; show first and last characters distinctly; warn on a first-time recipient that resembles a previous one |
| Lookalike YOZEXA ID | The protocol makes homographs inexpressible: ASCII only, lowercase only, no doubled or edge hyphens, no all-numeric names, reserved names blocked. Wallets should additionally show a name's registration date, so a freshly-registered lookalike is visible as such |
| Fake token | YZXA is the only native asset. A wallet must not display an arbitrary asset as if it were YZXA |
| Malicious permission request | Unlimited grants cannot be expressed on YOZEXA. Show total, rate, recipients and expiry, and default the expiry short |
| Malicious site | Domain allow-lists and warning lists, maintained per wallet |

## Network confusion

A wallet must make it impossible to mistake a test network for mainnet:

- chain ids carry the network kind (`yozexa-1`, `yozexa-testnet-1`, …) and are
  part of every signature, so a testnet signature is worthless on mainnet;
- `/v1/status` returns an explicit `network_warning` on any non-mainnet chain,
  and the CLI prints it before signing;
- testnet UI must be visually distinct and must state **NO REAL VALUE**.

## Display units

Show YZXA, YOZ, and a fiat reference the user chooses (USD, EUR, AOA, GBP, …).

Fiat figures are **market references from an external price source**, labelled
as such and timestamped. The wallet must never present a fiat figure as a
guarantee, and must never invent a price when no source is available — it shows
the YZXA amount and says the reference is unavailable.

## What a wallet must never do

- Store, transmit or log a private key or seed phrase.
- Sign anything the user has not been shown in words.
- Claim a payment is settled before it is in a committed block.
- Show an APY without the slashing risk next to it.
- Put a person's name, document, phone number or address on chain.
