package main

import (
	"context"
	"fmt"
	"time"

	"github.com/spf13/cobra"

	"github.com/yozexa/yozexa/chain/types"
)

func supplyCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "supply", Short: "inspect and audit the YZXA supply"}
	cmd.AddCommand(supplyShowCmd(), supplyVerifyCmd())
	return cmd
}

func supplyShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "show",
		Short: "show the current supply",
		RunE: func(cmd *cobra.Command, _ []string) error {
			s, err := newClient(cmd).Supply(context.Background())
			if err != nil {
				return err
			}
			fmt.Printf("Maximum Supply:      %v YZXA\n", s["max_supply_yzxa"])
			fmt.Printf("Minted Supply:       %v YZXA\n", s["minted_supply_yzxa"])
			fmt.Printf("Burned Supply:       %v YZXA\n", s["burned_supply_yzxa"])
			fmt.Printf("Circulating Supply:  %v YZXA\n", s["circulating_supply_yzxa"])
			fmt.Printf("Remaining Mintable:  %v YZXA\n", s["remaining_mintable_yzxa"])
			return nil
		},
	}
}

// supplyVerifyCmd implements `yozexa supply verify`, the audit command.
//
// It prints a hard verdict, not a number to interpret. If the cap were ever
// broken this command would say INVALID and exit non-zero, so it can be run
// from monitoring.
func supplyVerifyCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "verify",
		Short: "audit the supply against the hard cap and every invariant",
		RunE: func(cmd *cobra.Command, _ []string) error {
			r, err := newClient(cmd).VerifySupply(context.Background())
			if err != nil {
				return err
			}
			fmt.Printf("Maximum Supply:\n%v YZXA\n\n", r["maximum_supply_yzxa"])
			fmt.Printf("Current Minted:\n%v YZXA\n\n", r["current_minted_yzxa"])
			fmt.Printf("Burned:\n%v YZXA\n\n", r["burned_yzxa"])
			fmt.Printf("Circulating:\n%v YZXA\n\n", r["circulating_yzxa"])
			fmt.Printf("Remaining Mintable:\n%v YZXA\n\n", r["remaining_mintable_yzxa"])

			if reserve, ok := r["emission_reserve"].(string); ok {
				emitted, _ := r["emission_emitted"].(string)
				remaining, _ := r["emission_remaining"].(string)
				rv, _ := types.AmountFromString(reserve)
				ev, _ := types.AmountFromString(emitted)
				rmv, _ := types.AmountFromString(remaining)
				fmt.Printf("Emission reserve:   %s YZXA\n", types.FormatYZXA(rv.Int()))
				fmt.Printf("Emission paid:      %s YZXA\n", types.FormatYZXA(ev.Int()))
				fmt.Printf("Emission remaining: %s YZXA\n\n", types.FormatYZXA(rmv.Int()))
			}

			if mods, ok := r["module_balances"].(map[string]any); ok {
				fmt.Printf("Protocol accounts\n")
				for _, name := range []string{
					"bonded_pool", "unbonding_pool", "reward_pool", "treasury",
					"security_fund", "ecosystem_fund", "liquidity_fund", "gov_deposit",
				} {
					if v, ok := mods[name].(string); ok {
						amt, _ := types.AmountFromString(v)
						fmt.Printf("  %-16s %s YZXA\n", name, types.FormatYZXA(amt.Int()))
					}
				}
				fmt.Println()
			}

			if results, ok := r["invariants"].([]any); ok {
				failed := 0
				for _, item := range results {
					m, _ := item.(map[string]any)
					ok, _ := m["ok"].(bool)
					if !ok {
						failed++
						fmt.Printf("INVARIANT FAILED: %v — %v\n", m["name"], m["message"])
					}
				}
				if failed == 0 {
					fmt.Printf("Invariants: all pass\n")
				}
			}

			verdict := fmt.Sprintf("%v", r["supply_cap"])
			fmt.Printf("\nSupply Cap:\n%s\n", verdict)
			if verdict != "VALID" {
				return fmt.Errorf("the supply cap is violated on this node")
			}
			return nil
		},
	}
}

func timeUnix(u int64) string {
	return time.Unix(u, 0).UTC().Format("2006-01-02 15:04:05 UTC")
}
