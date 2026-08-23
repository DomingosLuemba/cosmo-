package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtos "github.com/cometbft/cometbft/libs/os"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/spf13/cobra"

	"github.com/yozexa/yozexa/chain/app"
	"github.com/yozexa/yozexa/chain/keyring"
	"github.com/yozexa/yozexa/chain/state"
	"github.com/yozexa/yozexa/chain/types"
)

// Chain id prefixes. A wallet must never be able to confuse a test network
// with the one that carries value, so the network kind is part of the chain id
// itself and the chain id is part of every signature.
const (
	ChainIDLocalnet    = "yozexa-localnet-1"
	ChainIDDevnet      = "yozexa-devnet-1"
	ChainIDTestnet     = "yozexa-testnet-1"
	ChainIDAdversarial = "yozexa-adversarial-1"
	ChainIDMainnet     = "yozexa-1"
)

func initCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "init [moniker]",
		Short: "initialise a node home directory and, optionally, a genesis file",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			home, _ := cmd.Flags().GetString("home")
			chainID, _ := cmd.Flags().GetString("chain-id")
			network, _ := cmd.Flags().GetString("network")
			withGenesis, _ := cmd.Flags().GetBool("with-genesis")
			operatorKeyName, _ := cmd.Flags().GetString("operator-key")
			passphrase, _ := cmd.Flags().GetString("passphrase")
			moniker := args[0]

			if chainID == "" {
				var err error
				chainID, err = chainIDForNetwork(network)
				if err != nil {
					return err
				}
			}

			config := cfg.DefaultConfig()
			config.SetRoot(home)
			config.Moniker = moniker
			// Two to four seconds is the target the network is designed
			// around. The real figure is whatever benchmarking measures on
			// the deployed validator set; this is the starting point.
			config.Consensus.TimeoutCommit = 2 * time.Second
			config.RPC.ListenAddress = "tcp://127.0.0.1:26657"
			config.P2P.AddrBookStrict = false
			config.LogLevel = "info"

			cfg.EnsureRoot(home)
			cfg.WriteConfigFile(filepath.Join(home, "config", "config.toml"), config)

			pvKeyFile := config.PrivValidatorKeyFile()
			pvStateFile := config.PrivValidatorStateFile()
			var pv *privval.FilePV
			if cmtos.FileExists(pvKeyFile) {
				pv = privval.LoadFilePV(pvKeyFile, pvStateFile)
				fmt.Printf("using existing validator key %s\n", pvKeyFile)
			} else {
				pv = privval.GenFilePV(pvKeyFile, pvStateFile)
				pv.Save()
				fmt.Printf("generated validator consensus key %s\n", pvKeyFile)
			}

			nodeKeyFile := config.NodeKeyFile()
			if !cmtos.FileExists(nodeKeyFile) {
				if _, err := p2p.LoadOrGenNodeKey(nodeKeyFile); err != nil {
					return fmt.Errorf("generate node key: %w", err)
				}
			}

			consPub, ok := pv.Key.PubKey.(ed25519.PubKey)
			if !ok {
				return fmt.Errorf("unexpected consensus key type %T", pv.Key.PubKey)
			}
			consPubB64 := base64.StdEncoding.EncodeToString(consPub.Bytes())

			fmt.Printf("\nnode initialised\n")
			fmt.Printf("  home:            %s\n", home)
			fmt.Printf("  moniker:         %s\n", moniker)
			fmt.Printf("  chain id:        %s\n", chainID)
			fmt.Printf("  node id:         %s\n", nodeIDOf(nodeKeyFile))
			fmt.Printf("  consensus key:   %s\n", consPubB64)

			if !withGenesis {
				fmt.Printf("\nNo genesis was written. Obtain the network's genesis.json and place it at\n  %s\n",
					config.GenesisFile())
				return nil
			}

			if operatorKeyName == "" {
				return fmt.Errorf("--operator-key is required when writing a genesis file")
			}
			if passphrase == "" {
				return fmt.Errorf("--passphrase is required to read the operator key")
			}
			kr, err := keyring.Open(filepath.Join(home, "keyring"))
			if err != nil {
				return err
			}
			operator, err := kr.Address(operatorKeyName)
			if err != nil {
				return err
			}

			genesisTime := time.Now().UTC().Truncate(time.Second)
			g, err := buildGenesis(chainID, genesisTime, operator, consPubB64, moniker, network)
			if err != nil {
				return err
			}
			if err := writeGenesis(config.GenesisFile(), g); err != nil {
				return err
			}
			fmt.Printf("  genesis:         %s\n", config.GenesisFile())
			printAllocation(g)
			return nil
		},
	}
	cmd.Flags().String("chain-id", "", "explicit chain id (overrides --network)")
	cmd.Flags().String("network", "localnet",
		"network kind: localnet, devnet, testnet, adversarial, mainnet")
	cmd.Flags().Bool("with-genesis", false, "also write a genesis file for a new network")
	cmd.Flags().String("operator-key", "", "keyring name of the validator operator account")
	cmd.Flags().String("passphrase", "", "keyring passphrase (prefer YOZEXA_PASSPHRASE)")
	return cmd
}

