// Command yozexa is the YOZEXA command line wallet and query tool.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/yozexa/yozexa/chain/client"
	"github.com/yozexa/yozexa/chain/keyring"
)

func main() {
	if err := rootCmd().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func rootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "yozexa",
		Short: "YOZEXA command line wallet",
		Long: `yozexa manages keys and sends transactions on the YOZEXA Network.

Private keys are stored encrypted with scrypt and XChaCha20-Poly1305 and are
never written in plaintext. Every transaction is signed locally: the node you
talk to never sees a key.`,
		SilenceUsage: true,
	}
	root.PersistentFlags().String("home", defaultHome(), "home directory holding the keyring")
	root.PersistentFlags().String("node", defaultNode(), "YOZEXA node API address")
	root.PersistentFlags().String("chain-id", "", "chain id (read from the node when empty)")

	root.AddCommand(keysCmd(), txCmd(), queryCmd(), supplyCmd())
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
	return filepath.Join(home, ".yozexa")
}

func defaultNode() string {
	if n := os.Getenv("YOZEXA_NODE"); n != "" {
		return n
	}
	return "127.0.0.1:1717"
}

func openKeyring(cmd *cobra.Command) (*keyring.Keyring, error) {
	home, _ := cmd.Flags().GetString("home")
	return keyring.Open(filepath.Join(home, "keyring"))
}

func newClient(cmd *cobra.Command) *client.Client {
	node, _ := cmd.Flags().GetString("node")
	return client.New(node)
}

// passphrase resolves the keyring passphrase, preferring the environment so it
// does not land in shell history or a process listing.
func passphrase(cmd *cobra.Command) (string, error) {
	if p := os.Getenv("YOZEXA_PASSPHRASE"); p != "" {
		return p, nil
	}
	p, _ := cmd.Flags().GetString("passphrase")
	if p == "" {
		return "", fmt.Errorf(
			"a keyring passphrase is required: set YOZEXA_PASSPHRASE or pass --passphrase")
	}
	return p, nil
}
