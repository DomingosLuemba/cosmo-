package state

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/yozexa/yozexa/chain/store"
	"github.com/yozexa/yozexa/chain/types"
)

// Key prefixes. They are human-readable on purpose: an auditor reading a raw
// database dump should be able to tell what every row is without a decoder.
const (
	KeyParams        = "params"
	KeyMintedSupply  = "supply/minted"
	KeyBurnedSupply  = "supply/burned"
	KeyBaseFee       = "feemarket/base_fee"
	KeyEmissionState = "mint/state"
	KeyNextProposal  = "gov/next_id"
	KeyTreasuryEpoch = "treasury/epoch"

	PrefixAccount    = "acct/"
	PrefixValidator  = "val/"
	PrefixDelegation = "del/"
	PrefixUnbonding  = "ubd/"
	PrefixVesting    = "vest/"
	PrefixGrant      = "grant/"
	PrefixProposal   = "gov/proposal/"
	PrefixVote       = "gov/vote/"
	PrefixAlias      = "alias/"
	PrefixAliasOwner = "alias-owner/"
	PrefixSignInfo   = "slashing/sign-info/"
	PrefixConsAddr   = "slashing/cons-to-operator/"
	PrefixTombstone  = "slashing/tombstone/"
)

// State is a typed view over the authenticated key/value store.
//
// Every read and write of consensus state goes through this type. Modules
// never touch the raw store, so the encoding of a balance or a validator is
// defined in exactly one place.
type State struct {
	kv *store.Store
}

// New wraps a store.
func New(kv *store.Store) *State { return &State{kv: kv} }

// Store exposes the underlying store for commit and proof operations.
func (s *State) Store() *store.Store { return s.kv }

func (s *State) getJSON(key string, out any) (bool, error) {
	raw, err := s.kv.Get([]byte(key))
	if errors.Is(err, store.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return false, fmt.Errorf("decode %s: %w", key, err)
	}
	return true, nil
}

func (s *State) setJSON(key string, v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("encode %s: %w", key, err)
	}
	return s.kv.Set([]byte(key), raw)
}

func (s *State) delete(key string) error { return s.kv.Delete([]byte(key)) }

// Params reads the consensus parameters.
func (s *State) Params() (Params, error) {
	var p Params
	found, err := s.getJSON(KeyParams, &p)
	if err != nil {
		return p, err
	}
	if !found {
		return p, errors.New("params not initialised: the chain has no genesis state")
	}
	return p, nil
}

// SetParams writes the consensus parameters after validating them.
func (s *State) SetParams(p Params) error {
	if err := p.Validate(); err != nil {
		return fmt.Errorf("invalid params: %w", err)
	}
	return s.setJSON(KeyParams, p)
}

// addrKey renders an address into a state key segment.
func addrKey(a types.Address) string { return a.Hex() }

func jsonUnmarshal(b []byte, out any) error { return json.Unmarshal(b, out) }
