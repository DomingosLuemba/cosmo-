// Package types defines the core value types of the YOZEXA Network.
//
// MONETARY SAFETY RULES (see docs/MONETARY_POLICY.md):
//
//  1. Balances, supply and fees are ALWAYS integers in the base unit (ayzxa).
//     Floating point is never used for any value that can move funds.
//  2. The maximum supply is a compile-time constant enforced by an invariant
//     that is checked at the end of every block.
//  3. Every arithmetic helper in this package is checked: it either returns an
//     exact result or an error. There is no silent wrap-around or truncation
//     of a value that represents money.
package types

import (
	"fmt"
	"math/big"
	"strings"
)

const (
	// BaseDenom is the smallest indivisible unit of the network currency.
	// "a" is the SI prefix atto (10^-18), so 1 ayzxa = 10^-18 YZXA.
	BaseDenom = "ayzxa"

	// DisplayDenom is the human unit. 1 YZXA = 10^18 ayzxa.
	DisplayDenom = "YZXA"

	// SubDenom is the friendly retail sub-unit used by wallets.
	// 1 YOZ = 0.00001 YZXA = 10^13 ayzxa.
	SubDenom = "YOZ"

	// Decimals is the number of decimal places of the display denom.
	Decimals = 18

	// SubDenomDecimals is the number of decimal places of one YOZ expressed
	// in YZXA: 1 YOZ = 10^-5 YZXA.
	SubDenomDecimals = 5
)

var (
	// one YZXA in base units: 10^18.
	oneYZXA = new(big.Int).Exp(big.NewInt(10), big.NewInt(Decimals), nil)

	// one YOZ in base units: 10^13.
	oneYOZ = new(big.Int).Exp(big.NewInt(10), big.NewInt(Decimals-SubDenomDecimals), nil)

	// MaxSupply is the absolute, protocol-enforced ceiling on the number of
	// ayzxa that can ever exist: 10,000,000 YZXA.
	//
	// No administrator, upgrade, validator, governance vote, bridge or
	// migration may raise this number. Invariant "supply-cap" (checked every
	// block) halts the chain rather than allow it to be exceeded.
	MaxSupply = new(big.Int).Mul(big.NewInt(10_000_000), oneYZXA)
)

// OneYZXA returns a fresh copy of 10^18 ayzxa.
func OneYZXA() *big.Int { return new(big.Int).Set(oneYZXA) }

// OneYOZ returns a fresh copy of 10^13 ayzxa.
func OneYOZ() *big.Int { return new(big.Int).Set(oneYOZ) }

// MaxSupplyCopy returns a fresh copy of the hard cap in base units.
func MaxSupplyCopy() *big.Int { return new(big.Int).Set(MaxSupply) }

// YZXA converts a whole number of YZXA into base units. It is intended for
// constants and genesis configuration, not for user input.
func YZXA(n int64) *big.Int {
	return new(big.Int).Mul(big.NewInt(n), oneYZXA)
}

// ParseAmount parses a decimal amount string denominated in the given unit and
// returns the exact value in base units.
//
// It accepts at most `Decimals` fractional digits for YZXA and rejects any
// input that would silently lose precision. Scientific notation, signs,
// separators and whitespace are rejected: user-facing amounts must be
// unambiguous.
func ParseAmount(s string, unit string) (*big.Int, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, fmt.Errorf("empty amount")
	}
	var scale int
	switch strings.ToUpper(unit) {
	case DisplayDenom:
		scale = Decimals
	case SubDenom:
		scale = Decimals - SubDenomDecimals
	case BaseDenom, "AYZXA":
		scale = 0
	default:
		return nil, fmt.Errorf("unknown unit %q (want YZXA, YOZ or ayzxa)", unit)
	}

	intPart, fracPart, hasFrac := strings.Cut(s, ".")
	if intPart == "" {
		return nil, fmt.Errorf("invalid amount %q: missing integer part", s)
	}
	if err := checkDigits(intPart); err != nil {
		return nil, fmt.Errorf("invalid amount %q: %w", s, err)
	}
	if hasFrac {
		if fracPart == "" {
			return nil, fmt.Errorf("invalid amount %q: trailing decimal point", s)
		}
		if err := checkDigits(fracPart); err != nil {
			return nil, fmt.Errorf("invalid amount %q: %w", s, err)
		}
		if len(fracPart) > scale {
			return nil, fmt.Errorf(
				"invalid amount %q: %d fractional digits exceeds %d for unit %s",
				s, len(fracPart), scale, unit)
		}
	}

	digits := intPart + fracPart
	pad := scale - len(fracPart)
	digits += strings.Repeat("0", pad)

	v, ok := new(big.Int).SetString(digits, 10)
	if !ok {
		return nil, fmt.Errorf("invalid amount %q", s)
	}
	return v, nil
}

func checkDigits(s string) error {
	for _, r := range s {
		if r < '0' || r > '9' {
			return fmt.Errorf("unexpected character %q", r)
		}
	}
	return nil
}

// FormatYZXA renders a base-unit amount as a YZXA decimal string with no
// precision loss and no trailing zeros (but always at least one decimal).
func FormatYZXA(v *big.Int) string { return formatScaled(v, Decimals) }

// FormatYOZ renders a base-unit amount as a YOZ decimal string.
func FormatYOZ(v *big.Int) string { return formatScaled(v, Decimals-SubDenomDecimals) }

func formatScaled(v *big.Int, scale int) string {
	if v == nil {
		return "0.0"
	}
	neg := v.Sign() < 0
	abs := new(big.Int).Abs(v)

	div := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(scale)), nil)
	q, r := new(big.Int).QuoRem(abs, div, new(big.Int))

	frac := r.String()
	if pad := scale - len(frac); pad > 0 {
		frac = strings.Repeat("0", pad) + frac
	}
	frac = strings.TrimRight(frac, "0")
	if frac == "" {
		frac = "0"
	}
	out := q.String() + "." + frac
	if neg {
		out = "-" + out
	}
	return out
}
