package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	cmtjson "github.com/cometbft/cometbft/libs/json"
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
	cmd.AddCommand(genesisValidateCmd(), genesisShowCmd(), genesisAddValidatorCmd())
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

// genesisAddValidatorCmd adds a validator to a genesis that already exists.
//
// Without this a network can only ever start with one validator, because
// `init --with-genesis` writes the operator it was given and nothing can add a
// second. A one-validator chain is not a network: it cannot lose a node, it
// cannot disagree, and nothing it demonstrates about consensus is worth much.
//
// The flow for a multi-validator network is:
//
//	node 1:  yozexad init v1 --with-genesis --operator-key v1 ...
//	node 2:  yozexad init v2                          (no genesis)
//	         yozexad genesis add-validator \
//	             --genesis <v1's genesis.json> \
//	             --operator <v2's operator address> \
//	             --consensus-pubkey <printed by v2's init> \
//	             --moniker v2
//	then copy the genesis to every node.
//
// The result is validated before it is written, so a genesis that would break
// the supply cap or duplicate a validator is refused rather than saved.
func genesisAddValidatorCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "add-validator",
		Short: "add a validator to an existing genesis file",
		RunE: func(cmd *cobra.Command, args []string) error {
			home, _ := cmd.Flags().GetString("home")
			path, _ := cmd.Flags().GetString("genesis")
			if path == "" {
				path = filepath.Join(home, "config", "genesis.json")
			}
			operatorRaw, _ := cmd.Flags().GetString("operator")
			consPubKey, _ := cmd.Flags().GetString("consensus-pubkey")
			moniker, _ := cmd.Flags().GetString("moniker")
			stakeYZXA, _ := cmd.Flags().GetInt64("self-delegation")
			balanceYZXA, _ := cmd.Flags().GetInt64("balance")
			commissionBps, _ := cmd.Flags().GetUint32("commission-bps")
			maxCommissionBps, _ := cmd.Flags().GetUint32("max-commission-bps")

			if operatorRaw == "" || consPubKey == "" || moniker == "" {
				return fmt.Errorf("--operator, --consensus-pubkey and --moniker are all required")
			}
			operator, err := types.ParseAddress(operatorRaw)
			if err != nil {
				return fmt.Errorf("--operator: %w", err)
			}
			if stakeYZXA <= 0 {
				return fmt.Errorf("--self-delegation must be positive")
			}
			// The operator has to be able to pay a fee after bonding its
			// stake, or its first transaction fails and the node looks broken
			// for a reason that has nothing to do with consensus.
			if balanceYZXA <= 0 {
				return fmt.Errorf("--balance must be positive: an operator with no spendable balance cannot pay a fee")
			}

			g, doc, err := loadGenesis(path)
			if err != nil {
				return err
			}
			for _, v := range g.Validators {
				if v.Operator == operator {
					return fmt.Errorf("%s is already a validator in this genesis", operator)
				}
				if v.ConsensusPubKey == consPubKey {
					return fmt.Errorf("consensus key %s is already used by validator %q", consPubKey, v.Moniker)
				}
				if v.Moniker == moniker {
					return fmt.Errorf("moniker %q is already taken in this genesis", moniker)
				}
			}
			for _, a := range g.Accounts {
				if a.Address == operator {
					return fmt.Errorf("%s already has a genesis account; "+
						"give the validator its own operator address", operator)
				}
			}

			g.Accounts = append(g.Accounts, app.GenesisAccount{
				Address: operator,
				Balance: types.MustAmount(types.YZXA(balanceYZXA)),
				Label:   moniker + " operator",
			})
			g.Validators = append(g.Validators, app.GenesisValidator{
				Operator:          operator,
				ConsensusPubKey:   consPubKey,
				Moniker:           moniker,
				SelfDelegation:    types.MustAmount(types.YZXA(stakeYZXA)),
				CommissionBps:     commissionBps,
				MaxCommissionBps:  maxCommissionBps,
				MinSelfDelegation: types.MustAmount(types.YZXA(1)),
			})

			if err := writeGenesisPreservingTime(path, g, doc); err != nil {
				return err
			}
			fmt.Printf("added validator %q to %s\n", moniker, path)
			fmt.Printf("  operator:        %s\n", operator)
			fmt.Printf("  self-delegation: %d YZXA\n", stakeYZXA)
			fmt.Printf("  balance:         %d YZXA\n", balanceYZXA)
			fmt.Printf("  validators now:  %d\n", len(g.Validators))
			fmt.Printf("\nCopy this genesis to every node before starting the network.\n")
			return nil
		},
	}
	cmd.Flags().String("genesis", "", "path to the genesis file (default: <home>/config/genesis.json)")
	cmd.Flags().String("operator", "", "the validator's operator account address (yzx1…)")
	cmd.Flags().String("consensus-pubkey", "", "base64 ed25519 consensus key, printed by `yozexad init`")
	cmd.Flags().String("moniker", "", "the validator's name")
	cmd.Flags().Int64("self-delegation", 100_000, "stake bonded at genesis, in YZXA")
	cmd.Flags().Int64("balance", 200_000, "spendable balance for the operator, in YZXA")
	cmd.Flags().Uint32("commission-bps", 1_000, "commission in basis points (1000 = 10%)")
	cmd.Flags().Uint32("max-commission-bps", 2_000, "maximum commission the validator may ever set")
	return cmd
}

// writeGenesisPreservingTime rewrites a genesis in place, keeping the genesis
// time it already had. Regenerating it would give each node a different start
// time and they would never agree on the first block.
func writeGenesisPreservingTime(path string, g app.Genesis, doc *cmttypes.GenesisDoc) error {
	g.GenesisTime = doc.GenesisTime
	g.ChainID = doc.ChainID
	if err := g.Validate(); err != nil {
		return fmt.Errorf("refusing to write an invalid genesis: %w", err)
	}
	appState, err := json.Marshal(g)
	if err != nil {
		return err
	}
	doc.AppState = appState
	raw, err := cmtjson.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
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
