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

// handleSubmitProposal opens a proposal and escrows its deposit.
func (a *App) handleSubmitProposal(s *state.State, m tx.MsgSubmitProposal, now int64, p state.Params) (uint64, error) {
	// A treasury spend is checked for plausibility at submission time as well
	// as at execution: a proposal that could never execute should not consume
	// a voting period.
	if m.Kind == tx.ProposalTypeTreasurySpend {
		if m.Spend.Amount.Cmp(p.TreasuryMaxSpendPerEpoch) > 0 {
			return 0, fmt.Errorf(
				"treasury spend of %s exceeds the per-epoch limit of %s; raise the limit in a separate parameter proposal first",
				types.FormatYZXA(m.Spend.Amount.Int()),
				types.FormatYZXA(p.TreasuryMaxSpendPerEpoch.Int()))
		}
	}
	// A parameter proposal is validated against the current params so an
	// unknown key or an unparseable value is rejected before anyone votes.
	if m.Kind == tx.ProposalTypeParamChange {
		trial := p
		for _, c := range m.ParamChanges {
			if err := trial.SetParam(c.Key, c.Value); err != nil {
				return 0, err
			}
		}
		if err := trial.Validate(); err != nil {
			return 0, fmt.Errorf("proposed parameters are invalid: %w", err)
		}
	}

	if err := s.Transfer(m.Proposer, state.ModuleGovDeposit, m.Deposit.Int(), now); err != nil {
		return 0, fmt.Errorf("escrow deposit: %w", err)
	}

	id, err := s.NextProposalID()
	if err != nil {
		return 0, err
	}
	zero := types.MustAmount(types.Zero())
	prop := state.Proposal{
		ID:              id,
		Kind:            m.Kind,
		Title:           m.Title,
		Summary:         m.Summary,
		Proposer:        m.Proposer,
		ParamChanges:    m.ParamChanges,
		Spend:           m.Spend,
		Upgrade:         m.Upgrade,
		Deposit:         m.Deposit,
		SubmitUnix:      now,
		DepositEndUnix:  now + p.DepositPeriodSeconds,
		TallyYes:        zero,
		TallyNo:         zero,
		TallyAbstain:    zero,
		TallyNoWithVeto: zero,
	}
	if m.Deposit.Cmp(p.MinDeposit) >= 0 {
		prop.Status = state.ProposalStatusVoting
		prop.VotingEndUnix = now + p.VotingPeriodSeconds
	} else {
		prop.Status = state.ProposalStatusDeposit
	}
	return id, s.SetProposal(prop)
}

// handleDeposit adds to a proposal's deposit, moving it into voting once the
// minimum is reached.
func (a *App) handleDeposit(s *state.State, m tx.MsgDeposit, now int64, p state.Params) error {
	prop, found, err := s.GetProposal(m.ProposalID)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("proposal %d does not exist", m.ProposalID)
	}
	if prop.Status != state.ProposalStatusDeposit {
		return fmt.Errorf("proposal %d is not in its deposit period", m.ProposalID)
	}
	if now > prop.DepositEndUnix {
		return fmt.Errorf("the deposit period for proposal %d has ended", m.ProposalID)
	}
	if err := s.Transfer(m.Depositor, state.ModuleGovDeposit, m.Amount.Int(), now); err != nil {
		return err
	}
	total, err := types.Add(prop.Deposit.Int(), m.Amount.Int())
	if err != nil {
		return err
	}
	if prop.Deposit, err = types.NewAmount(total); err != nil {
		return err
	}
	if prop.Deposit.Cmp(p.MinDeposit) >= 0 {
		prop.Status = state.ProposalStatusVoting
		prop.VotingEndUnix = now + p.VotingPeriodSeconds
	}
	return s.SetProposal(prop)
}

