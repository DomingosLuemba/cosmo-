// Package tx defines YOZEXA transactions, the messages they carry and the
// exact bytes a signer commits to.
package tx

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strings"

	"github.com/yozexa/yozexa/chain/types"
)

// Message type identifiers. These strings are part of the signed payload and
// are therefore consensus-critical: they may never be renamed, only added to.
const (
	MsgTypeSend            = "bank/send"
	MsgTypeMultiSend       = "bank/multisend"
	MsgTypeBurn            = "bank/burn"
	MsgTypeCreateValidator = "staking/create_validator"
	MsgTypeEditValidator   = "staking/edit_validator"
	MsgTypeDelegate        = "staking/delegate"
	MsgTypeUndelegate      = "staking/undelegate"
	MsgTypeRedelegate      = "staking/redelegate"
	MsgTypeWithdrawRewards = "staking/withdraw_rewards"
	MsgTypeUnjail          = "staking/unjail"
	MsgTypeSubmitProposal  = "gov/submit_proposal"
	MsgTypeVote            = "gov/vote"
	MsgTypeDeposit         = "gov/deposit"
	MsgTypeClaimVested     = "vesting/claim"
	MsgTypeGrant           = "auth/grant"
	MsgTypeRevoke          = "auth/revoke"
	MsgTypeExec            = "auth/exec"
	MsgTypeRegisterAlias   = "id/register_alias"
	MsgTypeTransferAlias   = "id/transfer_alias"
)

// Msg is a single instruction inside a transaction.
type Msg interface {
	// Type returns the stable identifier of the message.
	Type() string
	// Signer returns the account whose signature authorises this message.
	Signer() types.Address
	// ValidateBasic performs stateless validation: everything that can be
	// checked without reading chain state. It must never accept a message
	// that state-dependent logic would then have to defend against.
	ValidateBasic() error
}

// MsgSend transfers YZXA from one account to another.
type MsgSend struct {
	From   types.Address `json:"from"`
	To     types.Address `json:"to"`
	Amount types.Amount  `json:"amount"`
}

func (m MsgSend) Type() string          { return MsgTypeSend }
func (m MsgSend) Signer() types.Address { return m.From }
func (m MsgSend) ValidateBasic() error {
	if m.From.IsZero() || m.To.IsZero() {
		return fmt.Errorf("send: zero address")
	}
	if m.From == m.To {
		return fmt.Errorf("send: sender and recipient are the same account")
	}
	if m.Amount.IsZero() {
		return fmt.Errorf("send: amount must be positive")
	}
	return nil
}

// Output is one leg of a multi-send.
type Output struct {
	To     types.Address `json:"to"`
	Amount types.Amount  `json:"amount"`
}

// MsgMultiSend pays many recipients atomically: either every leg succeeds or
// the whole transaction fails. This is the primitive behind payroll and bulk
// merchant payouts.
type MsgMultiSend struct {
	From    types.Address `json:"from"`
	Outputs []Output      `json:"outputs"`
}

// MaxMultiSendOutputs bounds the fan-out of a single transaction so that one
// message cannot be used to force an unbounded amount of state work into a
// block.
const MaxMultiSendOutputs = 1000

func (m MsgMultiSend) Type() string          { return MsgTypeMultiSend }
func (m MsgMultiSend) Signer() types.Address { return m.From }
func (m MsgMultiSend) ValidateBasic() error {
	if m.From.IsZero() {
		return fmt.Errorf("multisend: zero sender")
	}
	if len(m.Outputs) == 0 {
		return fmt.Errorf("multisend: no outputs")
	}
	if len(m.Outputs) > MaxMultiSendOutputs {
		return fmt.Errorf("multisend: %d outputs exceeds limit of %d",
			len(m.Outputs), MaxMultiSendOutputs)
	}
	seen := make(map[types.Address]struct{}, len(m.Outputs))
	for i, o := range m.Outputs {
		if o.To.IsZero() {
			return fmt.Errorf("multisend: output %d has zero address", i)
		}
		if o.Amount.IsZero() {
			return fmt.Errorf("multisend: output %d has zero amount", i)
		}
		if _, dup := seen[o.To]; dup {
			return fmt.Errorf("multisend: duplicate recipient %s", o.To)
		}
		seen[o.To] = struct{}{}
	}
	return nil
}

