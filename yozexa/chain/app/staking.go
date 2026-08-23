package app

import (
	"fmt"
	"math/big"

	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// KeyUndistributed tracks reward-pool balance that has been received but not
// yet allocated to validators, because integer division left a remainder. It
// is carried into the next block rather than being lost or double-counted.
const KeyUndistributed = "dist/undistributed"

// sharesForTokens computes how many shares a token amount buys in a validator.
//
// A validator that has been slashed holds fewer tokens per share, so a new
// delegator buys proportionally more shares for the same tokens — and does not
// inherit the earlier loss. That is the whole point of the share model.
func sharesForTokens(v state.Validator, amount *big.Int) (*big.Int, error) {
	tokens := v.Tokens.Int()
	shares := v.DelegatorShares.Int()
	if tokens.Sign() == 0 || shares.Sign() == 0 {
		// First delegation into this validator: one share per unit.
		return new(big.Int).Set(amount), nil
	}
	out := new(big.Int).Mul(amount, shares)
	return out.Quo(out, tokens), nil
}

// tokensForShares converts shares back into their current token value.
func tokensForShares(v state.Validator, shares *big.Int) (*big.Int, error) {
	total := v.DelegatorShares.Int()
	if total.Sign() == 0 {
		return big.NewInt(0), nil
	}
	out := new(big.Int).Mul(shares, v.Tokens.Int())
	return out.Quo(out, total), nil
}

// pendingReward returns the reward a delegation has accrued but not claimed.
func pendingReward(v state.Validator, d state.Delegation) (*big.Int, error) {
	diff, err := types.Sub(v.RewardAccumulator.Int(), d.RewardDebt.Int())
	if err != nil {
		// The accumulator only ever grows, so a negative difference means the
		// delegation recorded a debt from a later state than the validator
		// holds: a corruption bug, not a normal condition.
		return nil, fmt.Errorf("reward accounting inconsistent for delegator %s: %w", d.Delegator, err)
	}
	out := new(big.Int).Mul(d.Shares.Int(), diff)
	return out.Quo(out, state.RewardScale), nil
}

// settleRewards pays out everything a delegation has accrued and resets its
// debt. It runs before every change to a delegation's share count, so a
// delegator can never be paid at a rate they were not staked at.
func (a *App) settleRewards(s *state.State, v state.Validator, d *state.Delegation) (*big.Int, error) {
	reward, err := pendingReward(v, *d)
	if err != nil {
		return nil, err
	}
	if reward.Sign() > 0 {
		poolBalance, err := s.Balance(state.ModuleRewards)
		if err != nil {
			return nil, err
		}
		if poolBalance.Cmp(reward) < 0 {
			return nil, fmt.Errorf(
				"reward pool holds %s but owes %s: refusing to pay a reward that is not backed",
				poolBalance, reward)
		}
		if err := s.SubBalance(state.ModuleRewards, reward); err != nil {
			return nil, err
		}
		if err := s.AddBalance(d.Delegator, reward); err != nil {
			return nil, err
		}
	}
	d.RewardDebt = v.RewardAccumulator
	return reward, nil
}

// handleDelegate bonds tokens to a validator.
func (a *App) handleDelegate(s *state.State, m tx.MsgDelegate, now int64) error {
	v, found, err := s.GetValidator(m.Validator)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("validator %s does not exist", m.Validator.ValoperString())
	}
	if v.Tombstoned {
		return fmt.Errorf("validator %s has been permanently removed for double signing and cannot be delegated to",
			m.Validator.ValoperString())
	}
	amount := m.Amount.Int()

	// Move the stake into the bonded pool. Spendable is enforced, so vesting
	// tokens cannot be staked out from under their lock... they can be staked,
	// but only the unlocked part: staking is a transfer of custody to the
	// protocol and would otherwise be a way to route around vesting.
	spendable, err := s.Spendable(m.Delegator, now)
	if err != nil {
		return err
	}
	if spendable.Cmp(amount) < 0 {
		return fmt.Errorf("insufficient spendable balance to delegate: %s available, %s requested",
			types.FormatYZXA(spendable), types.FormatYZXA(amount))
	}
	if err := s.SubBalance(m.Delegator, amount); err != nil {
		return err
	}
	if err := s.AddBalance(state.ModuleBonded, amount); err != nil {
		return err
	}

	d, _, err := s.GetDelegation(m.Validator, m.Delegator)
	if err != nil {
		return err
	}
	if d.Delegator.IsZero() {
		d = state.Delegation{
			Delegator:  m.Delegator,
			Validator:  m.Validator,
			Shares:     types.MustAmount(types.Zero()),
			RewardDebt: v.RewardAccumulator,
		}
	} else if _, err := a.settleRewards(s, v, &d); err != nil {
		return err
	}

	shares, err := sharesForTokens(v, amount)
	if err != nil {
		return err
	}
	if shares.Sign() == 0 {
		return fmt.Errorf("delegation of %s is too small to buy a share of this validator",
			types.FormatYZXA(amount))
	}

	newTokens, err := types.Add(v.Tokens.Int(), amount)
	if err != nil {
		return err
	}
	newShares, err := types.Add(v.DelegatorShares.Int(), shares)
	if err != nil {
		return err
	}
	if v.Tokens, err = types.NewAmount(newTokens); err != nil {
		return err
	}
	if v.DelegatorShares, err = types.NewAmount(newShares); err != nil {
		return err
	}

	dShares, err := types.Add(d.Shares.Int(), shares)
	if err != nil {
		return err
	}
	if d.Shares, err = types.NewAmount(dShares); err != nil {
		return err
	}
	d.RewardDebt = v.RewardAccumulator

	if err := s.SetValidator(v); err != nil {
		return err
	}
	return s.SetDelegation(d)
}

