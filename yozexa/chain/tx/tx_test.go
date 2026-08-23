package tx_test

import (
	"encoding/base64"
	"math/big"
	"strings"
	"testing"

	"github.com/yozexa/yozexa/chain/crypto"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

func mustKey(t *testing.T) *crypto.PrivKey {
	t.Helper()
	k, err := crypto.GeneratePrivKey()
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return k
}

func buildSend(t *testing.T, key *crypto.PrivKey, to types.Address, amount *big.Int) tx.Tx {
	t.Helper()
	b := tx.NewBuilder("yozexa-localnet-1")
	if err := b.AddMsg(tx.MsgSend{
		From:   key.Address(),
		To:     to,
		Amount: types.MustAmount(amount),
	}); err != nil {
		t.Fatalf("add msg: %v", err)
	}
	if err := b.WithFee(200_000, big.NewInt(1_000_000_000)); err != nil {
		t.Fatalf("fee: %v", err)
	}
	signed, err := b.Sign(key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signed
}

func TestSignedTransactionRoundTripsAndVerifies(t *testing.T) {
	key := mustKey(t)
	dest := mustKey(t).Address()
	signed := buildSend(t, key, dest, types.YZXA(1))

	raw, err := signed.Bytes()
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	decoded, err := tx.Decode(raw)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	msgs, signer, err := decoded.ValidateBasic("yozexa-localnet-1")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if signer != key.Address() {
		t.Fatalf("signer mismatch: got %s want %s", signer, key.Address())
	}
	if len(msgs) != 1 || msgs[0].Type() != tx.MsgTypeSend {
		t.Fatalf("unexpected messages: %+v", msgs)
	}
}

func TestTamperedAmountInvalidatesSignature(t *testing.T) {
	key := mustKey(t)
	dest := mustKey(t).Address()
	signed := buildSend(t, key, dest, types.YZXA(1))

	raw, err := signed.Bytes()
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	// Rewrite 1 YZXA into 100 YZXA directly in the encoded bytes.
	tampered := strings.Replace(string(raw), `"1000000000000000000"`, `"100000000000000000000"`, 1)
	if tampered == string(raw) {
		t.Fatal("test setup failed: amount not found in encoded transaction")
	}
	decoded, err := tx.Decode([]byte(tampered))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if _, _, err := decoded.ValidateBasic("yozexa-localnet-1"); err == nil {
		t.Fatal("tampered transaction verified; signature check is not binding the amount")
	}
}

func TestTransactionSignedForAnotherChainIsRejected(t *testing.T) {
	key := mustKey(t)
	dest := mustKey(t).Address()
	signed := buildSend(t, key, dest, types.YZXA(1))

	if _, _, err := signed.ValidateBasic("yozexa-mainnet-1"); err == nil {
		t.Fatal("testnet transaction accepted on mainnet chain id")
	}
}

func TestSignatureFromAnotherKeyIsRejected(t *testing.T) {
	key := mustKey(t)
	other := mustKey(t)
	dest := mustKey(t).Address()
	signed := buildSend(t, key, dest, types.YZXA(1))

	signBytes, err := signed.SignBytes()
	if err != nil {
		t.Fatalf("sign bytes: %v", err)
	}
	sig, err := other.Sign(signBytes)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	signed.Signature = base64.StdEncoding.EncodeToString(sig)

	if _, _, err := signed.ValidateBasic("yozexa-localnet-1"); err == nil {
		t.Fatal("transaction signed by a different key was accepted")
	}
}

func TestMessageSignerMustMatchTransactionSigner(t *testing.T) {
	key := mustKey(t)
	victim := mustKey(t)
	b := tx.NewBuilder("yozexa-localnet-1")
	// Attempt to spend from an account we do not control.
	if err := b.AddMsg(tx.MsgSend{
		From:   victim.Address(),
		To:     key.Address(),
		Amount: types.MustAmount(types.YZXA(1)),
	}); err != nil {
		t.Fatalf("add msg: %v", err)
	}
	if err := b.WithFee(200_000, big.NewInt(1)); err != nil {
		t.Fatalf("fee: %v", err)
	}
	signed, err := b.Sign(key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if _, _, err := signed.ValidateBasic("yozexa-localnet-1"); err == nil {
		t.Fatal("a transaction spending someone else's account was accepted")
	}
}

func TestSignBytesAreDeterministic(t *testing.T) {
	key := mustKey(t)
	dest := mustKey(t).Address()
	signed := buildSend(t, key, dest, types.YZXA(1))

	first, err := signed.SignBytes()
	if err != nil {
		t.Fatalf("sign bytes: %v", err)
	}
	for i := 0; i < 200; i++ {
		next, err := signed.SignBytes()
		if err != nil {
			t.Fatalf("sign bytes: %v", err)
		}
		if string(next) != string(first) {
			t.Fatalf("sign bytes differ between calls:\n%s\n%s", first, next)
		}
	}
}

func TestUnknownMessageTypeIsRejected(t *testing.T) {
	_, err := tx.UnmarshalMsg([]byte(`{"type":"bank/mint_for_me","value":{}}`))
	if err == nil {
		t.Fatal("unknown message type was accepted")
	}
}

func TestOversizedTransactionIsRejected(t *testing.T) {
	big := make([]byte, tx.MaxTxBytes+1)
	for i := range big {
		big[i] = 'a'
	}
	if _, err := tx.Decode(big); err == nil {
		t.Fatal("oversized transaction accepted")
	}
}
