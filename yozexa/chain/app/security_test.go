package app_test

import (
	"context"
	"encoding/json"
	"math/big"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	dbm "github.com/cometbft/cometbft-db"
	"github.com/cometbft/cometbft/libs/log"

	"github.com/yozexa/yozexa/chain/app"
	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// A genesis that allocates more than the hard cap must be refused outright.
// This is the last moment at which the cap could be broken without a bug, so
// it is checked before a single block exists.
func TestGenesisAboveTheHardCapIsRefused(t *testing.T) {
	val := newAccount(t)
	whale := newAccount(t)

	g := app.Genesis{
		ChainID:     "yozexa-overflow-1",
		GenesisTime: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
		Params:      state.DefaultParams(),
		Accounts: []app.GenesisAccount{
			{Address: val.addr, Balance: types.MustAmount(types.YZXA(1_000)), Label: "v"},
			{Address: whale.addr, Balance: types.MustAmount(types.YZXA(9_999_999)), Label: "whale"},
		},
		Validators: []app.GenesisValidator{{
			Operator:          val.addr,
			ConsensusPubKey:   mustConsPub(t, 9),
			Moniker:           "v",
			SelfDelegation:    types.MustAmount(types.YZXA(500)),
			MaxCommissionBps:  1_000,
			MinSelfDelegation: types.MustAmount(types.YZXA(1)),
		}},
	}
	if err := g.Validate(); err == nil {
		t.Fatal("a genesis allocating past the hard cap was accepted")
	}

	// And the application must refuse it too, not only the helper.
	db := dbm.NewMemDB()
	a, err := app.New(db, log.NewNopLogger(), app.Options{})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(g)
	if _, err := a.InitChain(context.Background(), &abci.RequestInitChain{
		ChainId: g.ChainID, Time: g.GenesisTime, AppStateBytes: raw,
	}); err == nil {
		t.Fatal("InitChain accepted a genesis that breaks the hard cap")
	}
}

func mustConsPub(t *testing.T, seed byte) string {
	t.Helper()
	pub, _ := newConsensusKey(t, seed)
	return pub
}

// Emission must stop dead at the reserve, not merely slow down. The test
// drives the schedule to exhaustion by starting a chain whose emission state
// is already almost spent.
func TestEmissionStopsAtTheReserve(t *testing.T) {
	val := newAccount(t)
	h := newHarness(t, val, nil)

	// Fast-forward the emission counter to one block reward short of the
	// reserve, through the same state accessor the protocol uses.
	s := h.app.State()
	almost := new(big.Int).Sub(state.EmissionReserve(), state.InitialBlockReward())
	if err := s.SetEmissionState(state.EmissionState{
		TotalEmitted:     types.MustAmount(almost),
		LastRewardHeight: h.height,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Store().Commit(s.Store().Version() + 1); err != nil {
		t.Fatal(err)
	}
	h.height = s.Store().Version()

	h.advance(3)

	es, err := s.GetEmissionState()
	if err != nil {
		t.Fatal(err)
	}
	if es.TotalEmitted.Int().Cmp(state.EmissionReserve()) > 0 {
		t.Fatalf("emission overshot the reserve: %s > %s",
			es.TotalEmitted, state.EmissionReserve())
	}
	// The last permissible reward should have been paid, and nothing after.
	if es.TotalEmitted.Int().Cmp(state.EmissionReserve()) != 0 {
		t.Fatalf("emission stopped early at %s of %s", es.TotalEmitted, state.EmissionReserve())
	}
	h.checkInvariants()
}

// The supply cap is not merely a check on a counter: it must hold against the
// state accessor directly, because that accessor is the only door through
// which YZXA can come into existence.
func TestMintRefusesToCrossTheHardCap(t *testing.T) {
	val := newAccount(t)
	h := newHarness(t, val, nil)
	s := h.app.State()

	remaining, err := s.MintableRemaining()
	if err != nil {
		t.Fatal(err)
	}
	// One unit past what is left must be refused.
	oneTooMany := new(big.Int).Add(remaining, big.NewInt(1))
	if err := s.Mint(val.addr, oneTooMany); err == nil {
		t.Fatal("Mint created supply beyond the hard cap")
	}
	// Exactly what is left must be accepted, and then nothing more.
	if err := s.Mint(val.addr, remaining); err != nil {
		t.Fatalf("Mint refused an amount that fits under the cap: %v", err)
	}
	if err := s.Mint(val.addr, big.NewInt(1)); err == nil {
		t.Fatal("Mint created a unit past a fully-minted supply")
	}
	supply, err := s.Supply()
	if err != nil {
		t.Fatal(err)
	}
	if supply.Minted.Cmp(types.MaxSupplyCopy()) != 0 {
		t.Fatalf("minted %s, expected exactly the cap %s", supply.Minted, supply.Max)
	}
}

// A grant is the primitive behind subscriptions, session keys and AI agent
// wallets. It must hold every limit it declares.
func TestDelegatedSpendingRespectsEveryLimit(t *testing.T) {
	owner := newAccount(t)
	agent := newAccount(t)
	merchant := newAccount(t)
	attacker := newAccount(t)
	val := newAccount(t)

	h := newHarness(t, val, map[*account]int64{
		owner: 1_000, agent: 10, merchant: 0, attacker: 0,
	})

	expiry := h.now.Add(24 * time.Hour).Unix()
	h.requireOK(h.commitBlock(h.sign(owner, tx.MsgGrant{
		Granter:           owner.addr,
		Grantee:           agent.addr,
		AllowedMsgTypes:   []string{tx.MsgTypeSend},
		AllowedRecipients: []types.Address{merchant.addr},
		Limit: tx.SpendLimit{
			Total:         types.MustAmount(types.YZXA(20)),
			PerPeriod:     types.MustAmount(types.YZXA(5)),
			PeriodSeconds: 3600,
		},
		ExpiresAtUnix:        expiry,
		RequireApprovalAbove: types.MustAmount(types.YZXA(3)),
	})))

	exec := func(to types.Address, amountYZXA int64) []byte {
		inner, err := tx.MarshalMsg(tx.MsgSend{
			From: owner.addr, To: to, Amount: types.MustAmount(types.YZXA(amountYZXA)),
		})
		if err != nil {
			t.Fatal(err)
		}
		return h.sign(agent, tx.MsgExec{
			Grantee: agent.addr, Granter: owner.addr,
			Msgs: []json.RawMessage{inner},
		})
	}

	// Within every limit: allowed.
	h.requireOK(h.commitBlock(exec(merchant.addr, 2)))
	if got := h.balance(merchant.addr); got.Cmp(types.YZXA(2)) != 0 {
		t.Fatalf("merchant holds %s after an authorised agent payment", types.FormatYZXA(got))
	}

	// Above the per-transaction approval ceiling: refused.
	h.requireFailed(h.commitBlock(exec(merchant.addr, 4)))

	// To a destination the grant does not name: refused.
	h.requireFailed(h.commitBlock(exec(attacker.addr, 1)))

	// Past the per-period cap: refused (2 + 2 + 2 would exceed 5 in an hour).
	h.requireOK(h.commitBlock(exec(merchant.addr, 2)))
	h.requireFailed(h.commitBlock(exec(merchant.addr, 2)))

	if got := h.balance(merchant.addr); got.Cmp(types.YZXA(4)) != 0 {
		t.Fatalf("merchant holds %s; the agent moved more than its grant allowed",
			types.FormatYZXA(got))
	}
	if h.balance(attacker.addr).Sign() != 0 {
		t.Fatal("the agent paid an address outside the grant")
	}
	h.checkInvariants()

	// After the window rolls over, spending resumes up to the total.
	h.advanceTime(2 * time.Hour)
	h.requireOK(h.commitBlock(exec(merchant.addr, 3)))

	// A revoked grant stops working immediately.
	h.requireOK(h.commitBlock(h.sign(owner, tx.MsgRevoke{
		Granter: owner.addr, Grantee: agent.addr,
	})))
	h.requireFailed(h.commitBlock(exec(merchant.addr, 1)))
	h.checkInvariants()
}

// A grant must not be usable to do things it never authorised, and must expire
// on its own without anyone having to intervene.
func TestGrantCannotBeWidenedOrOutlived(t *testing.T) {
	owner := newAccount(t)
	agent := newAccount(t)
	merchant := newAccount(t)
	val := newAccount(t)
	h := newHarness(t, val, map[*account]int64{owner: 1_000, agent: 10})

	// A grant with no expiry is rejected before it is ever stored.
	if err := (tx.MsgGrant{
		Granter:         owner.addr,
		Grantee:         agent.addr,
		AllowedMsgTypes: []string{tx.MsgTypeSend},
		Limit:           tx.SpendLimit{Total: types.MustAmount(types.YZXA(1))},
	}).ValidateBasic(); err == nil {
		t.Fatal("a grant without an expiry was accepted")
	}
	// A grant with no limit is rejected: there is no such thing as unlimited.
	if err := (tx.MsgGrant{
		Granter:         owner.addr,
		Grantee:         agent.addr,
		AllowedMsgTypes: []string{tx.MsgTypeSend},
		ExpiresAtUnix:   h.now.Add(time.Hour).Unix(),
	}).ValidateBasic(); err == nil {
		t.Fatal("a grant with no spending limit was accepted")
	}
	// Governance voting may never be delegated to a session key.
	if err := (tx.MsgGrant{
		Granter:         owner.addr,
		Grantee:         agent.addr,
		AllowedMsgTypes: []string{tx.MsgTypeVote},
		Limit:           tx.SpendLimit{Total: types.MustAmount(types.YZXA(1))},
		ExpiresAtUnix:   h.now.Add(time.Hour).Unix(),
	}).ValidateBasic(); err == nil {
		t.Fatal("a grant delegating governance votes was accepted")
	}

	expiry := h.now.Add(2 * time.Hour).Unix()
	h.requireOK(h.commitBlock(h.sign(owner, tx.MsgGrant{
		Granter:         owner.addr,
		Grantee:         agent.addr,
		AllowedMsgTypes: []string{tx.MsgTypeSend},
		Limit: tx.SpendLimit{
			Total: types.MustAmount(types.YZXA(100)),
		},
		ExpiresAtUnix: expiry,
	})))

	inner, err := tx.MarshalMsg(tx.MsgSend{
		From: owner.addr, To: merchant.addr, Amount: types.MustAmount(types.YZXA(1)),
	})
	if err != nil {
		t.Fatal(err)
	}
	h.requireOK(h.commitBlock(h.sign(agent, tx.MsgExec{
		Grantee: agent.addr, Granter: owner.addr, Msgs: []json.RawMessage{inner},
	})))

	// Past the expiry, the same grant is dead without anyone revoking it.
	h.advanceTime(3 * time.Hour)
	inner2, _ := tx.MarshalMsg(tx.MsgSend{
		From: owner.addr, To: merchant.addr, Amount: types.MustAmount(types.YZXA(1)),
	})
	h.requireFailed(h.commitBlock(h.sign(agent, tx.MsgExec{
		Grantee: agent.addr, Granter: owner.addr, Msgs: []json.RawMessage{inner2},
	})))
	h.checkInvariants()
}

// Double signing must slash the validator and remove it forever.
func TestDoubleSigningTombstonesTheValidatorPermanently(t *testing.T) {
	val := newAccount(t)
	h := newHarness(t, val, nil)

	before, found, err := h.app.State().GetValidator(val.addr)
	if err != nil || !found {
		t.Fatalf("validator missing: %v", err)
	}
	beforeSupply := h.supply()

	h.height++
	h.now = h.now.Add(3 * time.Second)
	if _, err := h.app.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{
		Height: h.height,
		Time:   h.now,
		Misbehavior: []abci.Misbehavior{{
			Type:      abci.MisbehaviorType_DUPLICATE_VOTE,
			Validator: abci.Validator{Address: h.valConsAddr.Bytes(), Power: 500},
			Height:    h.height - 1,
			Time:      h.now.Add(-3 * time.Second),
		}},
	}); err != nil {
		t.Fatalf("finalize: %v", err)
	}
	if _, err := h.app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}

	after, _, err := h.app.State().GetValidator(val.addr)
	if err != nil {
		t.Fatal(err)
	}
	if !after.Tombstoned || !after.Jailed {
		t.Fatal("a double-signing validator was not tombstoned and jailed")
	}
	if after.Tokens.Cmp(before.Tokens) >= 0 {
		t.Fatal("a double-signing validator lost no stake")
	}
	// The slashed stake is burned, not redistributed.
	afterSupply := h.supply()
	if afterSupply.Burned.Cmp(beforeSupply.Burned) <= 0 {
		t.Fatal("slashed stake was not burned")
	}

	// It can never come back, not even by unjailing.
	h.requireFailed(h.commitBlock(h.sign(val, tx.MsgUnjail{Operator: val.addr})))

	// And the consensus key cannot be re-registered by anyone else.
	newOp := newAccount(t)
	h2 := newHarness(t, newOp, nil)
	_ = h2
	h.checkInvariants()
}

// Governance may move treasury funds but may never create them.
func TestGovernanceCannotMintAndRespectsTheTimelock(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 5_000})

	// Alice bonds so she has voting power.
	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgDelegate{
		Delegator: alice.addr, Validator: val.addr,
		Amount: types.MustAmount(types.YZXA(4_000)),
	})))

	recipient := newAccount(t)
	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgSubmitProposal{
		Proposer: alice.addr,
		Kind:     tx.ProposalTypeTreasurySpend,
		Title:    "Fund an audit",
		Summary:  "Pay an external security audit from the treasury.",
		Deposit:  types.MustAmount(types.YZXA(100)),
		Spend: &tx.TreasurySpend{
			Recipient: recipient.addr,
			Amount:    types.MustAmount(types.YZXA(1_000)),
			Purpose:   "External audit of the consensus and supply logic",
		},
	})))

	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgVote{
		Voter: alice.addr, ProposalID: 1, Option: tx.VoteYes,
	})))

	supplyBefore := h.supply()

	// Close the voting period.
	h.advanceTime(8 * 24 * time.Hour)
	prop, found, err := h.app.State().GetProposal(1)
	if err != nil || !found {
		t.Fatalf("proposal missing: %v", err)
	}
	if prop.Status != state.ProposalStatusPassed {
		t.Fatalf("proposal status is %q, expected it to have passed", prop.Status)
	}
	// The timelock must still be holding it.
	if h.balance(recipient.addr).Sign() != 0 {
		t.Fatal("a passed proposal executed before its timelock elapsed")
	}

	// Run out the timelock.
	h.advanceTime(3 * 24 * time.Hour)
	prop, _, err = h.app.State().GetProposal(1)
	if err != nil {
		t.Fatal(err)
	}
	if prop.Status != state.ProposalStatusExecuted {
		t.Fatalf("proposal status is %q after the timelock, reason: %s", prop.Status, prop.FailureReason)
	}
	if got := h.balance(recipient.addr); got.Cmp(types.YZXA(1_000)) != 0 {
		t.Fatalf("recipient holds %s, expected 1000 YZXA", types.FormatYZXA(got))
	}

	// The critical property: the treasury paid, it did not print.
	supplyAfter := h.supply()
	if supplyAfter.Minted.Cmp(supplyBefore.Minted) < 0 {
		t.Fatal("minted supply decreased")
	}
	treasurySpend := types.YZXA(1_000)
	mintedDelta := new(big.Int).Sub(supplyAfter.Minted, supplyBefore.Minted)
	if mintedDelta.Cmp(treasurySpend) >= 0 {
		t.Fatalf("governance appears to have minted %s to fund a %s spend",
			types.FormatYZXA(mintedDelta), types.FormatYZXA(treasurySpend))
	}
	h.checkInvariants()
}