// handleUndelegate starts unbonding.
func (a *App) handleUndelegate(s *state.State, m tx.MsgUndelegate, now int64, p state.Params) error {
	return a.unbond(s, m.Delegator, m.Validator, m.Amount.Int(), now, p, nil)
}

// handleRedelegate moves stake to a different validator.
//
// YOZEXA redelegation is queued, not instant: the stake leaves the source
// validator, waits out the full unbonding period in the unbonding pool where
// it remains slashable, and is then bonded to the destination automatically.
//
// Instant redelegation (as some networks implement) needs an extra ledger of
// redelegation entries purely so that stake which has already moved can still
// be slashed for the source validator's earlier misbehaviour. Queuing it
// removes that entire class of accounting bug at the cost of convenience, and
// the delegator still does not have to come back and re-stake by hand.
func (a *App) handleRedelegate(s *state.State, m tx.MsgRedelegate, now int64, p state.Params) error {
	dst, found, err := s.GetValidator(m.DstValidator)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("destination validator %s does not exist", m.DstValidator.ValoperString())
	}
	if dst.Tombstoned {
		return fmt.Errorf("destination validator %s has been permanently removed", m.DstValidator.ValoperString())
	}
	target := m.DstValidator
	return a.unbond(s, m.Delegator, m.SrcValidator, m.Amount.Int(), now, p, &target)
}

// unbond is the shared path for undelegation and queued redelegation.
func (a *App) unbond(
	s *state.State,
	delegator, validator types.Address,
	amount *big.Int,
	now int64,
	p state.Params,
	redelegateTo *types.Address,
) error {
	v, found, err := s.GetValidator(validator)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("validator %s does not exist", validator.ValoperString())
	}
	d, found, err := s.GetDelegation(validator, delegator)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("no delegation from %s to %s", delegator, validator.ValoperString())
	}

	entries, err := s.CountUnbondingEntries(delegator, validator)
	if err != nil {
		return err
	}
	if entries >= p.MaxEntries {
		return fmt.Errorf("too many unbonding entries with this validator: %d of %d in flight",
			entries, p.MaxEntries)
	}

	if _, err := a.settleRewards(s, v, &d); err != nil {
		return err
	}

	shares, err := sharesForTokens(v, amount)
	if err != nil {
		return err
	}
	if shares.Sign() == 0 {
		return fmt.Errorf("amount too small to unbond")
	}
	if shares.Cmp(d.Shares.Int()) > 0 {
		shares = d.Shares.Int()
	}
	tokensOut, err := tokensForShares(v, shares)
	if err != nil {
		return err
	}
	if tokensOut.Sign() == 0 {
		return fmt.Errorf("amount too small to unbond")
	}

	newTokens, err := types.Sub(v.Tokens.Int(), tokensOut)
	if err != nil {
		return err
	}
	newShares, err := types.Sub(v.DelegatorShares.Int(), shares)
	if err != nil {
		return err
	}
	if v.Tokens, err = types.NewAmount(newTokens); err != nil {
		return err
	}
	if v.DelegatorShares, err = types.NewAmount(newShares); err != nil {
		return err
	}

	remaining, err := types.Sub(d.Shares.Int(), shares)
	if err != nil {
		return err
	}
	if d.Shares, err = types.NewAmount(remaining); err != nil {
		return err
	}
	d.RewardDebt = v.RewardAccumulator

	// Move the stake from the bonded pool into the unbonding pool. It stops
	// counting towards voting power immediately, but stays slashable until
	// the entry matures.
	if err := s.SubBalance(state.ModuleBonded, tokensOut); err != nil {
		return err
	}
	if err := s.AddBalance(state.ModuleUnbonding, tokensOut); err != nil {
		return err
	}

	id, err := a.nextUnbondingID(s)
	if err != nil {
		return err
	}
	amt, err := types.NewAmount(tokensOut)
	if err != nil {
		return err
	}
	entry := state.UnbondingEntry{
		ID:           id,
		Delegator:    delegator,
		Validator:    validator,
		Amount:       amt,
		CompleteUnix: now + p.UnbondingSeconds,
	}
	if redelegateTo != nil {
		entry.RedelegateTo = redelegateTo
	}
	entry.CreatedUnix = now
	if err := s.AddUnbonding(entry); err != nil {
		return err
	}

	if err := s.SetValidator(v); err != nil {
		return err
	}
	if err := s.SetDelegation(d); err != nil {
		return err
	}
	return a.jailIfSelfDelegationTooLow(s, v, now)
}

