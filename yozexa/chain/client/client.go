// Package client talks to a YOZEXA node over the HTTP API.
//
// It is the same client the CLI, the faucet and the Go SDK use. Everything it
// sends is a transaction the caller has already signed: the client never sees
// or handles a private key.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/yozexa/yozexa/chain/crypto"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// Client is a YOZEXA API client.
type Client struct {
	baseURL string
	http    *http.Client
}

// New builds a client for a node API endpoint.
func New(baseURL string) *Client {
	if !strings.HasPrefix(baseURL, "http://") && !strings.HasPrefix(baseURL, "https://") {
		baseURL = "http://" + baseURL
	}
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("cannot reach the YOZEXA node at %s: %w", c.baseURL, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		var e struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(body, &e) == nil && e.Error != "" {
			return fmt.Errorf("%s", e.Error)
		}
		return fmt.Errorf("node returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(body, out)
}

func (c *Client) post(ctx context.Context, path string, payload, out any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("cannot reach the YOZEXA node at %s: %w", c.baseURL, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		var e struct {
			Error string `json:"error"`
			Log   string `json:"log"`
		}
		if json.Unmarshal(body, &e) == nil {
			if e.Error != "" {
				return fmt.Errorf("%s", e.Error)
			}
			if e.Log != "" {
				return fmt.Errorf("%s", e.Log)
			}
		}
		return fmt.Errorf("node returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(body, out)
}

// Status describes the node and network.
type Status struct {
	ChainID         string         `json:"chain_id"`
	Height          int64          `json:"height"`
	NodeVersion     string         `json:"node_version"`
	LatestBlockTime string         `json:"latest_block_time"`
	CatchingUp      bool           `json:"catching_up"`
	NetworkWarning  string         `json:"network_warning"`
	Supply          map[string]any `json:"supply"`
}

// Status fetches node status.
func (c *Client) Status(ctx context.Context) (Status, error) {
	var s Status
	return s, c.get(ctx, "/v1/status", &s)
}

// Account is the wallet view of an account.
type Account struct {
	Address     string `json:"address"`
	Alias       string `json:"alias"`
	Balance     string `json:"balance"`
	Spendable   string `json:"spendable"`
	Locked      string `json:"locked"`
	Sequence    uint64 `json:"sequence"`
	BalanceYZXA string `json:"balance_yzxa"`
	BalanceYOZ  string `json:"balance_yoz"`
	Vesting     *struct {
		Category  string `json:"category"`
		Total     string `json:"total"`
		Vested    string `json:"vested"`
		Locked    string `json:"locked"`
		CliffUnix int64  `json:"cliff_unix"`
		EndUnix   int64  `json:"end_unix"`
	} `json:"vesting"`
}

// Account fetches an account.
func (c *Client) Account(ctx context.Context, address string) (Account, error) {
	var a Account
	return a, c.get(ctx, "/v1/account/"+address, &a)
}

// FeeMarket describes current gas pricing.
type FeeMarket struct {
	BaseFee string `json:"base_fee"`
	Tiers   []struct {
		Name        string `json:"name"`
		GasPrice    string `json:"gas_price"`
		Description string `json:"description"`
	} `json:"tiers"`
}

// FeeMarket fetches the current fee market.
func (c *Client) FeeMarket(ctx context.Context) (FeeMarket, error) {
	var f FeeMarket
	return f, c.get(ctx, "/v1/feemarket", &f)
}

// Supply fetches the monetary picture.
func (c *Client) Supply(ctx context.Context) (map[string]any, error) {
	var s map[string]any
	return s, c.get(ctx, "/v1/supply", &s)
}

// VerifySupply fetches the supply audit report.
func (c *Client) VerifySupply(ctx context.Context) (map[string]any, error) {
	var s map[string]any
	return s, c.get(ctx, "/v1/supply/verify", &s)
}

// Validators fetches the validator set.
func (c *Client) Validators(ctx context.Context) (map[string]any, error) {
	var v map[string]any
	return v, c.get(ctx, "/v1/validators", &v)
}

// Query performs a raw GET against any API path.
func (c *Client) Query(ctx context.Context, path string) (json.RawMessage, error) {
	var raw json.RawMessage
	return raw, c.get(ctx, path, &raw)
}

// BroadcastResult reports what happened to a broadcast transaction.
type BroadcastResult struct {
	Hash   string `json:"hash"`
	Status string `json:"status"`
	Code   uint32 `json:"code"`
	Log    string `json:"log"`
	Height int64  `json:"height"`
}

// Broadcast submits an already-signed transaction.
func (c *Client) Broadcast(ctx context.Context, signed tx.Tx, mode string) (BroadcastResult, error) {
	raw, err := signed.Bytes()
	if err != nil {
		return BroadcastResult{}, err
	}
	var res BroadcastResult
	err = c.post(ctx, "/v1/tx", map[string]any{
		"tx":   json.RawMessage(raw),
		"mode": mode,
	}, &res)
	return res, err
}

// TxStatus fetches a transaction's finality state.
func (c *Client) TxStatus(ctx context.Context, hash string) (map[string]any, error) {
	var out map[string]any
	return out, c.get(ctx, "/v1/tx/"+hash, &out)
}

// Simulate asks the node to explain what a transaction would do.
func (c *Client) Simulate(ctx context.Context, signed tx.Tx) (map[string]any, error) {
	raw, err := signed.Bytes()
	if err != nil {
		return nil, err
	}
	var out map[string]any
	return out, c.post(ctx, "/v1/simulate", map[string]any{"tx": json.RawMessage(raw)}, &out)
}

// SignAndBroadcast is the full path from intent to broadcast: it reads the
// account's current sequence and the live fee market, builds the transaction,
// signs it and submits it.
//
// The sequence is read immediately before signing so that a wallet cannot
// accidentally sign a transaction that is already stale.
func (c *Client) SignAndBroadcast(
	ctx context.Context,
	key *crypto.PrivKey,
	chainID string,
	feeTier string,
	gasLimit uint64,
	memo string,
	mode string,
	msgs ...tx.Msg,
) (BroadcastResult, error) {
	acc, err := c.Account(ctx, key.Address().String())
	if err != nil {
		return BroadcastResult{}, err
	}
	fm, err := c.FeeMarket(ctx)
	if err != nil {
		return BroadcastResult{}, err
	}
	gasPrice, err := selectGasPrice(fm, feeTier)
	if err != nil {
		return BroadcastResult{}, err
	}

	b := tx.NewBuilder(chainID)
	for _, m := range msgs {
		if err := b.AddMsg(m); err != nil {
			return BroadcastResult{}, err
		}
	}
	if err := b.WithFee(gasLimit, gasPrice); err != nil {
		return BroadcastResult{}, err
	}
	b.WithSequence(acc.Sequence).WithMemo(memo)

	signed, err := b.Sign(key)
	if err != nil {
		return BroadcastResult{}, err
	}
	return c.Broadcast(ctx, signed, mode)
}

func selectGasPrice(fm FeeMarket, tier string) (*big.Int, error) {
	if tier == "" {
		tier = "normal"
	}
	for _, t := range fm.Tiers {
		if t.Name == tier {
			v, ok := new(big.Int).SetString(t.GasPrice, 10)
			if !ok {
				return nil, fmt.Errorf("node returned an unparseable gas price %q", t.GasPrice)
			}
			return v, nil
		}
	}
	return nil, fmt.Errorf("unknown fee tier %q (want economy, normal or priority)", tier)
}

// ResolveRecipient turns an address or YOZEXA ID into an address, checking
// with the chain so the caller learns the true destination before signing.
func (c *Client) ResolveRecipient(ctx context.Context, input string) (types.Address, error) {
	if addr, err := types.ParseAddress(input); err == nil {
		return addr, nil
	}
	var alias struct {
		Name  string `json:"name"`
		Owner string `json:"owner"`
	}
	if err := c.get(ctx, "/v1/alias/"+input, &alias); err != nil {
		return types.Address{}, fmt.Errorf(
			"%q is neither a valid YOZEXA address nor a registered YOZEXA ID", input)
	}
	return types.ParseAddress(alias.Owner)
}