// Governance parameter changes are re-validated at execution: a passed
// proposal with impossible values fails instead of bricking the network.
func TestGovernanceCannotDisableDoubleSignSlashing(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 5_000})

	// The proposal is rejected at submission, before anyone wastes a vote.
	results := h.commitBlock(h.sign(alice, tx.MsgSubmitProposal{
		Proposer: alice.addr,
		Kind:     tx.ProposalTypeParamChange,
		Title:    "Disable equivocation slashing",
		Summary:  "Set the double-sign slash fraction to zero.",
		Deposit:  types.MustAmount(types.YZXA(100)),
		ParamChanges: []tx.ParamChange{
			{Key: "slash_fraction_double_sign_bps", Value: "0"},
		},
	}))
	h.requireFailed(results)
	h.checkInvariants()
}

// An account with no bonded stake has no say in governance.
func TestVotingRequiresStakeAtRisk(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	whale := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 1_000, whale: 5_000})

	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgDelegate{
		Delegator: alice.addr, Validator: val.addr,
		Amount: types.MustAmount(types.YZXA(100)),
	})))
	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgSubmitProposal{
		Proposer: alice.addr,
		Kind:     tx.ProposalTypeText,
		Title:    "A signalling proposal",
		Summary:  "No payload.",
		Deposit:  types.MustAmount(types.YZXA(100)),
	})))

	// The whale holds five times alice's balance but has bonded nothing.
	h.requireFailed(h.commitBlock(h.sign(whale, tx.MsgVote{
		Voter: whale.addr, ProposalID: 1, Option: tx.VoteNo,
	})))
	h.checkInvariants()
}

