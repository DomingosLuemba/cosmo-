package app_test

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"testing"
	"time"

	dbm "github.com/cometbft/cometbft-db"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/libs/log"

	"github.com/yozexa/yozexa/chain/app"
	"github.com/yozexa/yozexa/chain/crypto"
	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// harness drives a real YOZEXA state machine through real blocks. Nothing here
// is mocked: it is the same App a node runs, exercised through the same ABCI
// calls CometBFT makes.
type harness struct {
	t       *testing.T
	app     *app.App
	chainID string
	height  int64
	now     time.Time
	genesis app.Genesis

	valConsPub  string
	valConsAddr types.Address
}

type account struct {
	key  *crypto.PrivKey
	addr types.Address
	seq  uint64
}

func newAccount(t *testing.T) *account {
	t.Helper()
	k, err := crypto.GeneratePrivKey()
	if err != nil {
		t.Fatalf("key: %v", err)
	}
	return &account{key: k, addr: k.Address()}
}

func newConsensusKey(t *testing.T, seed byte) (string, types.Address) {
	t.Helper()
	seedBytes := make([]byte, ed25519.SeedSize)
	seedBytes[0] = seed
	priv := ed25519.NewKeyFromSeed(seedBytes)
	pub := priv.Public().(ed25519.PublicKey)
	b64 := base64.StdEncoding.EncodeToString(pub)
	addr, err := state.ConsAddressFromPubKey(b64)
	if err != nil {
		t.Fatalf("cons addr: %v", err)
	}
	return b64, addr
}

// newHarness starts a chain with one validator and the given funded accounts.
func newHarness(t *testing.T, validator *account, funded map[*account]int64, opts ...func(*app.Genesis)) *harness {
	t.Helper()
	db := dbm.NewMemDB()
	a, err := app.New(db, log.NewNopLogger(), app.Options{})
	if err != nil {
		t.Fatalf("new app: %v", err)
	}

	genesisTime := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	consPub, consAddr := newConsensusKey(t, 1)

	accounts := []app.GenesisAccount{
		{Address: validator.addr, Balance: types.MustAmount(types.YZXA(1_000)), Label: "validator-0"},
	}
	for acc, amount := range funded {
		accounts = append(accounts, app.GenesisAccount{
			Address: acc.addr,
			Balance: types.MustAmount(types.YZXA(amount)),
		})
	}

	g := app.Genesis{
		ChainID:     "yozexa-test-1",
		GenesisTime: genesisTime,
		Params:      state.DefaultParams(),
		Accounts:    accounts,
		Validators: []app.GenesisValidator{{
			Operator:          validator.addr,
			ConsensusPubKey:   consPub,
			Moniker:           "validator-0",
			SelfDelegation:    types.MustAmount(types.YZXA(500)),
			CommissionBps:     1_000,
			MaxCommissionBps:  2_000,
			MinSelfDelegation: types.MustAmount(types.YZXA(1)),
		}},
		FundAllocations: true,
	}
	for _, o := range opts {
		o(&g)
	}

	appState, err := json.Marshal(g)
	if err != nil {
		t.Fatalf("marshal genesis: %v", err)
	}
	if _, err := a.InitChain(context.Background(), &abci.RequestInitChain{
		ChainId:       g.ChainID,
		Time:          genesisTime,
		AppStateBytes: appState,
	}); err != nil {
		t.Fatalf("init chain: %v", err)
	}

	return &harness{
		t: t, app: a, chainID: g.ChainID,
		height: 0, now: genesisTime, genesis: g,
		valConsPub: consPub, valConsAddr: consAddr,
	}
}

// commitBlock runs one block containing the given transactions and returns the
// per-transaction results.
func (h *harness) commitBlock(txs ...[]byte) []*abci.ExecTxResult {
	h.t.Helper()
	h.height++
	h.now = h.now.Add(3 * time.Second)

	res, err := h.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{
		Height: h.height,
		Time:   h.now,
		Txs:    txs,
		DecidedLastCommit: abci.CommitInfo{
			Votes: []abci.VoteInfo{{
				Validator:   abci.Validator{Address: h.valConsAddr.Bytes(), Power: 500},
				BlockIdFlag: 2, // commit
			}},
		},
	})
	if err != nil {
		h.t.Fatalf("finalize block %d: %v", h.height, err)
	}
	if _, err := h.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		h.t.Fatalf("commit block %d: %v", h.height, err)
	}
	return res.TxResults
}

