package app

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"

	abci "github.com/cometbft/cometbft/abci/types"

	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/store"
	"github.com/yozexa/yozexa/chain/types"
)

// Query answers ABCI queries. Paths are stable API surface:
//
//	/supply                     the full monetary picture
//	/supply/verify              the supply cap audit report
//	/params                     consensus parameters
//	/account/{address}          balance, spendable, sequence, alias
//	/account/{address}/proof    a Merkle proof of the account row
//	/validators                 the whole validator set
//	/validator/{operator}       one validator
//	/delegations/{delegator}    an account's stake positions
//	/unbonding/{delegator}      an account's unbonding queue
//	/vesting                    every public vesting position
//	/proposals                  governance proposals
//	/proposal/{id}              one proposal with its tally
//	/grants/{granter}           delegated spending permissions
//	/alias/{name}               resolve a YOZEXA ID
//	/feemarket                  base fee and the wallet's fee tiers
//	/emission                   the emission schedule's current state
//	/invariants                 run every invariant against live state
func (a *App) Query(_ context.Context, req *abci.RequestQuery) (*abci.ResponseQuery, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	path := strings.Trim(req.Path, "/")
	parts := strings.Split(path, "/")
	height := a.kv.Version()

	respond := func(v any) (*abci.ResponseQuery, error) {
		raw, err := json.Marshal(v)
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		return &abci.ResponseQuery{Code: CodeOK, Value: raw, Height: height}, nil
	}

	s := a.state
	switch {

	case path == "supply":
		sup, err := s.Supply()
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		return respond(supplyJSON(sup))

	case path == "supply/verify":
		report, err := a.VerifySupply()
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		return respond(report)

	case path == "params":
		p, err := s.Params()
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		return respond(p)

	case parts[0] == "account" && len(parts) >= 2:
		addr, err := types.ParseAnyAddress(parts[1])
		if err != nil {
			return queryError(CodeDecodeError, err.Error(), height), nil
		}
		if len(parts) == 3 && parts[2] == "proof" {
			proof, value, err := s.Store().Prove([]byte(state.PrefixAccount + addr.Hex()))
			if err != nil {
				return queryError(CodeInternal, err.Error(), height), nil
			}
			return respond(map[string]any{
				"key":      state.PrefixAccount + addr.Hex(),
				"key_hash": fmt.Sprintf("%x", store.KeyHash([]byte(state.PrefixAccount+addr.Hex()))),
				"value":    string(value),
				"app_hash": fmt.Sprintf("%x", s.Store().Root()),
				"proof":    proof,
				"height":   height,
			})
		}
		view, err := a.accountView(addr)
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		return respond(view)

	case path == "validators":
		p, err := s.Params()
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		all, err := s.AllValidators()
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		active, err := s.ActiveSet(p.MaxValidators)
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		inActive := map[string]bool{}
		for _, v := range active {
			inActive[v.Operator.Hex()] = true
		}
		bonded, err := s.TotalBonded()
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		out := make([]map[string]any, 0, len(all))
		for _, v := range all {
			out = append(out, validatorJSON(v, inActive[v.Operator.Hex()], bonded))
		}
		return respond(map[string]any{"validators": out, "total_bonded": bonded.String()})

	case parts[0] == "validator" && len(parts) == 2:
		addr, err := types.ParseAnyAddress(parts[1])
		if err != nil {
			return queryError(CodeDecodeError, err.Error(), height), nil
		}
		v, found, err := s.GetValidator(addr)
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		if !found {
			return queryError(CodeExecutionFailed, "validator not found", height), nil
		}
		bonded, err := s.TotalBonded()
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		p, err := s.Params()
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		active, err := s.ActiveSet(p.MaxValidators)
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		isActive := false
		for _, av := range active {
			if av.Operator == v.Operator {
				isActive = true
				break
			}
		}
		return respond(validatorJSON(v, isActive, bonded))

	case parts[0] == "delegations" && len(parts) == 2:
		addr, err := types.ParseAnyAddress(parts[1])
		if err != nil {
			return queryError(CodeDecodeError, err.Error(), height), nil
		}
		out, err := a.delegationsOf(addr)
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		return respond(map[string]any{"delegations": out})

	case parts[0] == "unbonding" && len(parts) == 2:
		addr, err := types.ParseAnyAddress(parts[1])
		if err != nil {
			return queryError(CodeDecodeError, err.Error(), height), nil
		}
		var out []state.UnbondingEntry
		if err := s.Store().Iterate([]byte(state.PrefixUnbonding), func(_, value []byte) bool {
			var e state.UnbondingEntry
			if err := json.Unmarshal(value, &e); err != nil {
				return true
			}
			if e.Delegator == addr {
				out = append(out, e)
			}
			return true
		}); err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		return respond(map[string]any{"unbonding": out})

	case path == "vesting":
		positions, err := a.vestingPositions()
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		return respond(map[string]any{"vesting": positions})

	case path == "proposals":
		var out []state.Proposal
		if err := s.IterateProposals(func(p state.Proposal) bool {
			out = append(out, p)
			return true
		}); err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
		return respond(map[string]any{"proposals": out})

	case parts[0] == "proposal" && len(parts) == 2:
		id, err := strconv.ParseUint(parts[1], 10, 64)
		if err != nil {
			return queryError(CodeDecodeError, "invalid proposal id", height), nil
		}
		prop, found, err := s.GetProposal(id)
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		if !found {
			return queryError(CodeExecutionFailed, "proposal not found", height), nil
		}
		p, err := s.Params()
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		tally, err := s.Tally(id, p)
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		return respond(map[string]any{
			"proposal": prop,
			"tally": map[string]any{
				"yes": tally.Yes.String(), "no": tally.No.String(),
				"abstain": tally.Abstain.String(), "no_with_veto": tally.NoWithVeto.String(),
				"total": tally.Total.String(), "bonded": tally.BondedAtEnd.String(),
				"quorum_met": tally.QuorumMet, "would_pass": tally.Passed, "would_veto": tally.Vetoed,
			},
		})

	case parts[0] == "grants" && len(parts) == 2:
		addr, err := types.ParseAddress(parts[1])
		if err != nil {
			return queryError(CodeDecodeError, err.Error(), height), nil
		}
		var out []state.Grant
		if err := s.IterateGrantsOf(addr, func(g state.Grant) bool {
			out = append(out, g)
			return true
		}); err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		return respond(map[string]any{"grants": out})

	case parts[0] == "alias" && len(parts) == 2:
		al, found, err := s.GetAlias(parts[1])
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		if !found {
			return queryError(CodeExecutionFailed, "alias not registered", height), nil
		}
		return respond(al)

	case path == "feemarket":
		baseFee, err := s.GetBaseFee()
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		p, err := s.Params()
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		return respond(map[string]any{
			"base_fee":         baseFee.String(),
			"min_base_fee":     p.MinBaseFee.String(),
			"target_block_gas": p.TargetBlockGas,
			"max_block_gas":    p.MaxBlockGas,
			"tiers":            state.FeeTiers(baseFee),
		})

	case path == "emission":
		info, err := s.EmissionInfoAt(height + 1)
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		return respond(info)

	case path == "invariants":
		results, err := a.RunInvariants(a.lastBlockTimeUnix())
		if err != nil {
			return queryError(CodeInternal, err.Error(), height), nil
		}
		allOK := true
		for _, r := range results {
			if !r.OK {
				allOK = false
			}
		}
		return respond(map[string]any{"ok": allOK, "results": results})

	default:
		return queryError(CodeDecodeError, fmt.Sprintf("unknown query path %q", req.Path), height), nil
	}
}

