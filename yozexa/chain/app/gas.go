package app

import (
	"fmt"

	"github.com/yozexa/yozexa/chain/tx"
)

// Gas costs. Gas exists to price the work a transaction imposes on every node
// on the network, and to bound how much of it one block can contain.
//
// The numbers are deliberately conservative: a message that writes more state
// costs more, and anything with unbounded fan-out is charged per element.
const (
	GasTxBase       uint64 = 21_000
	GasPerByte      uint64 = 16
	GasSend         uint64 = 21_000
	GasMultiSendOut uint64 = 12_000
	GasBurn         uint64 = 15_000
	GasDelegate     uint64 = 60_000
	GasUndelegate   uint64 = 70_000
	GasRedelegate   uint64 = 80_000
	GasWithdraw     uint64 = 50_000
	GasCreateVal    uint64 = 150_000
	GasEditVal      uint64 = 40_000
	GasUnjail       uint64 = 30_000
	GasSubmitProp   uint64 = 200_000
	GasVote         uint64 = 35_000
	GasDeposit      uint64 = 35_000
	GasClaimVested  uint64 = 30_000
	GasGrant        uint64 = 55_000
	GasRevoke       uint64 = 25_000
	GasExecOverhead uint64 = 20_000
	GasAlias        uint64 = 80_000
)

// MsgGas returns the gas a message consumes.
func MsgGas(m tx.Msg) (uint64, error) {
	switch t := m.(type) {
	case tx.MsgSend:
		return GasSend, nil
	case tx.MsgMultiSend:
		return GasMultiSendOut * uint64(len(t.Outputs)), nil
	case tx.MsgBurn:
		return GasBurn, nil
	case tx.MsgCreateValidator:
		return GasCreateVal, nil
	case tx.MsgEditValidator:
		return GasEditVal, nil
	case tx.MsgDelegate:
		return GasDelegate, nil
	case tx.MsgUndelegate:
		return GasUndelegate, nil
	case tx.MsgRedelegate:
		return GasRedelegate, nil
	case tx.MsgWithdrawRewards:
		return GasWithdraw, nil
	case tx.MsgUnjail:
		return GasUnjail, nil
	case tx.MsgSubmitProposal:
		return GasSubmitProp, nil
	case tx.MsgVote:
		return GasVote, nil
	case tx.MsgDeposit:
		return GasDeposit, nil
	case tx.MsgClaimVested:
		return GasClaimVested, nil
	case tx.MsgGrant:
		return GasGrant, nil
	case tx.MsgRevoke:
		return GasRevoke, nil
	case tx.MsgExec:
		total := GasExecOverhead
		inner, err := t.InnerMsgs()
		if err != nil {
			return 0, err
		}
		for _, im := range inner {
			g, err := MsgGas(im)
			if err != nil {
				return 0, err
			}
			total += g
		}
		return total, nil
	case tx.MsgRegisterAlias, tx.MsgTransferAlias:
		return GasAlias, nil
	default:
		return 0, fmt.Errorf("no gas schedule for message type %q", m.Type())
	}
}

// TxGas returns the total gas a transaction consumes: a flat base cost, a
// per-byte cost that prices bandwidth and storage, and the sum of its
// messages.
func TxGas(t tx.Tx, rawSize int, msgs []tx.Msg) (uint64, error) {
	total := GasTxBase + GasPerByte*uint64(rawSize)
	for _, m := range msgs {
		g, err := MsgGas(m)
		if err != nil {
			return 0, err
		}
		total += g
	}
	return total, nil
}
