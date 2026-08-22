package app

import (
	"encoding/json"
	"fmt"
	"math/big"

	abci "github.com/cometbft/cometbft/abci/types"

	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// execTx executes one transaction.
//
// The order of operations matters and is the same one every serious ledger
// uses:
//
//  1. authenticate (signature, chain id, sequence, expiry);
//  2. charge the fee — unconditionally, so that a failing transaction still
//     pays for the work it made the network do, which is what prevents free
//     spam;
//  3. execute the messages against a snapshot;
//  4. on any error, discard everything from step 3 and keep steps 1-2.
func (a *App) execTx(raw []byte, height, now int64, p state.Params) *abci.ExecTxResult {
	// Snapshot the block's staged writes so that rolling back this
	// transaction cannot touch the work of the transactions before it or of
	// begin-block. Discarding the whole pending set here would silently undo
	// every earlier payment in the block.
	entrySnapshot := a.kv.SnapshotPending()

	fail := func(code uint32, format string, args ...any) *abci.ExecTxResult {
		a.kv.RestorePending(entrySnapshot)
		return &abci.ExecTxResult{Code: code, Log: fmt.Sprintf(format, args...)}
	}

	t, err := tx.Decode(raw)
	if err != nil {
		return fail(CodeDecodeError, "%v", err)
	}
	msgs, signer, err := t.ValidateBasic(a.chainID)
	if err != nil {
		return fail(CodeInvalidSignature, "%v", err)
	}
	if t.Body.TimeoutHeight > 0 && height >= t.Body.TimeoutHeight {
		return fail(CodeTimeout, "transaction expired at height %d (current height %d)",
			t.Body.TimeoutHeight, height)
	}

	acc, err := a.state.GetAccount(signer)
	if err != nil {
		return fail(CodeInternal, "%v", err)
	}
	if t.Auth.Sequence != acc.Sequence {
		return fail(CodeWrongSequence, "expected sequence %d, got %d", acc.Sequence, t.Auth.Sequence)
	}

	gasUsed, err := TxGas(t, len(raw), msgs)
	if err != nil {
		return fail(CodeExecutionFailed, "%v", err)
	}
	if gasUsed > t.Auth.Fee.GasLimit {
		return fail(CodeInsufficientFee, "out of gas: used %d, limit %d", gasUsed, t.Auth.Fee.GasLimit)
	}
	if a.blockGasUsed+gasUsed > p.MaxBlockGas {
		return fail(CodeInsufficientFee, "block gas limit reached")
	}

	baseFee, err := a.state.GetBaseFee()
	if err != nil {
		return fail(CodeInternal, "%v", err)
	}
	gasPrice := t.Auth.Fee.GasPrice.Int()
	if gasPrice.Cmp(baseFee) < 0 {
		return fail(CodeInsufficientFee, "gas price %s is below the base fee %s", gasPrice, baseFee)
	}

	// The fee charged is gas *used* times gas price, not the gas limit: the
	// sender is never billed for headroom they did not consume.
	feeCharged := new(big.Int).Mul(new(big.Int).SetUint64(gasUsed), gasPrice)
	baseFeePart := new(big.Int).Mul(new(big.Int).SetUint64(gasUsed), baseFee)
	tipPart, err := types.Sub(feeCharged, baseFeePart)
	if err != nil {
		return fail(CodeInternal, "fee accounting: %v", err)
	}

	spendable, err := a.state.Spendable(signer, now)
	if err != nil {
		return fail(CodeInternal, "%v", err)
	}
	if spendable.Cmp(feeCharged) < 0 {
		return fail(CodeInsufficientFunds, "cannot pay fee of %s: %s spendable",
			types.FormatYZXA(feeCharged), types.FormatYZXA(spendable))
	}

	// --- Steps 1-2 are now final for this transaction. --------------------
	if err := a.state.SubBalance(signer, feeCharged); err != nil {
		return fail(CodeInsufficientFunds, "%v", err)
	}
	burnPart, err := types.MulQuo(baseFeePart, int64(p.BaseFeeBurnBps), 10_000)
	if err != nil {
		return fail(CodeInternal, "%v", err)
	}
	validatorPart, err := types.Sub(baseFeePart, burnPart)
	if err != nil {
		return fail(CodeInternal, "%v", err)
	}
	toValidators, err := types.Add(tipPart, validatorPart)
	if err != nil {
		return fail(CodeInternal, "%v", err)
	}
	if burnPart.Sign() > 0 {
		// Burn straight from the signer's already-debited fee: credit the
		// reward pool with the whole fee, then burn the base-fee share from
		// it, so the pool's balance is always exactly what it owes.
		if err := a.state.AddBalance(state.ModuleRewards, burnPart); err != nil {
			return fail(CodeInternal, "%v", err)
		}
		if err := a.state.Burn(state.ModuleRewards, burnPart); err != nil {
			return fail(CodeInternal, "%v", err)
		}
		a.blockBurned = new(big.Int).Add(a.blockBurned, burnPart)
	}
	if toValidators.Sign() > 0 {
		if err := a.state.AddBalance(state.ModuleRewards, toValidators); err != nil {
			return fail(CodeInternal, "%v", err)
		}
		if err := a.addUndistributed(toValidators); err != nil {
			return fail(CodeInternal, "%v", err)
		}
		a.blockFees = new(big.Int).Add(a.blockFees, toValidators)
	}
	if err := a.state.IncrementSequence(signer, t.Auth.PubKey); err != nil {
		return fail(CodeInternal, "%v", err)
	}
	a.blockGasUsed += gasUsed

	// The fee charge and the sequence bump must survive a message failure, so
	// the rollback point for execution is taken *after* them.
	feeSnapshot := a.kv.SnapshotPending()

	events := []abci.Event{}
	for i, m := range msgs {
		evs, err := a.dispatch(m, height, now, p)
		if err != nil {
			a.kv.RestorePending(feeSnapshot)
			return &abci.ExecTxResult{
				Code:      CodeExecutionFailed,
				Log:       fmt.Sprintf("message %d (%s): %v", i, m.Type(), err),
				GasUsed:   int64(gasUsed),
				GasWanted: int64(t.Auth.Fee.GasLimit),
			}
		}
		events = append(events, evs...)
	}

	return &abci.ExecTxResult{
		Code:      CodeOK,
		GasUsed:   int64(gasUsed),
		GasWanted: int64(t.Auth.Fee.GasLimit),
		Events:    events,
	}
}

// dispatch routes a message to its handler.
func (a *App) dispatch(m tx.Msg, height, now int64, p state.Params) ([]abci.Event, error) {
	s := a.state
	switch msg := m.(type) {

	case tx.MsgSend:
		if err := s.Transfer(msg.From, msg.To, msg.Amount.Int(), now); err != nil {
			return nil, err
		}
		return []abci.Event{transferEvent(msg.From, msg.To, msg.Amount.Int())}, nil

	case tx.MsgMultiSend:
		total, err := msg.Total()
		if err != nil {
			return nil, err
		}
		spendable, err := s.Spendable(msg.From, now)
		if err != nil {
			return nil, err
		}
		if spendable.Cmp(total) < 0 {
			return nil, fmt.Errorf("insufficient spendable balance for multisend: %s available, %s required",
				types.FormatYZXA(spendable), types.FormatYZXA(total))
		}
		evs := make([]abci.Event, 0, len(msg.Outputs))
		for _, o := range msg.Outputs {
			if err := s.Transfer(msg.From, o.To, o.Amount.Int(), now); err != nil {
				return nil, err
			}
			evs = append(evs, transferEvent(msg.From, o.To, o.Amount.Int()))
		}
		return evs, nil

	case tx.MsgBurn:
		spendable, err := s.Spendable(msg.From, now)
		if err != nil {
			return nil, err
		}
		if spendable.Cmp(msg.Amount.Int()) < 0 {
			return nil, fmt.Errorf("insufficient spendable balance to burn: %s available",
				types.FormatYZXA(spendable))
		}
		if err := s.Burn(msg.From, msg.Amount.Int()); err != nil {
			return nil, err
		}
		return []abci.Event{{
			Type: "burn",
			Attributes: []abci.EventAttribute{
				{Key: "from", Value: msg.From.String()},
				{Key: "amount", Value: msg.Amount.String()},
			},
		}}, nil

	case tx.MsgCreateValidator:
		if err := a.handleCreateValidator(s, msg, now, p); err != nil {
			return nil, err
		}
		return []abci.Event{{
			Type: "create_validator",
			Attributes: []abci.EventAttribute{
				{Key: "operator", Value: msg.Operator.ValoperString()},
				{Key: "self_delegation", Value: msg.SelfDelegation.String()},
			},
		}}, nil

	case tx.MsgEditValidator:
		return nil, a.handleEditValidator(s, msg)

	case tx.MsgDelegate:
		if err := a.handleDelegate(s, msg, now); err != nil {
			return nil, err
		}
		return []abci.Event{{
			Type: "delegate",
			Attributes: []abci.EventAttribute{
				{Key: "delegator", Value: msg.Delegator.String()},
				{Key: "validator", Value: msg.Validator.ValoperString()},
				{Key: "amount", Value: msg.Amount.String()},
			},
		}}, nil

	case tx.MsgUndelegate:
		if err := a.handleUndelegate(s, msg, now, p); err != nil {
			return nil, err
		}
		return []abci.Event{{
			Type: "undelegate",
			Attributes: []abci.EventAttribute{
				{Key: "delegator", Value: msg.Delegator.String()},
				{Key: "validator", Value: msg.Validator.ValoperString()},
				{Key: "amount", Value: msg.Amount.String()},
				{Key: "completes_unix", Value: fmt.Sprintf("%d", now+p.UnbondingSeconds)},
			},
		}}, nil

	case tx.MsgRedelegate:
		if err := a.handleRedelegate(s, msg, now, p); err != nil {
			return nil, err
		}
		return nil, nil

	case tx.MsgWithdrawRewards:
		paid, err := a.handleWithdrawRewards(s, msg)
		if err != nil {
			return nil, err
		}
		return []abci.Event{{
			Type: "withdraw_rewards",
			Attributes: []abci.EventAttribute{
				{Key: "delegator", Value: msg.Delegator.String()},
				{Key: "validator", Value: msg.Validator.ValoperString()},
				{Key: "amount", Value: paid.String()},
			},
		}}, nil

	case tx.MsgUnjail:
		return nil, a.handleUnjail(s, msg, now)

	case tx.MsgSubmitProposal:
		id, err := a.handleSubmitProposal(s, msg, now, p)
		if err != nil {
			return nil, err
		}
		return []abci.Event{{
			Type: "submit_proposal",
			Attributes: []abci.EventAttribute{
				{Key: "proposal_id", Value: fmt.Sprintf("%d", id)},
				{Key: "kind", Value: msg.Kind},
			},
		}}, nil

	case tx.MsgVote:
		return nil, a.handleVote(s, msg, now)

	case tx.MsgDeposit:
		return nil, a.handleDeposit(s, msg, now, p)

	case tx.MsgClaimVested:
		// Vested tokens are already in the account's balance; they simply stop
		// being locked as the schedule progresses. The message exists so a
		// wallet can show the holder their current position, and it fails
		// loudly if used on an account with no schedule.
		v, found, err := s.GetVestingSchedule(msg.Account)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, fmt.Errorf("account %s has no vesting schedule", msg.Account)
		}
		status, err := v.Status(now)
		if err != nil {
			return nil, err
		}
		return []abci.Event{{
			Type: "vesting_status",
			Attributes: []abci.EventAttribute{
				{Key: "account", Value: msg.Account.String()},
				{Key: "vested", Value: status.Vested},
				{Key: "locked", Value: status.Locked},
			},
		}}, nil

	case tx.MsgGrant:
		if msg.ExpiresAtUnix <= now {
			return nil, fmt.Errorf("grant expiry %d is not in the future (block time is %d)",
				msg.ExpiresAtUnix, now)
		}
		if msg.ExpiresAtUnix-now > tx.MaxGrantDurationSeconds {
			return nil, fmt.Errorf("grant would run for %d seconds; the maximum is %d",
				msg.ExpiresAtUnix-now, tx.MaxGrantDurationSeconds)
		}
		if err := s.SetGrant(state.GrantFromMsg(msg, now)); err != nil {
			return nil, err
		}
		return []abci.Event{{
			Type: "grant",
			Attributes: []abci.EventAttribute{
				{Key: "granter", Value: msg.Granter.String()},
				{Key: "grantee", Value: msg.Grantee.String()},
				{Key: "total_limit", Value: msg.Limit.Total.String()},
				{Key: "expires_unix", Value: fmt.Sprintf("%d", msg.ExpiresAtUnix)},
			},
		}}, nil

	case tx.MsgRevoke:
		if _, found, err := s.GetGrant(msg.Granter, msg.Grantee); err != nil {
			return nil, err
		} else if !found {
			return nil, fmt.Errorf("no grant from %s to %s", msg.Granter, msg.Grantee)
		}
		if err := s.DeleteGrant(msg.Granter, msg.Grantee); err != nil {
			return nil, err
		}
		return []abci.Event{{
			Type: "revoke",
			Attributes: []abci.EventAttribute{
				{Key: "granter", Value: msg.Granter.String()},
				{Key: "grantee", Value: msg.Grantee.String()},
			},
		}}, nil

	case tx.MsgExec:
		return a.handleExec(s, msg, height, now, p)

	case tx.MsgRegisterAlias:
		if _, found, err := s.GetAlias(msg.Alias); err != nil {
			return nil, err
		} else if found {
			return nil, fmt.Errorf("the YOZEXA ID %q is already registered", msg.Alias)
		}
		if err := s.SetAlias(state.Alias{
			Name:           msg.Alias,
			Owner:          msg.Owner,
			RegisteredUnix: now,
		}); err != nil {
			return nil, err
		}
		return []abci.Event{{
			Type: "register_alias",
			Attributes: []abci.EventAttribute{
				{Key: "alias", Value: msg.Alias},
				{Key: "owner", Value: msg.Owner.String()},
			},
		}}, nil

	case tx.MsgTransferAlias:
		al, found, err := s.GetAlias(msg.Alias)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, fmt.Errorf("the YOZEXA ID %q is not registered", msg.Alias)
		}
		if al.Owner != msg.Owner {
			return nil, fmt.Errorf("the YOZEXA ID %q belongs to another account", msg.Alias)
		}
		if err := s.ClearAliasOwner(msg.Owner); err != nil {
			return nil, err
		}
		al.Owner = msg.To
		return nil, s.SetAlias(al)

	default:
		return nil, fmt.Errorf("no handler for message type %q", m.Type())
	}
}

