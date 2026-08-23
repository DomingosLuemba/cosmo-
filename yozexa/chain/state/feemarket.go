package state

import (
	"math/big"

	"github.com/yozexa/yozexa/chain/types"
)

// The fee market follows the EIP-1559 design, which is the best-understood
// mechanism for pricing block space:
//
//   - a base fee that every transaction must pay, adjusted each block towards
//     a target gas usage;
//   - a tip on top, which is what actually orders transactions.
//
// The base fee can move by at most 1/BaseFeeChangeDenominator per block, so no
// single proposer can spike the price of a block, and users can predict the
// cost of the next few blocks. The base fee is burned, which removes the
// incentive for a proposer to stuff its own blocks to inflate its income.

// GetBaseFee reads the current base fee, falling back to the floor.
func (s *State) GetBaseFee() (*big.Int, error) {
	v, err := s.readBigInt(KeyBaseFee)
	if err != nil {
		return nil, err
	}
	if v.Sign() == 0 {
		p, err := s.Params()
		if err != nil {
			return nil, err
		}
		return p.MinBaseFee.Int(), nil
	}
	return v, nil
}

// SetBaseFee writes the base fee.
func (s *State) SetBaseFee(v *big.Int) error { return s.writeBigInt(KeyBaseFee, v) }

// NextBaseFee computes the base fee for the next block from the gas used in
// this one.
//
// delta = base * |used - target| / target / denominator, with a minimum step
// of 1 when the direction is upwards, so the fee can always escape a floor
// during sustained congestion.
func NextBaseFee(current *big.Int, gasUsed, target uint64, denominator uint64, minBaseFee *big.Int) *big.Int {
	if target == 0 || denominator == 0 {
		return new(big.Int).Set(current)
	}
	t := new(big.Int).SetUint64(target)
	d := new(big.Int).SetUint64(denominator)

	switch {
	case gasUsed == target:
		return new(big.Int).Set(current)

	case gasUsed > target:
		delta := new(big.Int).SetUint64(gasUsed - target)
		delta.Mul(delta, current)
		delta.Quo(delta, t)
		delta.Quo(delta, d)
		if delta.Sign() == 0 {
			delta = big.NewInt(1)
		}
		return new(big.Int).Add(current, delta)

	default:
		delta := new(big.Int).SetUint64(target - gasUsed)
		delta.Mul(delta, current)
		delta.Quo(delta, t)
		delta.Quo(delta, d)
		next := new(big.Int).Sub(current, delta)
		if next.Cmp(minBaseFee) < 0 {
			return new(big.Int).Set(minBaseFee)
		}
		return next
	}
}

// FeeTier is a wallet-facing gas price suggestion.
type FeeTier struct {
	Name     string `json:"name"`
	GasPrice string `json:"gas_price"`
	// Description is shown verbatim in the wallet so the trade-off is stated,
	// not implied by a colour.
	Description string `json:"description"`
}

// FeeTiers derives the three tiers a wallet offers from the current base fee.
//
// Every tier states the full price. There is no hidden component: what the
// wallet shows is what the account pays, and no product built on top of the
// network adds a second fee to a plain transfer.
func FeeTiers(baseFee *big.Int) []FeeTier {
	economy := new(big.Int).Set(baseFee)
	normal, _ := types.MulQuo(baseFee, 110, 100)
	priority, _ := types.MulQuo(baseFee, 150, 100)
	return []FeeTier{
		{Name: "economy", GasPrice: economy.String(),
			Description: "Pays the base fee only. Included when there is spare block space; may wait during congestion."},
		{Name: "normal", GasPrice: normal.String(),
			Description: "Base fee plus a 10% tip. Recommended for everyday payments."},
		{Name: "priority", GasPrice: priority.String(),
			Description: "Base fee plus a 50% tip. For time-sensitive payments during congestion."},
	}
}
