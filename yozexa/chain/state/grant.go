package state

import (
	"fmt"
	"math/big"

	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

// Grant is a live delegated spending permission.
//
// Grants are what make session keys, subscriptions and AI agent wallets safe:
// the holder of a grant can spend, but only up to a total, only up to a
// per-period rate, only to permitted destinations, only with permitted message
// types, and only until an expiry the chain enforces.
type Grant struct {
	Granter types.Address `json:"granter"`
	Grantee types.Address `json:"grantee"`

	AllowedMsgTypes   []string        `json:"allowed_msg_types"`
	AllowedRecipients []types.Address `json:"allowed_recipients,omitempty"`

	Total         types.Amount `json:"total"`
	PerPeriod     types.Amount `json:"per_period"`
	PeriodSeconds int64        `json:"period_seconds"`

	// SpentTotal is the lifetime amount already moved under this grant.
	SpentTotal types.Amount `json:"spent_total"`
	// SpentThisPeriod resets when the window rolls over.
	SpentThisPeriod types.Amount `json:"spent_this_period"`
	// PeriodStartUnix is when the current window began.
	PeriodStartUnix int64 `json:"period_start_unix"`

	ExpiresAtUnix        int64        `json:"expires_at_unix"`
	RequireApprovalAbove types.Amount `json:"require_approval_above,omitempty"`
}

func grantKey(granter, grantee types.Address) string {
	return PrefixGrant + addrKey(granter) + "/" + addrKey(grantee)
}

// SetGrant stores a grant.
func (s *State) SetGrant(g Grant) error { return s.setJSON(grantKey(g.Granter, g.Grantee), g) }

// GetGrant reads a grant.
func (s *State) GetGrant(granter, grantee types.Address) (Grant, bool, error) {
	var g Grant
	found, err := s.getJSON(grantKey(granter, grantee), &g)
	return g, found, err
}

// DeleteGrant revokes a grant.
func (s *State) DeleteGrant(granter, grantee types.Address) error {
	return s.delete(grantKey(granter, grantee))
}

// IterateGrantsOf visits every grant issued by an account.
func (s *State) IterateGrantsOf(granter types.Address, fn func(Grant) bool) error {
	return s.kv.Iterate([]byte(PrefixGrant+addrKey(granter)+"/"), func(_, value []byte) bool {
		var g Grant
		if err := jsonUnmarshal(value, &g); err != nil {
			return true
		}
		return fn(g)
	})
}

// Authorize checks a single delegated spend against every limit in the grant
// and, if it passes, records the spend.
//
// The caller must persist the returned grant. Authorisation and accounting are
// deliberately the same operation: there is no way to check a limit and then
// forget to charge it.
func (g *Grant) Authorize(msgType string, recipients []types.Address, amount *big.Int, nowUnix int64) error {
	if nowUnix >= g.ExpiresAtUnix {
		return fmt.Errorf("grant from %s to %s expired at %d", g.Granter, g.Grantee, g.ExpiresAtUnix)
	}
	allowed := false
	for _, t := range g.AllowedMsgTypes {
		if t == msgType {
			allowed = true
			break
		}
	}
	if !allowed {
		return fmt.Errorf("grant does not permit message type %q", msgType)
	}
	if len(g.AllowedRecipients) > 0 {
		for _, r := range recipients {
			ok := false
			for _, a := range g.AllowedRecipients {
				if a == r {
					ok = true
					break
				}
			}
			if !ok {
				return fmt.Errorf("grant does not permit payments to %s", r)
			}
		}
	}
	if types.IsPositive(g.RequireApprovalAbove.Int()) && amount.Cmp(g.RequireApprovalAbove.Int()) > 0 {
		return fmt.Errorf(
			"amount %s exceeds the per-transaction ceiling of %s set on this grant; it requires direct approval by the account holder",
			types.FormatYZXA(amount), types.FormatYZXA(g.RequireApprovalAbove.Int()))
	}

	nextTotal, err := types.Add(g.SpentTotal.Int(), amount)
	if err != nil {
		return err
	}
	if nextTotal.Cmp(g.Total.Int()) > 0 {
		return fmt.Errorf("grant total limit exceeded: %s already spent of %s, %s requested",
			types.FormatYZXA(g.SpentTotal.Int()), types.FormatYZXA(g.Total.Int()), types.FormatYZXA(amount))
	}

	spentPeriod := g.SpentThisPeriod.Int()
	if g.PeriodSeconds > 0 {
		// Roll the window forward if it has elapsed. Windows are anchored to
		// the grant's start, not to the time of the last spend, so a grantee
		// cannot extend its allowance by choosing when to transact.
		if nowUnix >= g.PeriodStartUnix+g.PeriodSeconds {
			elapsed := nowUnix - g.PeriodStartUnix
			periods := elapsed / g.PeriodSeconds
			g.PeriodStartUnix += periods * g.PeriodSeconds
			spentPeriod = big.NewInt(0)
		}
		nextPeriod, err := types.Add(spentPeriod, amount)
		if err != nil {
			return err
		}
		if nextPeriod.Cmp(g.PerPeriod.Int()) > 0 {
			return fmt.Errorf("grant period limit exceeded: %s already spent this period of %s, %s requested",
				types.FormatYZXA(spentPeriod), types.FormatYZXA(g.PerPeriod.Int()), types.FormatYZXA(amount))
		}
		spentPeriod = nextPeriod
	}

	g.SpentTotal, err = types.NewAmount(nextTotal)
	if err != nil {
		return err
	}
	g.SpentThisPeriod, err = types.NewAmount(spentPeriod)
	return err
}

// GrantFromMsg builds the stored grant from a signed MsgGrant.
func GrantFromMsg(m tx.MsgGrant, nowUnix int64) Grant {
	return Grant{
		Granter:              m.Granter,
		Grantee:              m.Grantee,
		AllowedMsgTypes:      m.AllowedMsgTypes,
		AllowedRecipients:    m.AllowedRecipients,
		Total:                m.Limit.Total,
		PerPeriod:            m.Limit.PerPeriod,
		PeriodSeconds:        m.Limit.PeriodSeconds,
		SpentTotal:           types.MustAmount(types.Zero()),
		SpentThisPeriod:      types.MustAmount(types.Zero()),
		PeriodStartUnix:      nowUnix,
		ExpiresAtUnix:        m.ExpiresAtUnix,
		RequireApprovalAbove: m.RequireApprovalAbove,
	}
}
