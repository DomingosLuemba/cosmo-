package tx

import (
	"encoding/json"
	"fmt"

	"github.com/yozexa/yozexa/chain/types"
)

// MaxGrantDurationSeconds bounds how long any delegated spending permission
// can live. An unbounded permission is the single most dangerous object a
// wallet can sign, so the protocol refuses to create one at all: every grant
// expires, and the longest a grant can run is one year.
const MaxGrantDurationSeconds int64 = 365 * 24 * 60 * 60

// MaxExecMessages bounds how many messages one delegated execution may carry.
const MaxExecMessages = 32

// SpendLimit describes how much a grantee may move and how fast.
//
// This is the object behind three products at once:
//
//   - subscriptions: a merchant may charge at most X per period, never more;
//   - session keys: a device or dapp key that can spend a little, briefly;
//   - AI agent wallets: an autonomous agent holds a key that is structurally
//     incapable of draining the account it acts for.
//
// There is deliberately no "unlimited" value. A grant with a zero total is
// rejected, and the per-period cap is always enforced on top of the total.
type SpendLimit struct {
	// Total is the absolute maximum the grantee may ever move under this
	// grant, across its whole lifetime.
	Total types.Amount `json:"total"`
	// PerPeriod is the maximum that may be moved inside one period window.
	PerPeriod types.Amount `json:"per_period"`
	// PeriodSeconds is the length of the rolling window that PerPeriod
	// applies to. Zero means the per-period cap is not used.
	PeriodSeconds int64 `json:"period_seconds"`
}

// MsgGrant authorises `Grantee` to submit a restricted set of messages that
// spend from `Granter`, under an explicit limit and an explicit expiry.
type MsgGrant struct {
	Granter types.Address `json:"granter"`
	Grantee types.Address `json:"grantee"`
	// AllowedMsgTypes restricts which message types may be executed. It is
	// never empty: a grant always names what it permits.
	AllowedMsgTypes []string `json:"allowed_msg_types"`
	// AllowedRecipients optionally pins the destinations the grantee may pay.
	// When set, a payment to any other address is rejected. This is what makes
	// "this agent may pay my hosting provider and nobody else" enforceable.
	AllowedRecipients []types.Address `json:"allowed_recipients,omitempty"`
	Limit             SpendLimit      `json:"limit"`
	// ExpiresAtUnix is the absolute expiry, in seconds since the Unix epoch,
	// evaluated against deterministic block time.
	ExpiresAtUnix int64 `json:"expires_at_unix"`
	// RequireApprovalAbove, when positive, marks amounts that the granting
	// human wants to review. The chain enforces it as a hard ceiling per
	// single message; wallets surface it as "ask me above this amount".
	RequireApprovalAbove types.Amount `json:"require_approval_above,omitempty"`
}

func (m MsgGrant) Type() string          { return MsgTypeGrant }
func (m MsgGrant) Signer() types.Address { return m.Granter }
func (m MsgGrant) ValidateBasic() error {
	if m.Granter.IsZero() || m.Grantee.IsZero() {
		return fmt.Errorf("grant: zero address")
	}
	if m.Granter == m.Grantee {
		return fmt.Errorf("grant: an account cannot grant to itself")
	}
	if len(m.AllowedMsgTypes) == 0 {
		return fmt.Errorf("grant: must name at least one allowed message type")
	}
	if len(m.AllowedMsgTypes) > 16 {
		return fmt.Errorf("grant: too many allowed message types")
	}
	for _, t := range m.AllowedMsgTypes {
		if !grantableMsgTypes[t] {
			return fmt.Errorf("grant: message type %q may not be delegated", t)
		}
	}
	if len(m.AllowedRecipients) > 64 {
		return fmt.Errorf("grant: too many allowed recipients")
	}
	if m.Limit.Total.IsZero() {
		return fmt.Errorf("grant: total spend limit must be positive (unlimited grants are not supported)")
	}
	if m.Limit.PeriodSeconds < 0 {
		return fmt.Errorf("grant: negative period")
	}
	if m.Limit.PeriodSeconds > 0 && m.Limit.PerPeriod.IsZero() {
		return fmt.Errorf("grant: a period was set but no per-period limit")
	}
	if m.ExpiresAtUnix <= 0 {
		return fmt.Errorf("grant: an explicit expiry is required")
	}
	return nil
}

// grantableMsgTypes is the allow-list of what a delegated key may ever do.
//
// Governance votes, validator creation, alias transfers and grant management
// itself are intentionally absent: a session key must not be able to vote with
// someone's stake, hand away their identity, or mint new permissions.
var grantableMsgTypes = map[string]bool{
	MsgTypeSend:            true,
	MsgTypeMultiSend:       true,
	MsgTypeDelegate:        true,
	MsgTypeUndelegate:      true,
	MsgTypeWithdrawRewards: true,
}

// MsgRevoke destroys a grant immediately.
type MsgRevoke struct {
	Granter types.Address `json:"granter"`
	Grantee types.Address `json:"grantee"`
}

func (m MsgRevoke) Type() string          { return MsgTypeRevoke }
func (m MsgRevoke) Signer() types.Address { return m.Granter }
func (m MsgRevoke) ValidateBasic() error {
	if m.Granter.IsZero() || m.Grantee.IsZero() {
		return fmt.Errorf("revoke: zero address")
	}
	return nil
}

// MsgExec runs messages on behalf of a granter. The grantee signs the
// transaction; the inner messages spend the granter's balance, but only
// within the grant.
type MsgExec struct {
	Grantee types.Address     `json:"grantee"`
	Granter types.Address     `json:"granter"`
	Msgs    []json.RawMessage `json:"msgs"`
}

func (m MsgExec) Type() string          { return MsgTypeExec }
func (m MsgExec) Signer() types.Address { return m.Grantee }
func (m MsgExec) ValidateBasic() error {
	if m.Grantee.IsZero() || m.Granter.IsZero() {
		return fmt.Errorf("exec: zero address")
	}
	if len(m.Msgs) == 0 {
		return fmt.Errorf("exec: no messages")
	}
	if len(m.Msgs) > MaxExecMessages {
		return fmt.Errorf("exec: %d messages exceeds limit of %d", len(m.Msgs), MaxExecMessages)
	}
	for i, raw := range m.Msgs {
		inner, err := UnmarshalMsg(raw)
		if err != nil {
			return fmt.Errorf("exec: message %d: %w", i, err)
		}
		if err := inner.ValidateBasic(); err != nil {
			return fmt.Errorf("exec: message %d: %w", i, err)
		}
		// Nesting exec inside exec would let a grantee launder permissions
		// through a chain of grants that no single grant authorised.
		if inner.Type() == MsgTypeExec {
			return fmt.Errorf("exec: nested exec is not allowed")
		}
		if inner.Signer() != m.Granter {
			return fmt.Errorf("exec: message %d is signed for %s, not for the granter %s",
				i, inner.Signer(), m.Granter)
		}
	}
	return nil
}

// InnerMsgs decodes the messages carried by an exec.
func (m MsgExec) InnerMsgs() ([]Msg, error) {
	out := make([]Msg, 0, len(m.Msgs))
	for i, raw := range m.Msgs {
		inner, err := UnmarshalMsg(raw)
		if err != nil {
			return nil, fmt.Errorf("exec: message %d: %w", i, err)
		}
		out = append(out, inner)
	}
	return out, nil
}