// handleVote records a vote weighted by the voter's bonded stake.
//
// Voting power is stake at risk, not balance. An account holding YZXA in a
// wallet has no say; an account that has bonded it to a validator does. That
// alignment is deliberate: the people who can lose money from a bad decision
// are the ones who decide.
func (a *App) handleVote(s *state.State, m tx.MsgVote, now int64) error {
	prop, found, err := s.GetProposal(m.ProposalID)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("proposal %d does not exist", m.ProposalID)
	}
	if prop.Status != state.ProposalStatusVoting {
		return fmt.Errorf("proposal %d is not open for voting", m.ProposalID)
	}
	if now > prop.VotingEndUnix {
		return fmt.Errorf("voting on proposal %d has closed", m.ProposalID)
	}
	weight, err := s.BondedStakeOf(m.Voter)
	if err != nil {
		return err
	}
	if weight.Sign() == 0 {
		return fmt.Errorf("account %s has no bonded stake and therefore no voting power", m.Voter)
	}
	amt, err := types.NewAmount(weight)
	if err != nil {
		return err
	}
	// Re-voting replaces the previous vote rather than adding to it.
	return s.SetVote(state.Vote{
		ProposalID: m.ProposalID,
		Voter:      m.Voter,
		Option:     m.Option,
		Weight:     amt,
	})
}

// processGovernance advances every open proposal: expiring deposits, closing
// votes, and executing passed proposals once their timelock has run.
func (a *App) processGovernance(now int64, p state.Params) ([]abci.Event, error) {
	s := a.state
	active, err := s.ActiveProposals()
	if err != nil {
		return nil, err
	}
	var events []abci.Event

	for _, prop := range active {
		switch prop.Status {

		case state.ProposalStatusDeposit:
			if now <= prop.DepositEndUnix {
				continue
			}
			// The deposit is burned rather than refunded: an abandoned
			// proposal has consumed real network attention.
			if err := s.Burn(state.ModuleGovDeposit, prop.Deposit.Int()); err != nil {
				return nil, err
			}
			prop.Status = state.ProposalStatusExpired
			if err := s.SetProposal(prop); err != nil {
				return nil, err
			}
			events = append(events, govEvent("proposal_expired", prop.ID, ""))

		case state.ProposalStatusVoting:
			if now <= prop.VotingEndUnix {
				continue
			}
			tally, err := s.Tally(prop.ID, p)
			if err != nil {
				return nil, err
			}
			prop.TallyYes = types.MustAmount(tally.Yes)
			prop.TallyNo = types.MustAmount(tally.No)
			prop.TallyAbstain = types.MustAmount(tally.Abstain)
			prop.TallyNoWithVeto = types.MustAmount(tally.NoWithVeto)

			switch {
			case tally.Vetoed:
				if err := s.Burn(state.ModuleGovDeposit, prop.Deposit.Int()); err != nil {
					return nil, err
				}
				prop.Status = state.ProposalStatusVetoed
				events = append(events, govEvent("proposal_vetoed", prop.ID, ""))

			case tally.Passed:
				if err := s.Transfer(state.ModuleGovDeposit, prop.Proposer, prop.Deposit.Int(), now); err != nil {
					return nil, err
				}
				prop.Status = state.ProposalStatusPassed
				prop.ExecuteAfterUnix = now + p.TimelockSeconds
				events = append(events, govEvent("proposal_passed", prop.ID,
					fmt.Sprintf("executes after %d", prop.ExecuteAfterUnix)))

			default:
				if err := s.Transfer(state.ModuleGovDeposit, prop.Proposer, prop.Deposit.Int(), now); err != nil {
					return nil, err
				}
				prop.Status = state.ProposalStatusRejected
				events = append(events, govEvent("proposal_rejected", prop.ID, ""))
			}
			if err := s.SetProposal(prop); err != nil {
				return nil, err
			}

		case state.ProposalStatusPassed:
			if now < prop.ExecuteAfterUnix {
				continue // still inside the timelock
			}
			if err := a.executeProposal(&prop, now, p); err != nil {
				prop.Status = state.ProposalStatusFailed
				prop.FailureReason = err.Error()
				events = append(events, govEvent("proposal_execution_failed", prop.ID, err.Error()))
			} else {
				prop.Status = state.ProposalStatusExecuted
				events = append(events, govEvent("proposal_executed", prop.ID, ""))
			}
			if err := s.SetProposal(prop); err != nil {
				return nil, err
			}
		}
	}
	return events, nil
}

