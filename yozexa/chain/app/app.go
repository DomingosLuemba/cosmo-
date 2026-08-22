// Package app is the YOZEXA state machine: the deterministic program that
// CometBFT drives to produce the chain.
//
// CometBFT provides consensus, networking, the block store and evidence
// handling. This package provides everything above it: accounts, the currency,
// staking, slashing, emission, governance and the rules that make the supply
// cap unbreakable.
package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"sync"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/libs/log"
	cmtcrypto "github.com/cometbft/cometbft/proto/tendermint/crypto"

	dbm "github.com/cometbft/cometbft-db"

	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/store"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// Result codes returned to CometBFT. Zero means success; every other value is
// a distinct, documented failure so that a wallet can tell a user *why* a
// payment did not go through.
const (
	CodeOK uint32 = iota
	CodeDecodeError
	CodeInvalidSignature
	CodeWrongSequence
	CodeInsufficientFunds
	CodeInsufficientFee
	CodeExecutionFailed
	CodeUnauthorized
	CodeTimeout
	CodeInternal
)

// App is the YOZEXA application.
type App struct {
	abci.BaseApplication

	mu sync.Mutex

	db      dbm.DB
	kv      *store.Store
	state   *state.State
	logger  log.Logger
	chainID string

	// genesis is retained so that vesting schedules can be anchored to the
	// genesis time and so the CLI can report the network's founding config.
	genesisTime time.Time

	// blockGasUsed accumulates the gas of the block being executed.
	blockGasUsed uint64
	// blockFees accumulates the tips collected in the block being executed.
	blockFees *big.Int
	// blockBurned accumulates the base fee burned in the block.
	blockBurned *big.Int

	// invariantsEveryBlock makes the app check every invariant at the end of
	// every block. It is on by default: on a network that settles money, a
	// silent accounting error is far worse than a halt.
	invariantsEveryBlock bool
}

// Options configure an App.
type Options struct {
	// SkipInvariantChecks disables the per-block invariant sweep. It exists
	// for load testing only and must never be set on a network carrying
	// value.
	SkipInvariantChecks bool
}

// New opens (or creates) the application state in db.
func New(db dbm.DB, logger log.Logger, opts Options) (*App, error) {
	kv, err := store.Open(db)
	if err != nil {
		return nil, fmt.Errorf("open state: %w", err)
	}
	a := &App{
		db:                   db,
		kv:                   kv,
		state:                state.New(kv),
		logger:               logger,
		blockFees:            big.NewInt(0),
		blockBurned:          big.NewInt(0),
		invariantsEveryBlock: !opts.SkipInvariantChecks,
	}
	// Restore chain metadata if the store already holds a genesis.
	if raw, err := kv.Get([]byte("chain/meta")); err == nil {
		var meta chainMeta
		if err := json.Unmarshal(raw, &meta); err == nil {
			a.chainID = meta.ChainID
			a.genesisTime = time.Unix(meta.GenesisTimeUnix, 0).UTC()
		}
	}
	return a, nil
}

type chainMeta struct {
	ChainID         string `json:"chain_id"`
	GenesisTimeUnix int64  `json:"genesis_time_unix"`
}

// State exposes the state for read-only tooling (RPC, CLI queries).
func (a *App) State() *state.State { return a.state }

// ChainID returns the network this node is running.
func (a *App) ChainID() string { return a.chainID }

// GenesisTime returns the network's genesis time.
func (a *App) GenesisTime() time.Time { return a.genesisTime }

// Lock/Unlock guard state access from the RPC layer, which reads the same
// store the consensus thread writes.
func (a *App) Lock()   { a.mu.Lock() }
func (a *App) Unlock() { a.mu.Unlock() }

// Info tells CometBFT where the application is, so it can replay any blocks
// the app has not yet seen after a crash.
func (a *App) Info(_ context.Context, _ *abci.RequestInfo) (*abci.ResponseInfo, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	return &abci.ResponseInfo{
		Data:             "yozexa",
		Version:          Version,
		AppVersion:       AppVersion,
		LastBlockHeight:  a.kv.Version(),
		LastBlockAppHash: a.kv.Root(),
	}, nil
}

