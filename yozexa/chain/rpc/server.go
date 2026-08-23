// Package rpc serves the YOZEXA HTTP API.
//
// It is the interface every YOZEXA product uses: the wallet, the explorer, the
// indexer and the Pay service all read the chain through these endpoints and
// broadcast through /v1/tx. It is read-mostly and stateless — the chain is the
// source of truth, and nothing here can change consensus state except by
// submitting a signed transaction that the state machine then validates.
package rpc

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	cmtnode "github.com/cometbft/cometbft/node"
	rpccore "github.com/cometbft/cometbft/rpc/core"
	rpctypes "github.com/cometbft/cometbft/rpc/jsonrpc/types"
	cmttypes "github.com/cometbft/cometbft/types"

	"github.com/yozexa/yozexa/chain/app"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// Node is what the server needs from a running node.
type Node interface {
	App() *app.App
	CometNode() *cmtnode.Node
}

// Server is the YOZEXA HTTP API.
type Server struct {
	node Node
	addr string
	http *http.Server
	env  *rpccore.Environment
}

// New builds an API server.
func New(n Node, addr string) *Server {
	s := &Server{node: n, addr: addr}
	mux := http.NewServeMux()
	s.routes(mux)
	s.http = &http.Server{
		Addr:              addr,
		Handler:           withMiddleware(mux),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	return s
}

// Start serves until Stop is called.
func (s *Server) Start() error {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return err
	}
	if cn := s.node.CometNode(); cn != nil {
		env, err := cn.ConfigureRPC()
		if err != nil {
			return fmt.Errorf("configure consensus RPC: %w", err)
		}
		s.env = env
	}
	return s.http.Serve(ln)
}

// Stop shuts the server down.
func (s *Server) Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return s.http.Shutdown(ctx)
}

