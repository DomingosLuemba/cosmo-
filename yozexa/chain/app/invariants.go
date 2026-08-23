package app

import (
	"fmt"
	"math/big"

	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/types"
)

// Invariants are the properties that must be true of YOZEXA's state at the end
// of every single block. They are checked in production, not only in tests,
// because on a network that settles money a silent accounting error is far
// worse than a halt: a halted chain can be diagnosed and restarted, while a
// chain that quietly created a coin has already paid it to someone.
//
// A violation returns an error from FinalizeBlock, which stops the node.
//
//	supply-cap      minted <= 10,000,000 YZXA, always
//	conservation    sum of every balance == minted - burned
//	burn-monotonic  burned never decreases (checked across blocks)
//	bonded-pool     bonded pool balance == sum of validator tokens
//	unbonding-pool  unbonding pool balance == sum of queued entries
//	reward-pool     reward pool balance >= what it has promised
//	shares          a validator with tokens has shares, and vice versa
//	vesting         a vesting account's balance covers its locked amount
//	emission        total emitted <= the 5,000,000 reserve
type InvariantResult struct {
	Name    string `json:"name"`
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}

// CheckInvariants runs every invariant and returns the first violation.
func (a *App) CheckInvariants(nowUnix int64) error {
	results, err := a.RunInvariants(nowUnix)
	if err != nil {
		return err
	}
	for _, r := range results {
		if !r.OK {
			return fmt.Errorf("%s: %s", r.Name, r.Message)
		}
	}
	return nil
}

// RunInvariants evaluates every invariant and reports each result. The CLI and
// the explorer expose this so anyone can audit a running node.
func (a *App) RunInvariants(nowUnix int64) ([]InvariantResult, error) {
	s := a.state
	var out []InvariantResult

	add := func(name string, ok bool, format string, args ...any) {
		r := InvariantResult{Name: name, OK: ok}
		if !ok {
			r.Message = fmt.Sprintf(format, args...)
		}
		out = append(out, r)
	}

	minted, err := s.MintedSupply()
	if err != nil {
		return nil, err
	}
	burned, err := s.BurnedSupply()
	if err != nil {
		return nil, err
	}

	// 1. The hard cap.
	capErr := types.CheckSupplyCap(minted)
	add("supply-cap", capErr == nil, "%v", capErr)

	// 2. Conservation: every unit that was minted and not burned must be
	//    sitting in exactly one account.
	totalBalances := types.Zero()
	if err := s.IterateAccounts(func(acc state.Account) bool {
		totalBalances, err = types.Add(totalBalances, acc.Balance.Int())
		return err == nil
	}); err != nil {
		return nil, err
	}
	expected, err := types.Sub(minted, burned)
	if err != nil {
		add("conservation", false, "burned %s exceeds minted %s", burned, minted)
	} else {
		add("conservation", totalBalances.Cmp(expected) == 0,
			"balances total %s but minted-burned is %s (difference %s ayzxa)",
			totalBalances, expected, new(big.Int).Sub(totalBalances, expected))
	}

	// 3. The bonded pool holds exactly the sum of validator tokens.
	sumTokens := types.Zero()
	sumShares := types.Zero()
	sharesConsistent := true
	var sharesMsg string
	if err := s.IterateValidators(func(v state.Validator) bool {
		var e error
		sumTokens, e = types.Add(sumTokens, v.Tokens.Int())
		if e != nil {
			return false
		}
		sumShares, e = types.Add(sumShares, v.DelegatorShares.Int())
		if e != nil {
			return false
		}
		if types.IsPositive(v.Tokens.Int()) != types.IsPositive(v.DelegatorShares.Int()) {
			sharesConsistent = false
			sharesMsg = fmt.Sprintf("validator %s holds %s tokens against %s shares",
				v.Operator.ValoperString(), v.Tokens, v.DelegatorShares)
		}
		return true
	}); err != nil {
		return nil, err
	}
	bondedBalance, err := s.Balance(state.ModuleBonded)
	if err != nil {
		return nil, err
	}
	add("bonded-pool", bondedBalance.Cmp(sumTokens) == 0,
		"bonded pool holds %s but validators account for %s", bondedBalance, sumTokens)
	add("shares", sharesConsistent, "%s", sharesMsg)

	// 4. The unbonding pool holds exactly the sum of queued entries.
	sumUnbonding := types.Zero()
	if err := s.Store().Iterate([]byte(state.PrefixUnbonding), func(key, value []byte) bool {
		var e state.UnbondingEntry
		if err := jsonUnmarshalEntry(value, &e); err != nil {
			return true // the id counter lives under this prefix too
		}
		if e.Amount.IsZero() && e.ID == 0 {
			return true
		}
		var addErr error
		sumUnbonding, addErr = types.Add(sumUnbonding, e.Amount.Int())
		return addErr == nil
	}); err != nil {
		return nil, err
	}
	unbondingBalance, err := s.Balance(state.ModuleUnbonding)
	if err != nil {
		return nil, err
	}
	add("unbonding-pool", unbondingBalance.Cmp(sumUnbonding) == 0,
		"unbonding pool holds %s but queued entries account for %s", unbondingBalance, sumUnbonding)

	// 5. The reward pool can cover everything it has promised: undistributed
	//    remainder, unwithdrawn commission, and every delegator's accrued
	//    reward.
	owed, err := a.getUndistributed()
	if err != nil {
		return nil, err
	}
	if err := s.IterateValidators(func(v state.Validator) bool {
		var e error
		owed, e = types.Add(owed, v.CommissionOwed.Int())
		return e == nil
	}); err != nil {
		return nil, err
	}
	var pendingErr error
	if err := s.IterateAllDelegations(func(d state.Delegation) bool {
		v, found, e := s.GetValidator(d.Validator)
		if e != nil || !found {
			return true
		}
		pending, e := pendingReward(v, d)
		if e != nil {
			pendingErr = e
			return false
		}
		owed, e = types.Add(owed, pending)
		return e == nil
	}); err != nil {
		return nil, err
	}
	if pendingErr != nil {
		add("reward-pool", false, "%v", pendingErr)
	} else {
		rewardBalance, err := s.Balance(state.ModuleRewards)
		if err != nil {
			return nil, err
		}
		add("reward-pool", rewardBalance.Cmp(owed) >= 0,
			"reward pool holds %s but owes %s", rewardBalance, owed)
	}

	// 6. Vesting: a locked allocation must still be there to be locked.
	vestingOK := true
	vestingMsg := ""
	if err := s.IterateVesting(func(v state.VestingSchedule) bool {
		locked, e := v.LockedAt(nowUnix)
		if e != nil {
			vestingOK, vestingMsg = false, e.Error()
			return false
		}
		balance, e := s.Balance(v.Address)
		if e != nil {
			vestingOK, vestingMsg = false, e.Error()
			return false
		}
		if balance.Cmp(locked) < 0 {
			vestingOK = false
			vestingMsg = fmt.Sprintf(
				"vesting account %s holds %s but %s is still locked",
				v.Address, types.FormatYZXA(balance), types.FormatYZXA(locked))
			return false
		}
		return true
	}); err != nil {
		return nil, err
	}
	add("vesting", vestingOK, "%s", vestingMsg)

	// 7. Emission has never exceeded its reserve.
	es, err := s.GetEmissionState()
	if err != nil {
		return nil, err
	}
	add("emission", es.TotalEmitted.Int().Cmp(state.EmissionReserve()) <= 0,
		"emitted %s exceeds the reserve of %s", es.TotalEmitted, state.EmissionReserve())

	return out, nil
}