// InitChain applies genesis.
func (a *App) InitChain(_ context.Context, req *abci.RequestInitChain) (*abci.ResponseInitChain, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	var g Genesis
	if len(req.AppStateBytes) > 0 {
		if err := json.Unmarshal(req.AppStateBytes, &g); err != nil {
			return nil, fmt.Errorf("decode genesis app state: %w", err)
		}
	} else {
		return nil, fmt.Errorf("genesis app_state is empty: a YOZEXA network cannot start without an explicit allocation")
	}
	if g.ChainID == "" {
		g.ChainID = req.ChainId
	}
	if g.ChainID != req.ChainId {
		return nil, fmt.Errorf("genesis chain_id %q does not match CometBFT chain_id %q", g.ChainID, req.ChainId)
	}
	if g.GenesisTime.IsZero() {
		g.GenesisTime = req.Time.UTC()
	}
	if err := g.Validate(); err != nil {
		return nil, fmt.Errorf("invalid genesis: %w", err)
	}

	if err := a.applyGenesis(g); err != nil {
		return nil, fmt.Errorf("apply genesis: %w", err)
	}

	p, err := a.state.Params()
	if err != nil {
		return nil, err
	}
	set, err := a.state.ActiveSet(p.MaxValidators)
	if err != nil {
		return nil, err
	}
	updates, err := validatorUpdates(nil, set)
	if err != nil {
		return nil, err
	}

	// The genesis state is committed at height 0 so that the app hash in the
	// first block header describes a state that actually exists.
	root, err := a.kv.Commit(0)
	if err != nil {
		return nil, fmt.Errorf("commit genesis: %w", err)
	}
	a.logger.Info("YOZEXA genesis applied",
		"chain_id", g.ChainID,
		"validators", len(set),
		"app_hash", fmt.Sprintf("%X", root))

	return &abci.ResponseInitChain{
		Validators: updates,
		AppHash:    root,
	}, nil
}

// CheckTx is the mempool gate. It authenticates the transaction and confirms
// the sender can pay the fee, without executing it.
//
// It deliberately runs against committed state, not against a speculative
// view: a transaction that passes CheckTx may still fail in a block, and the
// wallet is told so rather than being promised a result the chain has not
// reached.
func (a *App) CheckTx(_ context.Context, req *abci.RequestCheckTx) (*abci.ResponseCheckTx, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	t, err := tx.Decode(req.Tx)
	if err != nil {
		return &abci.ResponseCheckTx{Code: CodeDecodeError, Log: err.Error()}, nil
	}
	msgs, signer, err := t.ValidateBasic(a.chainID)
	if err != nil {
		return &abci.ResponseCheckTx{Code: CodeInvalidSignature, Log: err.Error()}, nil
	}

	acc, err := a.state.GetAccount(signer)
	if err != nil {
		return &abci.ResponseCheckTx{Code: CodeInternal, Log: err.Error()}, nil
	}
	// The mempool accepts the next sequence and a small window above it, so a
	// wallet can queue a few payments without waiting a block between each.
	if t.Auth.Sequence < acc.Sequence {
		return &abci.ResponseCheckTx{
			Code: CodeWrongSequence,
			Log:  fmt.Sprintf("sequence %d already used; account is at %d", t.Auth.Sequence, acc.Sequence),
		}, nil
	}
	if t.Auth.Sequence > acc.Sequence+mempoolSequenceWindow {
		return &abci.ResponseCheckTx{
			Code: CodeWrongSequence,
			Log:  fmt.Sprintf("sequence %d is too far ahead of %d", t.Auth.Sequence, acc.Sequence),
		}, nil
	}

	gas, err := TxGas(t, len(req.Tx), msgs)
	if err != nil {
		return &abci.ResponseCheckTx{Code: CodeExecutionFailed, Log: err.Error()}, nil
	}
	if gas > t.Auth.Fee.GasLimit {
		return &abci.ResponseCheckTx{
			Code: CodeInsufficientFee,
			Log:  fmt.Sprintf("gas limit %d is below the required %d", t.Auth.Fee.GasLimit, gas),
		}, nil
	}
	baseFee, err := a.state.GetBaseFee()
	if err != nil {
		return &abci.ResponseCheckTx{Code: CodeInternal, Log: err.Error()}, nil
	}
	if t.Auth.Fee.GasPrice.Int().Cmp(baseFee) < 0 {
		return &abci.ResponseCheckTx{
			Code: CodeInsufficientFee,
			Log: fmt.Sprintf("gas price %s is below the current base fee %s",
				t.Auth.Fee.GasPrice, baseFee),
		}, nil
	}
	maxFee := t.Auth.Fee.Total()
	balance, err := a.state.Balance(signer)
	if err != nil {
		return &abci.ResponseCheckTx{Code: CodeInternal, Log: err.Error()}, nil
	}
	if balance.Cmp(maxFee) < 0 {
		return &abci.ResponseCheckTx{
			Code: CodeInsufficientFunds,
			Log: fmt.Sprintf("balance %s cannot cover the maximum fee %s",
				types.FormatYZXA(balance), types.FormatYZXA(maxFee)),
		}, nil
	}

	return &abci.ResponseCheckTx{Code: CodeOK, GasWanted: int64(t.Auth.Fee.GasLimit)}, nil
}

