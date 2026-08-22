// Package crypto provides YOZEXA key handling and signatures.
//
// YOZEXA does not invent cryptography. It uses:
//
//   - secp256k1 ECDSA (RFC 6979 deterministic nonces) for account keys, the
//     same curve as Bitcoin and Ethereum, via the audited decred
//     implementation that CometBFT itself depends on.
//   - Ed25519 for validator consensus keys, as required by CometBFT.
//   - SHA-256 for all protocol hashing.
//   - BIP-39 mnemonics and BIP-32/BIP-44 derivation for wallet seeds.
package crypto

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"

	"github.com/yozexa/yozexa/chain/types"
)

// PubKeySize is the length of a compressed secp256k1 public key.
const PubKeySize = 33

// SignatureSize is the length of a compact ECDSA signature (r||s), without a
// recovery byte. YOZEXA transactions always carry the public key explicitly,
// so no recovery id is needed.
const SignatureSize = 64

// PrivKey is a secp256k1 signing key.
type PrivKey struct {
	k *secp256k1.PrivateKey
}

// PubKey is a compressed secp256k1 verification key.
type PubKey struct {
	bytes [PubKeySize]byte
}

// GeneratePrivKey creates a new key from the operating system CSPRNG.
func GeneratePrivKey() (*PrivKey, error) {
	k, err := secp256k1.GeneratePrivateKeyFromRand(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate key: %w", err)
	}
	return &PrivKey{k: k}, nil
}

// PrivKeyFromBytes loads a 32-byte scalar. It rejects the zero key and any
// scalar outside the curve order.
func PrivKeyFromBytes(b []byte) (*PrivKey, error) {
	if len(b) != 32 {
		return nil, fmt.Errorf("private key must be 32 bytes, got %d", len(b))
	}
	var modNScalar secp256k1.ModNScalar
	if overflow := modNScalar.SetByteSlice(b); overflow {
		return nil, errors.New("private key is not in the curve order range")
	}
	if modNScalar.IsZero() {
		return nil, errors.New("private key is zero")
	}
	return &PrivKey{k: secp256k1.NewPrivateKey(&modNScalar)}, nil
}

// Bytes returns the 32-byte scalar. Callers must treat the result as secret
// material and zero it as soon as it is no longer needed.
func (p *PrivKey) Bytes() []byte { return p.k.Serialize() }

// PubKey returns the matching public key.
func (p *PrivKey) PubKey() PubKey {
	var pk PubKey
	copy(pk.bytes[:], p.k.PubKey().SerializeCompressed())
	return pk
}

// Address returns the account address controlled by this key.
func (p *PrivKey) Address() types.Address { return p.PubKey().Address() }

// Sign produces a deterministic (RFC 6979) ECDSA signature over SHA-256(msg).
func (p *PrivKey) Sign(msg []byte) ([]byte, error) {
	digest := sha256.Sum256(msg)
	sig := ecdsa.Sign(p.k, digest[:])
	// Serialise as fixed-width r||s so that signature bytes are canonical and
	// no DER malleability is possible on the wire.
	r, s := sig.R(), sig.S()
	out := make([]byte, SignatureSize)
	rb := r.Bytes()
	sb := s.Bytes()
	copy(out[0:32], rb[:])
	copy(out[32:64], sb[:])
	return out, nil
}

// PubKeyFromBytes validates and wraps a 33-byte compressed public key.
func PubKeyFromBytes(b []byte) (PubKey, error) {
	var pk PubKey
	if len(b) != PubKeySize {
		return pk, fmt.Errorf("public key must be %d bytes, got %d", PubKeySize, len(b))
	}
	if _, err := secp256k1.ParsePubKey(b); err != nil {
		return pk, fmt.Errorf("invalid secp256k1 public key: %w", err)
	}
	copy(pk.bytes[:], b)
	return pk, nil
}

// PubKeyFromHex parses a hex-encoded compressed public key.
func PubKeyFromHex(s string) (PubKey, error) {
	b, err := hex.DecodeString(s)
	if err != nil {
		return PubKey{}, fmt.Errorf("invalid hex public key: %w", err)
	}
	return PubKeyFromBytes(b)
}

// Bytes returns a copy of the compressed public key.
func (pk PubKey) Bytes() []byte {
	out := make([]byte, PubKeySize)
	copy(out, pk.bytes[:])
	return out
}

// Hex renders the compressed public key as hex.
func (pk PubKey) Hex() string { return hex.EncodeToString(pk.bytes[:]) }

// IsZero reports whether the key is unset.
func (pk PubKey) IsZero() bool { return pk.bytes == [PubKeySize]byte{} }

// Address derives the account address of the public key.
func (pk PubKey) Address() types.Address { return types.AddressFromPubKey(pk.bytes[:]) }

// Verify checks a fixed-width r||s signature against SHA-256(msg).
//
// It enforces low-S canonicalisation: a signature whose S value is above
// half the curve order is rejected. Without this rule an attacker could take
// a valid signature, flip S, and produce a second distinct transaction hash
// for the same intent (signature malleability).
func (pk PubKey) Verify(msg, sig []byte) bool {
	if len(sig) != SignatureSize {
		return false
	}
	pub, err := secp256k1.ParsePubKey(pk.bytes[:])
	if err != nil {
		return false
	}
	var r, s secp256k1.ModNScalar
	if overflow := r.SetByteSlice(sig[0:32]); overflow {
		return false
	}
	if overflow := s.SetByteSlice(sig[32:64]); overflow {
		return false
	}
	if r.IsZero() || s.IsZero() {
		return false
	}
	if s.IsOverHalfOrder() {
		return false // non-canonical (malleable) signature
	}
	digest := sha256.Sum256(msg)
	return ecdsa.NewSignature(&r, &s).Verify(digest[:], pub)
}
