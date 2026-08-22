package tx_test

import (
	"encoding/base64"
	"math/big"
	"testing"

	"github.com/yozexa/yozexa/chain/codec"
	"github.com/yozexa/yozexa/chain/crypto"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// FuzzDecodeTx feeds arbitrary bytes to the transaction parser.
//
// The parser is the first code an unauthenticated peer can reach, so it must
// never panic, never allocate without bound, and never accept a transaction
// whose signature does not verify. A crash here would be a remote denial of
// service against every node on the network.
func FuzzDecodeTx(f *testing.F) {
	key, err := crypto.GeneratePrivKey()
	if err != nil {
		f.Fatal(err)
	}
	dest, err := crypto.GeneratePrivKey()
	if err != nil {
		f.Fatal(err)
	}
	b := tx.NewBuilder("yozexa-fuzz-1")
	_ = b.AddMsg(tx.MsgSend{
		From: key.Address(), To: dest.Address(),
		Amount: types.MustAmount(types.YZXA(1)),
	})
	_ = b.WithFee(200_000, big.NewInt(1_000_000_000))
	signed, err := b.Sign(key)
	if err != nil {
		f.Fatal(err)
	}
	raw, err := signed.Bytes()
	if err != nil {
		f.Fatal(err)
	}

	f.Add(raw)
	f.Add([]byte(`{}`))
	f.Add([]byte(`{"body":{"chain_id":"x","msgs":[]},"auth":{},"signature":""}`))
	f.Add([]byte(`{"body":{"chain_id":"x","msgs":[{"type":"bank/send","value":{}}]}}`))
	f.Add([]byte("\x00\x01\x02"))

	f.Fuzz(func(t *testing.T, data []byte) {
		decoded, err := tx.Decode(data)
		if err != nil {
			return
		}
		msgs, _, err := decoded.ValidateBasic("yozexa-fuzz-1")
		if err != nil {
			return
		}
		// Anything that validated must round-trip to identical canonical bytes
		// and hash stably. If it did not, two nodes could disagree on a
		// transaction's identity.
		encoded, err := decoded.Bytes()
		if err != nil {
			t.Fatalf("a validated transaction failed to re-encode: %v", err)
		}
		again, err := tx.Decode(encoded)
		if err != nil {
			t.Fatalf("a re-encoded transaction failed to decode: %v", err)
		}
		if _, _, err := again.ValidateBasic("yozexa-fuzz-1"); err != nil {
			t.Fatalf("a re-encoded transaction failed to validate: %v", err)
		}
		h1, _ := decoded.Hash()
		h2, _ := again.Hash()
		if h1 != h2 {
			t.Fatalf("hash is not stable across a round trip: %s vs %s", h1, h2)
		}
		for _, m := range msgs {
			if err := m.ValidateBasic(); err != nil {
				t.Fatalf("a validated transaction carried an invalid message: %v", err)
			}
		}
	})
}

// FuzzParseAmount checks that no input string can produce a wrong amount.
//
// Amount parsing sits between a human typing a number and money moving. A
// parser that silently truncates, rounds or misreads a value is a way to send
// somebody the wrong amount, so the property tested is exact: whatever parses
// must format back to the same value.
func FuzzParseAmount(f *testing.F) {
	f.Add("1.5", "YZXA")
	f.Add("0.000000000000000001", "YZXA")
	f.Add("25", "YOZ")
	f.Add("10000000", "YZXA")
	f.Add("1e10", "YZXA")
	f.Add("-1", "YZXA")
	f.Add("1.", "YZXA")
	f.Add(".1", "YZXA")

	f.Fuzz(func(t *testing.T, s, unit string) {
		v, err := types.ParseAmount(s, unit)
		if err != nil {
			return
		}
		if v.Sign() < 0 {
			t.Fatalf("parsed %q as a negative amount %s", s, v)
		}
		// Re-parsing the formatted value must give back exactly the same
		// integer: no rounding may creep in through display.
		formatted := types.FormatYZXA(v)
		again, err := types.ParseAmount(formatted, types.DisplayDenom)
		if err != nil {
			t.Fatalf("formatted amount %q from input %q failed to re-parse: %v", formatted, s, err)
		}
		if again.Cmp(v) != 0 {
			t.Fatalf("round trip changed the amount: %q -> %s -> %q -> %s", s, v, formatted, again)
		}
	})
}

// FuzzCanonicalJSON checks that canonicalisation is idempotent and stable.
//
// Sign bytes are produced by this function. If two canonicalisations of the
// same document could differ, a signature would be verifiable against one
// encoding and not another.
func FuzzCanonicalJSON(f *testing.F) {
	f.Add([]byte(`{"b":1,"a":2}`))
	f.Add([]byte(`{"a":{"z":1,"y":[1,2,{"c":3,"b":4}]}}`))
	f.Add([]byte(`"string with \" quote"`))
	f.Add([]byte(`[1,2,3]`))

	f.Fuzz(func(t *testing.T, data []byte) {
		once, err := codec.Canonicalize(data)
		if err != nil {
			return
		}
		twice, err := codec.Canonicalize(once)
		if err != nil {
			t.Fatalf("canonical output failed to canonicalise again: %v", err)
		}
		if string(once) != string(twice) {
			t.Fatalf("canonicalisation is not idempotent:\n%s\n%s", once, twice)
		}
	})
}

// FuzzSignatureVerification checks that no mutation of a signature or its
// payload can make a forged transaction verify.
func FuzzSignatureVerification(f *testing.F) {
	f.Add(uint8(0), uint8(0))
	f.Add(uint8(31), uint8(255))
	f.Add(uint8(63), uint8(1))

	key, err := crypto.GeneratePrivKey()
	if err != nil {
		f.Fatal(err)
	}
	msg := []byte("YOZEXA test payload")
	sig, err := key.Sign(msg)
	if err != nil {
		f.Fatal(err)
	}
	pub := key.PubKey()
	if !pub.Verify(msg, sig) {
		f.Fatal("a freshly signed message did not verify")
	}

	f.Fuzz(func(t *testing.T, index, delta uint8) {
		if delta == 0 {
			return
		}
		mutated := append([]byte(nil), sig...)
		mutated[int(index)%len(mutated)] ^= delta
		if pub.Verify(msg, mutated) {
			t.Fatalf("a mutated signature verified (byte %d ^= %d)", index%uint8(len(mutated)), delta)
		}
	})
}

// A canonical low-S signature must be produced, and its high-S twin rejected.
// Without this, one signed intent could be re-encoded into a second valid
// transaction with a different hash.
func TestSignaturesAreCanonicalLowS(t *testing.T) {
	key, err := crypto.GeneratePrivKey()
	if err != nil {
		t.Fatal(err)
	}
	// secp256k1 group order.
	order, _ := new(big.Int).SetString(
		"FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141", 16)
	half := new(big.Int).Rsh(order, 1)

	for i := 0; i < 100; i++ {
		msg := []byte{byte(i), byte(i >> 8), 'y', 'z'}
		sig, err := key.Sign(msg)
		if err != nil {
			t.Fatal(err)
		}
		s := new(big.Int).SetBytes(sig[32:64])
		if s.Cmp(half) > 0 {
			t.Fatalf("signature %d has high S: %s", i, s)
		}
		// Flip S to its high twin: same mathematical signature, different bytes.
		highS := new(big.Int).Sub(order, s)
		twin := append([]byte(nil), sig...)
		hb := highS.Bytes()
		for j := range twin[32:64] {
			twin[32+j] = 0
		}
		copy(twin[64-len(hb):64], hb)
		if key.PubKey().Verify(msg, twin) {
			t.Fatalf("a high-S (malleable) signature verified at iteration %d", i)
		}
	}
	_ = base64.StdEncoding
}
