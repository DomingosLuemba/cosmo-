package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/spf13/cobra"

	"github.com/yozexa/yozexa/chain/app"
	"github.com/yozexa/yozexa/chain/types"
)

func genesisCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "genesis",
		Short: "inspect and validate genesis files",
	}
	cmd.AddCommand(genesisValidateCmd(), genesisShowCmd())
	return cmd
}

func genesisValidateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "validate [path]",
		Short: "validate a genesis file against every YOZEXA rule",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			home, _ := cmd.Flags().GetString("home")
			path := filepath.Join(home, "config", "genesis.json")
			if len(args) == 1 {
				path = args[0]
			}
			g, doc, err := loadGenesis(path)
			if err != nil {
				return err
			}
			if err := g.Validate(); err != nil {
				return fmt.Errorf("INVALID: %w", err)
			}
			total, err := g.TotalGenesisMint()
			if err != nil {
				return err
			}
			fmt.Printf("genesis is VALID\n")
			fmt.Printf("  chain id:              %s\n", doc.ChainID)
			fmt.Printf("  genesis time:          %s\n", doc.GenesisTime.UTC().Format("2006-01-02T15:04:05Z"))
			fmt.Printf("  accounts:              %d\n", len(g.Accounts))
			fmt.Printf("  vesting positions:     %d\n", len(g.Vesting))
			fmt.Printf("  validators:            %d\n", len(g.Validators))
			fmt.Printf("  minted at genesis:     %s YZXA\n", types.FormatYZXA(total))
			fmt.Printf("  hard cap:              %s YZXA\n", types.FormatYZXA(types.MaxSupplyCopy()))
			return nil
		},
	}
}

func genesisShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "show [path]",
		Short: "print the YOZEXA application state of a genesis file",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			home, _ := cmd.Flags().GetString("home")
			path := filepath.Join(home, "config", "genesis.json")
			if len(args) == 1 {
				path = args[0]
			}
			g, _, err := loadGenesis(path)
			if err != nil {
				return err
			}
			raw, err := g.MarshalIndent()
			if err != nil {
				return err
			}
			fmt.Println(string(raw))
			return nil
		},
	}
}

func loadGenesis(path string) (app.Genesis, *cmttypes.GenesisDoc, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return app.Genesis{}, nil, fmt.Errorf("read genesis: %w", err)
	}
	doc, err := cmttypes.GenesisDocFromJSON(raw)
	if err != nil {
		return app.Genesis{}, nil, fmt.Errorf("parse genesis: %w", err)
	}
	var g app.Genesis
	if err := json.Unmarshal(doc.AppState, &g); err != nil {
		return app.Genesis{}, nil, fmt.Errorf("parse YOZEXA app state: %w", err)
	}
	if g.ChainID == "" {
		g.ChainID = doc.ChainID
	}
	if g.GenesisTime.IsZero() {
		g.GenesisTime = doc.GenesisTime
	}
	return g, doc, nil
}
