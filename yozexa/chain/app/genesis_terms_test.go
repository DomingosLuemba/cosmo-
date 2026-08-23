package app_test

import (
	"strings"
	"testing"
	"time"

	"github.com/yozexa/yozexa/chain/app"
	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/types"
)

// genesisWithVesting builds a minimal valid genesis carrying one vesting
// position, so a test can vary only the terms it cares about.
func genesisWithVesting(t *testing.T, v app.GenesisVesting) app.Genesis {
	t.Helper()
	val := newAccount(t)
	consKey, _ := newConsensusKey(t, 1)
	return app.Genesis{
		ChainID:     "yozexa-test-1",
		GenesisTime: time.Now(),
		Params:      state.DefaultParams(),
		Accounts: []app.GenesisAccount{
			{Address: val.addr, Balance: types.MustAmount(types.YZXA(100_000)), Label: "validator"},
		},
		Vesting: []app.GenesisVesting{v},
		Validators: []app.GenesisValidator{{
			Operator:          val.addr,
			ConsensusPubKey:   consKey,
			Moniker:           "v",
			SelfDelegation:    types.MustAmount(types.YZXA(100_000)),
			CommissionBps:     500,
			MaxCommissionBps:  2000,
			MinSelfDelegation: types.MustAmount(types.YZXA(1)),
		}},
	}
}

func founderPosition(t *testing.T) app.GenesisVesting {
	t.Helper()
	return app.GenesisVesting{
		Address:         newAccount(t).addr,
		Category:        state.VestingCategoryFounder,
		Total:           types.MustAmount(types.YZXA(app.AllocFounderYZXA)),
		CliffSeconds:    app.FounderCliffSeconds,
		DurationSeconds: app.FounderDurationSeconds,
		Label:           "founder",
	}
}

// The published terms must be accepted exactly as published, or the rule that
// enforces them is unusable.
func TestGenesisAcceptsThePublishedFounderAndTeamTerms(t *testing.T) {
	if err := genesisWithVesting(t, founderPosition(t)).Validate(); err != nil {
		t.Fatalf("the published founder terms were refused: %v", err)
	}
	team := app.GenesisVesting{
		Address:         newAccount(t).addr,
		Category:        state.VestingCategoryTeam,
		Total:           types.MustAmount(types.YZXA(app.AllocTeamYZXA)),
		CliffSeconds:    app.TeamCliffSeconds,
		DurationSeconds: app.TeamDurationSeconds,
		Label:           "team",
	}
	if err := genesisWithVesting(t, team).Validate(); err != nil {
		t.Fatalf("the published team terms were refused: %v", err)
	}
}

// The allocation table is a public commitment. A genesis that claims a
// reserved category has to honour it — otherwise the table is a comment and
// the founder can be given any size on any schedule.
func TestGenesisRefusesFounderAndTeamTermsThatDoNotMatchThePublishedOnes(t *testing.T) {
	cases := []struct {
		name  string
		want  string
		apply func(v *app.GenesisVesting)
	}{
		{"allocation six times larger", "allocation",
			func(v *app.GenesisVesting) { v.Total = types.MustAmount(types.YZXA(3_000_000)) }},
		{"allocation one YZXA smaller", "allocation",
			func(v *app.GenesisVesting) { v.Total = types.MustAmount(types.YZXA(app.AllocFounderYZXA - 1)) }},
		{"cliff of one second", "cliff",
			func(v *app.GenesisVesting) { v.CliffSeconds = 1 }},
		{"no cliff at all", "cliff",
			func(v *app.GenesisVesting) { v.CliffSeconds = 0 }},
		// Still longer than the cliff, so it gets past the generic sanity
		// check and has to be refused for not matching the published term.
		{"vesting shortened from 8 years to 3", "vesting runs",
			func(v *app.GenesisVesting) { v.DurationSeconds = 3 * app.Year }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v := founderPosition(t)
			tc.apply(&v)
			err := genesisWithVesting(t, v).Validate()
			if err == nil {
				t.Fatalf("accepted a founder position with %s", tc.name)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("refused for the wrong reason: %v", err)
			}
		})
	}
}

// Splitting the allocation across several positions would let each one match
// the published size while the category total is a multiple of it.
func TestGenesisRefusesASecondFounderPosition(t *testing.T) {
	g := genesisWithVesting(t, founderPosition(t))
	g.Vesting = append(g.Vesting, founderPosition(t))
	err := g.Validate()
	if err == nil {
		t.Fatal("accepted two founder positions, doubling the founder allocation")
	}
	if !strings.Contains(err.Error(), "more than one") {
		t.Fatalf("refused for the wrong reason: %v", err)
	}
}

// A network with no founder or team position is normal — every devnet and
// testnet is one. The rule must not require them to exist.
func TestGenesisAllowsANetworkWithNoReservedPositions(t *testing.T) {
	g := genesisWithVesting(t, app.GenesisVesting{
		Address:         newAccount(t).addr,
		Category:        state.VestingCategoryOther,
		Total:           types.MustAmount(types.YZXA(1_000)),
		CliffSeconds:    60,
		DurationSeconds: 600,
		Label:           "grant recipient",
	})
	if err := g.Validate(); err != nil {
		t.Fatalf("a genesis with no founder or team position was refused: %v", err)
	}
}
