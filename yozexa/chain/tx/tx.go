package tx

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"

	"github.com/yozexa/yozexa/chain/codec"
	"github.com/yozexa/yozexa/chain/crypto"
	"github.com/yozexa/yozexa/chain/types"
)

// MaxTxBytes is the largest transaction a node will accept. It bounds the work
// an unauthenticated peer can force a node to do before any signature check.
const MaxTxBytes = 128 * 1024

// MaxMsgsPerTx bounds how many messages one transaction may batch.
const MaxMsgsPerTx = 64

// MaxMemoBytes bounds the free-text memo carried with a payment.
const MaxMemoBytes = 512

// Fee describes what the sender pays for execution.
//
// The fee is always gas_limit * gas_price, both integers. The wallet shows the
// full number before signing; there is no hidden component and no second fee
// added by any product built on top of the network.
type Fee struct {
	GasLimit uint64       `json:"gas_limit"`
	GasPrice types.Amount `json:"gas_price"` // ayzxa per unit of gas
}

// Total returns gas_limit * gas_price, the maximum the sender can pay.
func (f Fee) Total() *big.Int {
	return new(big.Int).Mul(new(big.Int).SetUint64(f.GasLimit), f.GasPrice.Int())
}

// Body is the part of a transaction that describes intent.
type Body struct {
	ChainID string `json:"chain_id"`
	// Msgs are executed in order and atomically: if any message fails, the
	// whole transaction is reverted and only the fee is charged.
	Msgs []json.RawMessage `json:"msgs"`
	Memo string            `json:"memo,omitempty"`
	// TimeoutHeight, when non-zero, makes the transaction invalid at and above
	// that height. A payment that has not been included by then can be
	// re-issued with confidence that the original can never land later.
	TimeoutHeight int64 `json:"timeout_height,omitempty"`
}

// Auth carries the authentication material.
type Auth struct {
	// PubKey is the compressed secp256k1 key, hex encoded.
	PubKey string `json:"pubkey"`
	// Sequence is the signer's next expected nonce. It is what makes a signed
	// transaction executable exactly once: replaying it finds the account's
	// sequence already advanced and is rejected.
	Sequence uint64 `json:"sequence"`
	Fee      Fee    `json:"fee"`
}

// Tx is a signed YOZEXA transaction.
type Tx struct {
	Body Body `json:"body"`
	Auth Auth `json:"auth"`
	// Signature is 64 bytes of r||s, base64 encoded.
	Signature string `json:"signature"`
}

// signDoc is the exact structure that gets canonicalised and hashed. It
// deliberately repeats the body and auth fields rather than embedding the Tx
// type, so that adding a field to the wire format can never silently change
// what users have been signing.
type signDoc struct {
	ChainID       string            `json:"chain_id"`
	Msgs          []json.RawMessage `json:"msgs"`
	Memo          string            `json:"memo"`
	TimeoutHeight int64             `json:"timeout_height"`
	PubKey        string            `json:"pubkey"`
	Sequence      uint64            `json:"sequence"`
	GasLimit      uint64            `json:"gas_limit"`
	GasPrice      string            `json:"gas_price"`
}

// SignBytes returns the canonical bytes the signer commits to.
//
// The chain id is inside the signed payload. That is what stops a transaction
// signed on the testnet from ever being valid on mainnet, and vice versa.
func (t Tx) SignBytes() ([]byte, error) {
	doc := signDoc{
		ChainID:       t.Body.ChainID,
		Msgs:          t.Body.Msgs,
		Memo:          t.Body.Memo,
		TimeoutHeight: t.Body.TimeoutHeight,
		PubKey:        t.Auth.PubKey,
		Sequence:      t.Auth.Sequence,
		GasLimit:      t.Auth.Fee.GasLimit,
		GasPrice:      t.Auth.Fee.GasPrice.String(),
	}
	return codec.CanonicalJSON(doc)
}

// Bytes returns the canonical wire encoding of the signed transaction.
func (t Tx) Bytes() ([]byte, error) { return codec.CanonicalJSON(t) }

// Hash returns the transaction hash: SHA-256 over the canonical wire bytes,
// rendered as uppercase hex (the CometBFT convention).
func (t Tx) Hash() (string, error) {
	b, err := t.Bytes()
	if err != nil {
		return "", err
	}
	return HashBytes(b), nil
}

// HashBytes hashes already-encoded transaction bytes.
func HashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

// Decode parses and structurally validates transaction bytes.
func Decode(raw []byte) (Tx, error) {
	var t Tx
	if len(raw) == 0 {
		return t, fmt.Errorf("empty transaction")
	}
	if len(raw) > MaxTxBytes {
		return t, fmt.Errorf("transaction of %d bytes exceeds limit of %d", len(raw), MaxTxBytes)
	}
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if err := d.Decode(&t); err != nil {
		return t, fmt.Errorf("decode transaction: %w", err)
	}
	if d.More() {
		return t, fmt.Errorf("trailing data after transaction")
	}
	return t, nil
}

