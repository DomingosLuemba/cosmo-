package app_test

import (
	"testing"

	abci "github.com/cometbft/cometbft/abci/types"

	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// addressesIndexed returns the addresses the `account` event marked for
// indexing on a transaction result. This is what a wallet's history query
// matches against, so if an address is missing here the account cannot find
// its own transaction.
func addressesIndexed(res *abci.ExecTxResult) []string {
	var out []string
	for _, e := range res.Events {
		if e.Type != "account" {
			continue
		}
		for _, a := range e.Attributes {
			if a.Key == "address" && a.Index {
				out = append(out, a.Value)
			}
		}
	}
	return out
}

func contains(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

// A payment must be findable by both parties. A history that only the sender
// can search is not a history — the recipient has no way to see what arrived.
func TestPaymentIsIndexedForBothSenderAndRecipient(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	bob := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 100})

	results := h.commitBlock(h.sign(alice, tx.MsgSend{
		From: alice.addr, To: bob.addr, Amount: types.MustAmount(types.YZXA(5)),
	}))
	h.requireOK(results)

	indexed := addressesIndexed(results[0])
	if !contains(indexed, alice.addr.String()) {
		t.Fatalf("the sender is not indexed; indexed: %v", indexed)
	}
	if !contains(indexed, bob.addr.String()) {
		t.Fatalf("the recipient is not indexed; indexed: %v", indexed)
	}
	// The sender is named twice — once as the signer, once as the payer — and
	// must be indexed once, or their history repeats every payment they make.
	count := 0
	for _, a := range indexed {
		if a == alice.addr.String() {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("the sender was indexed %d times, want exactly 1", count)
	}
}

// Every recipient of a multisend must be able to find it, not just the first.
func TestMultiSendIsIndexedForEveryRecipient(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	bob := newAccount(t)
	carol := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 100})

	results := h.commitBlock(h.sign(alice, tx.MsgMultiSend{
		From: alice.addr,
		Outputs: []tx.Output{
			{To: bob.addr, Amount: types.MustAmount(types.YZXA(2))},
			{To: carol.addr, Amount: types.MustAmount(types.YZXA(3))},
		},
	}))
	h.requireOK(results)

	indexed := addressesIndexed(results[0])
	for name, addr := range map[string]types.Address{
		"sender": alice.addr, "first recipient": bob.addr, "second recipient": carol.addr,
	} {
		if !contains(indexed, addr.String()) {
			t.Fatalf("%s is not indexed; indexed: %v", name, addr)
		}
	}
}

// A transaction that failed still charged a fee. If it is not indexed, the
// account sees money leave with nothing to explain it.
func TestFailedTransactionIsStillIndexedForTheSigner(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	bob := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 10})

	results := h.commitBlock(h.sign(alice, tx.MsgSend{
		From: alice.addr, To: bob.addr, Amount: types.MustAmount(types.YZXA(1_000_000)),
	}))
	h.requireFailed(results)

	indexed := addressesIndexed(results[0])
	if !contains(indexed, alice.addr.String()) {
		t.Fatalf("the signer of a failed, fee-charged transaction is not indexed; indexed: %v", indexed)
	}
	// The recipient was never credited, so the transaction is not part of
	// their history and must not appear there.
	if contains(indexed, bob.addr.String()) {
		t.Fatalf("a recipient who received nothing was indexed; indexed: %v", indexed)
	}
}

// Staking is part of an account's history too — a wallet that shows payments
// but silently drops delegations is lying by omission.
func TestDelegationIsIndexedForTheDelegator(t *testing.T) {
	val := newAccount(t)
	alice := newAccount(t)
	h := newHarness(t, val, map[*account]int64{alice: 100})

	results := h.commitBlock(h.sign(alice, tx.MsgDelegate{
		Delegator: alice.addr, Validator: val.addr, Amount: types.MustAmount(types.YZXA(10)),
	}))
	h.requireOK(results)

	indexed := addressesIndexed(results[0])
	if !contains(indexed, alice.addr.String()) {
		t.Fatalf("the delegator is not indexed; indexed: %v", indexed)
	}
	if !contains(indexed, val.addr.ValoperString()) {
		t.Fatalf("the validator is not indexed under its operator address; indexed: %v", indexed)
	}
}
