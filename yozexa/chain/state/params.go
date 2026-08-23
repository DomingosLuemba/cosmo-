// Package state defines YOZEXA's on-chain data model and the typed accessors
// the state machine uses to read and write it.
package state

import (
	"encoding/json"
	"fmt"
	"math/big"

	"github.com/yozexa/yozexa/chain/types"
)

// Params are the consensus parameters of the application. Every field is
// changeable only through a governance proposal that passes quorum, threshold
// and the timelock — never by an operator, and never by an upgrade alone.
//
// Notably absent: anything that could raise the supply cap. The cap is a
// compile-time constant, not a parameter, precisely so that no vote can move
// it.
type Params struct {
	// --- Staking -------------------------------------------------------
	// MaxValidators is the size of the active set.
	MaxValidators uint32 `json:"max_validators"`
	// UnbondingSeconds is how long undelegated stake stays slashable. It is
	// the economic basis of security against long-range attacks: a validator
	// cannot unbond, then rewrite history from before it unbonded, without
	// its stake still being at risk.
	UnbondingSeconds int64 `json:"unbonding_seconds"`
	// MinSelfDelegation is the floor a validator must keep bonded itself.
	MinSelfDelegation types.Amount `json:"min_self_delegation"`
	// MaxEntries bounds concurrent unbonding/redelegation entries per pair.
	MaxEntries uint32 `json:"max_entries"`

	// --- Slashing ------------------------------------------------------
	// SlashFractionDoubleSignBps is the stake burned for equivocation.
	SlashFractionDoubleSignBps uint32 `json:"slash_fraction_double_sign_bps"`
	// SlashFractionDowntimeBps is the stake burned for liveness failure.
	SlashFractionDowntimeBps uint32 `json:"slash_fraction_downtime_bps"`
	// SignedBlocksWindow and MinSignedPerWindowBps define liveness.
	SignedBlocksWindow    int64  `json:"signed_blocks_window"`
	MinSignedPerWindowBps uint32 `json:"min_signed_per_window_bps"`
	// DowntimeJailSeconds is how long a validator stays jailed for downtime.
	DowntimeJailSeconds int64 `json:"downtime_jail_seconds"`

	// --- Fee market ----------------------------------------------------
	// MinBaseFee is the floor the dynamic base fee can never go below. A
	// non-zero floor is a spam defence: it keeps the cost of flooding the
	// mempool from decaying to nothing during quiet periods.
	MinBaseFee types.Amount `json:"min_base_fee"`
	// TargetBlockGas is the gas usage the base fee steers towards.
	TargetBlockGas uint64 `json:"target_block_gas"`
	// MaxBlockGas is the hard ceiling on gas in one block.
	MaxBlockGas uint64 `json:"max_block_gas"`
	// BaseFeeChangeDenominator bounds how fast the base fee can move: at most
	// 1/denominator per block, so the fee cannot be manipulated in one block.
	BaseFeeChangeDenominator uint64 `json:"base_fee_change_denominator"`
	// BaseFeeBurnBps is the share of the base fee that is burned rather than
	// paid to validators. Burning the base fee removes the incentive for a
	// proposer to inflate it by stuffing blocks with its own transactions.
	BaseFeeBurnBps uint32 `json:"base_fee_burn_bps"`

	// --- Governance ----------------------------------------------------
	MinDeposit           types.Amount `json:"min_deposit"`
	DepositPeriodSeconds int64        `json:"deposit_period_seconds"`
	VotingPeriodSeconds  int64        `json:"voting_period_seconds"`
	// TimelockSeconds is the delay between a proposal passing and executing.
	// It exists so that a governance capture attack cannot be executed
	// faster than users can react to it.
	TimelockSeconds int64 `json:"timelock_seconds"`
	// QuorumBps is the minimum share of bonded stake that must vote.
	QuorumBps uint32 `json:"quorum_bps"`
	// ThresholdBps is the yes share (of non-abstain votes) needed to pass.
	ThresholdBps uint32 `json:"threshold_bps"`
	// VetoBps is the no-with-veto share that rejects a proposal and burns
	// its deposit outright.
	VetoBps uint32 `json:"veto_bps"`

	// --- Treasury ------------------------------------------------------
	// TreasuryMaxSpendPerEpoch caps how much the treasury can pay out in one
	// epoch, so a single compromised vote cannot drain it in one block.
	TreasuryMaxSpendPerEpoch types.Amount `json:"treasury_max_spend_per_epoch"`
	TreasuryEpochSeconds     int64        `json:"treasury_epoch_seconds"`
}