// Messages decodes the messages carried by the transaction.
func (t Tx) Messages() ([]Msg, error) {
	out := make([]Msg, 0, len(t.Body.Msgs))
	for i, raw := range t.Body.Msgs {
		m, err := UnmarshalMsg(raw)
		if err != nil {
			return nil, fmt.Errorf("message %d: %w", i, err)
		}
		out = append(out, m)
	}
	return out, nil
}

// ValidateBasic performs every check that does not require chain state:
// structure, limits, message validity, signature validity and the rule that
// the signer must authorise every message in the batch.
//
// It returns the decoded messages so that callers do not decode twice.
func (t Tx) ValidateBasic(expectedChainID string) ([]Msg, types.Address, error) {
	var signer types.Address

	if t.Body.ChainID == "" {
		return nil, signer, fmt.Errorf("missing chain id")
	}
	if expectedChainID != "" && t.Body.ChainID != expectedChainID {
		return nil, signer, fmt.Errorf(
			"chain id mismatch: transaction is for %q, this node is %q",
			t.Body.ChainID, expectedChainID)
	}
	if len(t.Body.Msgs) == 0 {
		return nil, signer, fmt.Errorf("transaction carries no messages")
	}
	if len(t.Body.Msgs) > MaxMsgsPerTx {
		return nil, signer, fmt.Errorf("transaction carries %d messages, limit is %d",
			len(t.Body.Msgs), MaxMsgsPerTx)
	}
	if len(t.Body.Memo) > MaxMemoBytes {
		return nil, signer, fmt.Errorf("memo of %d bytes exceeds limit of %d",
			len(t.Body.Memo), MaxMemoBytes)
	}
	if t.Body.TimeoutHeight < 0 {
		return nil, signer, fmt.Errorf("negative timeout height")
	}
	if t.Auth.Fee.GasLimit == 0 {
		return nil, signer, fmt.Errorf("gas limit must be positive")
	}

	pk, err := crypto.PubKeyFromHex(t.Auth.PubKey)
	if err != nil {
		return nil, signer, err
	}
	signer = pk.Address()

	msgs, err := t.Messages()
	if err != nil {
		return nil, signer, err
	}
	for i, m := range msgs {
		if err := m.ValidateBasic(); err != nil {
			return nil, signer, fmt.Errorf("message %d: %w", i, err)
		}
		if m.Signer() != signer {
			return nil, signer, fmt.Errorf(
				"message %d is authorised by %s but the transaction is signed by %s",
				i, m.Signer(), signer)
		}
	}

	sig, err := base64.StdEncoding.DecodeString(t.Signature)
	if err != nil {
		return nil, signer, fmt.Errorf("invalid signature encoding: %w", err)
	}
	signBytes, err := t.SignBytes()
	if err != nil {
		return nil, signer, fmt.Errorf("build sign bytes: %w", err)
	}
	if !pk.Verify(signBytes, sig) {
		return nil, signer, fmt.Errorf("signature verification failed")
	}
	return msgs, signer, nil
}

// Builder assembles and signs a transaction.
type Builder struct {
	chainID       string
	msgs          []json.RawMessage
	memo          string
	timeoutHeight int64
	sequence      uint64
	fee           Fee
}

// NewBuilder starts a transaction for the given chain.
func NewBuilder(chainID string) *Builder { return &Builder{chainID: chainID} }

// AddMsg appends a message to the batch.
func (b *Builder) AddMsg(m Msg) error {
	if err := m.ValidateBasic(); err != nil {
		return err
	}
	raw, err := MarshalMsg(m)
	if err != nil {
		return err
	}
	b.msgs = append(b.msgs, raw)
	return nil
}

// WithMemo attaches a memo.
func (b *Builder) WithMemo(memo string) *Builder { b.memo = memo; return b }

// WithTimeoutHeight makes the transaction expire.
func (b *Builder) WithTimeoutHeight(h int64) *Builder { b.timeoutHeight = h; return b }

// WithSequence sets the signer's nonce.
func (b *Builder) WithSequence(seq uint64) *Builder { b.sequence = seq; return b }

// WithFee sets the gas limit and price.
func (b *Builder) WithFee(gasLimit uint64, gasPrice *big.Int) error {
	a, err := types.NewAmount(gasPrice)
	if err != nil {
		return err
	}
	b.fee = Fee{GasLimit: gasLimit, GasPrice: a}
	return nil
}

// Sign produces the final signed transaction.
func (b *Builder) Sign(key *crypto.PrivKey) (Tx, error) {
	t := Tx{
		Body: Body{
			ChainID:       b.chainID,
			Msgs:          b.msgs,
			Memo:          b.memo,
			TimeoutHeight: b.timeoutHeight,
		},
		Auth: Auth{
			PubKey:   key.PubKey().Hex(),
			Sequence: b.sequence,
			Fee:      b.fee,
		},
	}
	signBytes, err := t.SignBytes()
	if err != nil {
		return Tx{}, err
	}
	sig, err := key.Sign(signBytes)
	if err != nil {
		return Tx{}, err
	}
	t.Signature = base64.StdEncoding.EncodeToString(sig)
	return t, nil
}