func chainIDForNetwork(network string) (string, error) {
	switch network {
	case "localnet":
		return ChainIDLocalnet, nil
	case "devnet":
		return ChainIDDevnet, nil
	case "testnet":
		return ChainIDTestnet, nil
	case "adversarial":
		return ChainIDAdversarial, nil
	case "mainnet":
		return ChainIDMainnet, nil
	default:
		return "", fmt.Errorf("unknown network %q (want localnet, devnet, testnet, adversarial or mainnet)", network)
	}
}

func nodeIDOf(nodeKeyFile string) string {
	nk, err := p2p.LoadNodeKey(nodeKeyFile)
	if err != nil {
		return "<unknown>"
	}
	return string(nk.ID())
}

// buildGenesis assembles a genesis document for a new network.
//
// For every network kind except mainnet it funds the operator account so a
// single machine can start producing blocks. A mainnet genesis is deliberately
// NOT generated by this command: it is assembled from the real allocation and
// reviewed by more than one person, per docs/MAINNET_CHECKLIST.md.
func buildGenesis(
	chainID string,
	genesisTime time.Time,
	operator types.Address,
	consPubB64, moniker, network string,
) (app.Genesis, error) {
	if network == "mainnet" {
		return app.Genesis{}, fmt.Errorf(
			"a mainnet genesis is not generated by this command; see docs/MAINNET_CHECKLIST.md")
	}
	selfDelegation := types.YZXA(100_000)
	operatorBalance := types.YZXA(200_000)

	return app.Genesis{
		ChainID:     chainID,
		GenesisTime: genesisTime,
		Params:      state.DefaultParams(),
		Accounts: []app.GenesisAccount{{
			Address: operator,
			Balance: types.MustAmount(operatorBalance),
			Label:   moniker + " operator",
		}},
		Validators: []app.GenesisValidator{{
			Operator:          operator,
			ConsensusPubKey:   consPubB64,
			Moniker:           moniker,
			SelfDelegation:    types.MustAmount(selfDelegation),
			CommissionBps:     1_000, // 10%
			MaxCommissionBps:  2_000, // 20%
			MinSelfDelegation: types.MustAmount(types.YZXA(1)),
		}},
		FundAllocations: true,
	}, nil
}

// writeGenesis writes a CometBFT genesis file carrying the YOZEXA app state.
func writeGenesis(path string, g app.Genesis) error {
	if err := g.Validate(); err != nil {
		return fmt.Errorf("refusing to write an invalid genesis: %w", err)
	}
	appState, err := json.Marshal(g)
	if err != nil {
		return err
	}
	doc := cmttypes.GenesisDoc{
		GenesisTime:     g.GenesisTime,
		ChainID:         g.ChainID,
		InitialHeight:   1,
		ConsensusParams: cmttypes.DefaultConsensusParams(),
		AppState:        appState,
	}
	// Block size is bounded so that a single block cannot be used to force
	// every node on the network to process an unbounded amount of data.
	doc.ConsensusParams.Block.MaxBytes = 4 * 1024 * 1024
	doc.ConsensusParams.Block.MaxGas = int64(g.Params.MaxBlockGas)
	doc.ConsensusParams.Evidence.MaxAgeNumBlocks = 200_000
	doc.ConsensusParams.Evidence.MaxAgeDuration = 21 * 24 * time.Hour

	if err := doc.ValidateAndComplete(); err != nil {
		return fmt.Errorf("invalid CometBFT genesis: %w", err)
	}
	raw, err := cmtjson.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
}

func printAllocation(g app.Genesis) {
	total, err := g.TotalGenesisMint()
	if err != nil {
		return
	}
	fmt.Printf("\ngenesis allocation\n")
	fmt.Printf("  hard cap:              %s YZXA\n", types.FormatYZXA(types.MaxSupplyCopy()))
	fmt.Printf("  minted at genesis:     %s YZXA\n", types.FormatYZXA(total))
	fmt.Printf("  reserved for emission: %s YZXA\n", types.FormatYZXA(state.EmissionReserve()))
	fmt.Printf("  never mintable:        the remainder, forever\n")
}
