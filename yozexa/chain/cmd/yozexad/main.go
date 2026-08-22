// Command yozexad runs a YOZEXA Network node.
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/yozexa/yozexa/chain/app"
	"github.com/yozexa/yozexa/chain/node"
	"github.com/yozexa/yozexa/chain/rpc"
)

func main() {
	if err := rootCmd().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func rootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "yozexad",
		Short: "YOZEXA Network node",
		Long: `yozexad runs a node of the YOZEXA Network.

A node validates every block against the same rules as every other node,
including the invariants that guarantee the 10,000,000 YZXA supply cap. If
those invariants are ever violated the node halts rather than continuing on
state that is known to be wrong.`,
		SilenceUsage: true,
	}
	root.PersistentFlags().String("home", defaultHome(), "node home directory")

	root.AddCommand(
		initCmd(),
		startCmd(),
		statusCmd(),
		genesisCmd(),
		versionCmd(),
	)
	return root
}

func defaultHome() string {
	if h := os.Getenv("YOZEXA_HOME"); h != "" {
		return h
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".yozexa"
	}
	return home + "/.yozexa"
}

func versionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "print the node version",
		RunE: func(cmd *cobra.Command, _ []string) error {
			fmt.Printf("yozexad %s (app version %d)\n", app.Version, app.AppVersion)
			return nil
		},
	}
}

func startCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "start",
		Short: "start the node",
		RunE: func(cmd *cobra.Command, _ []string) error {
			home, _ := cmd.Flags().GetString("home")
			logLevel, _ := cmd.Flags().GetString("log-level")
			rpcAddr, _ := cmd.Flags().GetString("api")
			skipInvariants, _ := cmd.Flags().GetBool("skip-invariant-checks")

			if skipInvariants {
				fmt.Fprintln(os.Stderr,
					"WARNING: per-block invariant checks are disabled. This is for load testing only. "+
						"Never run a network that carries value with this flag.")
			}

			n, err := node.New(node.Config{
				HomeDir:             home,
				LogLevel:            logLevel,
				SkipInvariantChecks: skipInvariants,
			})
			if err != nil {
				return err
			}
			if err := n.Start(); err != nil {
				return fmt.Errorf("start node: %w", err)
			}
			fmt.Println("YOZEXA node started")

			var api *rpc.Server
			if rpcAddr != "" {
				api = rpc.New(n, rpcAddr)
				go func() {
					if err := api.Start(); err != nil {
						fmt.Fprintln(os.Stderr, "API server stopped:", err)
					}
				}()
				fmt.Printf("YOZEXA API listening on http://%s\n", rpcAddr)
			}

			sig := make(chan os.Signal, 1)
			signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
			<-sig

			fmt.Println("\nshutting down...")
			if api != nil {
				_ = api.Stop()
			}
			return n.Stop()
		},
	}
	cmd.Flags().String("log-level", "info", "log level")
	cmd.Flags().String("api", "127.0.0.1:1717", "address for the YOZEXA HTTP API (empty to disable)")
	cmd.Flags().Bool("skip-invariant-checks", false,
		"DANGEROUS: skip per-block invariant checks (load testing only)")
	return cmd
}