func queryError(code uint32, msg string, height int64) *abci.ResponseQuery {
	return &abci.ResponseQuery{Code: code, Log: msg, Height: height}
}

// AccountView is the wallet-facing picture of an account.
type AccountView struct {
	Address   string `json:"address"`
	Alias     string `json:"alias,omitempty"`
	Balance   string `json:"balance"`
	Spendable string `json:"spendable"`
	Locked    string `json:"locked"`
	Sequence  uint64 `json:"sequence"`
	PubKey    string `json:"pubkey,omitempty"`
	// BalanceYZXA and BalanceYOZ are rendered for display only; the
	// authoritative figure is always the base-unit integer above.
	BalanceYZXA string `json:"balance_yzxa"`
	BalanceYOZ  string `json:"balance_yoz"`

	Vesting *state.VestingStatus `json:"vesting,omitempty"`
}

func (a *App) accountView(addr types.Address) (AccountView, error) {
	s := a.state
	acc, err := s.GetAccount(addr)
	if err != nil {
		return AccountView{}, err
	}
	now := a.lastBlockTimeUnix()
	locked, err := s.LockedAmount(addr, now)
	if err != nil {
		return AccountView{}, err
	}
	spendable, err := types.Sub(acc.Balance.Int(), locked)
	if err != nil {
		spendable = types.Zero()
	}
	view := AccountView{
		Address:     addr.String(),
		Balance:     acc.Balance.String(),
		Spendable:   spendable.String(),
		Locked:      locked.String(),
		Sequence:    acc.Sequence,
		PubKey:      acc.PubKey,
		BalanceYZXA: types.FormatYZXA(acc.Balance.Int()),
		BalanceYOZ:  types.FormatYOZ(acc.Balance.Int()),
	}
	if name, found, err := s.PrimaryAlias(addr); err == nil && found {
		view.Alias = name
	}
	if sched, found, err := s.GetVestingSchedule(addr); err == nil && found {
		st, err := sched.Status(now)
		if err == nil {
			view.Vesting = &st
		}
	}
	return view, nil
}

