package types

import (
	"encoding/json"
	"fmt"
	"math/big"
)

// Amount is a non-negative integer number of ayzxa.
//
// It marshals to and from a JSON *string* so that no JSON parser anywhere in
// the stack (JavaScript especially) can round a balance through a float64.
type Amount struct {
	i *big.Int
}

// NewAmount builds an Amount from a big.Int, copying it.
func NewAmount(v *big.Int) (Amount, error) {
	if v == nil {
		return Amount{}, fmt.Errorf("nil amount")
	}
	if v.Sign() < 0 {
		return Amount{}, fmt.Errorf("%w: %s", ErrNegative, v)
	}
	return Amount{i: new(big.Int).Set(v)}, nil
}

// MustAmount is for constants and tests only; it panics on invalid input.
func MustAmount(v *big.Int) Amount {
	a, err := NewAmount(v)
	if err != nil {
		panic(err)
	}
	return a
}

// AmountFromString parses a base-unit decimal string.
func AmountFromString(s string) (Amount, error) {
	v, ok := new(big.Int).SetString(s, 10)
	if !ok {
		return Amount{}, fmt.Errorf("invalid amount %q", s)
	}
	return NewAmount(v)
}

// Int returns a copy of the underlying integer.
func (a Amount) Int() *big.Int {
	if a.i == nil {
		return big.NewInt(0)
	}
	return new(big.Int).Set(a.i)
}

// String renders the amount in base units.
func (a Amount) String() string { return a.Int().String() }

// IsZero reports whether the amount is zero.
func (a Amount) IsZero() bool { return a.Int().Sign() == 0 }

// Cmp compares two amounts.
func (a Amount) Cmp(b Amount) int { return a.Int().Cmp(b.Int()) }

// MarshalJSON encodes the amount as a decimal string.
func (a Amount) MarshalJSON() ([]byte, error) { return json.Marshal(a.String()) }

// UnmarshalJSON decodes a decimal string, rejecting numbers and negatives.
func (a *Amount) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return fmt.Errorf("amount must be a JSON string in base units: %w", err)
	}
	v, err := AmountFromString(s)
	if err != nil {
		return err
	}
	*a = v
	return nil
}
