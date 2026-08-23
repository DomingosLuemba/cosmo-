package app

import (
	"encoding/json"
	"fmt"
	"math/big"

	abci "github.com/cometbft/cometbft/abci/types"

	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// applyGenesis writes the initial state.
//
// Every unit of YZXA that exists at height 0 is minted here, through the same
// state.Mint choke point that the emission schedule uses, so the hard cap is
// enforced on the genesis allocation exactly as it is on a block reward.
func (a *App) applyGenesis(g Genesis) error {
	s := a.state
	a.chainID = g.ChainID
	a.genesisTime = g.GenesisTime.UTC()

	meta, err := json.Marshal(chainMeta{
		ChainID:         g.ChainID,
		GenesisTimeUnix: a.genesisTime.Unix(),
	})
	if err != nil {
		return err
	}
	if err := a.kv.Set([]byte("chain/meta"), meta); err != nil {
		return err
	}
	if err := s.SetParams(g.Params); err != nil {
		return err
	}
	if err := s.SetBaseFee(g.Params.MinBaseFee.Int()); err != nil {
		return err
	}

	for _, acc := range g.Accounts {
		if err := s.Mint(acc.Address, acc.Balance.Int()); err != nil {
			return fmt.Errorf("genesis account %s: %w", acc.Address, err)
		}
	}

	genesisUnix := a.genesisTime.Unix()
	for _, v := range g.Vesting {
		if err := s.Mint(v.Address, v.Total.Int()); err != nil {
			return fmt.Errorf("genesis vesting %s: %w", v.Address, err)
		}
		if err := s.SetVestingSchedule(state.VestingSchedule{
			Address:         v.Address,
			Category:        v.Category,
			Total:           v.Total,
			StartUnix:       genesisUnix,
			CliffSeconds:    v.CliffSeconds,
			DurationSeconds: v.DurationSeconds,
		}); err != nil {
			return err
		}
	}

	if g.FundAllocations {
		allocations := []struct {
			addr types.Address
			amt  int64
			name string
		}{
			{state.ModuleEcosystem, AllocEcosystemYZXA, "ecosystem"},
			{state.ModuleLiquidity, AllocLiquidityYZXA, "liquidity"},
			{state.ModuleTreasury, AllocTreasuryYZXA, "treasury"},
			{state.ModuleSecurity, AllocSecurityYZXA, "security"},
		}
		for _, al := range allocations {
			if err := s.Mint(al.addr, types.YZXA(al.amt)); err != nil {
				return fmt.Errorf("genesis %s allocation: %w", al.name, err)
			}
		}
	}

	for _, v := range g.Validators {
		if err := a.handleCreateValidator(s, tx.MsgCreateValidator{
			Operator:          v.Operator,
			ConsensusPubKey:   v.ConsensusPubKey,
			Description:       tx.Description{Moniker: v.Moniker},
			CommissionRateBps: v.CommissionBps,
			MaxCommissionBps:  v.MaxCommissionBps,
			MinSelfDelegation: v.MinSelfDelegation,
			SelfDelegation:    v.SelfDelegation,
		}, genesisUnix, g.Params); err != nil {
			return fmt.Errorf("genesis validator %s: %w", v.Moniker, err)
		}
	}

	// The genesis allocation must leave room for the entire emission reserve.
	minted, err := s.MintedSupply()
	if err != nil {
		return err
	}
	withEmission, err := types.Add(minted, state.EmissionReserve())
	if err != nil {
		return err
	}
	if err := types.CheckSupplyCap(withEmission); err != nil {
		return fmt.Errorf("genesis leaves no room for the emission reserve: %w", err)
	}
	return nil
}

// beginBlock runs before any transaction: liveness accounting, evidence
// handling, emission and reward distribution.
func (a *App) beginBlock(req *abci.RequestFinalizeBlock, now int64, p state.Params) error {
	a.currentHeight = req.Height

	// 0. Stop before anything else if the network voted for an upgrade this
	//    node does not implement. Executing the block would mean computing a
	//    different app hash from the nodes that did upgrade, and a split chain
	//    is worse than a stopped one.
	if err := a.checkScheduledUpgrade(req.Height); err != nil {
		return err
	}

	// 1. Punish equivocation first. A validator that double signed must not be
	//    paid for the block in which its evidence landed.
	for _, ev := range req.Misbehavior {
		if err := a.handleMisbehavior(ev, now, p); err != nil {
			return fmt.Errorf("handle misbehavior: %w", err)
		}
	}

	// 2. Liveness: record who signed the previous block.
	if err := a.recordLiveness(req.DecidedLastCommit, now, p); err != nil {
		return fmt.Errorf("record liveness: %w", err)
	}

	// 3. Emission: create the block reward and hand it to the reward pool.
	if err := a.emitBlockReward(req.Height); err != nil {
		return fmt.Errorf("emit block reward: %w", err)
	}

	// 4. Distribute everything the reward pool holds but has not yet
	//    allocated: this block's emission plus the previous block's fees.
	return a.distributeRewards(p)
}

// handleMisbehavior slashes and permanently tombstones an equivocating
// validator.
//
// Double signing is the one infraction that ends a validator forever. A
// tombstoned consensus key can never validate again, under any operator, and
// no governance vote in this codebase can undo it.
func (a *App) handleMisbehavior(ev abci.Misbehavior, now int64, p state.Params) error {
	s := a.state
	consAddr, err := types.AddressFromBytes(ev.Validator.Address)
	if err != nil {
		return nil // not an address we can attribute; nothing to do
	}
	operator, found, err := s.OperatorByConsAddress(consAddr)
	if err != nil || !found {
		return err
	}
	already, err := s.IsTombstoned(consAddr)
	if err != nil {
		return err
	}
	if already {
		return nil // do not slash twice for the same permanent ban
	}

	infractionUnix := ev.Time.UTC().Unix()

	burned, err := s.SlashValidator(operator, p.SlashFractionDoubleSignBps)
	if err != nil {
		return err
	}
	// Stake that was already unbonding when the infraction happened is
	// slashed too. Without this, a validator could equivocate and then simply
	// wait out the unbonding period with its stake untouched.
	unbondingBurned, err := a.slashUnbonding(operator, infractionUnix, p.SlashFractionDoubleSignBps)
	if err != nil {
		return err
	}

	v, found, err := s.GetValidator(operator)
	if err != nil {
		return err
	}
	if found {
		v.Jailed = true
		v.Tombstoned = true
		v.JailedUntilUnix = 0
		if err := s.SetValidator(v); err != nil {
			return err
		}
	}
	if err := s.SetTombstone(consAddr); err != nil {
		return err
	}
	a.logger.Error("validator tombstoned for double signing",
		"operator", operator.ValoperString(),
		"height", ev.Height,
		"burned_bonded", burned.String(),
		"burned_unbonding", unbondingBurned.String())
	_ = now
	return nil
}

// slashUnbonding burns a fraction of every unbonding entry of a validator that
// was in flight at the time of the infraction.
func (a *App) slashUnbonding(operator types.Address, infractionUnix int64, fractionBps uint32) (*big.Int, error) {
	s := a.state
	total := types.Zero()
	var entries []state.UnbondingEntry
	err := s.Store().Iterate([]byte(state.PrefixUnbonding), func(_, value []byte) bool {
		var e state.UnbondingEntry
		if err := json.Unmarshal(value, &e); err != nil {
			return true
		}
		if e.Validator == operator && e.CreatedUnix >= infractionUnix {
			entries = append(entries, e)
		}
		return true
	})
	if err != nil {
		return nil, err
	}
	for _, e := range entries {
		slash, err := types.MulQuo(e.Amount.Int(), int64(fractionBps), 10_000)
		if err != nil {
			return nil, err
		}
		if slash.Sign() == 0 {
			continue
		}
		remaining, err := types.Sub(e.Amount.Int(), slash)
		if err != nil {
			return nil, err
		}
		if err := s.RemoveUnbonding(e); err != nil {
			return nil, err
		}
		if e.Amount, err = types.NewAmount(remaining); err != nil {
			return nil, err
		}
		if err := s.AddUnbonding(e); err != nil {
			return nil, err
		}
		if err := s.Burn(state.ModuleUnbonding, slash); err != nil {
			return nil, err
		}
		if total, err = types.Add(total, slash); err != nil {
			return nil, err
		}
	}
	return total, nil
}

// recordLiveness updates every active validator's signing window and jails
// those that fall below the liveness threshold.
func (a *App) recordLiveness(commit abci.CommitInfo, now int64, p state.Params) error {
	s := a.state
	for _, vote := range commit.Votes {
		consAddr, err := types.AddressFromBytes(vote.Validator.Address)
		if err != nil {
			continue
		}
		operator, found, err := s.OperatorByConsAddress(consAddr)
		if err != nil {
			return err
		}
		if !found {
			continue
		}
		si, found, err := s.GetSignInfo(operator)
		if err != nil {
			return err
		}
		if !found {
			si = state.SignInfo{Operator: operator}
		}
		// Only a commit vote counts as having signed. A nil vote is a vote
		// for no block and an absent vote is no vote at all; neither
		// demonstrates liveness for this height.
		signed := vote.BlockIdFlag == cmtBlockIDFlagCommit

		shouldJail := si.RecordSignature(signed, p.SignedBlocksWindow, p.MinSignedPerWindowBps)
		if shouldJail {
			v, found, err := s.GetValidator(operator)
			if err != nil {
				return err
			}
			if found && !v.Jailed && !v.Tombstoned {
				if _, err := s.SlashValidator(operator, p.SlashFractionDowntimeBps); err != nil {
					return err
				}
				v.Jailed = true
				v.JailedUntilUnix = now + p.DowntimeJailSeconds
				if err := s.SetValidator(v); err != nil {
					return err
				}
				si.ResetWindow()
				a.logger.Info("validator jailed for downtime",
					"operator", operator.ValoperString(),
					"until_unix", v.JailedUntilUnix)
			}
		}
		if err := s.SetSignInfo(si); err != nil {
			return err
		}
	}
	return nil
}

// CometBFT block id flags, restated here so the state machine does not depend
// on the numeric values drifting under it.
const (
	cmtBlockIDFlagCommit = 2
)

// emitBlockReward mints this block's emission into the reward pool.
func (a *App) emitBlockReward(height int64) error {
	s := a.state
	es, err := s.GetEmissionState()
	if err != nil {
		return err
	}
	// Idempotent under replay: a height already rewarded is never rewarded
	// twice, even if CometBFT re-delivers the block after a crash.
	if es.LastRewardHeight >= height {
		return nil
	}
	reward, err := s.NextBlockReward(height)
	if err != nil {
		return err
	}
	if reward.Sign() > 0 {
		if err := s.Mint(state.ModuleRewards, reward); err != nil {
			return fmt.Errorf("block reward: %w", err)
		}
		emitted, err := types.Add(es.TotalEmitted.Int(), reward)
		if err != nil {
			return err
		}
		if es.TotalEmitted, err = types.NewAmount(emitted); err != nil {
			return err
		}
		if err := a.addUndistributed(reward); err != nil {
			return err
		}
	}
	es.LastRewardHeight = height
	return s.SetEmissionState(es)
}

func (a *App) getUndistributed() (*big.Int, error) {
	raw, err := a.kv.Get([]byte(KeyUndistributed))
	if err != nil {
		return big.NewInt(0), nil
	}
	v, ok := new(big.Int).SetString(string(raw), 10)
	if !ok {
		return nil, fmt.Errorf("corrupt undistributed reward counter")
	}
	return v, nil
}

func (a *App) setUndistributed(v *big.Int) error {
	return a.kv.Set([]byte(KeyUndistributed), []byte(v.String()))
}

func (a *App) addUndistributed(v *big.Int) error {
	cur, err := a.getUndistributed()
	if err != nil {
		return err
	}
	next, err := types.Add(cur, v)
	if err != nil {
		return err
	}
	return a.setUndistributed(next)
}

// distributeRewards allocates the undistributed reward pool across the active
// validators in proportion to their bonded stake.
//
// Each validator takes its commission and the rest raises its reward
// accumulator, which is what delegators claim against. Integer division leaves
// a remainder; it stays in the undistributed counter and is paid out in a
// later block rather than being lost or, worse, double-counted.
func (a *App) distributeRewards(p state.Params) error {
	s := a.state
	pool, err := a.getUndistributed()
	if err != nil {
		return err
	}
	if pool.Sign() == 0 {
		return nil
	}
	set, err := s.ActiveSet(p.MaxValidators)
	if err != nil {
		return err
	}
	if len(set) == 0 {
		return nil // nothing to pay; the pool carries over
	}
	totalStake := types.Zero()
	for _, v := range set {
		if totalStake, err = types.Add(totalStake, v.Tokens.Int()); err != nil {
			return err
		}
	}
	if totalStake.Sign() == 0 {
		return nil
	}

	distributed := types.Zero()
	for _, v := range set {
		share := new(big.Int).Mul(pool, v.Tokens.Int())
		share.Quo(share, totalStake)
		if share.Sign() == 0 {
			continue
		}
		commission, err := types.MulQuo(share, int64(v.CommissionBps), 10_000)
		if err != nil {
			return err
		}
		toDelegators, err := types.Sub(share, commission)
		if err != nil {
			return err
		}

		owed, err := types.Add(v.CommissionOwed.Int(), commission)
		if err != nil {
			return err
		}
		if v.CommissionOwed, err = types.NewAmount(owed); err != nil {
			return err
		}

		if types.IsPositive(v.DelegatorShares.Int()) && toDelegators.Sign() > 0 {
			inc := new(big.Int).Mul(toDelegators, state.RewardScale)
			inc.Quo(inc, v.DelegatorShares.Int())
			acc, err := types.Add(v.RewardAccumulator.Int(), inc)
			if err != nil {
				return err
			}
			if v.RewardAccumulator, err = types.NewAmount(acc); err != nil {
				return err
			}
		}
		if err := s.SetValidator(v); err != nil {
			return err
		}
		if distributed, err = types.Add(distributed, share); err != nil {
			return err
		}
	}
	remainder, err := types.Sub(pool, distributed)
	if err != nil {
		return err
	}
	return a.setUndistributed(remainder)
}

// endBlock runs after every transaction: matured unbonding, governance
// transitions and the fee-market update.
func (a *App) endBlock(height, now int64, p state.Params) ([]abci.Event, error) {
	var events []abci.Event

	completed, err := a.completeMaturedUnbonding(now, p)
	if err != nil {
		return nil, err
	}
	if completed > 0 {
		events = append(events, abci.Event{
			Type: "unbonding_completed",
			Attributes: []abci.EventAttribute{
				{Key: "count", Value: fmt.Sprintf("%d", completed)},
			},
		})
	}

	govEvents, err := a.processGovernance(now, p)
	if err != nil {
		return nil, err
	}
	events = append(events, govEvents...)

	// Fee market: adjust the base fee towards the target gas usage.
	baseFee, err := a.state.GetBaseFee()
	if err != nil {
		return nil, err
	}
	next := state.NextBaseFee(baseFee, a.blockGasUsed, p.TargetBlockGas,
		p.BaseFeeChangeDenominator, p.MinBaseFee.Int())
	if err := a.state.SetBaseFee(next); err != nil {
		return nil, err
	}

	events = append(events, abci.Event{
		Type: "block_economics",
		Attributes: []abci.EventAttribute{
			{Key: "height", Value: fmt.Sprintf("%d", height)},
			{Key: "gas_used", Value: fmt.Sprintf("%d", a.blockGasUsed)},
			{Key: "base_fee", Value: baseFee.String()},
			{Key: "next_base_fee", Value: next.String()},
			{Key: "fees_to_validators", Value: a.blockFees.String()},
			{Key: "fees_burned", Value: a.blockBurned.String()},
		},
	})
	return events, nil
}

// completeMaturedUnbonding returns matured stake to its delegators, or bonds
// it to the destination validator when the entry came from a redelegation.
func (a *App) completeMaturedUnbonding(now int64, p state.Params) (int, error) {
	s := a.state
	var matured []state.UnbondingEntry
	if err := s.IterateMatureUnbonding(now, func(e state.UnbondingEntry) bool {
		matured = append(matured, e)
		return true
	}); err != nil {
		return 0, err
	}

	for _, e := range matured {
		amount := e.Amount.Int()
		if err := s.SubBalance(state.ModuleUnbonding, amount); err != nil {
			return 0, err
		}
		if err := s.AddBalance(e.Delegator, amount); err != nil {
			return 0, err
		}
		if err := s.RemoveUnbonding(e); err != nil {
			return 0, err
		}
		if e.RedelegateTo != nil {
			amt, err := types.NewAmount(amount)
			if err != nil {
				return 0, err
			}
			// A queued redelegation bonds automatically. If the destination
			// validator has since been tombstoned the funds simply stay with
			// the delegator rather than being locked with a dead validator.
			if err := a.handleDelegate(s, tx.MsgDelegate{
				Delegator: e.Delegator,
				Validator: *e.RedelegateTo,
				Amount:    amt,
			}, now); err != nil {
				a.logger.Info("queued redelegation could not complete; funds returned to delegator",
					"delegator", e.Delegator.String(),
					"validator", e.RedelegateTo.ValoperString(),
					"reason", err.Error())
			}
		}
	}
	_ = p
	return len(matured), nil
}