func withMiddleware(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The chain's read API is public data by design, so cross-origin
		// reads are allowed. No credentials are ever accepted here: there is
		// nothing to authenticate against, because every state change must
		// arrive as an already-signed transaction.
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func (s *Server) routes(mux *http.ServeMux) {
	mux.HandleFunc("/v1/status", s.handleStatus)
	mux.HandleFunc("/v1/supply", s.proxyQuery("supply"))
	mux.HandleFunc("/v1/supply/verify", s.proxyQuery("supply/verify"))
	mux.HandleFunc("/v1/params", s.proxyQuery("params"))
	mux.HandleFunc("/v1/feemarket", s.proxyQuery("feemarket"))
	mux.HandleFunc("/v1/emission", s.proxyQuery("emission"))
	mux.HandleFunc("/v1/invariants", s.proxyQuery("invariants"))
	mux.HandleFunc("/v1/validators", s.proxyQuery("validators"))
	mux.HandleFunc("/v1/vesting", s.proxyQuery("vesting"))
	mux.HandleFunc("/v1/proposals", s.proxyQuery("proposals"))

	mux.HandleFunc("/v1/account/", s.handleAccount)
	mux.HandleFunc("/v1/validator/", s.handlePathQuery("validator"))
	mux.HandleFunc("/v1/delegations/", s.handlePathQuery("delegations"))
	mux.HandleFunc("/v1/unbonding/", s.handlePathQuery("unbonding"))
	mux.HandleFunc("/v1/proposal/", s.handlePathQuery("proposal"))
	mux.HandleFunc("/v1/grants/", s.handlePathQuery("grants"))
	mux.HandleFunc("/v1/alias/", s.handlePathQuery("alias"))

	mux.HandleFunc("/v1/history/", s.handleHistory)

	mux.HandleFunc("/v1/tx", s.handleBroadcast)
	mux.HandleFunc("/v1/tx/", s.handleTxByHash)
	mux.HandleFunc("/v1/simulate", s.handleSimulate)
	mux.HandleFunc("/v1/blocks", s.handleBlocks)
	mux.HandleFunc("/v1/block/", s.handleBlock)
	mux.HandleFunc("/v1/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeError(w http.ResponseWriter, status int, format string, args ...any) {
	writeJSON(w, status, map[string]any{"error": fmt.Sprintf(format, args...)})
}

// query runs an ABCI query against the application.
func (s *Server) query(path string) (json.RawMessage, error) {
	resp, err := s.node.App().Query(context.Background(), &abci.RequestQuery{Path: path})
	if err != nil {
		return nil, err
	}
	if resp.Code != app.CodeOK {
		return nil, fmt.Errorf("%s", resp.Log)
	}
	return resp.Value, nil
}

func (s *Server) proxyQuery(path string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw, err := s.query(path)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "%v", err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write(raw)
	}
}

// handlePathQuery forwards /v1/{kind}/{id} to the matching ABCI query path.
// addressKeyedQueries are the path queries whose {id} is an account or
// validator address. Their input is checked before the query runs, so a
// malformed address answers "you sent something that is not an address" rather
// than "no such account" — a client cannot tell a typo from an empty account
// otherwise.
var addressKeyedQueries = map[string]bool{
	"validator": true, "delegations": true, "unbonding": true, "grants": true,
}

func (s *Server) handlePathQuery(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/v1/"+kind+"/")
		if id == "" || strings.Contains(id, "/") {
			writeError(w, http.StatusBadRequest, "expected /v1/%s/{id}", kind)
			return
		}
		if addressKeyedQueries[kind] {
			if _, err := types.ParseAnyAddress(id); err != nil {
				writeError(w, http.StatusBadRequest, "%v", err)
				return
			}
		}
		raw, err := s.query(kind + "/" + id)
		if err != nil {
			writeError(w, http.StatusNotFound, "%v", err)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write(raw)
	}
}

// handleAccount serves an account view, and its Merkle proof on request.
func (s *Server) handleAccount(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/v1/account/")
	if rest == "" {
		writeError(w, http.StatusBadRequest, "expected /v1/account/{address}")
		return
	}
	// A malformed address is a bad request, not a missing account. Answering
	// 404 for both tells a wallet that a mistyped address is simply an account
	// with no history, which is how a typo turns into a lost payment.
	if _, err := types.ParseAnyAddress(rest); err != nil {
		writeError(w, http.StatusBadRequest, "%v", err)
		return
	}
	path := "account/" + rest
	raw, err := s.query(path)
	if err != nil {
		writeError(w, http.StatusNotFound, "%v", err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(raw)
}

// BroadcastRequest carries a signed transaction.
type BroadcastRequest struct {
	// Tx is the signed transaction as canonical JSON.
	Tx json.RawMessage `json:"tx"`
	// Mode is "sync" (default, returns after mempool validation) or "commit"
	// (waits for the transaction to be included in a block).
	Mode string `json:"mode,omitempty"`
}

// BroadcastResponse reports what happened to a submitted transaction.
//
// Status is deliberately explicit about finality. A payment is not "done"
// because it was accepted by a mempool: the three states a wallet must be able
// to distinguish are pending, confirmed and finalized.
type BroadcastResponse struct {
	Hash   string `json:"hash"`
	Status string `json:"status"` // pending | confirmed | failed
	Code   uint32 `json:"code"`
	Log    string `json:"log,omitempty"`
	Height int64  `json:"height,omitempty"`
}

func (s *Server) handleBroadcast(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "POST a signed transaction to this endpoint")
		return
	}
	var req BroadcastRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, tx.MaxTxBytes+1024))
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: %v", err)
		return
	}
	if len(req.Tx) == 0 {
		writeError(w, http.StatusBadRequest, "missing signed transaction")
		return
	}

	// Decode and validate locally first so the caller gets a precise error
	// rather than a generic mempool rejection.
	parsed, err := tx.Decode(req.Tx)
	if err != nil {
		writeError(w, http.StatusBadRequest, "%v", err)
		return
	}
	if _, _, err := parsed.ValidateBasic(s.node.App().ChainID()); err != nil {
		writeError(w, http.StatusBadRequest, "%v", err)
		return
	}
	raw, err := parsed.Bytes()
	if err != nil {
		writeError(w, http.StatusBadRequest, "%v", err)
		return
	}
	hash := tx.HashBytes(raw)

	if s.env == nil {
		writeError(w, http.StatusServiceUnavailable, "this node is not connected to consensus")
		return
	}
	ctx := &rpctypes.Context{}

	if req.Mode == "commit" {
		res, err := s.env.BroadcastTxCommit(ctx, cmttypes.Tx(raw))
		if err != nil {
			writeError(w, http.StatusBadGateway, "%v", err)
			return
		}
		if res.CheckTx.Code != app.CodeOK {
			writeJSON(w, http.StatusBadRequest, BroadcastResponse{
				Hash: hash, Status: "failed", Code: res.CheckTx.Code, Log: res.CheckTx.Log,
			})
			return
		}
		status := "confirmed"
		if res.TxResult.Code != app.CodeOK {
			status = "failed"
		}
		writeJSON(w, http.StatusOK, BroadcastResponse{
			Hash: hash, Status: status,
			Code: res.TxResult.Code, Log: res.TxResult.Log, Height: res.Height,
		})
		return
	}

	res, err := s.env.BroadcastTxSync(ctx, cmttypes.Tx(raw))
	if err != nil {
		writeError(w, http.StatusBadGateway, "%v", err)
		return
	}
	if res.Code != app.CodeOK {
		writeJSON(w, http.StatusBadRequest, BroadcastResponse{
			Hash: hash, Status: "failed", Code: res.Code, Log: res.Log,
		})
		return
	}
	writeJSON(w, http.StatusAccepted, BroadcastResponse{Hash: hash, Status: "pending"})
}