// Total returns the sum of every output.
func (m MsgMultiSend) Total() (*big.Int, error) {
	total := types.Zero()
	var err error
	for _, o := range m.Outputs {
		total, err = types.Add(total, o.Amount.Int())
		if err != nil {
			return nil, err
		}
	}
	return total, nil
}

// MsgBurn permanently destroys YZXA. Burned units are removed from the
// circulating supply and are never re-minted: the emission schedule does not
// "notice" a burn, so a burn is an irreversible reduction of the money that
// will ever exist.
type MsgBurn struct {
	From   types.Address `json:"from"`
	Amount types.Amount  `json:"amount"`
}

func (m MsgBurn) Type() string          { return MsgTypeBurn }
func (m MsgBurn) Signer() types.Address { return m.From }
func (m MsgBurn) ValidateBasic() error {
	if m.From.IsZero() {
		return fmt.Errorf("burn: zero address")
	}
	if m.Amount.IsZero() {
		return fmt.Errorf("burn: amount must be positive")
	}
	return nil
}

// Description is validator metadata shown in wallets and explorers.
type Description struct {
	Moniker  string `json:"moniker"`
	Identity string `json:"identity,omitempty"`
	Website  string `json:"website,omitempty"`
	Details  string `json:"details,omitempty"`
}

func (d Description) validate() error {
	if strings.TrimSpace(d.Moniker) == "" {
		return fmt.Errorf("moniker is required")
	}
	if len(d.Moniker) > 70 {
		return fmt.Errorf("moniker too long (max 70)")
	}
	if len(d.Website) > 140 || len(d.Details) > 280 || len(d.Identity) > 140 {
		return fmt.Errorf("description field too long")
	}
	return nil
}

// MsgCreateValidator registers a validator and bonds its self-delegation.
type MsgCreateValidator struct {
	Operator          types.Address `json:"operator"`
	ConsensusPubKey   string        `json:"consensus_pubkey"` // base64 ed25519, CometBFT format
	Description       Description   `json:"description"`
	CommissionRateBps uint32        `json:"commission_rate_bps"`
	MaxCommissionBps  uint32        `json:"max_commission_bps"`
	MinSelfDelegation types.Amount  `json:"min_self_delegation"`
	SelfDelegation    types.Amount  `json:"self_delegation"`
}

func (m MsgCreateValidator) Type() string          { return MsgTypeCreateValidator }
func (m MsgCreateValidator) Signer() types.Address { return m.Operator }
func (m MsgCreateValidator) ValidateBasic() error {
	if m.Operator.IsZero() {
		return fmt.Errorf("create_validator: zero operator")
	}
	if err := m.Description.validate(); err != nil {
		return fmt.Errorf("create_validator: %w", err)
	}
	if m.ConsensusPubKey == "" {
		return fmt.Errorf("create_validator: missing consensus public key")
	}
	if m.MaxCommissionBps > 10_000 {
		return fmt.Errorf("create_validator: max commission above 100%%")
	}
	if m.CommissionRateBps > m.MaxCommissionBps {
		return fmt.Errorf("create_validator: commission %d bps exceeds declared max %d bps",
			m.CommissionRateBps, m.MaxCommissionBps)
	}
	if m.SelfDelegation.IsZero() {
		return fmt.Errorf("create_validator: self delegation must be positive")
	}
	if m.SelfDelegation.Cmp(m.MinSelfDelegation) < 0 {
		return fmt.Errorf("create_validator: self delegation below declared minimum")
	}
	return nil
}

// MsgEditValidator updates mutable validator metadata.
type MsgEditValidator struct {
	Operator          types.Address `json:"operator"`
	Description       Description   `json:"description"`
	CommissionRateBps *uint32       `json:"commission_rate_bps,omitempty"`
}

