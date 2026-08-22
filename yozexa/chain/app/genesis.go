package app

import (
	"encoding/json"
	"fmt"
	"math/big"
	"sort"
	"time"

	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/types"
)

// The YOZEXA distribution. Percentages of the 10,000,000 YZXA hard cap:
//
//	Network emission     50%   5,000,000   paid out block by block, never held
//	Ecosystem/Developers 15%   1,500,000   grants, developer programmes
//	Liquidity            10%   1,000,000   market liquidity
//	Treasury             10%   1,000,000   governance-controlled, timelocked
//	Team                  8%     800,000   1-year cliff, 6-year vesting
//	Founder               5%     500,000   2-year cliff, 8-year vesting
//	Security              2%     200,000   audits, bounties, emergency work
//
// Everything except the emission share is minted at genesis. The emission
// share is not minted at genesis at all: it comes into existence one block
// reward at a time, so a genesis file cannot put it in anyone's wallet.
const (
	AllocEmissionYZXA  = 5_000_000
	AllocEcosystemYZXA = 1_500_000
	AllocLiquidityYZXA = 1_000_000
	AllocTreasuryYZXA  = 1_000_000
	AllocTeamYZXA      = 800_000
	AllocFounderYZXA   = 500_000
	AllocSecurityYZXA  = 200_000
)

// Vesting schedule constants, in seconds.
const (
	Year = int64(365 * 24 * 60 * 60)

	FounderCliffSeconds    = 2 * Year
	FounderDurationSeconds = 8 * Year
	TeamCliffSeconds       = 1 * Year
	TeamDurationSeconds    = 6 * Year
)

// GenesisAccount is a plain funded account at genesis.
type GenesisAccount struct {
	Address types.Address `json:"address"`
	Balance types.Amount  `json:"balance"`
	// Label is documentation only; it never affects consensus.
	Label string `json:"label,omitempty"`
}

// GenesisVesting is a locked allocation at genesis.
type GenesisVesting struct {
	Address         types.Address `json:"address"`
	Category        string        `json:"category"`
	Total           types.Amount  `json:"total"`
	CliffSeconds    int64         `json:"cliff_seconds"`
	DurationSeconds int64         `json:"duration_seconds"`
	Label           string        `json:"label,omitempty"`
}

// GenesisValidator is a validator present in the very first block.
type GenesisValidator struct {
	Operator          types.Address `json:"operator"`
	ConsensusPubKey   string        `json:"consensus_pubkey"`
	Moniker           string        `json:"moniker"`
	SelfDelegation    types.Amount  `json:"self_delegation"`
	CommissionBps     uint32        `json:"commission_bps"`
	MaxCommissionBps  uint32        `json:"max_commission_bps"`
	MinSelfDelegation types.Amount  `json:"min_self_delegation"`
}

// Genesis is the initial state of a YOZEXA network.
type Genesis struct {
	ChainID     string             `json:"chain_id"`
	GenesisTime time.Time          `json:"genesis_time"`
	Params      state.Params       `json:"params"`
	Accounts    []GenesisAccount   `json:"accounts"`
	Vesting     []GenesisVesting   `json:"vesting"`
	Validators  []GenesisValidator `json:"validators"`
	// FundAllocations, when true, mints the ecosystem, liquidity, treasury
	// and security allocations into their module accounts. A network that
	// only wants to test consensus can set it false and start with nothing
	// but validator stake.
	FundAllocations bool `json:"fund_allocations"`
}