// TxStatus is the finality-aware view of a transaction.
type TxStatus struct {
	Hash   string `json:"hash"`
	Status string `json:"status"` // pending | confirmed | finalized | failed | unknown
	Code   uint32 `json:"code"`
	Log    string `json:"log,omitempty"`
	Height int64  `json:"height,omitempty"`
	// Confirmations is how many blocks have been committed on top.
	Confirmations int64 `json:"confirmations"`
	// FinalizedExplanation states plainly what the status means, so a product
	// built on this API cannot accidentally present "included" as "settled".
	Explanation string          `json:"explanation"`
	GasUsed     int64           `json:"gas_used,omitempty"`
	Events      json.RawMessage `json:"events,omitempty"`
}

func (s *Server) handleTxByHash(w http.ResponseWriter, r *http.Request) {
	hash := strings.ToUpper(strings.TrimPrefix(r.URL.Path, "/v1/tx/"))
	if hash == "" {
		writeError(w, http.StatusBadRequest, "expected /v1/tx/{hash}")
		return
	}
	raw, err := hex.DecodeString(hash)
	if err != nil || len(raw) != 32 {
		writeError(w, http.StatusBadRequest, "a transaction hash is 32 bytes of hex")
		return
	}
	if s.env == nil {
		writeError(w, http.StatusServiceUnavailable, "this node is not connected to consensus")
		return
	}
	ctx := &rpctypes.Context{}
	res, err := s.env.Tx(ctx, raw, false)
	if err != nil {
		writeJSON(w, http.StatusNotFound, TxStatus{
			Hash: hash, Status: "unknown",
			Explanation: "This transaction has not been included in a block. It may still be in the mempool, or it may never have been broadcast.",
		})
		return
	}

	status := "confirmed"
	explanation := "Included in a committed block. CometBFT gives instant finality: once a block is committed by more than two thirds of voting power it cannot be reverted."
	if res.TxResult.Code != app.CodeOK {
		status = "failed"
		explanation = "Included in a block, but execution failed. The fee was charged; no other state changed."
	}

	var confirmations int64
	if cn := s.node.CometNode(); cn != nil {
		confirmations = cn.BlockStore().Height() - res.Height
	}
	if status == "confirmed" && confirmations >= 1 {
		status = "finalized"
	}

	events, _ := json.Marshal(res.TxResult.Events)
	writeJSON(w, http.StatusOK, TxStatus{
		Hash: hash, Status: status, Code: res.TxResult.Code, Log: res.TxResult.Log,
		Height: res.Height, Confirmations: confirmations,
		Explanation: explanation, GasUsed: res.TxResult.GasUsed, Events: events,
	})
}

// SimulateRequest asks the node what a transaction would do.
type SimulateRequest struct {
	Tx json.RawMessage `json:"tx"`
}

// SimulateResponse is what a wallet shows on its confirmation screen.
//
// Every field exists so that a user signs something they can read. Showing a
// hash and a button is not consent.
type SimulateResponse struct {
	Valid           bool     `json:"valid"`
	Error           string   `json:"error,omitempty"`
	ChainID         string   `json:"chain_id"`
	Signer          string   `json:"signer"`
	GasRequired     uint64   `json:"gas_required"`
	GasLimit        uint64   `json:"gas_limit"`
	BaseFee         string   `json:"base_fee"`
	GasPrice        string   `json:"gas_price"`
	MaxFee          string   `json:"max_fee"`
	MaxFeeYZXA      string   `json:"max_fee_yzxa"`
	EstimatedFee    string   `json:"estimated_fee"`
	EstimatedYZXA   string   `json:"estimated_fee_yzxa"`
	Effects         []Effect `json:"effects"`
	Warnings        []string `json:"warnings,omitempty"`
	SignerBalance   string   `json:"signer_balance"`
	SignerSpendable string   `json:"signer_spendable"`
}

