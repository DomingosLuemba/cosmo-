package state

import (
	"encoding/base64"
	"fmt"
	"math/big"
	"sort"

	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// Module accounts hold protocol-owned funds. They have deterministic,
// key-less addresses: no private key exists that can sign for them, so their
// balances can only move through the state machine's own logic.
var (
	// ModuleBonded holds all stake that is currently bonded.
	ModuleBonded = types.ModuleAddress("bonded_pool")
	// ModuleUnbonding holds stake that is unbonding and still slashable.
	ModuleUnbonding = types.ModuleAddress("unbonding_pool")
	// ModuleEmission holds the undistributed network emission reserve.
	ModuleEmission = types.ModuleAddress("emission_pool")
	// ModuleRewards holds accrued, unclaimed staking rewards.
	ModuleRewards = types.ModuleAddress("reward_pool")
	// ModuleTreasury is the ecosystem treasury, spendable only by governance.
	ModuleTreasury = types.ModuleAddress("treasury")
	// ModuleSecurity funds audits, bug bounties and emergency security work.
	ModuleSecurity = types.ModuleAddress("security_fund")
	// ModuleEcosystem funds grants and developer programmes.
	ModuleEcosystem = types.ModuleAddress("ecosystem_fund")
	// ModuleLiquidity holds the liquidity allocation.
	ModuleLiquidity = types.ModuleAddress("liquidity_fund")
	// ModuleGovDeposit escrows governance proposal deposits.
	ModuleGovDeposit = types.ModuleAddress("gov_deposit")
)

// ModuleAccounts lists every protocol-owned account, for the supply dashboard
// and for the invariant that checks their balances add up.
func ModuleAccounts() map[string]types.Address {
	return map[string]types.Address{
		"bonded_pool":    ModuleBonded,
		"unbonding_pool": ModuleUnbonding,
		"emission_pool":  ModuleEmission,
		"reward_pool":    ModuleRewards,
		"treasury":       ModuleTreasury,
		"security_fund":  ModuleSecurity,
		"ecosystem_fund": ModuleEcosystem,
		"liquidity_fund": ModuleLiquidity,
		"gov_deposit":    ModuleGovDeposit,
	}
}

// Validator is a consensus participant.
type Validator struct {
	Operator types.Address `json:"operator"`
	// ConsensusPubKey is the base64 ed25519 key CometBFT signs blocks with.
	// It is distinct from the operator key: the consensus key lives on a
	// hot machine and can be rotated, the operator key controls the stake
	// and should live on hardware.
	ConsensusPubKey string         `json:"consensus_pubkey"`
	Description     tx.Description `json:"description"`
	// Tokens is the total bonded to this validator, self-bond included.
	Tokens types.Amount `json:"tokens"`
	// DelegatorShares tracks proportional ownership of Tokens. Slashing
	// reduces Tokens without touching shares, so every delegator takes the
	// loss pro rata and nobody can escape a slash by withdrawing first.
	DelegatorShares   types.Amount `json:"delegator_shares"`
	CommissionBps     uint32       `json:"commission_bps"`
	MaxCommissionBps  uint32       `json:"max_commission_bps"`
	MinSelfDelegation types.Amount `json:"min_self_delegation"`
	// Jailed validators are excluded from the active set.
	Jailed bool `json:"jailed"`
	// Tombstoned validators are permanently excluded. Double signing
	// tombstones a validator: it can never return, under any operator action
	// or governance vote.
	Tombstoned      bool  `json:"tombstoned"`
	JailedUntilUnix int64 `json:"jailed_until_unix,omitempty"`
	// RewardAccumulator is the F1 fee-distribution accumulator: cumulative
	// reward per share, scaled by RewardScale.
	RewardAccumulator types.Amount `json:"reward_accumulator"`
	// CommissionOwed is commission earned but not yet withdrawn.
	CommissionOwed types.Amount `json:"commission_owed"`
}

// RewardScale is the fixed-point scale of the reward accumulator. Rewards are
// tracked as reward-per-share multiplied by this constant so that per-block
// distributions to large validator sets do not round to zero.
var RewardScale = new(big.Int).Exp(big.NewInt(10), big.NewInt(27), nil)

// Delegation is one delegator's position with one validator.
type Delegation struct {
	Delegator types.Address `json:"delegator"`
	Validator types.Address `json:"validator"`
	Shares    types.Amount  `json:"shares"`
	// RewardDebt is the accumulator value at the delegator's last reward
	// settlement. Pending reward = shares * (accumulator - debt) / scale.
	RewardDebt types.Amount `json:"reward_debt"`
}

// UnbondingEntry is stake in the unbonding queue. It no longer votes but is
// still slashable until it completes.
type UnbondingEntry struct {
	ID           uint64        `json:"id"`
	Delegator    types.Address `json:"delegator"`
	Validator    types.Address `json:"validator"`
	Amount       types.Amount  `json:"amount"`
	CompleteUnix int64         `json:"complete_unix"`
	// CreatedUnix is when the entry entered the queue. Evidence of an
	// infraction that happened at or before this time still slashes it.
	CreatedUnix int64 `json:"created_unix"`
	// RedelegateTo, when set, makes the matured stake bond to that validator
	// automatically instead of returning to the delegator's balance.
	RedelegateTo *types.Address `json:"redelegate_to,omitempty"`
}

func validatorKey(a types.Address) string { return PrefixValidator + addrKey(a) }
func delegationKey(val, del types.Address) string {
	return PrefixDelegation + addrKey(val) + "/" + addrKey(del)
}
func unbondingKey(completeUnix int64, id uint64) string {
	// Time-ordered key so the queue can be scanned in maturity order.
	return fmt.Sprintf("%s%020d/%020d", PrefixUnbonding, completeUnix, id)
}

// GetValidator reads a validator.
func (s *State) GetValidator(a types.Address) (Validator, bool, error) {
	var v Validator
	found, err := s.getJSON(validatorKey(a), &v)
	return v, found, err
}

// SetValidator writes a validator.
func (s *State) SetValidator(v Validator) error { return s.setJSON(validatorKey(v.Operator), v) }

// IterateValidators visits every validator in key order.
func (s *State) IterateValidators(fn func(Validator) bool) error {
	return s.kv.Iterate([]byte(PrefixValidator), func(_, value []byte) bool {
		var v Validator
		if err := jsonUnmarshal(value, &v); err != nil {
			return true
		}
		return fn(v)
	})
}

// AllValidators returns every validator, sorted by operator address so the
// result is identical on every node.
func (s *State) AllValidators() ([]Validator, error) {
	out := []Validator{}
	err := s.IterateValidators(func(v Validator) bool {
		out = append(out, v)
		return true
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Operator.Hex() < out[j].Operator.Hex() })
	return out, nil
}

// ActiveSet returns the validators that should be producing blocks: not
// jailed, not tombstoned, holding stake, ranked by voting power.
//
// Ties are broken by operator address so that the ordering is total and
// deterministic. Without a deterministic tie-break, two nodes could compute
// different validator sets from identical state and fork.
func (s *State) ActiveSet(maxValidators uint32) ([]Validator, error) {
	all, err := s.AllValidators()
	if err != nil {
		return nil, err
	}
	eligible := make([]Validator, 0, len(all))
	for _, v := range all {
		if v.Jailed || v.Tombstoned {
			continue
		}
		if !types.IsPositive(v.Tokens.Int()) {
			continue
		}
		eligible = append(eligible, v)
	}
	sort.SliceStable(eligible, func(i, j int) bool {
		c := eligible[i].Tokens.Int().Cmp(eligible[j].Tokens.Int())
		if c != 0 {
			return c > 0 // more stake first
		}
		return eligible[i].Operator.Hex() < eligible[j].Operator.Hex()
	})
	if uint32(len(eligible)) > maxValidators {
		eligible = eligible[:maxValidators]
	}
	return eligible, nil
}

// GetDelegation reads a delegation.
func (s *State) GetDelegation(val, del types.Address) (Delegation, bool, error) {
	var d Delegation
	found, err := s.getJSON(delegationKey(val, del), &d)
	return d, found, err
}

// SetDelegation writes a delegation, removing it when it reaches zero shares.
func (s *State) SetDelegation(d Delegation) error {
	if d.Shares.IsZero() {
		return s.delete(delegationKey(d.Validator, d.Delegator))
	}
	return s.setJSON(delegationKey(d.Validator, d.Delegator), d)
}

// IterateDelegations visits every delegation of a validator.
func (s *State) IterateDelegations(val types.Address, fn func(Delegation) bool) error {
	return s.kv.Iterate([]byte(PrefixDelegation+addrKey(val)+"/"), func(_, value []byte) bool {
		var d Delegation
		if err := jsonUnmarshal(value, &d); err != nil {
			return true
		}
		return fn(d)
	})
}

// IterateAllDelegations visits every delegation on the network.
func (s *State) IterateAllDelegations(fn func(Delegation) bool) error {
	return s.kv.Iterate([]byte(PrefixDelegation), func(_, value []byte) bool {
		var d Delegation
		if err := jsonUnmarshal(value, &d); err != nil {
			return true
		}
		return fn(d)
	})
}

// AddUnbonding appends to the unbonding queue.
func (s *State) AddUnbonding(e UnbondingEntry) error {
	return s.setJSON(unbondingKey(e.CompleteUnix, e.ID), e)
}

// IterateMatureUnbonding visits every unbonding entry that completes at or
// before nowUnix, in maturity order.
func (s *State) IterateMatureUnbonding(nowUnix int64, fn func(UnbondingEntry) bool) error {
	var toVisit []UnbondingEntry
	err := s.kv.Iterate([]byte(PrefixUnbonding), func(_, value []byte) bool {
		var e UnbondingEntry
		if err := jsonUnmarshal(value, &e); err != nil {
			return true
		}
		if e.CompleteUnix > nowUnix {
			return false // keys are time-ordered: nothing later can be mature
		}
		toVisit = append(toVisit, e)
		return true
	})
	if err != nil {
		return err
	}
	for _, e := range toVisit {
		if !fn(e) {
			break
		}
	}
	return nil
}

// RemoveUnbonding deletes a completed entry.
func (s *State) RemoveUnbonding(e UnbondingEntry) error {
	return s.delete(unbondingKey(e.CompleteUnix, e.ID))
}

// CountUnbondingEntries counts a delegator's open entries with a validator,
// which the max_entries parameter bounds.
func (s *State) CountUnbondingEntries(del, val types.Address) (uint32, error) {
	var n uint32
	err := s.kv.Iterate([]byte(PrefixUnbonding), func(_, value []byte) bool {
		var e UnbondingEntry
		if err := jsonUnmarshal(value, &e); err != nil {
			return true
		}
		if e.Delegator == del && e.Validator == val {
			n++
		}
		return true
	})
	return n, err
}

// ConsAddressFromPubKey maps a base64 ed25519 consensus key to the 20-byte
// consensus address CometBFT reports in evidence and vote info.
func ConsAddressFromPubKey(b64 string) (types.Address, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return types.Address{}, fmt.Errorf("invalid consensus key encoding: %w", err)
	}
	if len(raw) != 32 {
		return types.Address{}, fmt.Errorf("ed25519 consensus key must be 32 bytes, got %d", len(raw))
	}
	return types.AddressFromPubKey(raw), nil
}

// SetConsensusMapping records which operator a consensus address belongs to,
// so evidence reported by CometBFT can be attributed to a stake position.
func (s *State) SetConsensusMapping(cons types.Address, operator types.Address) error {
	return s.setJSON(PrefixConsAddr+addrKey(cons), operator)
}

// OperatorByConsAddress resolves a consensus address to its operator.
func (s *State) OperatorByConsAddress(cons types.Address) (types.Address, bool, error) {
	var op types.Address
	found, err := s.getJSON(PrefixConsAddr+addrKey(cons), &op)
	return op, found, err
}

// TotalBonded returns the stake backing consensus right now.
func (s *State) TotalBonded() (*big.Int, error) { return s.Balance(ModuleBonded) }
