package state

import (
	"fmt"
	"math/big"
	"sort"

	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// Proposal lifecycle states.
const (
	ProposalStatusDeposit  = "deposit_period"
	ProposalStatusVoting   = "voting_period"
	ProposalStatusPassed   = "passed" // passed, waiting out the timelock
	ProposalStatusExecuted = "executed"
	ProposalStatusRejected = "rejected"
	ProposalStatusVetoed   = "vetoed"
	ProposalStatusFailed   = "failed" // passed but execution errored
	ProposalStatusExpired  = "expired"
)

// Proposal is a governance proposal and its tally.
type Proposal struct {
	ID       uint64        `json:"id"`
	Kind     string        `json:"kind"`
	Title    string        `json:"title"`
	Summary  string        `json:"summary"`
	Proposer types.Address `json:"proposer"`

	ParamChanges []tx.ParamChange    `json:"param_changes,omitempty"`
	Spend        *tx.TreasurySpend   `json:"spend,omitempty"`
	Upgrade      *tx.SoftwareUpgrade `json:"upgrade,omitempty"`

	Status         string       `json:"status"`
	Deposit        types.Amount `json:"deposit"`
	SubmitUnix     int64        `json:"submit_unix"`
	DepositEndUnix int64        `json:"deposit_end_unix"`
	VotingEndUnix  int64        `json:"voting_end_unix,omitempty"`
	// ExecuteAfterUnix is when the timelock expires and a passed proposal may
	// take effect. The delay is what gives users time to react to a hostile
	// proposal that somehow passed.
	ExecuteAfterUnix int64 `json:"execute_after_unix,omitempty"`

	TallyYes        types.Amount `json:"tally_yes"`
	TallyNo         types.Amount `json:"tally_no"`
	TallyAbstain    types.Amount `json:"tally_abstain"`
	TallyNoWithVeto types.Amount `json:"tally_no_with_veto"`

	// FailureReason records why execution failed, so a failed proposal is
	// visible rather than silently ignored.
	FailureReason string `json:"failure_reason,omitempty"`
}

// Vote is one account's recorded vote.
type Vote struct {
	ProposalID uint64        `json:"proposal_id"`
	Voter      types.Address `json:"voter"`
	Option     string        `json:"option"`
	// Weight is the voter's bonded stake at the moment the vote was cast.
	Weight types.Amount `json:"weight"`
}

func proposalKey(id uint64) string { return fmt.Sprintf("%s%020d", PrefixProposal, id) }
func voteKey(id uint64, voter types.Address) string {
	return fmt.Sprintf("%s%020d/%s", PrefixVote, id, addrKey(voter))
}

// NextProposalID reserves the next proposal identifier.
func (s *State) NextProposalID() (uint64, error) {
	var id uint64
	if _, err := s.getJSON(KeyNextProposal, &id); err != nil {
		return 0, err
	}
	id++
	if err := s.setJSON(KeyNextProposal, id); err != nil {
		return 0, err
	}
	return id, nil
}

// SetProposal writes a proposal.
func (s *State) SetProposal(p Proposal) error { return s.setJSON(proposalKey(p.ID), p) }

// GetProposal reads a proposal.
func (s *State) GetProposal(id uint64) (Proposal, bool, error) {
	var p Proposal
	found, err := s.getJSON(proposalKey(id), &p)
	return p, found, err
}

// IterateProposals visits every proposal in id order.
func (s *State) IterateProposals(fn func(Proposal) bool) error {
	return s.kv.Iterate([]byte(PrefixProposal), func(_, value []byte) bool {
		var p Proposal
		if err := jsonUnmarshal(value, &p); err != nil {
			return true
		}
		return fn(p)
	})
}

// SetVote records a vote.
func (s *State) SetVote(v Vote) error { return s.setJSON(voteKey(v.ProposalID, v.Voter), v) }

// GetVote reads a vote.
func (s *State) GetVote(id uint64, voter types.Address) (Vote, bool, error) {
	var v Vote
	found, err := s.getJSON(voteKey(id, voter), &v)
	return v, found, err
}

// IterateVotes visits every vote on a proposal.
func (s *State) IterateVotes(id uint64, fn func(Vote) bool) error {
	prefix := fmt.Sprintf("%s%020d/", PrefixVote, id)
	return s.kv.Iterate([]byte(prefix), func(_, value []byte) bool {
		var v Vote
		if err := jsonUnmarshal(value, &v); err != nil {
			return true
		}
		return fn(v)
	})
}

// BondedStakeOf returns how much an account currently has bonded across all
// validators. Voting power comes from stake at risk, so an account that has
// unbonded cannot keep voting with tokens it no longer has at stake.
func (s *State) BondedStakeOf(addr types.Address) (*big.Int, error) {
	total := types.Zero()
	var iterErr error
	err := s.IterateAllDelegations(func(d Delegation) bool {
		if d.Delegator != addr {
			return true
		}
		v, found, err := s.GetValidator(d.Validator)
		if err != nil {
			iterErr = err
			return false
		}
		if !found || !types.IsPositive(v.DelegatorShares.Int()) {
			return true
		}
		amt, err := sharesToTokens(v, d.Shares.Int())
		if err != nil {
			iterErr = err
			return false
		}
		total, err = types.Add(total, amt)
		if err != nil {
			iterErr = err
			return false
		}
		return true
	})
	if err != nil {
		return nil, err
	}
	return total, iterErr
}

// sharesToTokens converts delegation shares into their current token value.
func sharesToTokens(v Validator, shares *big.Int) (*big.Int, error) {
	total := v.DelegatorShares.Int()
	if total.Sign() == 0 {
		return big.NewInt(0), nil
	}
	num := new(big.Int).Mul(v.Tokens.Int(), shares)
	return num.Quo(num, total), nil
}

// TallyResult is the outcome of counting a proposal's votes.
type TallyResult struct {
	Yes         *big.Int
	No          *big.Int
	Abstain     *big.Int
	NoWithVeto  *big.Int
	Total       *big.Int
	BondedAtEnd *big.Int
	Passed      bool
	Vetoed      bool
	QuorumMet   bool
}

// Tally counts the votes on a proposal against quorum, threshold and veto.
//
// Abstain counts towards quorum but not towards the yes/no ratio. A veto share
// above the veto threshold rejects the proposal outright and burns its
// deposit, which is what makes spamming hostile proposals expensive.
func (s *State) Tally(id uint64, p Params) (TallyResult, error) {
	res := TallyResult{
		Yes: types.Zero(), No: types.Zero(),
		Abstain: types.Zero(), NoWithVeto: types.Zero(),
	}
	var iterErr error
	err := s.IterateVotes(id, func(v Vote) bool {
		w := v.Weight.Int()
		var err error
		switch v.Option {
		case tx.VoteYes:
			res.Yes, err = types.Add(res.Yes, w)
		case tx.VoteNo:
			res.No, err = types.Add(res.No, w)
		case tx.VoteAbstain:
			res.Abstain, err = types.Add(res.Abstain, w)
		case tx.VoteNoWithVeto:
			res.NoWithVeto, err = types.Add(res.NoWithVeto, w)
		}
		if err != nil {
			iterErr = err
			return false
		}
		return true
	})
	if err != nil {
		return res, err
	}
	if iterErr != nil {
		return res, iterErr
	}

	total := types.Zero()
	for _, v := range []*big.Int{res.Yes, res.No, res.Abstain, res.NoWithVeto} {
		total, err = types.Add(total, v)
		if err != nil {
			return res, err
		}
	}
	res.Total = total

	bonded, err := s.TotalBonded()
	if err != nil {
		return res, err
	}
	res.BondedAtEnd = bonded

	if bonded.Sign() == 0 || total.Sign() == 0 {
		return res, nil // no stake, no quorum, no decision
	}

	// quorum: total votes / bonded stake >= quorum_bps
	quorumNum := new(big.Int).Mul(total, big.NewInt(10_000))
	res.QuorumMet = quorumNum.Quo(quorumNum, bonded).Cmp(big.NewInt(int64(p.QuorumBps))) >= 0
	if !res.QuorumMet {
		return res, nil
	}

	// veto: no_with_veto / total >= veto_bps
	vetoNum := new(big.Int).Mul(res.NoWithVeto, big.NewInt(10_000))
	if vetoNum.Quo(vetoNum, total).Cmp(big.NewInt(int64(p.VetoBps))) >= 0 {
		res.Vetoed = true
		return res, nil
	}

	// threshold: yes / (yes + no + veto) >= threshold_bps ; abstain excluded
	decisive := types.Zero()
	for _, v := range []*big.Int{res.Yes, res.No, res.NoWithVeto} {
		decisive, err = types.Add(decisive, v)
		if err != nil {
			return res, err
		}
	}
	if decisive.Sign() == 0 {
		return res, nil
	}
	yesNum := new(big.Int).Mul(res.Yes, big.NewInt(10_000))
	res.Passed = yesNum.Quo(yesNum, decisive).Cmp(big.NewInt(int64(p.ThresholdBps))) >= 0
	return res, nil
}

// ActiveProposals returns proposals in the deposit or voting period, ordered
// by id.
func (s *State) ActiveProposals() ([]Proposal, error) {
	var out []Proposal
	err := s.IterateProposals(func(p Proposal) bool {
		switch p.Status {
		case ProposalStatusDeposit, ProposalStatusVoting, ProposalStatusPassed:
			out = append(out, p)
		}
		return true
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}