// Effect is one human-readable consequence of a transaction.
type Effect struct {
	Kind        string `json:"kind"`
	Description string `json:"description"`
	From        string `json:"from,omitempty"`
	To          string `json:"to,omitempty"`
	Amount      string `json:"amount,omitempty"`
	AmountYZXA  string `json:"amount_yzxa,omitempty"`
	AmountYOZ   string `json:"amount_yoz,omitempty"`
}

func (s *Server) handleSimulate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "POST a transaction to simulate")
		return
	}
	var req SimulateRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, tx.MaxTxBytes+1024))
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: %v", err)
		return
	}
	resp, err := s.simulate(req.Tx)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, SimulateResponse{Valid: false, Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) simulate(raw json.RawMessage) (SimulateResponse, error) {
	application := s.node.App()
	t, err := tx.Decode(raw)
	if err != nil {
		return SimulateResponse{}, err
	}
	msgs, signer, err := t.ValidateBasic(application.ChainID())
	if err != nil {
		return SimulateResponse{}, err
	}
	gas, err := app.TxGas(t, len(raw), msgs)
	if err != nil {
		return SimulateResponse{}, err
	}

	application.Lock()
	st := application.State()
	baseFee, err := st.GetBaseFee()
	if err != nil {
		application.Unlock()
		return SimulateResponse{}, err
	}
	balance, err := st.Balance(signer)
	if err != nil {
		application.Unlock()
		return SimulateResponse{}, err
	}
	locked, err := st.LockedAmount(signer, time.Now().Unix())
	if err != nil {
		application.Unlock()
		return SimulateResponse{}, err
	}
	application.Unlock()

	spendable, err := types.Sub(balance, locked)
	if err != nil {
		spendable = types.Zero()
	}

	estimated := t.Auth.Fee.GasPrice.Int()
	estimated = estimated.Mul(estimated, new(big.Int).SetUint64(gas))
	maxFee := t.Auth.Fee.Total()

	resp := SimulateResponse{
		Valid:           true,
		ChainID:         t.Body.ChainID,
		Signer:          signer.String(),
		GasRequired:     gas,
		GasLimit:        t.Auth.Fee.GasLimit,
		BaseFee:         baseFee.String(),
		GasPrice:        t.Auth.Fee.GasPrice.String(),
		MaxFee:          maxFee.String(),
		MaxFeeYZXA:      types.FormatYZXA(maxFee),
		EstimatedFee:    estimated.String(),
		EstimatedYZXA:   types.FormatYZXA(estimated),
		SignerBalance:   balance.String(),
		SignerSpendable: spendable.String(),
	}

	if gas > t.Auth.Fee.GasLimit {
		resp.Warnings = append(resp.Warnings,
			fmt.Sprintf("The gas limit of %d is below the %d this transaction needs. It will fail and still be charged a fee.",
				t.Auth.Fee.GasLimit, gas))
	}
	if t.Auth.Fee.GasPrice.Int().Cmp(baseFee) < 0 {
		resp.Warnings = append(resp.Warnings,
			"The gas price is below the current base fee. This transaction will not be included until the base fee falls.")
	}

	for _, m := range msgs {
		resp.Effects = append(resp.Effects, describeMsg(m)...)
		resp.Warnings = append(resp.Warnings, warnAbout(m)...)
	}
	return resp, nil
}