func (a *App) delegationsOf(addr types.Address) ([]map[string]any, error) {
	s := a.state
	var out []map[string]any
	var iterErr error
	err := s.IterateAllDelegations(func(d state.Delegation) bool {
		if d.Delegator != addr {
			return true
		}
		v, found, err := s.GetValidator(d.Validator)
		if err != nil {
			iterErr = err
			return false
		}
		if !found {
			return true
		}
		tokens, err := tokensForShares(v, d.Shares.Int())
		if err != nil {
			iterErr = err
			return false
		}
		pending, err := pendingReward(v, d)
		if err != nil {
			iterErr = err
			return false
		}
		out = append(out, map[string]any{
			"validator":       v.Operator.ValoperString(),
			"moniker":         v.Description.Moniker,
			"shares":          d.Shares.String(),
			"staked":          tokens.String(),
			"staked_yzxa":     types.FormatYZXA(tokens),
			"pending_rewards": pending.String(),
			"commission_bps":  v.CommissionBps,
			"jailed":          v.Jailed,
			"tombstoned":      v.Tombstoned,
		})
		return true
	})
	if err != nil {
		return nil, err
	}
	return out, iterErr
}

func (a *App) vestingPositions() ([]state.VestingStatus, error) {
	now := a.lastBlockTimeUnix()
	var out []state.VestingStatus
	var iterErr error
	err := a.state.IterateVesting(func(v state.VestingSchedule) bool {
		st, err := v.Status(now)
		if err != nil {
			iterErr = err
			return false
		}
		out = append(out, st)
		return true
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Address.Hex() < out[j].Address.Hex() })
	return out, iterErr
}

// lastBlockTimeUnix approximates the current chain time for read-only queries.
// Consensus logic never uses it: every state transition takes block time from
// the block being executed.
func (a *App) lastBlockTimeUnix() int64 {
	if raw, err := a.kv.Get([]byte("chain/last_block_time")); err == nil {
		if v, err := strconv.ParseInt(string(raw), 10, 64); err == nil {
			return v
		}
	}
	return a.genesisTime.Unix()
}

func supplyJSON(s state.Supply) map[string]any {
	return map[string]any{
		"max_supply":              s.Max.String(),
		"max_supply_yzxa":         types.FormatYZXA(s.Max),
		"minted_supply":           s.Minted.String(),
		"minted_supply_yzxa":      types.FormatYZXA(s.Minted),
		"burned_supply":           s.Burned.String(),
		"burned_supply_yzxa":      types.FormatYZXA(s.Burned),
		"circulating_supply":      s.Circulating.String(),
		"circulating_supply_yzxa": types.FormatYZXA(s.Circulating),
		"remaining_mintable":      s.RemainingMintable.String(),
		"remaining_mintable_yzxa": types.FormatYZXA(s.RemainingMintable),
		"decimals":                types.Decimals,
		"base_denom":              types.BaseDenom,
		"display_denom":           types.DisplayDenom,
		"sub_denom":               types.SubDenom,
	}
}

func validatorJSON(v state.Validator, active bool, totalBonded *big.Int) map[string]any {
	votingPowerBps := "0"
	if totalBonded.Sign() > 0 {
		bps := new(big.Int).Mul(v.Tokens.Int(), big.NewInt(10_000))
		votingPowerBps = bps.Quo(bps, totalBonded).String()
	}
	return map[string]any{
		"operator":            v.Operator.ValoperString(),
		"moniker":             v.Description.Moniker,
		"website":             v.Description.Website,
		"details":             v.Description.Details,
		"consensus_pubkey":    v.ConsensusPubKey,
		"tokens":              v.Tokens.String(),
		"tokens_yzxa":         types.FormatYZXA(v.Tokens.Int()),
		"delegator_shares":    v.DelegatorShares.String(),
		"commission_bps":      v.CommissionBps,
		"max_commission_bps":  v.MaxCommissionBps,
		"min_self_delegation": v.MinSelfDelegation.String(),
		"jailed":              v.Jailed,
		"tombstoned":          v.Tombstoned,
		"jailed_until_unix":   v.JailedUntilUnix,
		"active":              active,
		"voting_power_bps":    votingPowerBps,
		"commission_owed":     v.CommissionOwed.String(),
	}
}