// executeProposal applies a passed proposal.
//
// Nothing here can mint. A treasury spend moves existing funds and fails if
// the treasury cannot cover it; a parameter change is re-validated before it
// is written; an upgrade only records a scheduled halt. There is deliberately
// no proposal type that can change a balance directly or lift the supply cap.
func (a *App) executeProposal(prop *state.Proposal, now int64, p state.Params) error {
	s := a.state
	switch prop.Kind {

	case tx.ProposalTypeText:
		return nil

	case tx.ProposalTypeParamChange:
		next := p
		for _, c := range prop.ParamChanges {
			if err := next.SetParam(c.Key, c.Value); err != nil {
				return err
			}
		}
		if err := next.Validate(); err != nil {
			return fmt.Errorf("resulting parameters are invalid: %w", err)
		}
		return s.SetParams(next)

	case tx.ProposalTypeTreasurySpend:
		if prop.Spend == nil {
			return fmt.Errorf("proposal has no spend payload")
		}
		spent, err := a.treasurySpentThisEpoch(now, p)
		if err != nil {
			return err
		}
		next, err := types.Add(spent, prop.Spend.Amount.Int())
		if err != nil {
			return err
		}
		if next.Cmp(p.TreasuryMaxSpendPerEpoch.Int()) > 0 {
			return fmt.Errorf(
				"treasury epoch limit reached: %s already spent this epoch of %s, %s requested",
				types.FormatYZXA(spent),
				types.FormatYZXA(p.TreasuryMaxSpendPerEpoch.Int()),
				types.FormatYZXA(prop.Spend.Amount.Int()))
		}
		balance, err := s.Balance(state.ModuleTreasury)
		if err != nil {
			return err
		}
		if balance.Cmp(prop.Spend.Amount.Int()) < 0 {
			return fmt.Errorf("treasury holds %s but the proposal spends %s",
				types.FormatYZXA(balance), types.FormatYZXA(prop.Spend.Amount.Int()))
		}
		if err := s.Transfer(state.ModuleTreasury, prop.Spend.Recipient, prop.Spend.Amount.Int(), now); err != nil {
			return err
		}
		return a.recordTreasurySpend(next, now, p)

	case tx.ProposalTypeSoftwareUpgrade:
		if prop.Upgrade == nil {
			return fmt.Errorf("proposal has no upgrade payload")
		}
		return s.Store().Set([]byte("upgrade/scheduled"), []byte(fmt.Sprintf(
			`{"name":%q,"height":%d,"info":%q}`, prop.Upgrade.Name, prop.Upgrade.Height, prop.Upgrade.Info)))

	default:
		return fmt.Errorf("unknown proposal kind %q", prop.Kind)
	}
}

// treasuryEpoch tracks spending within a rolling epoch so the per-epoch cap is
// enforced rather than merely declared.
type treasuryEpoch struct {
	StartUnix int64        `json:"start_unix"`
	Spent     types.Amount `json:"spent"`
}

// treasurySpentThisEpoch returns how much the treasury has paid out in the
// current epoch, rolling the window forward if the previous epoch has ended.
func (a *App) treasurySpentThisEpoch(now int64, p state.Params) (*big.Int, error) {
	var te treasuryEpoch
	raw, err := a.kv.Get([]byte(state.KeyTreasuryEpoch))
	if err != nil {
		return types.Zero(), nil // no epoch recorded yet
	}
	if err := json.Unmarshal(raw, &te); err != nil {
		return nil, fmt.Errorf("corrupt treasury epoch record: %w", err)
	}
	if now >= te.StartUnix+p.TreasuryEpochSeconds {
		return types.Zero(), nil // the window has rolled over
	}
	return te.Spent.Int(), nil
}

// recordTreasurySpend writes the epoch counter after a successful spend.
func (a *App) recordTreasurySpend(total *big.Int, now int64, p state.Params) error {
	var te treasuryEpoch
	start := now
	if raw, err := a.kv.Get([]byte(state.KeyTreasuryEpoch)); err == nil {
		if err := json.Unmarshal(raw, &te); err == nil {
			if now < te.StartUnix+p.TreasuryEpochSeconds {
				start = te.StartUnix
			}
		}
	}
	amt, err := types.NewAmount(total)
	if err != nil {
		return err
	}
	out, err := json.Marshal(treasuryEpoch{StartUnix: start, Spent: amt})
	if err != nil {
		return err
	}
	return a.kv.Set([]byte(state.KeyTreasuryEpoch), out)
}

func govEvent(kind string, id uint64, detail string) abci.Event {
	attrs := []abci.EventAttribute{{Key: "proposal_id", Value: fmt.Sprintf("%d", id)}}
	if detail != "" {
		attrs = append(attrs, abci.EventAttribute{Key: "detail", Value: detail})
	}
	return abci.Event{Type: kind, Attributes: attrs}
}