// mempoolSequenceWindow is how many sequence numbers ahead of an account's
// current nonce the mempool will hold.
const mempoolSequenceWindow = 32

// FinalizeBlock executes a block: begin-block work, every transaction, then
// end-block work, and returns the results plus the validator set changes.
func (a *App) FinalizeBlock(_ context.Context, req *abci.RequestFinalizeBlock) (*abci.ResponseFinalizeBlock, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	now := req.Time.UTC().Unix()
	a.blockGasUsed = 0
	a.blockFees = big.NewInt(0)
	a.blockBurned = big.NewInt(0)

	p, err := a.state.Params()
	if err != nil {
		return nil, err
	}
	previousSet, err := a.state.ActiveSet(p.MaxValidators)
	if err != nil {
		return nil, err
	}

	if err := a.beginBlock(req, now, p); err != nil {
		return nil, fmt.Errorf("begin block %d: %w", req.Height, err)
	}

	results := make([]*abci.ExecTxResult, 0, len(req.Txs))
	for _, raw := range req.Txs {
		results = append(results, a.execTx(raw, req.Height, now, p))
	}

	events, err := a.endBlock(req.Height, now, p)
	if err != nil {
		return nil, fmt.Errorf("end block %d: %w", req.Height, err)
	}

	// Re-read params: governance may have changed them in this very block.
	p, err = a.state.Params()
	if err != nil {
		return nil, err
	}
	nextSet, err := a.state.ActiveSet(p.MaxValidators)
	if err != nil {
		return nil, err
	}
	updates, err := validatorUpdates(previousSet, nextSet)
	if err != nil {
		return nil, err
	}

	// Record the block time so read-only queries can evaluate time-dependent
	// views (vesting, grant expiry) against the chain's own clock rather than
	// the machine's.
	if err := a.kv.Set([]byte("chain/last_block_time"), []byte(fmt.Sprintf("%d", now))); err != nil {
		return nil, err
	}

	if a.invariantsEveryBlock {
		if err := a.CheckInvariants(now); err != nil {
			// A broken invariant means the ledger no longer adds up. Halting
			// is the correct response: continuing would settle payments
			// against state that is known to be wrong.
			return nil, fmt.Errorf("INVARIANT VIOLATION at height %d: %w", req.Height, err)
		}
	}

	// The app hash MUST be returned here, not from Commit. CometBFT puts it
	// into the next block's header, and on restart it replays the last block
	// and checks that the application reproduces the same hash. Returning nil
	// makes a node fail its own replay check and refuse to start.
	appHash, err := a.kv.WorkingRoot()
	if err != nil {
		return nil, fmt.Errorf("compute app hash for height %d: %w", req.Height, err)
	}

	return &abci.ResponseFinalizeBlock{
		TxResults:        results,
		ValidatorUpdates: updates,
		Events:           events,
		AppHash:          appHash,
	}, nil
}

// Commit makes the block that FinalizeBlock executed durable.
//
// The hash was already returned from FinalizeBlock; this writes the state that
// produced it, atomically, in a single database batch.
func (a *App) Commit(_ context.Context, _ *abci.RequestCommit) (*abci.ResponseCommit, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, err := a.kv.Commit(a.kv.Version() + 1); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return &abci.ResponseCommit{}, nil
}