// SupplyReport is the output of `yozexa supply verify`.
//
// It is deliberately explicit: an auditor should be able to check the whole
// monetary position of the network from this one document, and the verdict
// must be a hard VALID/INVALID rather than a number to interpret.
type SupplyReport struct {
	MaximumSupply     string `json:"maximum_supply"`
	MaximumSupplyYZXA string `json:"maximum_supply_yzxa"`
	CurrentMinted     string `json:"current_minted"`
	CurrentMintedYZXA string `json:"current_minted_yzxa"`
	Burned            string `json:"burned"`
	BurnedYZXA        string `json:"burned_yzxa"`
	Circulating       string `json:"circulating"`
	CirculatingYZXA   string `json:"circulating_yzxa"`
	RemainingMintable string `json:"remaining_mintable"`
	RemainingYZXA     string `json:"remaining_mintable_yzxa"`

	SumOfAllBalances string `json:"sum_of_all_balances"`
	ConservationOK   bool   `json:"conservation_ok"`

	EmissionReserve   string `json:"emission_reserve"`
	EmissionEmitted   string `json:"emission_emitted"`
	EmissionRemaining string `json:"emission_remaining"`

	ModuleBalances map[string]string `json:"module_balances"`
	VestingLocked  string            `json:"vesting_locked"`

	SupplyCap  string            `json:"supply_cap"` // "VALID" or "INVALID"
	Invariants []InvariantResult `json:"invariants"`
	Height     int64             `json:"height"`
}

// VerifySupply produces the supply audit report.
func (a *App) VerifySupply() (SupplyReport, error) {
	s := a.state
	sup, err := s.Supply()
	if err != nil {
		return SupplyReport{}, err
	}
	now := a.lastBlockTimeUnix()

	sumBalances := types.Zero()
	if err := s.IterateAccounts(func(acc state.Account) bool {
		sumBalances, err = types.Add(sumBalances, acc.Balance.Int())
		return err == nil
	}); err != nil {
		return SupplyReport{}, err
	}

	modules := map[string]string{}
	for name, addr := range state.ModuleAccounts() {
		b, err := s.Balance(addr)
		if err != nil {
			return SupplyReport{}, err
		}
		modules[name] = b.String()
	}

	locked := types.Zero()
	if err := s.IterateVesting(func(v state.VestingSchedule) bool {
		l, err := v.LockedAt(now)
		if err != nil {
			return false
		}
		locked, err = types.Add(locked, l)
		return err == nil
	}); err != nil {
		return SupplyReport{}, err
	}

	es, err := s.GetEmissionState()
	if err != nil {
		return SupplyReport{}, err
	}
	emissionRemaining, err := types.Sub(state.EmissionReserve(), es.TotalEmitted.Int())
	if err != nil {
		emissionRemaining = types.Zero()
	}

	invariants, err := a.RunInvariants(now)
	if err != nil {
		return SupplyReport{}, err
	}

	capValid := types.CheckSupplyCap(sup.Minted) == nil
	verdict := "VALID"
	if !capValid {
		verdict = "INVALID"
	}

	return SupplyReport{
		MaximumSupply:     sup.Max.String(),
		MaximumSupplyYZXA: types.FormatYZXA(sup.Max),
		CurrentMinted:     sup.Minted.String(),
		CurrentMintedYZXA: types.FormatYZXA(sup.Minted),
		Burned:            sup.Burned.String(),
		BurnedYZXA:        types.FormatYZXA(sup.Burned),
		Circulating:       sup.Circulating.String(),
		CirculatingYZXA:   types.FormatYZXA(sup.Circulating),
		RemainingMintable: sup.RemainingMintable.String(),
		RemainingYZXA:     types.FormatYZXA(sup.RemainingMintable),
		SumOfAllBalances:  sumBalances.String(),
		ConservationOK:    sumBalances.Cmp(sup.Circulating) == 0,
		EmissionReserve:   state.EmissionReserve().String(),
		EmissionEmitted:   es.TotalEmitted.String(),
		EmissionRemaining: emissionRemaining.String(),
		ModuleBalances:    modules,
		VestingLocked:     locked.String(),
		SupplyCap:         verdict,
		Invariants:        invariants,
		Height:            a.kv.Version(),
	}, nil
}