func (m MsgEditValidator) Type() string          { return MsgTypeEditValidator }
func (m MsgEditValidator) Signer() types.Address { return m.Operator }
func (m MsgEditValidator) ValidateBasic() error {
	if m.Operator.IsZero() {
		return fmt.Errorf("edit_validator: zero operator")
	}
	if err := m.Description.validate(); err != nil {
		return fmt.Errorf("edit_validator: %w", err)
	}
	if m.CommissionRateBps != nil && *m.CommissionRateBps > 10_000 {
		return fmt.Errorf("edit_validator: commission above 100%%")
	}
	return nil
}

// MsgDelegate bonds YZXA to a validator.
type MsgDelegate struct {
	Delegator types.Address `json:"delegator"`
	Validator types.Address `json:"validator"`
	Amount    types.Amount  `json:"amount"`
}

func (m MsgDelegate) Type() string          { return MsgTypeDelegate }
func (m MsgDelegate) Signer() types.Address { return m.Delegator }
func (m MsgDelegate) ValidateBasic() error {
	if m.Delegator.IsZero() || m.Validator.IsZero() {
		return fmt.Errorf("delegate: zero address")
	}
	if m.Amount.IsZero() {
		return fmt.Errorf("delegate: amount must be positive")
	}
	return nil
}

// MsgUndelegate starts unbonding. The funds remain slashable for the whole
// unbonding period: this is what makes long-range attacks expensive.
type MsgUndelegate struct {
	Delegator types.Address `json:"delegator"`
	Validator types.Address `json:"validator"`
	Amount    types.Amount  `json:"amount"`
}

func (m MsgUndelegate) Type() string          { return MsgTypeUndelegate }
func (m MsgUndelegate) Signer() types.Address { return m.Delegator }
func (m MsgUndelegate) ValidateBasic() error {
	if m.Delegator.IsZero() || m.Validator.IsZero() {
		return fmt.Errorf("undelegate: zero address")
	}
	if m.Amount.IsZero() {
		return fmt.Errorf("undelegate: amount must be positive")
	}
	return nil
}

// MsgRedelegate moves a delegation between validators without a full unbonding
// wait, while keeping the stake continuously slashable.
type MsgRedelegate struct {
	Delegator    types.Address `json:"delegator"`
	SrcValidator types.Address `json:"src_validator"`
	DstValidator types.Address `json:"dst_validator"`
	Amount       types.Amount  `json:"amount"`
}

func (m MsgRedelegate) Type() string          { return MsgTypeRedelegate }
func (m MsgRedelegate) Signer() types.Address { return m.Delegator }
func (m MsgRedelegate) ValidateBasic() error {
	if m.Delegator.IsZero() || m.SrcValidator.IsZero() || m.DstValidator.IsZero() {
		return fmt.Errorf("redelegate: zero address")
	}
	if m.SrcValidator == m.DstValidator {
		return fmt.Errorf("redelegate: source and destination validators are the same")
	}
	if m.Amount.IsZero() {
		return fmt.Errorf("redelegate: amount must be positive")
	}
	return nil
}

// MsgWithdrawRewards claims accrued staking rewards.
type MsgWithdrawRewards struct {
	Delegator types.Address `json:"delegator"`
	Validator types.Address `json:"validator"`
}

func (m MsgWithdrawRewards) Type() string          { return MsgTypeWithdrawRewards }
func (m MsgWithdrawRewards) Signer() types.Address { return m.Delegator }
func (m MsgWithdrawRewards) ValidateBasic() error {
	if m.Delegator.IsZero() || m.Validator.IsZero() {
		return fmt.Errorf("withdraw_rewards: zero address")
	}
	return nil
}

// MsgUnjail returns a jailed validator to the active set once its downtime
// jail period has elapsed. A validator jailed for double signing is jailed
// permanently ("tombstoned") and this message will not release it.
type MsgUnjail struct {
	Operator types.Address `json:"operator"`
}

func (m MsgUnjail) Type() string          { return MsgTypeUnjail }
func (m MsgUnjail) Signer() types.Address { return m.Operator }
func (m MsgUnjail) ValidateBasic() error {
	if m.Operator.IsZero() {
		return fmt.Errorf("unjail: zero operator")
	}
	return nil
}

