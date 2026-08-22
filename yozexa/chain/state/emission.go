package state

import (
	"math/big"

	"github.com/yozexa/yozexa/chain/types"
)

// The YOZEXA emission schedule.
//
// 5,000,000 YZXA — exactly half of the hard cap — is reserved to pay for the
// network's own security over time. It is NOT held in anyone's wallet: it is
// created block by block by the protocol and paid to the validators and
// delegators that secured that block.
//
// The schedule is a geometric reduction, in the spirit of a halving but chosen
// so the arithmetic is exact rather than inherited:
//
//	era length          20,000,000 blocks
//	era 0 reward        0.125 YZXA per block   (1/8, exact in binary)
//	era n reward        era 0 reward / 2^n     (integer division)
//
// The sum of the first two eras is 0.125 * 20,000,000 * (1 + 1/2 + 1/4 + ...)
// = 5,000,000 YZXA in the limit. Because each era's reward is floored to an
// integer number of ayzxa, the realised total is very slightly BELOW
// 5,000,000: the schedule can never overshoot by construction, and the
// emission pool's own balance is a second, independent ceiling.
//
// At a 3-second target block time one era is about 1.9 years.
const (
	// EraBlocks is the number of blocks in one emission era.
	EraBlocks int64 = 20_000_000
	// MaxEras bounds the schedule. After the reward reaches zero through
	// halving there is nothing left to emit, and fees alone pay for security.
	MaxEras int64 = 64
)

// EmissionReserve is the total the schedule may ever pay out: 5,000,000 YZXA.
func EmissionReserve() *big.Int { return types.YZXA(5_000_000) }

// InitialBlockReward is 0.125 YZXA in base units.
func InitialBlockReward() *big.Int {
	return new(big.Int).Quo(types.OneYZXA(), big.NewInt(8))
}

// EmissionState tracks what the schedule has already paid.
type EmissionState struct {
	// TotalEmitted is the sum of every block reward paid so far.
	TotalEmitted types.Amount `json:"total_emitted"`
	// LastRewardHeight is the height of the last reward paid, used to make
	// emission idempotent if a block is ever re-processed during replay.
	LastRewardHeight int64 `json:"last_reward_height"`
}

// GetEmissionState reads the emission counters.
func (s *State) GetEmissionState() (EmissionState, error) {
	var es EmissionState
	found, err := s.getJSON(KeyEmissionState, &es)
	if err != nil {
		return es, err
	}
	if !found {
		return EmissionState{TotalEmitted: types.MustAmount(types.Zero())}, nil
	}
	return es, nil
}

// SetEmissionState writes the emission counters.
func (s *State) SetEmissionState(es EmissionState) error { return s.setJSON(KeyEmissionState, es) }

// EraAt returns the era index for a block height.
func EraAt(height int64) int64 {
	if height <= 0 {
		return 0
	}
	return (height - 1) / EraBlocks
}

// BlockRewardAt returns the scheduled reward for a height, before applying the
// remaining-reserve ceiling.
func BlockRewardAt(height int64) *big.Int {
	era := EraAt(height)
	if era >= MaxEras {
		return big.NewInt(0)
	}
	reward := InitialBlockReward()
	return reward.Rsh(reward, uint(era))
}

// NextBlockReward returns what may actually be paid at a height: the scheduled
// amount, capped by what is left of the 5,000,000 reserve and by what is left
// under the absolute hard cap.
//
// Two independent ceilings guard the same number. That redundancy is
// deliberate: a bug in the schedule cannot mint past the reserve, and a bug in
// the reserve accounting cannot mint past the cap.
func (s *State) NextBlockReward(height int64) (*big.Int, error) {
	scheduled := BlockRewardAt(height)
	if scheduled.Sign() == 0 {
		return big.NewInt(0), nil
	}

	es, err := s.GetEmissionState()
	if err != nil {
		return nil, err
	}
	reserveLeft, err := types.Sub(EmissionReserve(), es.TotalEmitted.Int())
	if err != nil {
		// Emitted more than the reserve: refuse to emit anything further.
		return big.NewInt(0), nil
	}
	reward := types.Min(scheduled, reserveLeft)

	mintableLeft, err := s.MintableRemaining()
	if err != nil {
		return nil, err
	}
	reward = types.Min(reward, mintableLeft)
	return reward, nil
}

// EmissionInfo is the public description of the schedule, for the explorer
// and the supply dashboard.
type EmissionInfo struct {
	Reserve          string `json:"reserve"`
	TotalEmitted     string `json:"total_emitted"`
	RemainingReserve string `json:"remaining_reserve"`
	CurrentEra       int64  `json:"current_era"`
	EraBlocks        int64  `json:"era_blocks"`
	CurrentReward    string `json:"current_block_reward"`
	NextEraHeight    int64  `json:"next_era_height"`
	NextEraReward    string `json:"next_era_block_reward"`
}

// EmissionInfoAt describes the schedule at a height.
func (s *State) EmissionInfoAt(height int64) (EmissionInfo, error) {
	es, err := s.GetEmissionState()
	if err != nil {
		return EmissionInfo{}, err
	}
	remaining, err := types.Sub(EmissionReserve(), es.TotalEmitted.Int())
	if err != nil {
		remaining = big.NewInt(0)
	}
	era := EraAt(height)
	nextEraHeight := (era+1)*EraBlocks + 1
	return EmissionInfo{
		Reserve:          EmissionReserve().String(),
		TotalEmitted:     es.TotalEmitted.String(),
		RemainingReserve: remaining.String(),
		CurrentEra:       era,
		EraBlocks:        EraBlocks,
		CurrentReward:    BlockRewardAt(height).String(),
		NextEraHeight:    nextEraHeight,
		NextEraReward:    BlockRewardAt(nextEraHeight).String(),
	}, nil
}