// describeMsg renders a message as plain language for a signing screen.
func describeMsg(m tx.Msg) []Effect {
	switch t := m.(type) {
	case tx.MsgSend:
		return []Effect{{
			Kind:        "payment",
			Description: fmt.Sprintf("Send %s YZXA to %s", types.FormatYZXA(t.Amount.Int()), t.To),
			From:        t.From.String(), To: t.To.String(),
			Amount: t.Amount.String(), AmountYZXA: types.FormatYZXA(t.Amount.Int()),
			AmountYOZ: types.FormatYOZ(t.Amount.Int()),
		}}
	case tx.MsgMultiSend:
		out := make([]Effect, 0, len(t.Outputs))
		for _, o := range t.Outputs {
			out = append(out, Effect{
				Kind:        "payment",
				Description: fmt.Sprintf("Send %s YZXA to %s", types.FormatYZXA(o.Amount.Int()), o.To),
				From:        t.From.String(), To: o.To.String(),
				Amount: o.Amount.String(), AmountYZXA: types.FormatYZXA(o.Amount.Int()),
				AmountYOZ: types.FormatYOZ(o.Amount.Int()),
			})
		}
		return out
	case tx.MsgBurn:
		return []Effect{{
			Kind:        "burn",
			Description: fmt.Sprintf("Permanently destroy %s YZXA. This cannot be undone.", types.FormatYZXA(t.Amount.Int())),
			From:        t.From.String(), Amount: t.Amount.String(),
			AmountYZXA: types.FormatYZXA(t.Amount.Int()),
		}}
	case tx.MsgDelegate:
		return []Effect{{
			Kind: "stake",
			Description: fmt.Sprintf(
				"Stake %s YZXA with validator %s. Staked funds are locked while bonded and can be slashed if the validator misbehaves.",
				types.FormatYZXA(t.Amount.Int()), t.Validator.ValoperString()),
			From: t.Delegator.String(), To: t.Validator.ValoperString(),
			Amount: t.Amount.String(), AmountYZXA: types.FormatYZXA(t.Amount.Int()),
		}}
	case tx.MsgUndelegate:
		return []Effect{{
			Kind: "unstake",
			Description: fmt.Sprintf(
				"Begin unstaking %s YZXA from %s. The funds stay locked and slashable for the whole unbonding period.",
				types.FormatYZXA(t.Amount.Int()), t.Validator.ValoperString()),
			From: t.Delegator.String(), To: t.Validator.ValoperString(),
			Amount: t.Amount.String(), AmountYZXA: types.FormatYZXA(t.Amount.Int()),
		}}
	case tx.MsgGrant:
		desc := fmt.Sprintf(
			"Allow %s to spend from this account: at most %s YZXA in total",
			t.Grantee, types.FormatYZXA(t.Limit.Total.Int()))
		if t.Limit.PeriodSeconds > 0 {
			desc += fmt.Sprintf(", and at most %s YZXA per %d seconds",
				types.FormatYZXA(t.Limit.PerPeriod.Int()), t.Limit.PeriodSeconds)
		}
		desc += fmt.Sprintf(". The permission expires at %s and can be revoked at any time.",
			time.Unix(t.ExpiresAtUnix, 0).UTC().Format(time.RFC3339))
		return []Effect{{
			Kind: "permission", Description: desc,
			From: t.Granter.String(), To: t.Grantee.String(),
			Amount: t.Limit.Total.String(), AmountYZXA: types.FormatYZXA(t.Limit.Total.Int()),
		}}
	case tx.MsgRevoke:
		return []Effect{{
			Kind:        "permission",
			Description: fmt.Sprintf("Revoke the spending permission held by %s, immediately.", t.Grantee),
			From:        t.Granter.String(), To: t.Grantee.String(),
		}}
	case tx.MsgVote:
		return []Effect{{
			Kind:        "governance",
			Description: fmt.Sprintf("Vote %s on proposal %d with this account's bonded stake.", t.Option, t.ProposalID),
		}}
	case tx.MsgRegisterAlias:
		return []Effect{{
			Kind:        "identity",
			Description: fmt.Sprintf("Register the YOZEXA ID %q to this account.", t.Alias),
		}}
	default:
		return []Effect{{
			Kind:        m.Type(),
			Description: fmt.Sprintf("Execute %s.", m.Type()),
		}}
	}
}

