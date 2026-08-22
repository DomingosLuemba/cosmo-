package state

import (
	"math/big"

	"github.com/yozexa/yozexa/chain/types"
)

// SignInfo tracks a validator's liveness over a sliding window of blocks.
//
// The window is stored as a counter plus a bitmap index rather than a full
// history, so liveness tracking costs O(1) state per validator per block.
type SignInfo struct {
	Operator types.Address `json:"operator"`
	// StartHeight is when this validator began being tracked.
	StartHeight int64 `json:"start_height"`
	// IndexOffset advances once per block the validator was expected to sign.
	IndexOffset int64 `json:"index_offset"`
	// MissedBlocks is how many of the last SignedBlocksWindow blocks were
	// missed. It is maintained incrementally against the bitmap.
	MissedBlocks int64 `json:"missed_blocks"`
	// Bitmap records, for each slot in the window, whether the block was
	// missed. One bit per block.
	Bitmap []byte `json:"bitmap"`
	// JailedUntilUnix is when a downtime jail expires.
	JailedUntilUnix int64 `json:"jailed_until_unix,omitempty"`
}

func signInfoKey(a types.Address) string { return PrefixSignInfo + addrKey(a) }

// GetSignInfo reads a validator's liveness record.
func (s *State) GetSignInfo(a types.Address) (SignInfo, bool, error) {
	var si SignInfo
	found, err := s.getJSON(signInfoKey(a), &si)
	return si, found, err
}

// SetSignInfo writes a validator's liveness record.
func (s *State) SetSignInfo(si SignInfo) error { return s.setJSON(signInfoKey(si.Operator), si) }

// RecordSignature updates the sliding window and reports whether the validator
// has now missed too many blocks and must be jailed.
func (si *SignInfo) RecordSignature(signed bool, window int64, minSignedBps uint32) (shouldJail bool) {
	if window <= 0 {
		return false
	}
	needed := (window * int64(minSignedBps)) / 10_000
	maxMissed := window - needed

	byteLen := int((window + 7) / 8)
	if len(si.Bitmap) != byteLen {
		grown := make([]byte, byteLen)
		copy(grown, si.Bitmap)
		si.Bitmap = grown
	}

	idx := si.IndexOffset % window
	byteIdx, bitIdx := idx/8, uint(idx%8)
	previouslyMissed := si.Bitmap[byteIdx]&(1<<bitIdx) != 0

	missedNow := !signed
	switch {
	case previouslyMissed && !missedNow:
		si.Bitmap[byteIdx] &^= 1 << bitIdx
		si.MissedBlocks--
	case !previouslyMissed && missedNow:
		si.Bitmap[byteIdx] |= 1 << bitIdx
		si.MissedBlocks++
	}
	si.IndexOffset++

	if si.MissedBlocks < 0 {
		si.MissedBlocks = 0
	}
	// Only judge a validator once it has had a full window to perform in.
	if si.IndexOffset < window {
		return false
	}
	return si.MissedBlocks > maxMissed
}

// ResetWindow clears the liveness window, used when a validator is jailed so
// that it starts with a clean record when it returns.
func (si *SignInfo) ResetWindow() {
	si.MissedBlocks = 0
	si.IndexOffset = 0
	for i := range si.Bitmap {
		si.Bitmap[i] = 0
	}
}

// SetTombstone permanently marks a consensus key as having equivocated.
//
// Tombstoning is recorded against the consensus address, not only the
// validator record, so that the same key can never be re-registered under a
// new operator to escape the penalty.
func (s *State) SetTombstone(cons types.Address) error {
	return s.setJSON(PrefixTombstone+addrKey(cons), true)
}

// IsTombstoned reports whether a consensus key has been permanently banned.
func (s *State) IsTombstoned(cons types.Address) (bool, error) {
	var v bool
	found, err := s.getJSON(PrefixTombstone+addrKey(cons), &v)
	if err != nil {
		return false, err
	}
	return found && v, nil
}

// SlashValidator removes a fraction of a validator's bonded stake and burns
// it. Shares are untouched, so the loss is shared pro rata by every delegator:
// nobody can dodge a slash, and the validator's own self-bond is hit too.
//
// Returns the amount actually burned.
func (s *State) SlashValidator(operator types.Address, fractionBps uint32) (*big.Int, error) {
	v, found, err := s.GetValidator(operator)
	if err != nil || !found {
		return big.NewInt(0), err
	}
	tokens := v.Tokens.Int()
	if tokens.Sign() == 0 {
		return big.NewInt(0), nil
	}
	slash, err := types.MulQuo(tokens, int64(fractionBps), 10_000)
	if err != nil {
		return nil, err
	}
	if slash.Sign() == 0 {
		return big.NewInt(0), nil
	}
	remaining, err := types.Sub(tokens, slash)
	if err != nil {
		return nil, err
	}
	v.Tokens, err = types.NewAmount(remaining)
	if err != nil {
		return nil, err
	}
	if err := s.SetValidator(v); err != nil {
		return nil, err
	}
	// The stake lives in the bonded pool; burning it there keeps the pool
	// balance equal to the sum of validator tokens.
	if err := s.Burn(ModuleBonded, slash); err != nil {
		return nil, err
	}
	return slash, nil
}
