package app_test

import (
	"math/big"
	"math/rand"
	"testing"

	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// FuzzStateMachine drives the real state machine with pseudo-random but
// well-formed traffic and asserts the invariants after every block.
//
// The property under test is the one that matters most: no sequence of valid
// or invalid transactions, in any order, can make the ledger stop adding up or
// the supply cross its cap.
func FuzzStateMachine(f *testing.F) {
	f.Add(int64(1), 30)
	f.Add(int64(7), 60)
	f.Add(int64(1234567), 45)

	f.Fuzz(func(t *testing.T, seed int64, steps int) {
		if steps < 1 || steps > 120 {
			steps = 40
		}
		rng := rand.New(rand.NewSource(seed))

		val := newAccount(t)
		a := newAccount(t)
		b := newAccount(t)
		c := newAccount(t)
		h := newHarness(t, val, map[*account]int64{a: 10_000, b: 5_000, c: 1_000})
		actors := []*account{a, b, c, val}

		for i := 0; i < steps; i++ {
			from := actors[rng.Intn(len(actors))]
			to := actors[rng.Intn(len(actors))]
			if from == to {
				h.commitBlock()
				h.checkInvariants()
				continue
			}
			// Amounts deliberately span the plausible and the absurd, so that
			// over-spends, dust and zero-value edges all get exercised.
			amount := big.NewInt(rng.Int63n(1_000_000))
			amount.Mul(amount, big.NewInt(rng.Int63n(1_000_000_000_000)+1))
			amt, err := types.NewAmount(amount)
			if err != nil {
				continue
			}

			var msg tx.Msg
			switch rng.Intn(6) {
			case 0, 1, 2:
				if amount.Sign() == 0 {
					continue
				}
				msg = tx.MsgSend{From: from.addr, To: to.addr, Amount: amt}
			case 3:
				if amount.Sign() == 0 {
					continue
				}
				msg = tx.MsgDelegate{Delegator: from.addr, Validator: val.addr, Amount: amt}
			case 4:
				if amount.Sign() == 0 {
					continue
				}
				msg = tx.MsgUndelegate{Delegator: from.addr, Validator: val.addr, Amount: amt}
			case 5:
				if amount.Sign() == 0 {
					continue
				}
				msg = tx.MsgBurn{From: from.addr, Amount: amt}
			}
			if err := msg.ValidateBasic(); err != nil {
				continue
			}

			// Results are not asserted: whether an individual transaction
			// succeeds is not the property under test. What must hold is that
			// the ledger is consistent no matter which ones did.
			h.commitBlock(h.sign(from, msg))
			h.checkInvariants()

			supply := h.supply()
			if supply.Minted.Cmp(types.MaxSupplyCopy()) > 0 {
				t.Fatalf("minted supply %s exceeds the hard cap after step %d",
					supply.Minted, i)
			}
			if supply.Circulating.Sign() < 0 {
				t.Fatalf("circulating supply went negative after step %d", i)
			}
		}
	})
}

// A long randomised run against the same properties, always executed as part
// of the normal test suite rather than only under -fuzz.
func TestRandomTrafficPreservesEveryInvariant(t *testing.T) {
	rng := rand.New(rand.NewSource(20260822))

	val := newAccount(t)
	accounts := make([]*account, 0, 6)
	funded := map[*account]int64{}
	for i := 0; i < 6; i++ {
		acc := newAccount(t)
		accounts = append(accounts, acc)
		funded[acc] = int64(1_000 * (i + 1))
	}
	h := newHarness(t, val, funded)

	for step := 0; step < 250; step++ {
		from := accounts[rng.Intn(len(accounts))]
		to := accounts[rng.Intn(len(accounts))]
		if from == to {
			continue
		}
		amount := new(big.Int).Mul(
			big.NewInt(rng.Int63n(2_000)+1),
			new(big.Int).Quo(types.OneYZXA(), big.NewInt(100)),
		)
		amt := types.MustAmount(amount)

		var msg tx.Msg
		switch rng.Intn(10) {
		case 0, 1, 2, 3, 4:
			msg = tx.MsgSend{From: from.addr, To: to.addr, Amount: amt}
		case 5, 6:
			msg = tx.MsgDelegate{Delegator: from.addr, Validator: val.addr, Amount: amt}
		case 7:
			msg = tx.MsgUndelegate{Delegator: from.addr, Validator: val.addr, Amount: amt}
		case 8:
			msg = tx.MsgWithdrawRewards{Delegator: from.addr, Validator: val.addr}
		case 9:
			msg = tx.MsgBurn{From: from.addr, Amount: amt}
		}
		h.commitBlock(h.sign(from, msg))
		h.checkInvariants()
	}

	supply := h.supply()
	if supply.Minted.Cmp(types.MaxSupplyCopy()) > 0 {
		t.Fatalf("hard cap broken: minted %s", supply.Minted)
	}
	// Emission over 250-odd blocks must match the schedule exactly.
	es, err := h.app.State().GetEmissionState()
	if err != nil {
		t.Fatal(err)
	}
	expected := new(big.Int).Mul(big.NewInt(h.height), state.InitialBlockReward())
	if es.TotalEmitted.Int().Cmp(expected) != 0 {
		t.Fatalf("emitted %s over %d blocks, schedule says %s",
			es.TotalEmitted, h.height, expected)
	}
}