// DefaultParams returns the parameters a fresh network starts with.
func DefaultParams() Params {
	return Params{
		MaxValidators:     100,
		UnbondingSeconds:  21 * 24 * 60 * 60, // 21 days
		MinSelfDelegation: types.MustAmount(types.YZXA(1)),
		MaxEntries:        7,

		SlashFractionDoubleSignBps: 500, // 5%
		SlashFractionDowntimeBps:   1,   // 0.01%
		SignedBlocksWindow:         10_000,
		MinSignedPerWindowBps:      5_000, // must sign 50% of the window
		DowntimeJailSeconds:        600,

		MinBaseFee:               types.MustAmount(big.NewInt(1_000_000_000)), // 1 gwei-equivalent
		TargetBlockGas:           15_000_000,
		MaxBlockGas:              30_000_000,
		BaseFeeChangeDenominator: 8,
		BaseFeeBurnBps:           10_000, // 100% of the base fee is burned

		MinDeposit:           types.MustAmount(types.YZXA(100)),
		DepositPeriodSeconds: 14 * 24 * 60 * 60,
		VotingPeriodSeconds:  7 * 24 * 60 * 60,
		TimelockSeconds:      2 * 24 * 60 * 60,
		QuorumBps:            3_340, // 33.4%
		ThresholdBps:         5_000, // 50%
		VetoBps:              3_340, // 33.4%

		TreasuryMaxSpendPerEpoch: types.MustAmount(types.YZXA(50_000)),
		TreasuryEpochSeconds:     30 * 24 * 60 * 60,
	}
}

// Validate rejects parameter sets that would make the chain unsafe. It runs on
// genesis and again on every governance parameter change, so a passed proposal
// with nonsensical values fails to execute rather than bricking the network.
func (p Params) Validate() error {
	if p.MaxValidators == 0 || p.MaxValidators > 1000 {
		return fmt.Errorf("max_validators must be 1..1000, got %d", p.MaxValidators)
	}
	if p.UnbondingSeconds < 60 {
		return fmt.Errorf("unbonding_seconds must be at least 60, got %d", p.UnbondingSeconds)
	}
	if p.MaxEntries == 0 || p.MaxEntries > 100 {
		return fmt.Errorf("max_entries must be 1..100, got %d", p.MaxEntries)
	}
	if p.SlashFractionDoubleSignBps > 10_000 || p.SlashFractionDowntimeBps > 10_000 {
		return fmt.Errorf("slash fractions must be <= 10000 bps")
	}
	if p.SlashFractionDoubleSignBps == 0 {
		return fmt.Errorf("double-sign slashing may not be disabled")
	}
	if p.SignedBlocksWindow < 100 {
		return fmt.Errorf("signed_blocks_window must be at least 100")
	}
	if p.MinSignedPerWindowBps > 10_000 {
		return fmt.Errorf("min_signed_per_window_bps must be <= 10000")
	}
	if !types.IsPositive(p.MinBaseFee.Int()) {
		return fmt.Errorf("min_base_fee must be positive")
	}
	if p.TargetBlockGas == 0 || p.MaxBlockGas < p.TargetBlockGas {
		return fmt.Errorf("max_block_gas must be >= target_block_gas > 0")
	}
	if p.BaseFeeChangeDenominator == 0 {
		return fmt.Errorf("base_fee_change_denominator must be positive")
	}
	if p.BaseFeeBurnBps > 10_000 {
		return fmt.Errorf("base_fee_burn_bps must be <= 10000")
	}
	if !types.IsPositive(p.MinDeposit.Int()) {
		return fmt.Errorf("min_deposit must be positive")
	}
	if p.VotingPeriodSeconds < 60 || p.DepositPeriodSeconds < 60 {
		return fmt.Errorf("governance periods must be at least 60 seconds")
	}
	if p.TimelockSeconds < 0 {
		return fmt.Errorf("timelock_seconds must not be negative")
	}
	if p.QuorumBps == 0 || p.QuorumBps > 10_000 {
		return fmt.Errorf("quorum_bps must be 1..10000")
	}
	if p.ThresholdBps == 0 {
		return fmt.Errorf("threshold_bps must be positive")
	}
	if p.ThresholdBps > 10_000 || p.VetoBps > 10_000 {
		return fmt.Errorf("threshold_bps and veto_bps must be <= 10000")
	}
	if p.TreasuryEpochSeconds < 60 {
		return fmt.Errorf("treasury_epoch_seconds must be at least 60")
	}
	return nil
}

