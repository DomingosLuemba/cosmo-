package types

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/btcsuite/btcd/btcutil/bech32"
)

// Human-readable prefixes for the three address families on YOZEXA.
//
// They are distinct so that an operator address can never be mistaken for a
// spending account, and a consensus key can never be mistaken for either.
const (
	Bech32PrefixAccount   = "yzx"
	Bech32PrefixValidator = "yzxvaloper"
	Bech32PrefixConsensus = "yzxvalcons"
)

// AddressLength is the byte length of every YOZEXA address.
const AddressLength = 20

// Address is the 20-byte identifier of an account, derived from a public key.
//
// Derivation: Address = SHA-256(compressed public key)[:20].
//
// This is the standard Tendermint/Cosmos derivation. YOZEXA deliberately does
// not invent an address scheme of its own.
type Address [AddressLength]byte

// AddressFromPubKey derives the account address of a public key.
func AddressFromPubKey(compressedPubKey []byte) Address {
	sum := sha256.Sum256(compressedPubKey)
	var a Address
	copy(a[:], sum[:AddressLength])
	return a
}

// AddressFromBytes builds an address from raw bytes, validating the length.
func AddressFromBytes(b []byte) (Address, error) {
	var a Address
	if len(b) != AddressLength {
		return a, fmt.Errorf("address must be %d bytes, got %d", AddressLength, len(b))
	}
	copy(a[:], b)
	return a, nil
}

// Bytes returns a copy of the raw address bytes.
func (a Address) Bytes() []byte {
	out := make([]byte, AddressLength)
	copy(out, a[:])
	return out
}

// IsZero reports whether the address is the all-zero address, which is never a
// valid destination for funds.
func (a Address) IsZero() bool {
	return a == Address{}
}

// String renders the account bech32 form, e.g. yzx1...
func (a Address) String() string { return mustBech32(Bech32PrefixAccount, a[:]) }

// ValoperString renders the validator-operator bech32 form.
func (a Address) ValoperString() string { return mustBech32(Bech32PrefixValidator, a[:]) }

// Hex renders the address as lowercase hex, used in logs and low-level tools.
func (a Address) Hex() string { return hex.EncodeToString(a[:]) }

// MarshalJSON encodes the address in its bech32 account form.
func (a Address) MarshalJSON() ([]byte, error) {
	return []byte(`"` + a.String() + `"`), nil
}

// UnmarshalJSON decodes a bech32 account address.
func (a *Address) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	parsed, err := ParseAddress(s)
	if err != nil {
		return err
	}
	*a = parsed
	return nil
}

// ParseAddress decodes a bech32 account address (prefix "yzx").
func ParseAddress(s string) (Address, error) { return parseBech32(s, Bech32PrefixAccount) }

// ParseValidatorAddress decodes a bech32 validator-operator address.
func ParseValidatorAddress(s string) (Address, error) {
	return parseBech32(s, Bech32PrefixValidator)
}

// ParseAnyAddress accepts either an account or a validator-operator address
// and returns the underlying 20 bytes. Used by read-only tooling (explorer,
// CLI queries) that should be forgiving about which form a user pasted.
func ParseAnyAddress(s string) (Address, error) {
	if a, err := parseBech32(s, Bech32PrefixValidator); err == nil {
		return a, nil
	}
	return parseBech32(s, Bech32PrefixAccount)
}

func parseBech32(s, wantHRP string) (Address, error) {
	var a Address
	s = strings.TrimSpace(s)
	if s == "" {
		return a, fmt.Errorf("empty address")
	}
	// bech32 is case-insensitive but mixed case is invalid; normalise to lower
	// and reject mixed input explicitly so that a copy-paste error is loud.
	if s != strings.ToLower(s) && s != strings.ToUpper(s) {
		return a, fmt.Errorf("mixed-case address %q is not valid bech32", s)
	}
	hrp, data, err := bech32.Decode(strings.ToLower(s))
	if err != nil {
		return a, fmt.Errorf("invalid bech32 address: %w", err)
	}
	if hrp != wantHRP {
		return a, fmt.Errorf("wrong address prefix %q, expected %q", hrp, wantHRP)
	}
	raw, err := bech32.ConvertBits(data, 5, 8, false)
	if err != nil {
		return a, fmt.Errorf("invalid bech32 payload: %w", err)
	}
	return AddressFromBytes(raw)
}

func mustBech32(hrp string, payload []byte) string {
	conv, err := bech32.ConvertBits(payload, 8, 5, true)
	if err != nil {
		panic(fmt.Sprintf("bech32 conversion failed: %v", err))
	}
	s, err := bech32.Encode(hrp, conv)
	if err != nil {
		panic(fmt.Sprintf("bech32 encode failed: %v", err))
	}
	return s
}

// ModuleAddress derives the deterministic, key-less address of a protocol
// module account (emission pool, treasury, staking pools, ...).
//
// Module addresses are derived from a domain-separated hash of the module
// name. No private key exists that maps to them, so no human can sign for a
// module account: their balances move only through protocol logic.
func ModuleAddress(name string) Address {
	sum := sha256.Sum256([]byte("yozexa/module-account/" + name))
	var a Address
	copy(a[:], sum[:AddressLength])
	return a
}
