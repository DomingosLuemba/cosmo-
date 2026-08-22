package app_test

import (
	"bytes"
	"context"
	"math/big"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"

	"github.com/yozexa/yozexa/chain/app"
	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

func TestGenesisMintsExactlyTheAllocationAndNoMore(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 1_000})

	s := h.supply()

	// Validator 1,000 + alice 1,000 + ecosystem 1.5M + liquidity 1M
	// + treasury 1M + security 200k = 3,702,000 YZXA.
	want := types.YZXA(3_702_000)
	if s.Minted.Cmp(want) != 0 {
		t.Fatalf("minted %s, want %s", types.FormatYZXA(s.Minted), types.FormatYZXA(want))
	}
	if s.Burned.Sign() != 0 {
		t.Fatalf("burned %s at genesis", s.Burned)
	}
	if s.Max.Cmp(types.YZXA(10_000_000)) != 0 {
		t.Fatalf("hard cap is %s", types.FormatYZXA(s.Max))
	}
	// The genesis mint must leave at least the full emission reserve free.
	if s.RemainingMintable.Cmp(state.EmissionReserve()) < 0 {
		t.Fatalf("only %s mintable but the emission reserve is %s",
			types.FormatYZXA(s.RemainingMintable), types.FormatYZXA(state.EmissionReserve()))
	}
	h.checkInvariants()
}

func TestPaymentMovesExactlyTheAmountAndChargesTheFee(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	bob := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 100})

	beforeAlice := h.balance(alice.addr)
	amount := types.YZXA(25)

	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgSend{
		From: alice.addr, To: bob.addr, Amount: types.MustAmount(amount),
	})))

	if got := h.balance(bob.addr); got.Cmp(amount) != 0 {
		t.Fatalf("recipient received %s, want %s", types.FormatYZXA(got), types.FormatYZXA(amount))
	}
	afterAlice := h.balance(alice.addr)
	spent := new(big.Int).Sub(beforeAlice, afterAlice)
	// The sender paid the amount plus a fee, and the fee is strictly positive
	// but small: it must not silently consume a meaningful part of a payment.
	fee := new(big.Int).Sub(spent, amount)
	if fee.Sign() <= 0 {
		t.Fatalf("no fee was charged (spent %s for a %s payment)", spent, amount)
	}
	if fee.Cmp(types.YZXA(1)) >= 0 {
		t.Fatalf("fee of %s is implausibly large", types.FormatYZXA(fee))
	}
	h.checkInvariants()
}

func TestOverspendIsRejectedAndLeavesNoTrace(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	bob := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 10})

	before := h.balance(alice.addr)
	results := h.commitBlock(h.sign(alice, tx.MsgSend{
		From: alice.addr, To: bob.addr, Amount: types.MustAmount(types.YZXA(1_000_000)),
	}))
	h.requireFailed(results)

	if h.balance(bob.addr).Sign() != 0 {
		t.Fatal("recipient was credited by a failed payment")
	}
	after := h.balance(alice.addr)
	// The sender still pays the fee for a failed transaction: that is what
	// makes spamming failures expensive.
	if after.Cmp(before) >= 0 {
		t.Fatal("a failed transaction cost the sender nothing")
	}
	h.checkInvariants()
}

// A failing transaction must not roll back the successful ones that came
// before it in the same block.
func TestFailedTransactionDoesNotRollBackEarlierOnesInTheBlock(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	bob := newAccount(t)
	carol := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 100, bob: 100})

	good := h.sign(alice, tx.MsgSend{
		From: alice.addr, To: carol.addr, Amount: types.MustAmount(types.YZXA(10)),
	})
	bad := h.sign(bob, tx.MsgSend{
		From: bob.addr, To: carol.addr, Amount: types.MustAmount(types.YZXA(99_999)),
	})
	results := h.commitBlock(good, bad)

	if results[0].Code != app.CodeOK {
		t.Fatalf("first transaction failed: %s", results[0].Log)
	}
	if results[1].Code == app.CodeOK {
		t.Fatal("second transaction should have failed")
	}
	if got := h.balance(carol.addr); got.Cmp(types.YZXA(10)) != 0 {
		t.Fatalf("carol holds %s; the good payment in the same block was lost",
			types.FormatYZXA(got))
	}
	h.checkInvariants()
}

func TestReplayOfTheSameTransactionIsRejected(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	bob := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 100})

	raw := h.sign(alice, tx.MsgSend{
		From: alice.addr, To: bob.addr, Amount: types.MustAmount(types.YZXA(5)),
	})
	h.requireOK(h.commitBlock(raw))
	first := h.balance(bob.addr)

	// Replay the identical bytes in a later block.
	h.requireFailed(h.commitBlock(raw))

	if got := h.balance(bob.addr); got.Cmp(first) != 0 {
		t.Fatalf("replay paid the recipient a second time: %s", types.FormatYZXA(got))
	}
	h.checkInvariants()
}