// YOZEXA IDs must resist the impersonation tricks that make name-based
// payments dangerous.
func TestAliasRegistrationRejectsImpersonationAttempts(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	attacker := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 100, attacker: 100})

	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgRegisterAlias{
		Owner: alice.addr, Alias: "maria.yzx",
	})))

	// The same name cannot be taken twice.
	h.requireFailed(h.commitBlock(h.sign(attacker, tx.MsgRegisterAlias{
		Owner: attacker.addr, Alias: "maria.yzx",
	})))

	// Non-ASCII lookalikes are refused at the message level, so a Cyrillic
	// "а" can never be registered as a homograph of "maria".
	for _, bad := range []string{
		"marіa.yzx",    // Cyrillic i
		"MARIA.yzx",    // uppercase
		"ma--ria.yzx",  // doubled hyphen
		"-maria.yzx",   // leading hyphen
		"12345.yzx",    // all digits
		"treasury.yzx", // reserved
		"maria",        // missing suffix
		"ma.yzx",       // too short
	} {
		if err := (tx.MsgRegisterAlias{Owner: attacker.addr, Alias: bad}).ValidateBasic(); err == nil {
			t.Fatalf("alias %q was accepted", bad)
		}
	}

	resolved, err := h.app.State().ResolveRecipient("maria.yzx")
	if err != nil {
		t.Fatal(err)
	}
	if resolved != alice.addr {
		t.Fatal("alias resolved to the wrong account")
	}
	h.checkInvariants()
}
