package state

import (
	"fmt"

	"github.com/yozexa/yozexa/chain/types"
)

// Alias is a registered YOZEXA ID: a human-readable name that resolves to an
// account, so a payment can be addressed to "maria.yzx" instead of 20 bytes of
// hex that nobody can proofread.
type Alias struct {
	Name  string        `json:"name"`
	Owner types.Address `json:"owner"`
	// RegisteredUnix is when the name was claimed, shown by wallets so a
	// freshly-registered lookalike of a known name is visible as such.
	RegisteredUnix int64 `json:"registered_unix"`
}

func aliasKey(name string) string          { return PrefixAlias + name }
func aliasOwnerKey(a types.Address) string { return PrefixAliasOwner + addrKey(a) }

// GetAlias resolves a name.
func (s *State) GetAlias(name string) (Alias, bool, error) {
	var a Alias
	found, err := s.getJSON(aliasKey(name), &a)
	return a, found, err
}

// SetAlias registers or updates a name, maintaining the reverse index.
func (s *State) SetAlias(a Alias) error {
	if err := s.setJSON(aliasKey(a.Name), a); err != nil {
		return err
	}
	return s.setJSON(aliasOwnerKey(a.Owner), a.Name)
}

// PrimaryAlias returns the name an address is displayed under, if any.
func (s *State) PrimaryAlias(addr types.Address) (string, bool, error) {
	var name string
	found, err := s.getJSON(aliasOwnerKey(addr), &name)
	return name, found, err
}

// ClearAliasOwner removes the reverse index entry for an address.
func (s *State) ClearAliasOwner(addr types.Address) error { return s.delete(aliasOwnerKey(addr)) }

// IterateAliases visits every alias in name order.
func (s *State) IterateAliases(fn func(Alias) bool) error {
	return s.kv.Iterate([]byte(PrefixAlias), func(_, value []byte) bool {
		var a Alias
		if err := jsonUnmarshal(value, &a); err != nil {
			return true
		}
		return fn(a)
	})
}

// ResolveRecipient accepts either a bech32 address or a registered alias and
// returns the account to pay.
//
// Wallets call this before showing a confirmation screen, so the address the
// user sees is the one the chain will actually credit.
func (s *State) ResolveRecipient(input string) (types.Address, error) {
	if addr, err := types.ParseAddress(input); err == nil {
		return addr, nil
	}
	a, found, err := s.GetAlias(input)
	if err != nil {
		return types.Address{}, err
	}
	if !found {
		return types.Address{}, fmt.Errorf("%q is neither a valid address nor a registered YOZEXA ID", input)
	}
	return a.Owner, nil
}
