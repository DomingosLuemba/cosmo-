package state

import (
	"fmt"
	"math/big"

	"github.com/yozexa/yozexa/chain/types"
)

// VestingCategory labels a schedule for public accounting in the explorer.
const (
	VestingCategoryFounder   = "founder"
	VestingCategoryTeam      = "team"
	VestingCategoryEcosystem = "ecosystem"
	VestingCategoryOther     = "other"
)

// VestingSchedule locks tokens that were allocated at genesis and releases
// them over time.
//
// The lock is enforced by the state machine itself, inside the transfer path.
// It is not a promise in a document and not a contract the holder can upgrade:
// there is no message, no parameter and no governance proposal in this
// codebase that shortens a schedule or releases a locked balance early. The
// holder of a vesting account cannot spend locked units even with full control
// of their private key.
type VestingSchedule struct {
	Address types.Address `json:"address"`
	// Category is metadata for the public supply dashboard.
	Category string `json:"category"`
	// Total is the full allocation subject to this schedule.
	Total types.Amount `json:"total"`
	// StartUnix is when the schedule begins (normally the genesis time).
	StartUnix int64 `json:"start_unix"`
	// CliffSeconds is the period after start during which nothing vests. At
	// the cliff, the elapsed portion vests at once.
	CliffSeconds int64 `json:"cliff_seconds"`
	// DurationSeconds is the total length of the schedule, cliff included.
	DurationSeconds int64 `json:"duration_seconds"`
}

func vestingKey(a types.Address) string { return PrefixVesting + addrKey(a) }

// Validate checks a schedule for internal consistency.
func (v VestingSchedule) Validate() error {
	if v.Address.IsZero() {
		return fmt.Errorf("vesting: zero address")
	}
	if v.Total.IsZero() {
		return fmt.Errorf("vesting: total must be positive")
	}
	if v.StartUnix <= 0 {
		return fmt.Errorf("vesting: start time must be set")
	}
	if v.CliffSeconds < 0 || v.DurationSeconds <= 0 {
		return fmt.Errorf("vesting: negative cliff or non-positive duration")
	}
	if v.CliffSeconds > v.DurationSeconds {
		return fmt.Errorf("vesting: cliff of %ds exceeds duration of %ds",
			v.CliffSeconds, v.DurationSeconds)
	}
	switch v.Category {
	case VestingCategoryFounder, VestingCategoryTeam, VestingCategoryEcosystem, VestingCategoryOther:
	default:
		return fmt.Errorf("vesting: unknown category %q", v.Category)
	}
	return nil
}

// VestedAt returns how much of the allocation has vested by the given time.
//
// Before the cliff: zero. At and after the cliff: linear in elapsed time,
// computed as total * elapsed / duration with a single floor division so no
// value is lost to repeated rounding. After the duration: the whole total.
func (v VestingSchedule) VestedAt(nowUnix int64) (*big.Int, error) {
	total := v.Total.Int()
	if nowUnix < v.StartUnix+v.CliffSeconds {
		return big.NewInt(0), nil
	}
	elapsed := nowUnix - v.StartUnix
	if elapsed >= v.DurationSeconds {
		return total, nil
	}
	return types.MulQuo(total, elapsed, v.DurationSeconds)
}

// LockedAt returns how much is still locked at the given time.
func (v VestingSchedule) LockedAt(nowUnix int64) (*big.Int, error) {
	vested, err := v.VestedAt(nowUnix)
	if err != nil {
		return nil, err
	}
	return types.Sub(v.Total.Int(), vested)
}

// SetVestingSchedule stores a schedule.
func (s *State) SetVestingSchedule(v VestingSchedule) error {
	if err := v.Validate(); err != nil {
		return err
	}
	return s.setJSON(vestingKey(v.Address), v)
}

// GetVestingSchedule reads a schedule if the account has one.
func (s *State) GetVestingSchedule(a types.Address) (VestingSchedule, bool, error) {
	var v VestingSchedule
	found, err := s.getJSON(vestingKey(a), &v)
	return v, found, err
}

// LockedAmount returns how much of an account's balance is locked right now.
//
// Accounts without a schedule have nothing locked, which is the common case
// and costs one absent-key lookup.
func (s *State) LockedAmount(a types.Address, blockTimeUnix int64) (*big.Int, error) {
	v, found, err := s.GetVestingSchedule(a)
	if err != nil {
		return nil, err
	}
	if !found {
		return big.NewInt(0), nil
	}
	return v.LockedAt(blockTimeUnix)
}

// IterateVesting visits every vesting schedule in key order.
func (s *State) IterateVesting(fn func(VestingSchedule) bool) error {
	return s.kv.Iterate([]byte(PrefixVesting), func(_, value []byte) bool {
		var v VestingSchedule
		if err := jsonUnmarshal(value, &v); err != nil {
			return true
		}
		return fn(v)
	})
}

// VestingStatus is the public view of a vesting position, as shown by the
// explorer's transparency page and the founder dashboard.
type VestingStatus struct {
	Address        types.Address `json:"address"`
	Category       string        `json:"category"`
	Total          string        `json:"total"`
	Vested         string        `json:"vested"`
	Locked         string        `json:"locked"`
	StartUnix      int64         `json:"start_unix"`
	CliffUnix      int64         `json:"cliff_unix"`
	EndUnix        int64         `json:"end_unix"`
	NextUnlockUnix int64         `json:"next_unlock_unix"`
}

// Status renders a schedule for public display at a point in time.
func (v VestingSchedule) Status(nowUnix int64) (VestingStatus, error) {
	vested, err := v.VestedAt(nowUnix)
	if err != nil {
		return VestingStatus{}, err
	}
	locked, err := types.Sub(v.Total.Int(), vested)
	if err != nil {
		return VestingStatus{}, err
	}
	cliffUnix := v.StartUnix + v.CliffSeconds
	endUnix := v.StartUnix + v.DurationSeconds

	// Before the cliff the next unlock is the cliff itself; after it, vesting
	// is continuous, so the next unlock is simply the next second until the
	// schedule ends.
	next := int64(0)
	switch {
	case nowUnix < cliffUnix:
		next = cliffUnix
	case nowUnix < endUnix:
		next = nowUnix + 1
	}
	return VestingStatus{
		Address:        v.Address,
		Category:       v.Category,
		Total:          v.Total.String(),
		Vested:         vested.String(),
		Locked:         locked.String(),
		StartUnix:      v.StartUnix,
		CliffUnix:      cliffUnix,
		EndUnix:        endUnix,
		NextUnlockUnix: next,
	}, nil
}