// warnAbout surfaces the things a user should be told before signing.
func warnAbout(m tx.Msg) []string {
	switch t := m.(type) {
	case tx.MsgBurn:
		return []string{"Burning is permanent. The destroyed YZXA cannot be recovered by anyone, including the network."}
	case tx.MsgGrant:
		var out []string
		if len(t.AllowedRecipients) == 0 {
			out = append(out, "This permission does not restrict who the holder may pay. Consider naming allowed recipients.")
		}
		if t.Limit.PeriodSeconds == 0 {
			out = append(out, "This permission has no per-period rate limit, only a lifetime total.")
		}
		return out
	case tx.MsgUndelegate:
		return []string{"Unstaked funds remain locked and slashable until the unbonding period completes."}
	default:
		return nil
	}
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	application := s.node.App()
	application.Lock()
	chainID := application.ChainID()
	application.Unlock()

	supplyRaw, _ := s.query("supply")
	var supply map[string]any
	_ = json.Unmarshal(supplyRaw, &supply)

	status := map[string]any{
		"chain_id":     chainID,
		"node_version": app.Version,
		"app_version":  app.AppVersion,
		"supply":       supply,
	}
	if cn := s.node.CometNode(); cn != nil {
		bs := cn.BlockStore()
		status["height"] = bs.Height()
		if block := bs.LoadBlock(bs.Height()); block != nil {
			status["latest_block_time"] = block.Time.UTC().Format(time.RFC3339)
			status["latest_block_hash"] = strings.ToUpper(hex.EncodeToString(block.Hash()))
		}
		status["catching_up"] = cn.ConsensusReactor().WaitSync()
		status["node_id"] = string(cn.NodeInfo().ID())
	}
	// Networks that are not mainnet say so, loudly, in every status response.
	if !strings.EqualFold(chainID, "yozexa-1") {
		status["network_warning"] = "This is not YOZEXA mainnet. Tokens on this network have NO REAL VALUE."
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleBlocks(w http.ResponseWriter, r *http.Request) {
	cn := s.node.CometNode()
	if cn == nil {
		writeError(w, http.StatusServiceUnavailable, "this node is not connected to consensus")
		return
	}
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	bs := cn.BlockStore()
	height := bs.Height()
	if v := r.URL.Query().Get("before"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			height = n - 1
		}
	}
	out := make([]map[string]any, 0, limit)
	for h := height; h > 0 && len(out) < limit; h-- {
		block := bs.LoadBlock(h)
		if block == nil {
			continue
		}
		out = append(out, blockSummary(block))
	}
	writeJSON(w, http.StatusOK, map[string]any{"blocks": out, "latest_height": bs.Height()})
}

func (s *Server) handleBlock(w http.ResponseWriter, r *http.Request) {
	cn := s.node.CometNode()
	if cn == nil {
		writeError(w, http.StatusServiceUnavailable, "this node is not connected to consensus")
		return
	}
	raw := strings.TrimPrefix(r.URL.Path, "/v1/block/")
	h, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "expected /v1/block/{height}")
		return
	}
	block := cn.BlockStore().LoadBlock(h)
	if block == nil {
		writeError(w, http.StatusNotFound, "block %d not found on this node", h)
		return
	}
	summary := blockSummary(block)
	txs := make([]map[string]any, 0, len(block.Txs))
	for _, raw := range block.Txs {
		entry := map[string]any{"hash": tx.HashBytes(raw)}
		if parsed, err := tx.Decode(raw); err == nil {
			if msgs, signer, err := parsed.ValidateBasic(""); err == nil {
				kinds := make([]string, 0, len(msgs))
				for _, m := range msgs {
					kinds = append(kinds, m.Type())
				}
				entry["signer"] = signer.String()
				entry["messages"] = kinds
				entry["memo"] = parsed.Body.Memo
				entry["fee_max"] = parsed.Auth.Fee.Total().String()
			}
		}
		txs = append(txs, entry)
	}
	summary["transactions"] = txs
	writeJSON(w, http.StatusOK, summary)
}

func blockSummary(block *cmttypes.Block) map[string]any {
	return map[string]any{
		"height":            block.Height,
		"time":              block.Time.UTC().Format(time.RFC3339),
		"hash":              strings.ToUpper(hex.EncodeToString(block.Hash())),
		"proposer":          strings.ToUpper(hex.EncodeToString(block.ProposerAddress)),
		"transaction_count": len(block.Txs),
		"app_hash":          strings.ToUpper(hex.EncodeToString(block.AppHash)),
	}
}

// --- account history ----------------------------------------------------

// HistoryEntry is one transaction in an account's history.
//
// It carries the raw events rather than an interpreted summary: what a
// transfer "means" depends on which side the reader is on, and the node has no
// business deciding that for them.
type HistoryEntry struct {
	Hash    string          `json:"hash"`
	Height  int64           `json:"height"`
	Time    string          `json:"time"`
	Code    uint32          `json:"code"`
	Log     string          `json:"log,omitempty"`
	GasUsed int64           `json:"gas_used"`
	Memo    string          `json:"memo,omitempty"`
	Events  json.RawMessage `json:"events"`
	Failed  bool            `json:"failed"`
}