// handleExec runs messages on behalf of a granter, charging every spend
// against the grant's limits before it happens.
func (a *App) handleExec(s *state.State, msg tx.MsgExec, height, now int64, p state.Params) ([]abci.Event, error) {
	grant, found, err := s.GetGrant(msg.Granter, msg.Grantee)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, fmt.Errorf("%s has no spending permission from %s", msg.Grantee, msg.Granter)
	}
	inner, err := msg.InnerMsgs()
	if err != nil {
		return nil, err
	}

	var events []abci.Event
	for i, im := range inner {
		amount, recipients, err := spendProfile(im)
		if err != nil {
			return nil, fmt.Errorf("message %d: %w", i, err)
		}
		// Authorise and charge the limit in one step: there is no path that
		// checks a limit and then forgets to record the spend.
		if err := grant.Authorize(im.Type(), recipients, amount, now); err != nil {
			return nil, fmt.Errorf("message %d: %w", i, err)
		}
		evs, err := a.dispatch(im, height, now, p)
		if err != nil {
			return nil, fmt.Errorf("message %d: %w", i, err)
		}
		events = append(events, evs...)
	}
	if err := s.SetGrant(grant); err != nil {
		return nil, err
	}
	return events, nil
}

// spendProfile extracts how much a message moves and where to, so a grant can
// be enforced against it.
//
// A message type whose spend cannot be determined here is refused rather than
// treated as spending zero. That default matters: a new message type added
// later must be deliberately taught to this function before a delegated key
// can ever use it.
func spendProfile(m tx.Msg) (*big.Int, []types.Address, error) {
	switch t := m.(type) {
	case tx.MsgSend:
		return t.Amount.Int(), []types.Address{t.To}, nil
	case tx.MsgMultiSend:
		total, err := t.Total()
		if err != nil {
			return nil, nil, err
		}
		to := make([]types.Address, 0, len(t.Outputs))
		for _, o := range t.Outputs {
			to = append(to, o.To)
		}
		return total, to, nil
	case tx.MsgDelegate:
		return t.Amount.Int(), []types.Address{t.Validator}, nil
	case tx.MsgUndelegate:
		return types.Zero(), []types.Address{t.Validator}, nil
	case tx.MsgWithdrawRewards:
		return types.Zero(), []types.Address{t.Validator}, nil
	default:
		return nil, nil, fmt.Errorf("message type %q may not be executed under a delegated grant", m.Type())
	}
}

func transferEvent(from, to types.Address, amount *big.Int) abci.Event {
	return abci.Event{
		Type: "transfer",
		Attributes: []abci.EventAttribute{
			{Key: "from", Value: from.String()},
			{Key: "to", Value: to.String()},
			{Key: "amount", Value: amount.String()},
		},
	}
}

func jsonUnmarshalEntry(b []byte, out any) error { return json.Unmarshal(b, out) }