// jailIfSelfDelegationTooLow enforces that a validator keeps skin in the game.
func (a *App) jailIfSelfDelegationTooLow(s *state.State, v state.Validator, now int64) error {
	if v.Jailed || v.Tombstoned {
		return nil
	}
	self, found, err := s.GetDelegation(v.Operator, v.Operator)
	if err != nil {
		return err
	}
	selfTokens := types.Zero()
	if found {
		selfTokens, err = tokensForShares(v, self.Shares.Int())
		if err != nil {
			return err
		}
	}
	if selfTokens.Cmp(v.MinSelfDelegation.Int()) < 0 {
		v.Jailed = true
		v.JailedUntilUnix = now
		return s.SetValidator(v)
	}
	return nil
}

func (a *App) nextUnbondingID(s *state.State) (uint64, error) {
	var id uint64
	kv := s.Store()
	raw, err := kv.Get([]byte("ubd/next_id"))
	if err == nil {
		if _, e := fmt.Sscanf(string(raw), "%d", &id); e != nil {
			return 0, fmt.Errorf("corrupt unbonding id counter")
		}
	}
	id++
	return id, kv.Set([]byte("ubd/next_id"), []byte(fmt.Sprintf("%d", id)))
}

// handleWithdrawRewards pays out a delegation's accrued rewards, plus a
// validator operator's commission when it is withdrawing from itself.
func (a *App) handleWithdrawRewards(s *state.State, m tx.MsgWithdrawRewards) (*big.Int, error) {
	v, found, err := s.GetValidator(m.Validator)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("validator %s does not exist", m.Validator.ValoperString())
	}
	d, found, err := s.GetDelegation(m.Validator, m.Delegator)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("no delegation from %s to %s", m.Delegator, m.Validator.ValoperString())
	}
	paid, err := a.settleRewards(s, v, &d)
	if err != nil {
		return nil, err
	}
	if err := s.SetDelegation(d); err != nil {
		return nil, err
	}

	if m.Delegator == v.Operator && types.IsPositive(v.CommissionOwed.Int()) {
		commission := v.CommissionOwed.Int()
		poolBalance, err := s.Balance(state.ModuleRewards)
		if err != nil {
			return nil, err
		}
		if poolBalance.Cmp(commission) < 0 {
			return nil, fmt.Errorf("reward pool cannot cover commission of %s", commission)
		}
		if err := s.SubBalance(state.ModuleRewards, commission); err != nil {
			return nil, err
		}
		if err := s.AddBalance(v.Operator, commission); err != nil {
			return nil, err
		}
		if v.CommissionOwed, err = types.NewAmount(types.Zero()); err != nil {
			return nil, err
		}
		if err := s.SetValidator(v); err != nil {
			return nil, err
		}
		paid, err = types.Add(paid, commission)
		if err != nil {
			return nil, err
		}
	}
	return paid, nil
}

