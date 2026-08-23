package main

import (
	"context"
	"fmt"
	"math/big"
	"strconv"
	"time"

	"github.com/spf13/cobra"

	"github.com/yozexa/yozexa/chain/client"
	"github.com/yozexa/yozexa/chain/crypto"
	"github.com/yozexa/yozexa/chain/tx"
	"github.com/yozexa/yozexa/chain/types"
)

func txCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "tx", Short: "build, sign and broadcast transactions"}
	cmd.PersistentFlags().String("from", "", "keyring name of the signing account")
	cmd.PersistentFlags().String("passphrase", "", "keyring passphrase (prefer YOZEXA_PASSPHRASE)")
	cmd.PersistentFlags().String("fee-tier", "normal", "fee tier: economy, normal or priority")
	cmd.PersistentFlags().Uint64("gas", 300_000, "gas limit")
	cmd.PersistentFlags().String("memo", "", "optional memo")
	cmd.PersistentFlags().Bool("dry-run", false, "simulate and show the effects without broadcasting")
	cmd.PersistentFlags().Bool("wait", true, "wait for the transaction to be included in a block")

	cmd.AddCommand(
		txSendCmd(), txBurnCmd(), txStakeCmd(), txUnstakeCmd(),
		txWithdrawCmd(), txVoteCmd(), txGrantCmd(), txRevokeCmd(),
		txRegisterAliasCmd(),
		txCreateValidatorCmd(), txEditValidatorCmd(), txUnjailCmd(),
	)
	return cmd
}

// signingContext gathers everything a transaction command needs.
type signingContext struct {
	key     *crypto.PrivKey
	cl      *client.Client
	chainID string
	tier    string
	gas     uint64
	memo    string
	dryRun  bool
	mode    string
}

func prepare(cmd *cobra.Command) (*signingContext, error) {
	from, _ := cmd.Flags().GetString("from")
	if from == "" {
		return nil, fmt.Errorf("--from is required")
	}
	kr, err := openKeyring(cmd)
	if err != nil {
		return nil, err
	}
	pass, err := passphrase(cmd)
	if err != nil {
		return nil, err
	}
	key, err := kr.Unlock(from, pass)
	if err != nil {
		return nil, err
	}
	cl := newClient(cmd)

	chainID, _ := cmd.Flags().GetString("chain-id")
	if chainID == "" {
		status, err := cl.Status(context.Background())
		if err != nil {
			return nil, err
		}
		chainID = status.ChainID
		if status.NetworkWarning != "" {
			fmt.Printf("! %s\n", status.NetworkWarning)
		}
	}

	tier, _ := cmd.Flags().GetString("fee-tier")
	gas, _ := cmd.Flags().GetUint64("gas")
	memo, _ := cmd.Flags().GetString("memo")
	dryRun, _ := cmd.Flags().GetBool("dry-run")
	wait, _ := cmd.Flags().GetBool("wait")
	mode := "sync"
	if wait {
		mode = "commit"
	}
	return &signingContext{
		key: key, cl: cl, chainID: chainID, tier: tier,
		gas: gas, memo: memo, dryRun: dryRun, mode: mode,
	}, nil
}