// HistoryResponse is a page of an account's history, newest first.
type HistoryResponse struct {
	Address  string         `json:"address"`
	Entries  []HistoryEntry `json:"entries"`
	Total    int            `json:"total"`
	Page     int            `json:"page"`
	PerPage  int            `json:"per_page"`
	Complete bool           `json:"complete"`
	Note     string         `json:"note,omitempty"`
}

// handleHistory returns the transactions that touched an account, newest
// first.
//
// This is served from CometBFT's transaction index, not by walking blocks: a
// wallet needs an account's whole history, and scanning blocks reaches about a
// minute into the past per hundred requests on a one-second chain.
//
// The index is a node-local convenience, not consensus state. A node started
// with `indexer = "null"`, or one that replayed a chain whose transactions
// predate the index, answers honestly rather than returning a short list as if
// it were complete.
func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimPrefix(r.URL.Path, "/v1/history/")
	if raw == "" {
		writeError(w, http.StatusBadRequest, "expected /v1/history/{address}")
		return
	}
	addr, err := types.ParseAnyAddress(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, "%v", err)
		return
	}
	if s.env == nil {
		writeError(w, http.StatusServiceUnavailable, "this node is not connected to consensus")
		return
	}

	perPage := 25
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			perPage = n
		}
	}
	page := 1
	if v := r.URL.Query().Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}

	// Both forms of the address are searched: an operator's own transactions
	// are indexed under whichever form the message named.
	queries := []string{
		fmt.Sprintf("account.address='%s'", addr.String()),
		fmt.Sprintf("account.address='%s'", addr.ValoperString()),
	}

	ctx := &rpctypes.Context{}
	seen := map[string]bool{}
	entries := make([]HistoryEntry, 0, perPage)
	total := 0
	for _, q := range queries {
		res, err := s.env.TxSearch(ctx, q, false, &page, &perPage, "desc")
		if err != nil {
			// An unindexed node is a configuration fact, not a server fault:
			// say so plainly so a client can fall back to scanning blocks.
			writeJSON(w, http.StatusOK, HistoryResponse{
				Address: addr.String(), Entries: []HistoryEntry{}, Complete: false,
				Note: "This node does not index transactions by account, so it cannot serve history. Ask the operator to set indexer = \"kv\", or read history from an explorer.",
			})
			return
		}
		total += res.TotalCount
		for _, tx := range res.Txs {
			hash := strings.ToUpper(hex.EncodeToString(tx.Hash))
			if seen[hash] {
				continue
			}
			seen[hash] = true
			events, _ := json.Marshal(tx.TxResult.Events)
			entries = append(entries, HistoryEntry{
				Hash:    hash,
				Height:  tx.Height,
				Time:    s.blockTime(tx.Height),
				Code:    tx.TxResult.Code,
				Log:     tx.TxResult.Log,
				GasUsed: tx.TxResult.GasUsed,
				Memo:    memoOf(tx.Tx),
				Events:  events,
				Failed:  tx.TxResult.Code != app.CodeOK,
			})
		}
	}

	// Two searches are merged, so re-sort: newest first, and stable within a
	// block by hash so the order does not wobble between calls.
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Height != entries[j].Height {
			return entries[i].Height > entries[j].Height
		}
		return entries[i].Hash < entries[j].Hash
	})
	if len(entries) > perPage {
		entries = entries[:perPage]
	}

	writeJSON(w, http.StatusOK, HistoryResponse{
		Address:  addr.String(),
		Entries:  entries,
		Total:    total,
		Page:     page,
		PerPage:  perPage,
		Complete: true,
	})
}

// blockTime returns a block's timestamp, or "" when the block store no longer
// holds it (a pruned node). An empty string is better than a fabricated time.
func (s *Server) blockTime(height int64) string {
	cn := s.node.CometNode()
	if cn == nil {
		return ""
	}
	meta := cn.BlockStore().LoadBlockMeta(height)
	if meta == nil {
		return ""
	}
	return meta.Header.Time.UTC().Format(time.RFC3339)
}

// memoOf pulls the memo out of an encoded transaction. A transaction the node
// cannot decode is still listed — it was in a block — just without its memo.
func memoOf(raw cmttypes.Tx) string {
	var t tx.Tx
	if err := json.Unmarshal(raw, &t); err != nil {
		return ""
	}
	return t.Body.Memo
}