// handleCreateValidator registers a validator and bonds its self-delegation.
func (a *App) handleCreateValidator(s *state.State, m tx.MsgCreateValidator, now int64, p state.Params) error {
	if _, found, err := s.GetValidator(m.Operator); err != nil {
		return err
	} else if found {
		return fmt.Errorf("validator %s already exists", m.Operator.ValoperString())
	}
	consAddr, err := state.ConsAddressFromPubKey(m.ConsensusPubKey)
	if err != nil {
		return err
	}
	// A consensus key that has ever double-signed is banned forever, even if
	// a brand new operator account tries to reuse it.
	tomb, err := s.IsTombstoned(consAddr)
	if err != nil {
		return err
	}
	if tomb {
		return fmt.Errorf("this consensus key has been tombstoned for double signing and may never validate again")
	}
	if existing, found, err := s.OperatorByConsAddress(consAddr); err != nil {
		return err
	} else if found && existing != m.Operator {
		return fmt.Errorf("consensus key is already registered to validator %s", existing.ValoperString())
	}
	if m.MinSelfDelegation.Cmp(p.MinSelfDelegation) < 0 {
		return fmt.Errorf("declared min_self_delegation %s is below the network minimum %s",
			types.FormatYZXA(m.MinSelfDelegation.Int()), types.FormatYZXA(p.MinSelfDelegation.Int()))
	}

	zero := types.MustAmount(types.Zero())
	v := state.Validator{
		Operator:          m.Operator,
		ConsensusPubKey:   m.ConsensusPubKey,
		Description:       m.Description,
		Tokens:            zero,
		DelegatorShares:   zero,
		CommissionBps:     m.CommissionRateBps,
		MaxCommissionBps:  m.MaxCommissionBps,
		MinSelfDelegation: m.MinSelfDelegation,
		RewardAccumulator: zero,
		CommissionOwed:    zero,
	}
	if err := s.SetValidator(v); err != nil {
		return err
	}
	if err := s.SetConsensusMapping(consAddr, m.Operator); err != nil {
		return err
	}
	return a.handleDelegate(s, tx.MsgDelegate{
		Delegator: m.Operator,
		Validator: m.Operator,
		Amount:    m.SelfDelegation,
	}, now)
}

// handleEditValidator updates validator metadata and commission.
func (a *App) handleEditValidator(s *state.State, m tx.MsgEditValidator) error {
	v, found, err := s.GetValidator(m.Operator)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("validator %s does not exist", m.Operator.ValoperString())
	}
	v.Description = m.Description
	if m.CommissionRateBps != nil {
		if *m.CommissionRateBps > v.MaxCommissionBps {
			return fmt.Errorf("commission %d bps exceeds the maximum %d bps this validator committed to",
				*m.CommissionRateBps, v.MaxCommissionBps)
		}
		v.CommissionBps = *m.CommissionRateBps
	}
	return s.SetValidator(v)
}

// handleUnjail returns a validator to the active set after downtime.
func (a *App) handleUnjail(s *state.State, m tx.MsgUnjail, now int64) error {
	v, found, err := s.GetValidator(m.Operator)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("validator %s does not exist", m.Operator.ValoperString())
	}
	if v.Tombstoned {
		return fmt.Errorf("validator %s was tombstoned for double signing and can never be unjailed",
			m.Operator.ValoperString())
	}
	if !v.Jailed {
		return fmt.Errorf("validator %s is not jailed", m.Operator.ValoperString())
	}
	if now < v.JailedUntilUnix {
		return fmt.Errorf("validator %s is jailed for another %d seconds",
			m.Operator.ValoperString(), v.JailedUntilUnix-now)
	}
	self, found, err := s.GetDelegation(v.Operator, v.Operator)
	if err != nil {
		return err
	}
	selfTokens := types.Zero()
	if found {
		if selfTokens, err = tokensForShares(v, self.Shares.Int()); err != nil {
			return err
		}
	}
	if selfTokens.Cmp(v.MinSelfDelegation.Int()) < 0 {
		return fmt.Errorf("self delegation of %s is below the required minimum of %s",
			types.FormatYZXA(selfTokens), types.FormatYZXA(v.MinSelfDelegation.Int()))
	}
	v.Jailed = false
	v.JailedUntilUnix = 0
	if si, found, err := s.GetSignInfo(v.Operator); err != nil {
		return err
	} else if found {
		si.ResetWindow()
		if err := s.SetSignInfo(si); err != nil {
			return err
		}
	}
	return s.SetValidator(v)
}