// MsgClaimVested releases the portion of a vesting position that has already
// vested according to the schedule recorded at genesis.
type MsgClaimVested struct {
	Account types.Address `json:"account"`
}

func (m MsgClaimVested) Type() string          { return MsgTypeClaimVested }
func (m MsgClaimVested) Signer() types.Address { return m.Account }
func (m MsgClaimVested) ValidateBasic() error {
	if m.Account.IsZero() {
		return fmt.Errorf("claim: zero account")
	}
	return nil
}

// MsgRegisterAlias claims a human-readable YOZEXA ID such as "maria.yzx".
type MsgRegisterAlias struct {
	Owner types.Address `json:"owner"`
	Alias string        `json:"alias"`
}

func (m MsgRegisterAlias) Type() string          { return MsgTypeRegisterAlias }
func (m MsgRegisterAlias) Signer() types.Address { return m.Owner }
func (m MsgRegisterAlias) ValidateBasic() error {
	if m.Owner.IsZero() {
		return fmt.Errorf("register_alias: zero owner")
	}
	return ValidateAlias(m.Alias)
}

// MsgTransferAlias hands an alias to another account.
type MsgTransferAlias struct {
	Owner types.Address `json:"owner"`
	Alias string        `json:"alias"`
	To    types.Address `json:"to"`
}

func (m MsgTransferAlias) Type() string          { return MsgTypeTransferAlias }
func (m MsgTransferAlias) Signer() types.Address { return m.Owner }
func (m MsgTransferAlias) ValidateBasic() error {
	if m.Owner.IsZero() || m.To.IsZero() {
		return fmt.Errorf("transfer_alias: zero address")
	}
	return ValidateAlias(m.Alias)
}

// rawMsg is the wire envelope of a message.
type rawMsg struct {
	Type  string          `json:"type"`
	Value json.RawMessage `json:"value"`
}

// MarshalMsg encodes a message in its wire envelope.
func MarshalMsg(m Msg) ([]byte, error) {
	v, err := json.Marshal(m)
	if err != nil {
		return nil, err
	}
	return json.Marshal(rawMsg{Type: m.Type(), Value: v})
}

// UnmarshalMsg decodes a message from its wire envelope. Unknown message types
// are rejected: a node must never accept a transaction it cannot fully
// interpret, because it would then disagree with upgraded peers about state.
func UnmarshalMsg(b []byte) (Msg, error) {
	var env rawMsg
	if err := json.Unmarshal(b, &env); err != nil {
		return nil, fmt.Errorf("decode message envelope: %w", err)
	}
	switch env.Type {
	case MsgTypeSend:
		var m MsgSend
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeMultiSend:
		var m MsgMultiSend
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeBurn:
		var m MsgBurn
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeCreateValidator:
		var m MsgCreateValidator
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeEditValidator:
		var m MsgEditValidator
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeDelegate:
		var m MsgDelegate
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeUndelegate:
		var m MsgUndelegate
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeRedelegate:
		var m MsgRedelegate
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeWithdrawRewards:
		var m MsgWithdrawRewards
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeUnjail:
		var m MsgUnjail
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeSubmitProposal:
		var m MsgSubmitProposal
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeVote:
		var m MsgVote
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeDeposit:
		var m MsgDeposit
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeClaimVested:
		var m MsgClaimVested
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeGrant:
		var m MsgGrant
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeRevoke:
		var m MsgRevoke
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeExec:
		var m MsgExec
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeRegisterAlias:
		var m MsgRegisterAlias
		return decodeInto(env.Value, &m, func() Msg { return m })
	case MsgTypeTransferAlias:
		var m MsgTransferAlias
		return decodeInto(env.Value, &m, func() Msg { return m })
	default:
		return nil, fmt.Errorf("unknown message type %q", env.Type)
	}
}

func decodeInto(raw []byte, dst any, get func() Msg) (Msg, error) {
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return nil, fmt.Errorf("decode message: %w", err)
	}
	if d.More() {
		return nil, fmt.Errorf("trailing data in message")
	}
	return get(), nil
}
