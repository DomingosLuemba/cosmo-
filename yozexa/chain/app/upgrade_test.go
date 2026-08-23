package app_test

import (
	"strings"
	"testing"
	"time"

	"github.com/yozexa/yozexa/chain/app"
	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// passUpgradeProposal votes a software upgrade through and lets the timelock
// expire, leaving it executed.
func passUpgradeProposal(t *testing.T, h *harness, voter *account, name string, height int64) {
	t.Helper()
	h.requireOK(h.commitBlock(h.sign(voter, tx.MsgSubmitProposal{
		Proposer: voter.addr,
		Kind:     tx.ProposalTypeSoftwareUpgrade,
		Title:    "Upgrade to " + name,
		Summary:  "Coordinated halt so every node switches at the same height.",
		Deposit:  types.MustAmount(types.YZXA(100)),
		Upgrade:  &tx.SoftwareUpgrade{Name: name, Height: height, Info: "release notes"},
	})))
	h.requireOK(h.commitBlock(h.sign(voter, tx.MsgVote{
		Voter: voter.addr, ProposalID: 1, Option: tx.VoteYes,
	})))
	h.advanceTime(8 * 24 * time.Hour) // close voting
	h.advanceTime(3 * 24 * time.Hour) // clear the timelock
}

// A vote for an upgrade that nothing acts on is theatre: the proposal passes,
// the height arrives, and every node carries on with the old rules.
func TestAScheduledUpgradeHaltsANodeThatDoesNotImplementIt(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 5_000})
	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgDelegate{
		Delegator: alice.addr, Validator: val.addr,
		Amount: types.MustAmount(types.YZXA(4_000)),
	})))

	target := h.height + 40
	passUpgradeProposal(t, h, alice, "v2", target)

	scheduled, err := h.app.ScheduledUpgrade()
	if err != nil {
		t.Fatalf("read scheduled upgrade: %v", err)
	}
	if scheduled == nil {
		t.Fatal("the proposal passed but nothing was scheduled")
	}
	if scheduled.Name != "v2" || scheduled.Height != target {
		t.Fatalf("scheduled %+v, want v2 at %d", scheduled, target)
	}

	// Blocks before the upgrade height are ordinary.
	for h.height < target-1 {
		if err := h.tryBlock(); err != nil {
			t.Fatalf("block %d before the upgrade height failed: %v", h.height, err)
		}
	}

	// The upgrade height itself must stop this node, which does not implement it.
	err = h.tryBlock()
	if err == nil {
		t.Fatal("the node ran straight through the upgrade height")
	}
	if !strings.Contains(err.Error(), "UPGRADE REQUIRED") {
		t.Fatalf("halted for the wrong reason: %v", err)
	}
	if !strings.Contains(err.Error(), "v2") {
		t.Fatalf("the halt does not name the upgrade an operator has to install: %v", err)
	}
}

// A node built for the upgrade passes through, and clears the schedule so the
// halt does not fire again on every subsequent block.
func TestANodeThatImplementsTheUpgradePassesThrough(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 5_000})
	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgDelegate{
		Delegator: alice.addr, Validator: val.addr,
		Amount: types.MustAmount(types.YZXA(4_000)),
	})))

	target := h.height + 40
	passUpgradeProposal(t, h, alice, "v2", target)
	h.app.UpgradeName = "v2"

	for h.height < target+3 {
		if err := h.tryBlock(); err != nil {
			t.Fatalf("a node that implements the upgrade halted at %d: %v", h.height, err)
		}
	}

	scheduled, err := h.app.ScheduledUpgrade()
	if err != nil {
		t.Fatalf("read scheduled upgrade: %v", err)
	}
	if scheduled != nil {
		t.Fatalf("the schedule survived the upgrade: %+v", scheduled)
	}
}

// An upgrade scheduled for a height already passed could never be coordinated:
// nodes would halt the moment it executed, at different points.
func TestAnUpgradeScheduledInThePastIsRefused(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 5_000})
	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgDelegate{
		Delegator: alice.addr, Validator: val.addr,
		Amount: types.MustAmount(types.YZXA(4_000)),
	})))

	passUpgradeProposal(t, h, alice, "v2", 1)

	prop, found, err := h.app.State().GetProposal(1)
	if err != nil || !found {
		t.Fatalf("proposal missing: %v", err)
	}
	if prop.Status != state.ProposalStatusFailed {
		t.Fatalf("proposal status is %q, expected execution to fail", prop.Status)
	}
	if !strings.Contains(prop.FailureReason, "not in the future") {
		t.Fatalf("failed for the wrong reason: %s", prop.FailureReason)
	}
	scheduled, err := h.app.ScheduledUpgrade()
	if err != nil {
		t.Fatalf("read scheduled upgrade: %v", err)
	}
	if scheduled != nil {
		t.Fatalf("an upgrade in the past was scheduled anyway: %+v", scheduled)
	}
	_ = app.Version
}