// PrepareProposal selects transactions for a block this node is proposing.
//
// It enforces the block gas ceiling here rather than only at execution, so a
// proposer cannot build a block that every other node will reject.
func (a *App) PrepareProposal(_ context.Context, req *abci.RequestPrepareProposal) (*abci.ResponsePrepareProposal, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	p, err := a.state.Params()
	if err != nil {
		return nil, err
	}
	var (
		selected [][]byte
		gas      uint64
		bytes    int64
	)
	for _, raw := range req.Txs {
		t, err := tx.Decode(raw)
		if err != nil {
			continue
		}
		msgs, _, err := t.ValidateBasic(a.chainID)
		if err != nil {
			continue
		}
		g, err := TxGas(t, len(raw), msgs)
		if err != nil || g > t.Auth.Fee.GasLimit {
			continue
		}
		if gas+t.Auth.Fee.GasLimit > p.MaxBlockGas {
			continue
		}
		if bytes+int64(len(raw)) > req.MaxTxBytes {
			break
		}
		selected = append(selected, raw)
		gas += t.Auth.Fee.GasLimit
		bytes += int64(len(raw))
	}
	return &abci.ResponsePrepareProposal{Txs: selected}, nil
}

// ProcessProposal validates a proposal from another node before voting on it.
func (a *App) ProcessProposal(_ context.Context, req *abci.RequestProcessProposal) (*abci.ResponseProcessProposal, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	p, err := a.state.Params()
	if err != nil {
		return nil, err
	}
	var gas uint64
	for _, raw := range req.Txs {
		t, err := tx.Decode(raw)
		if err != nil {
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, nil
		}
		if _, _, err := t.ValidateBasic(a.chainID); err != nil {
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, nil
		}
		gas += t.Auth.Fee.GasLimit
		if gas > p.MaxBlockGas {
			return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_REJECT}, nil
		}
	}
	return &abci.ResponseProcessProposal{Status: abci.ResponseProcessProposal_ACCEPT}, nil
}

// validatorUpdates diffs two validator sets into the update list CometBFT
// expects: entries with power 0 remove a validator.
func validatorUpdates(previous, next []state.Validator) ([]abci.ValidatorUpdate, error) {
	powerOf := func(v state.Validator) int64 {
		// CometBFT voting power is an int64. One unit of power is one whole
		// YZXA, so a validator's power is its bonded stake divided by 10^18.
		// Below one YZXA a validator has no power, which is also the network's
		// minimum self-delegation.
		p := new(big.Int).Quo(v.Tokens.Int(), types.OneYZXA())
		if !p.IsInt64() {
			// Impossible under the 10M cap, but never truncate power silently.
			return 0
		}
		return p.Int64()
	}

	prev := map[string]int64{}
	prevKey := map[string]string{}
	for _, v := range previous {
		prev[v.Operator.Hex()] = powerOf(v)
		prevKey[v.Operator.Hex()] = v.ConsensusPubKey
	}

	var updates []abci.ValidatorUpdate
	seen := map[string]bool{}
	for _, v := range next {
		seen[v.Operator.Hex()] = true
		power := powerOf(v)
		if power == 0 {
			continue
		}
		if old, ok := prev[v.Operator.Hex()]; ok && old == power {
			continue
		}
		u, err := validatorUpdate(v.ConsensusPubKey, power)
		if err != nil {
			return nil, err
		}
		updates = append(updates, u)
	}
	for _, v := range previous {
		if seen[v.Operator.Hex()] {
			continue
		}
		u, err := validatorUpdate(v.ConsensusPubKey, 0)
		if err != nil {
			return nil, err
		}
		updates = append(updates, u)
	}
	return updates, nil
}

func validatorUpdate(consPubKeyB64 string, power int64) (abci.ValidatorUpdate, error) {
	raw, err := base64Decode(consPubKeyB64)
	if err != nil {
		return abci.ValidatorUpdate{}, err
	}
	return abci.ValidatorUpdate{
		PubKey: cmtcrypto.PublicKey{Sum: &cmtcrypto.PublicKey_Ed25519{Ed25519: raw}},
		Power:  power,
	}, nil
}

func base64Decode(s string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 consensus key: %w", err)
	}
	if len(raw) != 32 {
		return nil, fmt.Errorf("ed25519 consensus key must be 32 bytes, got %d", len(raw))
	}
	return raw, nil
}