// Validate checks a genesis document before it can start a network.
//
// A malformed genesis is the one moment where a mistake is not recoverable by
// a later transaction, so the checks here are strict: totals must add up, the
// hard cap must hold with room for the whole emission reserve, addresses must
// be unique, and there must be enough stake to produce a block.
func (g Genesis) Validate() error {
	if g.ChainID == "" {
		return fmt.Errorf("genesis: chain_id is required")
	}
	if len(g.ChainID) > 50 {
		return fmt.Errorf("genesis: chain_id too long")
	}
	if g.GenesisTime.IsZero() {
		return fmt.Errorf("genesis: genesis_time is required")
	}
	if err := g.Params.Validate(); err != nil {
		return fmt.Errorf("genesis params: %w", err)
	}

	total := types.Zero()
	var err error

	// An address may hold both a plain balance and a vesting position — that
	// is how a vesting account gets enough unlocked YZXA to pay its own fees —
	// but it may not appear twice within either list, which would silently
	// double an allocation.
	seenAccounts := map[types.Address]string{}
	for _, a := range g.Accounts {
		if a.Address.IsZero() {
			return fmt.Errorf("genesis: account %s has the zero address", a.Label)
		}
		if prev, dup := seenAccounts[a.Address]; dup {
			return fmt.Errorf("genesis: account %s appears twice (%s and %s)", a.Address, prev, a.Label)
		}
		seenAccounts[a.Address] = a.Label
		if total, err = types.Add(total, a.Balance.Int()); err != nil {
			return err
		}
	}

	seenVesting := map[types.Address]string{}
	for _, v := range g.Vesting {
		if v.Address.IsZero() {
			return fmt.Errorf("genesis: vesting %s has the zero address", v.Label)
		}
		if prev, dup := seenVesting[v.Address]; dup {
			return fmt.Errorf("genesis: vesting position for %s appears twice (%s and %s)",
				v.Address, prev, v.Label)
		}
		seenVesting[v.Address] = v.Label
		if total, err = types.Add(total, v.Total.Int()); err != nil {
			return err
		}
		if v.CliffSeconds < 0 || v.DurationSeconds <= 0 || v.CliffSeconds > v.DurationSeconds {
			return fmt.Errorf("genesis: vesting %s has an invalid schedule", v.Label)
		}
		// A validator's self-delegation must come from unlocked funds, so a
		// vesting position may not also be a genesis validator operator.
		for _, val := range g.Validators {
			if val.Operator == v.Address {
				return fmt.Errorf(
					"genesis: %s is both a vesting position and a validator operator; a locked allocation cannot be self-delegated",
					v.Label)
			}
		}
	}
	if g.FundAllocations {
		for _, amt := range []int64{
			AllocEcosystemYZXA, AllocLiquidityYZXA, AllocTreasuryYZXA, AllocSecurityYZXA,
		} {
			total, err = types.Add(total, types.YZXA(amt))
			if err != nil {
				return err
			}
		}
	}

	// The genesis mint plus the entire future emission must fit under the cap.
	withEmission, err := types.Add(total, types.YZXA(AllocEmissionYZXA))
	if err != nil {
		return err
	}
	if err := types.CheckSupplyCap(withEmission); err != nil {
		return fmt.Errorf(
			"genesis allocates %s YZXA which, with the %d YZXA emission reserve, breaks the hard cap: %w",
			types.FormatYZXA(total), AllocEmissionYZXA, err)
	}

	if len(g.Validators) == 0 {
		return fmt.Errorf("genesis: at least one validator is required")
	}
	consSeen := map[string]bool{}
	for _, v := range g.Validators {
		if v.Operator.IsZero() {
			return fmt.Errorf("genesis: validator %q has the zero operator address", v.Moniker)
		}
		if v.ConsensusPubKey == "" {
			return fmt.Errorf("genesis: validator %q has no consensus key", v.Moniker)
		}
		if consSeen[v.ConsensusPubKey] {
			return fmt.Errorf("genesis: consensus key of validator %q is used twice", v.Moniker)
		}
		consSeen[v.ConsensusPubKey] = true
		if _, err := state.ConsAddressFromPubKey(v.ConsensusPubKey); err != nil {
			return fmt.Errorf("genesis: validator %q: %w", v.Moniker, err)
		}
		if !types.IsPositive(v.SelfDelegation.Int()) {
			return fmt.Errorf("genesis: validator %q has no self delegation", v.Moniker)
		}
		if v.CommissionBps > v.MaxCommissionBps || v.MaxCommissionBps > 10_000 {
			return fmt.Errorf("genesis: validator %q has an invalid commission", v.Moniker)
		}
		// The self-delegation has to come from a funded genesis account.
		funded := false
		for _, a := range g.Accounts {
			if a.Address == v.Operator && a.Balance.Cmp(v.SelfDelegation) >= 0 {
				funded = true
				break
			}
		}
		if !funded {
			return fmt.Errorf(
				"genesis: validator %q self-delegates %s but its operator account is not funded with at least that much",
				v.Moniker, types.FormatYZXA(v.SelfDelegation.Int()))
		}
	}
	return nil
}

// TotalGenesisMint returns how much will be minted when this genesis is
// applied.
func (g Genesis) TotalGenesisMint() (*big.Int, error) {
	total := types.Zero()
	var err error
	for _, a := range g.Accounts {
		if total, err = types.Add(total, a.Balance.Int()); err != nil {
			return nil, err
		}
	}
	for _, v := range g.Vesting {
		if total, err = types.Add(total, v.Total.Int()); err != nil {
			return nil, err
		}
	}
	if g.FundAllocations {
		for _, amt := range []int64{
			AllocEcosystemYZXA, AllocLiquidityYZXA, AllocTreasuryYZXA, AllocSecurityYZXA,
		} {
			if total, err = types.Add(total, types.YZXA(amt)); err != nil {
				return nil, err
			}
		}
	}
	return total, nil
}

// MarshalJSON renders genesis deterministically, sorting the lists so that two
// operators generating "the same" genesis produce byte-identical files.
func (g Genesis) MarshalIndent() ([]byte, error) {
	sort.Slice(g.Accounts, func(i, j int) bool { return g.Accounts[i].Address.Hex() < g.Accounts[j].Address.Hex() })
	sort.Slice(g.Vesting, func(i, j int) bool { return g.Vesting[i].Address.Hex() < g.Vesting[j].Address.Hex() })
	sort.Slice(g.Validators, func(i, j int) bool { return g.Validators[i].Operator.Hex() < g.Validators[j].Operator.Hex() })
	return json.MarshalIndent(g, "", "  ")
}
