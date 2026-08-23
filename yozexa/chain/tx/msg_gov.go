package tx

import (
	"fmt"
	"strings"

	"github.com/yozexa/yozexa/chain/types"
)

// Proposal kinds recognised by governance.
const (
	ProposalTypeText            = "text"
	ProposalTypeParamChange     = "param_change"
	ProposalTypeTreasurySpend   = "treasury_spend"
	ProposalTypeSoftwareUpgrade = "software_upgrade"
)

// Vote options.
const (
	VoteYes        = "yes"
	VoteNo         = "no"
	VoteAbstain    = "abstain"
	VoteNoWithVeto = "no_with_veto"
)

// ParamChange is a single parameter mutation requested by a proposal.
type ParamChange struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// TreasurySpend requests a payment out of the ecosystem treasury.
//
// Governance can move treasury funds. It can never mint them: a treasury
// spend that exceeds the treasury balance simply fails, and no code path in
// the module can raise the minted supply.
type TreasurySpend struct {
	Recipient types.Address `json:"recipient"`
	Amount    types.Amount  `json:"amount"`
	Purpose   string        `json:"purpose"`
}

// SoftwareUpgrade schedules a coordinated halt for a binary upgrade.
type SoftwareUpgrade struct {
	Name   string `json:"name"`
	Height int64  `json:"height"`
	Info   string `json:"info,omitempty"`
}

// MsgSubmitProposal opens a governance proposal.
type MsgSubmitProposal struct {
	Proposer     types.Address    `json:"proposer"`
	Kind         string           `json:"kind"`
	Title        string           `json:"title"`
	Summary      string           `json:"summary"`
	Deposit      types.Amount     `json:"deposit"`
	ParamChanges []ParamChange    `json:"param_changes,omitempty"`
	Spend        *TreasurySpend   `json:"spend,omitempty"`
	Upgrade      *SoftwareUpgrade `json:"upgrade,omitempty"`
}

func (m MsgSubmitProposal) Type() string          { return MsgTypeSubmitProposal }
func (m MsgSubmitProposal) Signer() types.Address { return m.Proposer }
func (m MsgSubmitProposal) ValidateBasic() error {
	if m.Proposer.IsZero() {
		return fmt.Errorf("submit_proposal: zero proposer")
	}
	if strings.TrimSpace(m.Title) == "" || len(m.Title) > 140 {
		return fmt.Errorf("submit_proposal: title must be 1..140 characters")
	}
	if len(m.Summary) > 10_000 {
		return fmt.Errorf("submit_proposal: summary too long")
	}
	switch m.Kind {
	case ProposalTypeText:
		if len(m.ParamChanges) > 0 || m.Spend != nil || m.Upgrade != nil {
			return fmt.Errorf("submit_proposal: text proposal must carry no payload")
		}
	case ProposalTypeParamChange:
		if len(m.ParamChanges) == 0 {
			return fmt.Errorf("submit_proposal: no parameter changes")
		}
		if len(m.ParamChanges) > 32 {
			return fmt.Errorf("submit_proposal: too many parameter changes")
		}
		for _, c := range m.ParamChanges {
			if strings.TrimSpace(c.Key) == "" {
				return fmt.Errorf("submit_proposal: empty parameter key")
			}
		}
	case ProposalTypeTreasurySpend:
		if m.Spend == nil {
			return fmt.Errorf("submit_proposal: missing spend payload")
		}
		if m.Spend.Recipient.IsZero() {
			return fmt.Errorf("submit_proposal: zero spend recipient")
		}
		if m.Spend.Amount.IsZero() {
			return fmt.Errorf("submit_proposal: spend amount must be positive")
		}
		if strings.TrimSpace(m.Spend.Purpose) == "" {
			return fmt.Errorf("submit_proposal: treasury spends must state a purpose")
		}
	case ProposalTypeSoftwareUpgrade:
		if m.Upgrade == nil || strings.TrimSpace(m.Upgrade.Name) == "" {
			return fmt.Errorf("submit_proposal: missing upgrade payload")
		}
		if m.Upgrade.Height <= 0 {
			return fmt.Errorf("submit_proposal: upgrade height must be positive")
		}
	default:
		return fmt.Errorf("submit_proposal: unknown proposal kind %q", m.Kind)
	}
	return nil
}

// MsgVote casts a vote weighted by the voter's bonded stake.
type MsgVote struct {
	Voter      types.Address `json:"voter"`
	ProposalID uint64        `json:"proposal_id"`
	Option     string        `json:"option"`
}

func (m MsgVote) Type() string          { return MsgTypeVote }
func (m MsgVote) Signer() types.Address { return m.Voter }
func (m MsgVote) ValidateBasic() error {
	if m.Voter.IsZero() {
		return fmt.Errorf("vote: zero voter")
	}
	if m.ProposalID == 0 {
		return fmt.Errorf("vote: proposal id must be positive")
	}
	switch m.Option {
	case VoteYes, VoteNo, VoteAbstain, VoteNoWithVeto:
		return nil
	default:
		return fmt.Errorf("vote: unknown option %q", m.Option)
	}
}

// MsgDeposit adds to a proposal's deposit so it can enter the voting period.
type MsgDeposit struct {
	Depositor  types.Address `json:"depositor"`
	ProposalID uint64        `json:"proposal_id"`
	Amount     types.Amount  `json:"amount"`
}

func (m MsgDeposit) Type() string          { return MsgTypeDeposit }
func (m MsgDeposit) Signer() types.Address { return m.Depositor }
func (m MsgDeposit) ValidateBasic() error {
	if m.Depositor.IsZero() {
		return fmt.Errorf("deposit: zero depositor")
	}
	if m.ProposalID == 0 {
		return fmt.Errorf("deposit: proposal id must be positive")
	}
	if m.Amount.IsZero() {
		return fmt.Errorf("deposit: amount must be positive")
	}
	return nil
}