// SetParam applies a single key/value change from a governance proposal.
// Unknown keys are rejected so that a passed proposal cannot silently do
// nothing while appearing to have taken effect.
func (p *Params) SetParam(key, value string) error {
	parseUint32 := func() (uint32, error) {
		var v uint64
		if _, err := fmt.Sscanf(value, "%d", &v); err != nil {
			return 0, fmt.Errorf("param %s: %q is not an integer", key, value)
		}
		if v > 0xFFFFFFFF {
			return 0, fmt.Errorf("param %s: %q out of range", key, value)
		}
		return uint32(v), nil
	}
	parseInt64 := func() (int64, error) {
		var v int64
		if _, err := fmt.Sscanf(value, "%d", &v); err != nil {
			return 0, fmt.Errorf("param %s: %q is not an integer", key, value)
		}
		return v, nil
	}
	parseUint64 := func() (uint64, error) {
		var v uint64
		if _, err := fmt.Sscanf(value, "%d", &v); err != nil {
			return 0, fmt.Errorf("param %s: %q is not an integer", key, value)
		}
		return v, nil
	}
	parseAmount := func() (types.Amount, error) { return types.AmountFromString(value) }

	var err error
	switch key {
	case "max_validators":
		p.MaxValidators, err = parseUint32()
	case "unbonding_seconds":
		p.UnbondingSeconds, err = parseInt64()
	case "min_self_delegation":
		p.MinSelfDelegation, err = parseAmount()
	case "max_entries":
		p.MaxEntries, err = parseUint32()
	case "slash_fraction_double_sign_bps":
		p.SlashFractionDoubleSignBps, err = parseUint32()
	case "slash_fraction_downtime_bps":
		p.SlashFractionDowntimeBps, err = parseUint32()
	case "signed_blocks_window":
		p.SignedBlocksWindow, err = parseInt64()
	case "min_signed_per_window_bps":
		p.MinSignedPerWindowBps, err = parseUint32()
	case "downtime_jail_seconds":
		p.DowntimeJailSeconds, err = parseInt64()
	case "min_base_fee":
		p.MinBaseFee, err = parseAmount()
	case "target_block_gas":
		p.TargetBlockGas, err = parseUint64()
	case "max_block_gas":
		p.MaxBlockGas, err = parseUint64()
	case "base_fee_change_denominator":
		p.BaseFeeChangeDenominator, err = parseUint64()
	case "base_fee_burn_bps":
		p.BaseFeeBurnBps, err = parseUint32()
	case "min_deposit":
		p.MinDeposit, err = parseAmount()
	case "deposit_period_seconds":
		p.DepositPeriodSeconds, err = parseInt64()
	case "voting_period_seconds":
		p.VotingPeriodSeconds, err = parseInt64()
	case "timelock_seconds":
		p.TimelockSeconds, err = parseInt64()
	case "quorum_bps":
		p.QuorumBps, err = parseUint32()
	case "threshold_bps":
		p.ThresholdBps, err = parseUint32()
	case "veto_bps":
		p.VetoBps, err = parseUint32()
	case "treasury_max_spend_per_epoch":
		p.TreasuryMaxSpendPerEpoch, err = parseAmount()
	case "treasury_epoch_seconds":
		p.TreasuryEpochSeconds, err = parseInt64()
	default:
		return fmt.Errorf("unknown parameter %q", key)
	}
	return err
}

// MarshalIndent renders params for the CLI and genesis files.
func (p Params) MarshalIndent() ([]byte, error) { return json.MarshalIndent(p, "", "  ") }
