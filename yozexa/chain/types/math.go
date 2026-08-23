package types

import (
	"errors"
	"fmt"
	"math/big"
)

// ErrNegative is returned whenever an operation would produce a negative
// amount of money. Money is unsigned on this network: a negative balance is
// always a bug, never a state.
var ErrNegative = errors.New("negative amount")

// ErrOverflow is returned when a value would exceed the protocol ceiling.
var ErrOverflow = errors.New("amount overflow")

// NewInt returns a big.Int copy, never sharing memory with the caller.
func NewInt(v *big.Int) *big.Int {
	if v == nil {
		return big.NewInt(0)
	}
	return new(big.Int).Set(v)
}

// Zero returns a fresh zero.
func Zero() *big.Int { return big.NewInt(0) }

// Add returns a+b, rejecting nil operands and negative results.
func Add(a, b *big.Int) (*big.Int, error) {
	if a == nil || b == nil {
		return nil, errors.New("nil operand")
	}
	r := new(big.Int).Add(a, b)
	if r.Sign() < 0 {
		return nil, ErrNegative
	}
	return r, nil
}

// Sub returns a-b and fails if the result would be negative. Callers moving
// funds MUST use this rather than big.Int.Sub so an under-funded transfer can
// never silently create money.
func Sub(a, b *big.Int) (*big.Int, error) {
	if a == nil || b == nil {
		return nil, errors.New("nil operand")
	}
	r := new(big.Int).Sub(a, b)
	if r.Sign() < 0 {
		return nil, fmt.Errorf("%w: %s - %s", ErrNegative, a, b)
	}
	return r, nil
}

// MulQuo computes a * num / den with a single rounding step (floor), keeping
// full precision in the intermediate product. Used for commissions, slashing
// fractions and reward splits, where computing (a/den)*num would lose value.
func MulQuo(a *big.Int, num, den int64) (*big.Int, error) {
	if a == nil {
		return nil, errors.New("nil operand")
	}
	if den == 0 {
		return nil, errors.New("division by zero")
	}
	if a.Sign() < 0 || num < 0 || den < 0 {
		return nil, ErrNegative
	}
	r := new(big.Int).Mul(a, big.NewInt(num))
	return r.Quo(r, big.NewInt(den)), nil
}

// IsNonNegative reports whether v is a valid (>= 0) money amount.
func IsNonNegative(v *big.Int) bool { return v != nil && v.Sign() >= 0 }

// IsPositive reports whether v is strictly greater than zero.
func IsPositive(v *big.Int) bool { return v != nil && v.Sign() > 0 }

// Min returns the smaller of a and b as a fresh value.
func Min(a, b *big.Int) *big.Int {
	if a.Cmp(b) <= 0 {
		return new(big.Int).Set(a)
	}
	return new(big.Int).Set(b)
}

// CheckSupplyCap fails if `minted` would exceed the absolute hard cap.
//
// This is the single choke point through which every unit of YZXA that has
// ever existed must pass. It is deliberately dependency-free so that it can be
// read, reviewed and formally checked in isolation.
func CheckSupplyCap(minted *big.Int) error {
	if minted == nil {
		return errors.New("nil minted supply")
	}
	if minted.Sign() < 0 {
		return fmt.Errorf("%w: minted supply %s", ErrNegative, minted)
	}
	if minted.Cmp(MaxSupply) > 0 {
		return fmt.Errorf("%w: minted %s exceeds hard cap %s ayzxa",
			ErrOverflow, minted, MaxSupply)
	}
	return nil
}
