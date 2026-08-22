package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/yozexa/yozexa/chain/types"
)

func queryCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "query", Short: "read state from a YOZEXA node"}
	cmd.AddCommand(
		queryBalanceCmd(), queryValidatorsCmd(), queryValidatorCmd(),
		queryTxCmd(), queryDelegationsCmd(), queryVestingCmd(),
		queryProposalsCmd(), queryGrantsCmd(), queryStatusCmd(),
		queryInvariantsCmd(),
	)
	return cmd
}

func printJSON(v any) {
	out, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		fmt.Println(v)
		return
	}
	fmt.Println(string(out))
}

func queryBalanceCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "balance [address-or-alias]",
		Short: "show an account's balance, spendable amount and vesting position",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			cl := newClient(cmd)
			ctx := context.Background()
			addr, err := cl.ResolveRecipient(ctx, args[0])
			if err != nil {
				return err
			}
			acc, err := cl.Account(ctx, addr.String())
			if err != nil {
				return err
			}
			fmt.Printf("address:    %s\n", acc.Address)
			if acc.Alias != "" {
				fmt.Printf("yozexa id:  %s\n", acc.Alias)
			}
			fmt.Printf("balance:    %s YZXA\n", acc.BalanceYZXA)
			fmt.Printf("            %s YOZ\n", acc.BalanceYOZ)
			spendable, _ := types.AmountFromString(acc.Spendable)
			locked, _ := types.AmountFromString(acc.Locked)
			fmt.Printf("spendable:  %s YZXA\n", types.FormatYZXA(spendable.Int()))
			if locked.Int().Sign() > 0 {
				fmt.Printf("locked:     %s YZXA (vesting)\n", types.FormatYZXA(locked.Int()))
			}
			fmt.Printf("sequence:   %d\n", acc.Sequence)
			if acc.Vesting != nil {
				total, _ := types.AmountFromString(acc.Vesting.Total)
				vested, _ := types.AmountFromString(acc.Vesting.Vested)
				fmt.Printf("\nvesting (%s)\n", acc.Vesting.Category)
				fmt.Printf("  allocation: %s YZXA\n", types.FormatYZXA(total.Int()))
				fmt.Printf("  vested:     %s YZXA\n", types.FormatYZXA(vested.Int()))
				fmt.Printf("  cliff:      %s\n", unixString(acc.Vesting.CliffUnix))
				fmt.Printf("  ends:       %s\n", unixString(acc.Vesting.EndUnix))
			}
			return nil
		},
	}
}

func queryValidatorsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "validators",
		Short: "list validators with stake, commission and status",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cl := newClient(cmd)
			v, err := cl.Validators(context.Background())
			if err != nil {
				return err
			}
			list, _ := v["validators"].([]any)
			fmt.Printf("%-52s %-16s %-8s %-10s %s\n", "OPERATOR", "STAKE (YZXA)", "COMM", "STATUS", "MONIKER")
			for _, item := range list {
				m, ok := item.(map[string]any)
				if !ok {
					continue
				}
				status := "active"
				if b, _ := m["tombstoned"].(bool); b {
					status = "tombstoned"
				} else if b, _ := m["jailed"].(bool); b {
					status = "jailed"
				} else if b, _ := m["active"].(bool); !b {
					status = "inactive"
				}
				commission := "-"
				if c, ok := m["commission_bps"].(float64); ok {
					commission = fmt.Sprintf("%.2f%%", c/100)
				}
				fmt.Printf("%-52v %-16v %-8s %-10s %v\n",
					m["operator"], m["tokens_yzxa"], commission, status, m["moniker"])
			}
			fmt.Printf("\nStaking rewards are not guaranteed. Validators can be slashed, and a\n" +
				"delegator's stake is slashed with them.\n")
			return nil
		},
	}
}

func queryValidatorCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "validator [operator]",
		Short: "show one validator",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			raw, err := newClient(cmd).Query(context.Background(), "/v1/validator/"+args[0])
			if err != nil {
				return err
			}
			var v any
			_ = json.Unmarshal(raw, &v)
			printJSON(v)
			return nil
		},
	}
}

func queryTxCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "tx [hash]",
		Short: "show a transaction and its finality state",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			out, err := newClient(cmd).TxStatus(context.Background(), args[0])
			if err != nil {
				return err
			}
			fmt.Printf("hash:          %v\n", out["hash"])
			fmt.Printf("status:        %v\n", out["status"])
			if h, ok := out["height"]; ok {
				fmt.Printf("height:        %v\n", h)
			}
			if c, ok := out["confirmations"]; ok {
				fmt.Printf("confirmations: %v\n", c)
			}
			if l, ok := out["log"]; ok && l != "" {
				fmt.Printf("log:           %v\n", l)
			}
			fmt.Printf("\n%v\n", out["explanation"])
			return nil
		},
	}
}

func queryDelegationsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "delegations [address]",
		Short: "show an account's staking positions",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			raw, err := newClient(cmd).Query(context.Background(), "/v1/delegations/"+args[0])
			if err != nil {
				return err
			}
			var v any
			_ = json.Unmarshal(raw, &v)
			printJSON(v)
			return nil
		},
	}
}

func queryVestingCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "vesting",
		Short: "show every public vesting position (founder, team, ecosystem)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			raw, err := newClient(cmd).Query(context.Background(), "/v1/vesting")
			if err != nil {
				return err
			}
			var v struct {
				Vesting []struct {
					Address   string `json:"address"`
					Category  string `json:"category"`
					Total     string `json:"total"`
					Vested    string `json:"vested"`
					Locked    string `json:"locked"`
					CliffUnix int64  `json:"cliff_unix"`
					EndUnix   int64  `json:"end_unix"`
				} `json:"vesting"`
			}
			if err := json.Unmarshal(raw, &v); err != nil {
				return err
			}
			if len(v.Vesting) == 0 {
				fmt.Println("no vesting positions on this network")
				return nil
			}
			for _, p := range v.Vesting {
				total, _ := types.AmountFromString(p.Total)
				vested, _ := types.AmountFromString(p.Vested)
				locked, _ := types.AmountFromString(p.Locked)
				fmt.Printf("%s  %s\n", p.Category, p.Address)
				fmt.Printf("  allocation %s YZXA | vested %s | locked %s\n",
					types.FormatYZXA(total.Int()), types.FormatYZXA(vested.Int()),
					types.FormatYZXA(locked.Int()))
				fmt.Printf("  cliff %s | ends %s\n\n", unixString(p.CliffUnix), unixString(p.EndUnix))
			}
			return nil
		},
	}
}

func queryProposalsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "proposals",
		Short: "list governance proposals",
		RunE: func(cmd *cobra.Command, _ []string) error {
			raw, err := newClient(cmd).Query(context.Background(), "/v1/proposals")
			if err != nil {
				return err
			}
			var v any
			_ = json.Unmarshal(raw, &v)
			printJSON(v)
			return nil
		},
	}
}

func queryGrantsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "grants [granter]",
		Short: "list the spending permissions an account has issued",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			raw, err := newClient(cmd).Query(context.Background(), "/v1/grants/"+args[0])
			if err != nil {
				return err
			}
			var v any
			_ = json.Unmarshal(raw, &v)
			printJSON(v)
			return nil
		},
	}
}

func queryStatusCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "status",
		Short: "show node and network status",
		RunE: func(cmd *cobra.Command, _ []string) error {
			s, err := newClient(cmd).Status(context.Background())
			if err != nil {
				return err
			}
			fmt.Printf("chain id:     %s\n", s.ChainID)
			fmt.Printf("height:       %d\n", s.Height)
			fmt.Printf("node version: %s\n", s.NodeVersion)
			if s.LatestBlockTime != "" {
				fmt.Printf("block time:   %s\n", s.LatestBlockTime)
			}
			if s.CatchingUp {
				fmt.Printf("state:        catching up with the network\n")
			}
			if s.NetworkWarning != "" {
				fmt.Printf("\n! %s\n", s.NetworkWarning)
			}
			return nil
		},
	}
}

func queryInvariantsCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "invariants",
		Short: "run every protocol invariant against the node's live state",
		RunE: func(cmd *cobra.Command, _ []string) error {
			raw, err := newClient(cmd).Query(context.Background(), "/v1/invariants")
			if err != nil {
				return err
			}
			var v struct {
				OK      bool `json:"ok"`
				Results []struct {
					Name    string `json:"name"`
					OK      bool   `json:"ok"`
					Message string `json:"message"`
				} `json:"results"`
			}
			if err := json.Unmarshal(raw, &v); err != nil {
				return err
			}
			for _, r := range v.Results {
				mark := "PASS"
				if !r.OK {
					mark = "FAIL"
				}
				fmt.Printf("%-4s %-16s %s\n", mark, r.Name, r.Message)
			}
			if !v.OK {
				return fmt.Errorf("one or more invariants are violated on this node")
			}
			fmt.Printf("\nall invariants hold\n")
			return nil
		},
	}
}

func unixString(u int64) string {
	if u == 0 {
		return "-"
	}
	return timeUnix(u)
}
