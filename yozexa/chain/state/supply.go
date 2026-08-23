package state

import (
	"fmt"
	"math/big"

	"github.com/yozexa/yozexa/chain/types"
)

// Supply is the complete monetary picture of the network at a point in time.
type Supply struct {
	// Max is the immutable hard cap: 10,000,000 YZXA in base units.
	Max *big.Int
	// Minted is every unit that has ever been created, at genesis or by
	// emission. It only ever grows.
	Minted *big.Int
	// Burned is every unit that has been irreversibly destroyed.
	Burned *big.Int
	// Circulating is Minted - Burned: the units that exist right now.
	Circulating *big.Int
	// RemainingMintable is Max - Minted: the units the protocol may still
	// create in the whole future of the network.
	RemainingMintable *big.Int
}

// MintedSupply reads the total ever minted.
func (s *State) MintedSupply() (*big.Int, error) { return s.readBigInt(KeyMintedSupply) }

// BurnedSupply reads the total ever burned.
func (s *State) BurnedSupply() (*big.Int, error) { return s.readBigInt(KeyBurnedSupply) }

func (s *State) readBigInt(key string) (*big.Int, error) {
	var str string
	found, err := s.getJSON(key, &str)
	if err != nil {
		return nil, err
	}
	if !found {
		return big.NewInt(0), nil
	}
	v, ok := new(big.Int).SetString(str, 10)
	if !ok {
		return nil, fmt.Errorf("corrupt integer at %s: %q", key, str)
	}
	return v, nil
}

func (s *State) writeBigInt(key string, v *big.Int) error {
	if v.Sign() < 0 {
		return fmt.Errorf("refusing to write negative value %s at %s", v, key)
	}
	return s.setJSON(key, v.String())
}

// Mint creates new units and credits them to an account.
//
// This is the ONLY function in the entire codebase that increases the minted
// supply. Every path that creates money — genesis allocation, block emission,
// anything a future module might want — must call it, and it refuses to
// return without the hard cap holding.
func (s *State) Mint(to types.Address, amount *big.Int) error {
	if !types.IsNonNegative(amount) {
		return fmt.Errorf("mint: %w", types.ErrNegative)
	}
	if amount.Sign() == 0 {
		return nil
	}
	minted, err := s.MintedSupply()
	if err != nil {
		return err
	}
	next, err := types.Add(minted, amount)
	if err != nil {
		return fmt.Errorf("mint: %w", err)
	}
	// The single choke point. If this check fails the operation is refused;
	// callers in consensus-critical paths treat the failure as fatal rather
	// than continuing with a partially applied mint.
	if err := types.CheckSupplyCap(next); err != nil {
		return fmt.Errorf("mint refused: %w", err)
	}
	if err := s.AddBalance(to, amount); err != nil {
		return err
	}
	return s.writeBigInt(KeyMintedSupply, next)
}

// MintableRemaining returns how much the protocol may still create.
func (s *State) MintableRemaining() (*big.Int, error) {
	minted, err := s.MintedSupply()
	if err != nil {
		return nil, err
	}
	return types.Sub(types.MaxSupplyCopy(), minted)
}

// Burn destroys units held by an account.
//
// Burned units are recorded separately and are never returned to the mintable
// pool: the emission schedule does not "see" burns, so burning is a permanent
// reduction of the money that will ever exist. Minted supply is deliberately
// NOT decremented, because it is the quantity the hard cap constrains — if
// burning reduced it, a burn-and-remint loop could exceed the cap.
func (s *State) Burn(from types.Address, amount *big.Int) error {
	if !types.IsNonNegative(amount) {
		return fmt.Errorf("burn: %w", types.ErrNegative)
	}
	if amount.Sign() == 0 {
		return nil
	}
	if err := s.SubBalance(from, amount); err != nil {
		return err
	}
	burned, err := s.BurnedSupply()
	if err != nil {
		return err
	}
	next, err := types.Add(burned, amount)
	if err != nil {
		return err
	}
	return s.writeBigInt(KeyBurnedSupply, next)
}

// Supply assembles the full monetary picture.
func (s *State) Supply() (Supply, error) {
	minted, err := s.MintedSupply()
	if err != nil {
		return Supply{}, err
	}
	burned, err := s.BurnedSupply()
	if err != nil {
		return Supply{}, err
	}
	circulating, err := types.Sub(minted, burned)
	if err != nil {
		return Supply{}, fmt.Errorf("burned supply exceeds minted supply: %w", err)
	}
	remaining, err := types.Sub(types.MaxSupplyCopy(), minted)
	if err != nil {
		return Supply{}, fmt.Errorf("minted supply exceeds the hard cap: %w", err)
	}
	return Supply{
		Max:               types.MaxSupplyCopy(),
		Minted:            minted,
		Burned:            burned,
		Circulating:       circulating,
		RemainingMintable: remaining,
	}, nil
}