func TestBurnPermanentlyReducesCirculatingSupply(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 100})

	before := h.supply()
	burn := types.YZXA(10)

	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgBurn{
		From: alice.addr, Amount: types.MustAmount(burn),
	})))

	after := h.supply()
	burnedDelta := new(big.Int).Sub(after.Burned, before.Burned)
	if burnedDelta.Cmp(burn) < 0 {
		t.Fatalf("burned counter rose by %s, expected at least %s",
			types.FormatYZXA(burnedDelta), types.FormatYZXA(burn))
	}
	if after.Circulating.Cmp(before.Circulating) >= 0 {
		t.Fatal("circulating supply did not fall after a burn")
	}
	// Burning must never make room to mint more: remaining mintable is a
	// function of minted supply alone.
	if after.RemainingMintable.Cmp(before.RemainingMintable) > 0 {
		t.Fatal("burning increased the amount that may still be minted")
	}
	h.checkInvariants()
}

func TestEmissionPaysValidatorsAndNeverExceedsTheReserve(t *testing.T) {
	val := newAccount(t)
	h := newHarness(t, val, nil)

	before := h.supply()
	h.advance(20)
	after := h.supply()

	minted := new(big.Int).Sub(after.Minted, before.Minted)
	if minted.Sign() <= 0 {
		t.Fatal("no emission after 20 blocks")
	}
	// Twenty blocks at 0.125 YZXA each.
	expected := new(big.Int).Mul(big.NewInt(20), state.InitialBlockReward())
	if minted.Cmp(expected) != 0 {
		t.Fatalf("emitted %s over 20 blocks, expected %s",
			types.FormatYZXA(minted), types.FormatYZXA(expected))
	}
	es, err := h.app.State().GetEmissionState()
	if err != nil {
		t.Fatal(err)
	}
	if es.TotalEmitted.Int().Cmp(state.EmissionReserve()) > 0 {
		t.Fatal("emission exceeded its reserve")
	}
	h.checkInvariants()
}

func TestStakingRewardsAccrueAndCanBeWithdrawn(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 1_000})

	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgDelegate{
		Delegator: alice.addr, Validator: val.addr,
		Amount: types.MustAmount(types.YZXA(500)),
	})))
	h.advance(50)

	before := h.balance(alice.addr)
	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgWithdrawRewards{
		Delegator: alice.addr, Validator: val.addr,
	})))
	after := h.balance(alice.addr)

	if after.Cmp(before) <= 0 {
		t.Fatal("delegator received no staking reward after 50 blocks")
	}
	h.checkInvariants()
}

func TestUndelegatedStakeIsReturnedOnlyAfterTheUnbondingPeriod(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 1_000})

	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgDelegate{
		Delegator: alice.addr, Validator: val.addr,
		Amount: types.MustAmount(types.YZXA(300)),
	})))
	afterDelegate := h.balance(alice.addr)

	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgUndelegate{
		Delegator: alice.addr, Validator: val.addr,
		Amount: types.MustAmount(types.YZXA(300)),
	})))

	h.advance(5)
	if got := h.balance(alice.addr); got.Cmp(new(big.Int).Add(afterDelegate, types.YZXA(300))) >= 0 {
		t.Fatal("unbonded stake was returned before the unbonding period elapsed")
	}
	h.checkInvariants()

	// Jump past the 21-day unbonding period.
	h.advanceTime(22 * 24 * time.Hour)
	got := h.balance(alice.addr)
	if got.Cmp(new(big.Int).Add(afterDelegate, types.YZXA(299))) < 0 {
		t.Fatalf("unbonded stake was not returned: balance is %s", types.FormatYZXA(got))
	}
	h.checkInvariants()
}

func TestVestedAllocationCannotBeSpentBeforeTheCliff(t *testing.T) {
	val := newAccount(t)
	founder := newAccount(t)
	bob := newAccount(t)

	h := newHarness(t, val, nil, func(g *app.Genesis) {
		g.Accounts = append(g.Accounts, app.GenesisAccount{
			// A little unlocked balance so the account can pay a fee.
			Address: founder.addr,
			Balance: types.MustAmount(types.YZXA(1)),
			Label:   "founder-fee-balance",
		})
		g.Vesting = append(g.Vesting, app.GenesisVesting{
			Address:         founder.addr,
			Category:        state.VestingCategoryFounder,
			Total:           types.MustAmount(types.YZXA(500_000)),
			CliffSeconds:    app.FounderCliffSeconds,
			DurationSeconds: app.FounderDurationSeconds,
			Label:           "founder",
		})
	})

	// The vesting allocation is on the balance sheet...
	if got := h.balance(founder.addr); got.Cmp(types.YZXA(500_001)) != 0 {
		t.Fatalf("founder balance is %s", types.FormatYZXA(got))
	}
	// ...but it cannot move.
	h.requireFailed(h.commitBlock(h.sign(founder, tx.MsgSend{
		From: founder.addr, To: bob.addr, Amount: types.MustAmount(types.YZXA(1_000)),
	})))
	if h.balance(bob.addr).Sign() != 0 {
		t.Fatal("locked founder tokens were spent before the cliff")
	}
	h.checkInvariants()

	// Still nothing one day before the two-year cliff.
	h.advanceTime(2*365*24*time.Hour - 24*time.Hour)
	h.requireFailed(h.commitBlock(h.sign(founder, tx.MsgSend{
		From: founder.addr, To: bob.addr, Amount: types.MustAmount(types.YZXA(1_000)),
	})))
	h.checkInvariants()

	// After the cliff, the elapsed quarter of the eight-year schedule unlocks.
	h.advanceTime(48 * time.Hour)
	h.requireOK(h.commitBlock(h.sign(founder, tx.MsgSend{
		From: founder.addr, To: bob.addr, Amount: types.MustAmount(types.YZXA(1_000)),
	})))
	if h.balance(bob.addr).Cmp(types.YZXA(1_000)) != 0 {
		t.Fatal("vested tokens could not be spent after the cliff")
	}

	// But not more than has actually vested: 2 of 8 years is 25%.
	h.requireFailed(h.commitBlock(h.sign(founder, tx.MsgSend{
		From: founder.addr, To: bob.addr, Amount: types.MustAmount(types.YZXA(200_000)),
	})))
	h.checkInvariants()
}