// tryBlock runs one empty block and returns the error instead of failing the
// test. Used where the block is *expected* to fail — a node halting at an
// upgrade height it does not implement, for instance.
func (h *harness) tryBlock() error {
	h.t.Helper()
	h.height++
	h.now = h.now.Add(3 * time.Second)
	if _, err := h.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{
		Height: h.height,
		Time:   h.now,
		DecidedLastCommit: abci.CommitInfo{
			Votes: []abci.VoteInfo{{
				Validator:   abci.Validator{Address: h.valConsAddr.Bytes(), Power: 500},
				BlockIdFlag: 2,
			}},
		},
	}); err != nil {
		return err
	}
	_, err := h.app.Commit(context.Background(), &abci.RequestCommit{})
	return err
}

// advance moves the chain forward by n blocks with no transactions.
func (h *harness) advance(n int) {
	h.t.Helper()
	for i := 0; i < n; i++ {
		h.commitBlock()
	}
}

// advanceTime jumps the clock forward and produces one block, used to test
// time-dependent logic such as unbonding and vesting.
func (h *harness) advanceTime(d time.Duration) {
	h.t.Helper()
	h.height++
	h.now = h.now.Add(d)
	if _, err := h.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{
		Height: h.height,
		Time:   h.now,
		DecidedLastCommit: abci.CommitInfo{
			Votes: []abci.VoteInfo{{
				Validator:   abci.Validator{Address: h.valConsAddr.Bytes(), Power: 500},
				BlockIdFlag: 2,
			}},
		},
	}); err != nil {
		h.t.Fatalf("finalize block: %v", err)
	}
	if _, err := h.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		h.t.Fatalf("commit: %v", err)
	}
}

// sign builds and signs a transaction from the account, advancing its nonce.
func (h *harness) sign(acc *account, msgs ...tx.Msg) []byte {
	h.t.Helper()
	b := tx.NewBuilder(h.chainID)
	for _, m := range msgs {
		if err := b.AddMsg(m); err != nil {
			h.t.Fatalf("add msg: %v", err)
		}
	}
	baseFee, err := h.app.State().GetBaseFee()
	if err != nil {
		h.t.Fatalf("base fee: %v", err)
	}
	if err := b.WithFee(2_000_000, baseFee); err != nil {
		h.t.Fatalf("fee: %v", err)
	}
	b.WithSequence(acc.seq)
	acc.seq++

	signed, err := b.Sign(acc.key)
	if err != nil {
		h.t.Fatalf("sign: %v", err)
	}
	raw, err := signed.Bytes()
	if err != nil {
		h.t.Fatalf("encode: %v", err)
	}
	return raw
}

func (h *harness) balance(a types.Address) *big.Int {
	h.t.Helper()
	v, err := h.app.State().Balance(a)
	if err != nil {
		h.t.Fatalf("balance: %v", err)
	}
	return v
}

func (h *harness) supply() state.Supply {
	h.t.Helper()
	s, err := h.app.State().Supply()
	if err != nil {
		h.t.Fatalf("supply: %v", err)
	}
	return s
}

func (h *harness) requireOK(results []*abci.ExecTxResult) {
	h.t.Helper()
	for i, r := range results {
		if r.Code != app.CodeOK {
			h.t.Fatalf("transaction %d failed with code %d: %s", i, r.Code, r.Log)
		}
	}
}

func (h *harness) requireFailed(results []*abci.ExecTxResult) {
	h.t.Helper()
	for i, r := range results {
		if r.Code == app.CodeOK {
			h.t.Fatalf("transaction %d unexpectedly succeeded", i)
		}
	}
}

func (h *harness) checkInvariants() {
	h.t.Helper()
	results, err := h.app.RunInvariants(h.now.Unix())
	if err != nil {
		h.t.Fatalf("run invariants: %v", err)
	}
	for _, r := range results {
		if !r.OK {
			h.t.Fatalf("invariant %q violated: %s", r.Name, r.Message)
		}
	}
}