// Two proposals executing in the same block: the first lowers the treasury's
// per-epoch cap, the second spends against it. If the loop carries the block's
// starting parameters instead of re-reading them, the second proposal is
// measured against a cap that no longer exists — the loop disagreeing with the
// state it just wrote.
func TestAProposalSeesParameterChangesMadeEarlierInTheSameBlock(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 20_000})
	h.requireOK(h.commitBlock(h.sign(alice, tx.MsgDelegate{
		Delegator: alice.addr, Validator: val.addr,
		Amount: types.MustAmount(types.YZXA(15_000)),
	})))

	before, err := h.app.State().Params()
	if err != nil {
		t.Fatalf("read params: %v", err)
	}
	// A spend that fits comfortably under the current cap, and not at all
	// under the one proposal 1 sets.
	spend := types.YZXA(900)
	tightened := types.YZXA(100)
	if before.TreasuryMaxSpendPerEpoch.Int().Cmp(spend) <= 0 {
		t.Skip("the default treasury cap is already below the test spend")
	}

	recipient := newAccount(t)
	// Proposal 1: tighten the cap. Proposal 2: spend more than the new cap.
	h.requireOK(h.commitBlock(
		h.sign(alice, tx.MsgSubmitProposal{
			Proposer: alice.addr,
			Kind:     tx.ProposalTypeParamChange,
			Title:    "Tighten the treasury cap",
			Summary:  "Lower how much the treasury may spend in one epoch.",
			Deposit:  types.MustAmount(types.YZXA(100)),
			ParamChanges: []tx.ParamChange{{
				Key: "treasury_max_spend_per_epoch", Value: tightened.String(),
			}},
		}),
	))
	h.requireOK(h.commitBlock(
		h.sign(alice, tx.MsgSubmitProposal{
			Proposer: alice.addr,
			Kind:     tx.ProposalTypeTreasurySpend,
			Title:    "Spend from the treasury",
			Summary:  "A spend that the tightened cap must refuse.",
			Deposit:  types.MustAmount(types.YZXA(100)),
			Spend: &tx.TreasurySpend{
				Recipient: recipient.addr,
				Amount:    types.MustAmount(spend),
				Purpose:   "Anything at all",
			},
		}),
	))

	h.requireOK(h.commitBlock(
		h.sign(alice, tx.MsgVote{Voter: alice.addr, ProposalID: 1, Option: tx.VoteYes}),
	))
	h.requireOK(h.commitBlock(
		h.sign(alice, tx.MsgVote{Voter: alice.addr, ProposalID: 2, Option: tx.VoteYes}),
	))

	h.advanceTime(8 * 24 * time.Hour) // close both voting periods
	h.advanceTime(3 * 24 * time.Hour) // clear both timelocks; both execute here

	params, err := h.app.State().Params()
	if err != nil {
		t.Fatalf("read params: %v", err)
	}
	if params.TreasuryMaxSpendPerEpoch.Int().Cmp(tightened) != 0 {
		t.Fatalf("proposal 1 did not tighten the cap: it is %s", params.TreasuryMaxSpendPerEpoch)
	}

	spendProp, found, err := h.app.State().GetProposal(2)
	if err != nil || !found {
		t.Fatalf("spend proposal missing: %v", err)
	}
	if spendProp.Status != state.ProposalStatusFailed {
		t.Fatalf(
			"the treasury spend executed against the old cap: status %q. "+
				"The cap was lowered to %s in the same block and %s was spent.",
			spendProp.Status, types.FormatYZXA(tightened), types.FormatYZXA(spend))
	}
	if !strings.Contains(spendProp.FailureReason, "epoch limit") {
		t.Fatalf("refused for the wrong reason: %s", spendProp.FailureReason)
	}
	balance, err := h.app.State().Balance(recipient.addr)
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}
	if balance.Sign() != 0 {
		t.Fatalf("the recipient was paid %s despite the cap", types.FormatYZXA(balance))
	}
}