func TestMultiSendIsAtomic(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	b1, b2, b3 := newAccount(t), newAccount(t), newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 100})

	// The third leg exceeds the balance, so no leg may be paid.
	h.requireFailed(h.commitBlock(h.sign(alice, tx.MsgMultiSend{
		From: alice.addr,
		Outputs: []tx.Output{
			{To: b1.addr, Amount: types.MustAmount(types.YZXA(10))},
			{To: b2.addr, Amount: types.MustAmount(types.YZXA(10))},
			{To: b3.addr, Amount: types.MustAmount(types.YZXA(10_000))},
		},
	})))
	for i, acc := range []*account{b1, b2, b3} {
		if h.balance(acc.addr).Sign() != 0 {
			t.Fatalf("recipient %d was paid by a failed atomic multisend", i)
		}
	}

	// A multisend that fits pays everyone.
	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgMultiSend{
		From: alice.addr,
		Outputs: []tx.Output{
			{To: b1.addr, Amount: types.MustAmount(types.YZXA(10))},
			{To: b2.addr, Amount: types.MustAmount(types.YZXA(20))},
			{To: b3.addr, Amount: types.MustAmount(types.YZXA(30))},
		},
	})))
	for i, want := range []int64{10, 20, 30} {
		acc := []*account{b1, b2, b3}[i]
		if h.balance(acc.addr).Cmp(types.YZXA(want)) != 0 {
			t.Fatalf("recipient %d holds %s, want %d YZXA", i, h.balance(acc.addr), want)
		}
	}
	h.checkInvariants()
}

// A node must survive a restart. CometBFT replays the last block on startup
// and compares the application's hash against the one recorded in the block
// header — so FinalizeBlock has to return the hash that Commit then makes
// durable. Getting this wrong makes a node refuse to start after any restart,
// which is exactly what happened before this test existed.
func TestAppHashFromFinalizeBlockMatchesTheCommittedState(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	bob := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 100})

	// Execute a block and capture the hash FinalizeBlock reported.
	h.height++
	h.now = h.now.Add(3 * time.Second)
	res, err := h.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{
		Height: h.height,
		Time:   h.now,
		Txs: [][]byte{h.sign(alice, tx.MsgSend{
			From: alice.addr, To: bob.addr, Amount: types.MustAmount(types.YZXA(5)),
		})},
		DecidedLastCommit: abci.CommitInfo{
			Votes: []abci.VoteInfo{{
				Validator:   abci.Validator{Address: h.valConsAddr.Bytes(), Power: 500},
				BlockIdFlag: 2,
			}},
		},
	})
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}
	if len(res.AppHash) == 0 {
		t.Fatal("FinalizeBlock returned an empty app hash; a node cannot replay its own last block")
	}
	reported := append([]byte(nil), res.AppHash...)

	if _, err := h.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// What Info reports after the commit must be the same hash.
	info, err := h.app.Info(context.Background(), &abci.RequestInfo{})
	if err != nil {
		t.Fatalf("info: %v", err)
	}
	if !bytes.Equal(info.LastBlockAppHash, reported) {
		t.Fatalf("app hash changed between FinalizeBlock and Commit:\n  finalize: %X\n  info:     %X",
			reported, info.LastBlockAppHash)
	}
	if info.LastBlockHeight != h.height {
		t.Fatalf("Info reports height %d, expected %d", info.LastBlockHeight, h.height)
	}
	h.checkInvariants()
}

// The app hash must describe the state a block actually produced: two blocks
// that change state differently must not report the same hash.
func TestAppHashChangesWithState(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	bob := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 100})

	h.commitBlock()
	first := h.app.State().Store().Root()

	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgSend{
		From: alice.addr, To: bob.addr, Amount: types.MustAmount(types.YZXA(1)),
	})))
	second := h.app.State().Store().Root()

	if bytes.Equal(first, second) {
		t.Fatal("the app hash did not change after a payment moved funds")
	}
}
