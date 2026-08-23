package state

import (
	"errors"
	"fmt"
	"math/big"

	"github.com/yozexa/yozexa/chain/types"
)

// Account is the on-chain record of a spending account.
type Account struct {
	Address types.Address `json:"address"`
	// Balance is the account's total holding in ayzxa, including any part
	// still locked by a vesting schedule.
	Balance types.Amount `json:"balance"`
	// Sequence is the next nonce the account must use. It advances on every
	// successfully authenticated transaction, which is what makes a signed
	// transaction executable exactly once.
	Sequence uint64 `json:"sequence"`
	// PubKey is recorded the first time the account signs, so that later
	// transactions can be authenticated even if the sender omits it and so
	// that tooling can display the key that controls the account.
	PubKey string `json:"pubkey,omitempty"`
}

func accountKey(a types.Address) string { return PrefixAccount + addrKey(a) }

// GetAccount reads an account, returning a zero-balance account if it has
// never been seen. Reading an unknown address is not an error: on a public
// network any address is a valid, empty account until it receives funds.
func (s *State) GetAccount(a types.Address) (Account, error) {
	var acc Account
	found, err := s.getJSON(accountKey(a), &acc)
	if err != nil {
		return acc, err
	}
	if !found {
		return Account{Address: a, Balance: types.MustAmount(types.Zero())}, nil
	}
	return acc, nil
}

// SetAccount writes an account, deleting rows that carry no information so
// that the state tree does not grow with empty accounts.
func (s *State) SetAccount(acc Account) error {
	if acc.Balance.IsZero() && acc.Sequence == 0 && acc.PubKey == "" {
		return s.delete(accountKey(acc.Address))
	}
	return s.setJSON(accountKey(acc.Address), acc)
}

// Balance returns an account's total balance.
func (s *State) Balance(a types.Address) (*big.Int, error) {
	acc, err := s.GetAccount(a)
	if err != nil {
		return nil, err
	}
	return acc.Balance.Int(), nil
}

// AddBalance credits an account.
func (s *State) AddBalance(a types.Address, amount *big.Int) error {
	if !types.IsNonNegative(amount) {
		return fmt.Errorf("credit: %w", types.ErrNegative)
	}
	acc, err := s.GetAccount(a)
	if err != nil {
		return err
	}
	next, err := types.Add(acc.Balance.Int(), amount)
	if err != nil {
		return err
	}
	acc.Balance, err = types.NewAmount(next)
	if err != nil {
		return err
	}
	return s.SetAccount(acc)
}

// SubBalance debits an account, failing if it is under-funded.
//
// It checks the TOTAL balance only. Callers moving user funds must use
// Transfer or first consult Spendable, which additionally enforces vesting
// locks.
func (s *State) SubBalance(a types.Address, amount *big.Int) error {
	if !types.IsNonNegative(amount) {
		return fmt.Errorf("debit: %w", types.ErrNegative)
	}
	acc, err := s.GetAccount(a)
	if err != nil {
		return err
	}
	next, err := types.Sub(acc.Balance.Int(), amount)
	if err != nil {
		return fmt.Errorf("insufficient balance: account %s holds %s, needs %s ayzxa",
			a, acc.Balance, amount)
	}
	acc.Balance, err = types.NewAmount(next)
	if err != nil {
		return err
	}
	return s.SetAccount(acc)
}

// Spendable returns the part of an account's balance that may be moved right
// now: total balance minus anything still locked by a vesting schedule.
func (s *State) Spendable(a types.Address, blockTimeUnix int64) (*big.Int, error) {
	acc, err := s.GetAccount(a)
	if err != nil {
		return nil, err
	}
	locked, err := s.LockedAmount(a, blockTimeUnix)
	if err != nil {
		return nil, err
	}
	spendable, err := types.Sub(acc.Balance.Int(), locked)
	if err != nil {
		// A locked amount above the balance means the schedule and the balance
		// disagree, which would be a state corruption bug. Report zero
		// spendable rather than a negative number, and surface the error.
		return nil, fmt.Errorf("account %s: locked %s exceeds balance %s",
			a, locked, acc.Balance)
	}
	return spendable, nil
}

// Transfer moves funds between accounts, enforcing vesting locks.
//
// It is the only path user funds take between two accounts. Fees, staking and
// protocol pools use the lower-level primitives deliberately: their movements
// are not user transfers and have their own rules.
func (s *State) Transfer(from, to types.Address, amount *big.Int, blockTimeUnix int64) error {
	if !types.IsNonNegative(amount) {
		return fmt.Errorf("transfer: %w", types.ErrNegative)
	}
	if from == to {
		return errors.New("transfer: sender and recipient are the same account")
	}
	spendable, err := s.Spendable(from, blockTimeUnix)
	if err != nil {
		return err
	}
	if spendable.Cmp(amount) < 0 {
		locked, lerr := s.LockedAmount(from, blockTimeUnix)
		if lerr == nil && locked.Sign() > 0 {
			return fmt.Errorf(
				"insufficient spendable balance: %s spendable, %s still locked by vesting, %s requested",
				types.FormatYZXA(spendable), types.FormatYZXA(locked), types.FormatYZXA(amount))
		}
		return fmt.Errorf("insufficient spendable balance: %s available, %s requested",
			types.FormatYZXA(spendable), types.FormatYZXA(amount))
	}
	if err := s.SubBalance(from, amount); err != nil {
		return err
	}
	return s.AddBalance(to, amount)
}

// IncrementSequence advances an account's nonce and records its public key.
func (s *State) IncrementSequence(a types.Address, pubKeyHex string) error {
	acc, err := s.GetAccount(a)
	if err != nil {
		return err
	}
	acc.Sequence++
	if acc.PubKey == "" {
		acc.PubKey = pubKeyHex
	}
	return s.SetAccount(acc)
}

// IterateAccounts visits every account with a stored row, in key order.
func (s *State) IterateAccounts(fn func(Account) bool) error {
	return s.kv.Iterate([]byte(PrefixAccount), func(_, value []byte) bool {
		var acc Account
		if err := jsonUnmarshal(value, &acc); err != nil {
			return true
		}
		return fn(acc)
	})
}