// submit simulates, prints the effects for the user to read, and broadcasts.
func (sc *signingContext) submit(ctx context.Context, msgs ...tx.Msg) error {
	acc, err := sc.cl.Account(ctx, sc.key.Address().String())
	if err != nil {
		return err
	}
	fm, err := sc.cl.FeeMarket(ctx)
	if err != nil {
		return err
	}
	var gasPrice string
	for _, t := range fm.Tiers {
		if t.Name == sc.tier {
			gasPrice = t.GasPrice
		}
	}
	if gasPrice == "" {
		return fmt.Errorf("unknown fee tier %q", sc.tier)
	}
	price, ok := new(big.Int).SetString(gasPrice, 10)
	if !ok {
		return fmt.Errorf("node returned an unparseable gas price")
	}

	b := tx.NewBuilder(sc.chainID)
	for _, m := range msgs {
		if err := b.AddMsg(m); err != nil {
			return err
		}
	}
	if err := b.WithFee(sc.gas, price); err != nil {
		return err
	}
	b.WithSequence(acc.Sequence).WithMemo(sc.memo)
	signed, err := b.Sign(sc.key)
	if err != nil {
		return err
	}

	sim, err := sc.cl.Simulate(ctx, signed)
	if err != nil {
		return fmt.Errorf("simulation failed: %w", err)
	}
	printSimulation(sim)

	if sc.dryRun {
		fmt.Println("\ndry run: nothing was broadcast")
		return nil
	}

	res, err := sc.cl.Broadcast(ctx, signed, sc.mode)
	if err != nil {
		return err
	}
	fmt.Printf("\ntransaction %s\n  hash:   %s\n", res.Status, res.Hash)
	if res.Height > 0 {
		fmt.Printf("  height: %d\n", res.Height)
	}
	if res.Log != "" {
		fmt.Printf("  log:    %s\n", res.Log)
	}
	switch res.Status {
	case "pending":
		fmt.Printf("\nThe transaction is in the mempool. It is NOT settled until it is in a\n"+
			"committed block. Check with: yozexa query tx %s\n", res.Hash)
	case "confirmed", "finalized":
		fmt.Printf("\nIncluded in a committed block. CometBFT commits are final: this cannot\n" +
			"be reverted by a longer chain.\n")
	case "failed":
		return fmt.Errorf("the transaction failed on chain")
	}
	return nil
}

func printSimulation(sim map[string]any) {
	fmt.Printf("\ntransaction review\n")
	if effects, ok := sim["effects"].([]any); ok {
		for _, e := range effects {
			m, ok := e.(map[string]any)
			if !ok {
				continue
			}
			fmt.Printf("  • %v\n", m["description"])
		}
	}
	if v, ok := sim["estimated_fee_yzxa"]; ok {
		fmt.Printf("  network fee: %v YZXA\n", v)
	}
	if warnings, ok := sim["warnings"].([]any); ok && len(warnings) > 0 {
		fmt.Printf("\n  warnings\n")
		for _, w := range warnings {
			fmt.Printf("  ! %v\n", w)
		}
	}
}

func txSendCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "send [recipient] [amount]",
		Short: "send YZXA to an address or YOZEXA ID",
		Long: `Send YZXA.

The recipient may be a bech32 address (yzx1...) or a registered YOZEXA ID
(maria.yzx). The amount is denominated by --unit: YZXA, YOZ or ayzxa.`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			sc, err := prepare(cmd)
			if err != nil {
				return err
			}
			ctx := context.Background()
			to, err := sc.cl.ResolveRecipient(ctx, args[0])
			if err != nil {
				return err
			}
			if args[0] != to.String() {
				fmt.Printf("resolved %s -> %s\n", args[0], to)
			}
			unit, _ := cmd.Flags().GetString("unit")
			amount, err := types.ParseAmount(args[1], unit)
			if err != nil {
				return err
			}
			amt, err := types.NewAmount(amount)
			if err != nil {
				return err
			}
			return sc.submit(ctx, tx.MsgSend{From: sc.key.Address(), To: to, Amount: amt})
		},
	}
	c.Flags().String("unit", "YZXA", "amount unit: YZXA, YOZ or ayzxa")
	return c
}

func txBurnCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "burn [amount]",
		Short: "permanently destroy YZXA",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			sc, err := prepare(cmd)
			if err != nil {
				return err
			}
			unit, _ := cmd.Flags().GetString("unit")
			amount, err := types.ParseAmount(args[0], unit)
			if err != nil {
				return err
			}
			amt, err := types.NewAmount(amount)
			if err != nil {
				return err
			}
			return sc.submit(context.Background(), tx.MsgBurn{From: sc.key.Address(), Amount: amt})
		},
	}
	c.Flags().String("unit", "YZXA", "amount unit")
	return c
}

func txStakeCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "stake [validator] [amount]",
		Short: "bond YZXA to a validator",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			sc, err := prepare(cmd)
			if err != nil {
				return err
			}
			val, err := types.ParseAnyAddress(args[0])
			if err != nil {
				return err
			}
			unit, _ := cmd.Flags().GetString("unit")
			amount, err := types.ParseAmount(args[1], unit)
			if err != nil {
				return err
			}
			amt, err := types.NewAmount(amount)
			if err != nil {
				return err
			}
			return sc.submit(context.Background(), tx.MsgDelegate{
				Delegator: sc.key.Address(), Validator: val, Amount: amt,
			})
		},
	}
	c.Flags().String("unit", "YZXA", "amount unit")
	return c
}

func txUnstakeCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "unstake [validator] [amount]",
		Short: "begin unbonding YZXA from a validator",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			sc, err := prepare(cmd)
			if err != nil {
				return err
			}
			val, err := types.ParseAnyAddress(args[0])
			if err != nil {
				return err
			}
			unit, _ := cmd.Flags().GetString("unit")
			amount, err := types.ParseAmount(args[1], unit)
			if err != nil {
				return err
			}
			amt, err := types.NewAmount(amount)
			if err != nil {
				return err
			}
			return sc.submit(context.Background(), tx.MsgUndelegate{
				Delegator: sc.key.Address(), Validator: val, Amount: amt,
			})
		},
	}
	c.Flags().String("unit", "YZXA", "amount unit")
	return c
}

func txWithdrawCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "withdraw-rewards [validator]",
		Short: "claim accrued staking rewards",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			sc, err := prepare(cmd)
			if err != nil {
				return err
			}
			val, err := types.ParseAnyAddress(args[0])
			if err != nil {
				return err
			}
			return sc.submit(context.Background(), tx.MsgWithdrawRewards{
				Delegator: sc.key.Address(), Validator: val,
			})
		},
	}
}

func txVoteCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "vote [proposal-id] [yes|no|abstain|no_with_veto]",
		Short: "vote on a governance proposal with your bonded stake",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			sc, err := prepare(cmd)
			if err != nil {
				return err
			}
			id, err := strconv.ParseUint(args[0], 10, 64)
			if err != nil {
				return fmt.Errorf("invalid proposal id %q", args[0])
			}
			return sc.submit(context.Background(), tx.MsgVote{
				Voter: sc.key.Address(), ProposalID: id, Option: args[1],
			})
		},
	}
}

func txGrantCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "grant [grantee]",
		Short: "give another key a limited, expiring permission to spend from this account",
		Long: `Create a spending permission.

This is how subscriptions, device session keys and AI agent wallets work on
YOZEXA. The permission is enforced by the chain itself, not by an application:
the grantee cannot exceed the total, the per-period cap, the named recipients
or the expiry, whatever software it runs.

There is no unlimited option. Every grant states a total and an expiry.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			sc, err := prepare(cmd)
			if err != nil {
				return err
			}
			grantee, err := types.ParseAddress(args[0])
			if err != nil {
				return err
			}
			unit, _ := cmd.Flags().GetString("unit")
			totalStr, _ := cmd.Flags().GetString("total")
			perPeriodStr, _ := cmd.Flags().GetString("per-period")
			periodSeconds, _ := cmd.Flags().GetInt64("period-seconds")
			hours, _ := cmd.Flags().GetInt64("expires-in-hours")
			approvalAbove, _ := cmd.Flags().GetString("require-approval-above")
			recipients, _ := cmd.Flags().GetStringSlice("recipient")
			msgTypes, _ := cmd.Flags().GetStringSlice("allow")

			total, err := types.ParseAmount(totalStr, unit)
			if err != nil {
				return fmt.Errorf("--total: %w", err)
			}
			totalAmt, err := types.NewAmount(total)
			if err != nil {
				return err
			}
			limit := tx.SpendLimit{Total: totalAmt, PeriodSeconds: periodSeconds}
			if perPeriodStr != "" {
				pp, err := types.ParseAmount(perPeriodStr, unit)
				if err != nil {
					return fmt.Errorf("--per-period: %w", err)
				}
				if limit.PerPeriod, err = types.NewAmount(pp); err != nil {
					return err
				}
			} else {
				limit.PerPeriod = types.MustAmount(types.Zero())
			}

			msg := tx.MsgGrant{
				Granter:         sc.key.Address(),
				Grantee:         grantee,
				AllowedMsgTypes: msgTypes,
				Limit:           limit,
				ExpiresAtUnix:   time.Now().Add(time.Duration(hours) * time.Hour).Unix(),
			}
			if approvalAbove != "" {
				v, err := types.ParseAmount(approvalAbove, unit)
				if err != nil {
					return fmt.Errorf("--require-approval-above: %w", err)
				}
				if msg.RequireApprovalAbove, err = types.NewAmount(v); err != nil {
					return err
				}
			} else {
				msg.RequireApprovalAbove = types.MustAmount(types.Zero())
			}
			for _, r := range recipients {
				addr, err := sc.cl.ResolveRecipient(context.Background(), r)
				if err != nil {
					return err
				}
				msg.AllowedRecipients = append(msg.AllowedRecipients, addr)
			}
			return sc.submit(context.Background(), msg)
		},
	}
	c.Flags().String("total", "", "lifetime spending limit (required)")
	c.Flags().String("per-period", "", "spending limit per rolling period")
	c.Flags().Int64("period-seconds", 0, "length of the rolling period in seconds")
	c.Flags().Int64("expires-in-hours", 24, "how long the permission lives")
	c.Flags().String("require-approval-above", "", "refuse single payments above this amount")
	c.Flags().StringSlice("recipient", nil, "restrict payments to these addresses or YOZEXA IDs")
	c.Flags().StringSlice("allow", []string{"bank/send"}, "message types the grantee may execute")
	c.Flags().String("unit", "YZXA", "amount unit")
	_ = c.MarkFlagRequired("total")
	return c
}

func txRevokeCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "revoke [grantee]",
		Short: "revoke a spending permission immediately",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			sc, err := prepare(cmd)
			if err != nil {
				return err
			}
			grantee, err := types.ParseAddress(args[0])
			if err != nil {
				return err
			}
			return sc.submit(context.Background(), tx.MsgRevoke{
				Granter: sc.key.Address(), Grantee: grantee,
			})
		},
	}
}

func txRegisterAliasCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "register-alias [name.yzx]",
		Short: "register a YOZEXA ID for this account",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			sc, err := prepare(cmd)
			if err != nil {
				return err
			}
			return sc.submit(context.Background(), tx.MsgRegisterAlias{
				Owner: sc.key.Address(), Alias: args[0],
			})
		},
	}
}

// --- validator lifecycle -------------------------------------------------
//
// Without these three the validator set is whatever the genesis had, forever:
// nobody can join, nobody can correct a commission, and a validator jailed for
// downtime — which is meant to be recoverable — has no way back. The protocol
// has always supported all three; nothing shipped could build the messages.

func txCreateValidatorCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "create-validator [self-delegation]",
		Short: "register the signing account as a validator and bond its stake",
		Long: "Register a validator.\n\n" +
			"The consensus public key is the base64 ed25519 key that `yozexad init`\n" +
			"prints for the node. It is the key that signs blocks; the account\n" +
			"signing this transaction is the operator that owns the stake.\n\n" +
			"Commission is in basis points: 1000 is 10%. --max-commission-bps is a\n" +
			"ceiling that can never be raised afterwards, so delegators can rely on\n" +
			"it when they choose a validator.",
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			sc, err := prepare(cmd)
			if err != nil {
				return err
			}
			consKey, _ := cmd.Flags().GetString("consensus-pubkey")
			moniker, _ := cmd.Flags().GetString("moniker")
			identity, _ := cmd.Flags().GetString("identity")
			website, _ := cmd.Flags().GetString("website")
			details, _ := cmd.Flags().GetString("details")
			commission, _ := cmd.Flags().GetUint32("commission-bps")
			maxCommission, _ := cmd.Flags().GetUint32("max-commission-bps")
			minSelf, _ := cmd.Flags().GetString("min-self-delegation")
			unit, _ := cmd.Flags().GetString("unit")

			if consKey == "" {
				return fmt.Errorf("--consensus-pubkey is required; `yozexad init` prints it for the node")
			}
			if moniker == "" {
				return fmt.Errorf("--moniker is required: a validator with no name cannot be chosen")
			}
			selfDelegation, err := types.ParseAmount(args[0], unit)
			if err != nil {
				return err
			}
			self, err := types.NewAmount(selfDelegation)
			if err != nil {
				return err
			}
			minAmount, err := types.ParseAmount(minSelf, unit)
			if err != nil {
				return fmt.Errorf("--min-self-delegation: %w", err)
			}
			minSelfAmt, err := types.NewAmount(minAmount)
			if err != nil {
				return err
			}
			return sc.submit(context.Background(), tx.MsgCreateValidator{
				Operator:        sc.key.Address(),
				ConsensusPubKey: consKey,
				Description: tx.Description{
					Moniker: moniker, Identity: identity, Website: website, Details: details,
				},
				CommissionRateBps: commission,
				MaxCommissionBps:  maxCommission,
				MinSelfDelegation: minSelfAmt,
				SelfDelegation:    self,
			})
		},
	}
	c.Flags().String("consensus-pubkey", "", "base64 ed25519 consensus key, printed by `yozexad init`")
	c.Flags().String("moniker", "", "the validator's name, shown to delegators")
	c.Flags().String("identity", "", "optional identity string")
	c.Flags().String("website", "", "optional website")
	c.Flags().String("details", "", "optional description")
	c.Flags().Uint32("commission-bps", 1_000, "commission in basis points (1000 = 10%)")
	c.Flags().Uint32("max-commission-bps", 2_000, "maximum commission this validator may ever charge")
	c.Flags().String("min-self-delegation", "1", "the self-delegation the operator commits to keeping")
	c.Flags().String("unit", "YZXA", "amount unit")
	return c
}

func txEditValidatorCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "edit-validator",
		Short: "change a validator's description, or lower its commission",
		Long: "Edit a validator.\n\n" +
			"Commission can never exceed the maximum set when the validator was\n" +
			"created. Leave --commission-bps unset to change only the description.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			sc, err := prepare(cmd)
			if err != nil {
				return err
			}
			moniker, _ := cmd.Flags().GetString("moniker")
			if moniker == "" {
				return fmt.Errorf("--moniker is required")
			}
			identity, _ := cmd.Flags().GetString("identity")
			website, _ := cmd.Flags().GetString("website")
			details, _ := cmd.Flags().GetString("details")

			msg := tx.MsgEditValidator{
				Operator: sc.key.Address(),
				Description: tx.Description{
					Moniker: moniker, Identity: identity, Website: website, Details: details,
				},
			}
			if cmd.Flags().Changed("commission-bps") {
				rate, _ := cmd.Flags().GetUint32("commission-bps")
				msg.CommissionRateBps = &rate
			}
			return sc.submit(context.Background(), msg)
		},
	}
	c.Flags().String("moniker", "", "the validator's name")
	c.Flags().String("identity", "", "optional identity string")
	c.Flags().String("website", "", "optional website")
	c.Flags().String("details", "", "optional description")
	c.Flags().Uint32("commission-bps", 0, "new commission in basis points; unset leaves it unchanged")
	return c
}

func txUnjailCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "unjail",
		Short: "release a validator jailed for downtime",
		Long: "Release a validator that was jailed for missing blocks.\n\n" +
			"Fix whatever took the node down first: unjailing a node that is still\n" +
			"unhealthy simply jails it again, and each jailing costs stake.\n\n" +
			"A validator tombstoned for double signing is refused here. That removal\n" +
			"is permanent and no governance vote in this protocol can undo it.",
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			sc, err := prepare(cmd)
			if err != nil {
				return err
			}
			return sc.submit(context.Background(), tx.MsgUnjail{Operator: sc.key.Address()})
		},
	}
}
