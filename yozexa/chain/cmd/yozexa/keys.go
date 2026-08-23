package main

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

func keysCmd() *cobra.Command {
	cmd := &cobra.Command{Use: "keys", Short: "manage YOZEXA account keys"}
	cmd.AddCommand(keysCreateCmd(), keysImportCmd(), keysListCmd(), keysShowCmd(), keysDeleteCmd())
	return cmd
}

func keysCreateCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "create [name]",
		Short: "create a new key and print its recovery phrase",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			kr, err := openKeyring(cmd)
			if err != nil {
				return err
			}
			pass, err := passphrase(cmd)
			if err != nil {
				return err
			}
			rec, mnemonic, err := kr.Create(args[0], pass)
			if err != nil {
				return err
			}
			fmt.Printf("key created\n")
			fmt.Printf("  name:    %s\n", rec.Name)
			fmt.Printf("  address: %s\n", rec.Address)
			fmt.Printf("  pubkey:  %s\n", rec.PubKey)
			fmt.Printf("\n%s\n", strings.Repeat("-", 72))
			fmt.Printf("RECOVERY PHRASE — write these 24 words down, on paper, offline.\n")
			fmt.Printf("Anyone who reads them controls this account. Nobody, including\n")
			fmt.Printf("YOZEXA Labs, can recover it for you if you lose them.\n")
			fmt.Printf("%s\n\n%s\n\n%s\n", strings.Repeat("-", 72), mnemonic, strings.Repeat("-", 72))
			return nil
		},
	}
	c.Flags().String("passphrase", "", "keyring passphrase (prefer YOZEXA_PASSPHRASE)")
	return c
}

func keysImportCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "import [name]",
		Short: "import a key from a BIP-39 recovery phrase",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			kr, err := openKeyring(cmd)
			if err != nil {
				return err
			}
			pass, err := passphrase(cmd)
			if err != nil {
				return err
			}
			mnemonic, _ := cmd.Flags().GetString("mnemonic")
			if mnemonic == "" {
				return fmt.Errorf("--mnemonic is required")
			}
			bip39Pass, _ := cmd.Flags().GetString("bip39-passphrase")
			rec, err := kr.Import(args[0], strings.TrimSpace(mnemonic), bip39Pass, pass)
			if err != nil {
				return err
			}
			fmt.Printf("key imported\n  name:    %s\n  address: %s\n", rec.Name, rec.Address)
			return nil
		},
	}
	c.Flags().String("mnemonic", "", "BIP-39 recovery phrase")
	c.Flags().String("bip39-passphrase", "", "optional BIP-39 passphrase (25th word)")
	c.Flags().String("passphrase", "", "keyring passphrase (prefer YOZEXA_PASSPHRASE)")
	return c
}

func keysListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "list keys in the keyring",
		RunE: func(cmd *cobra.Command, _ []string) error {
			kr, err := openKeyring(cmd)
			if err != nil {
				return err
			}
			records, err := kr.List()
			if err != nil {
				return err
			}
			if len(records) == 0 {
				fmt.Println("no keys in this keyring")
				return nil
			}
			for _, r := range records {
				fmt.Printf("%-20s %s\n", r.Name, r.Address)
			}
			return nil
		},
	}
}

func keysShowCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "show [name]",
		Short: "show a key's address and public key",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			kr, err := openKeyring(cmd)
			if err != nil {
				return err
			}
			r, err := kr.Get(args[0])
			if err != nil {
				return err
			}
			fmt.Printf("name:       %s\naddress:    %s\npubkey:     %s\nencryption: %s + %s\n",
				r.Name, r.Address, r.PubKey, r.KDF, r.Cipher)
			return nil
		},
	}
}

func keysDeleteCmd() *cobra.Command {
	c := &cobra.Command{
		Use:   "delete [name]",
		Short: "delete a key from the keyring",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			confirm, _ := cmd.Flags().GetBool("yes")
			if !confirm {
				return fmt.Errorf(
					"deleting a key is irreversible: without its recovery phrase the account is gone. Pass --yes to confirm")
			}
			kr, err := openKeyring(cmd)
			if err != nil {
				return err
			}
			if err := kr.Delete(args[0]); err != nil {
				return err
			}
			fmt.Printf("key %q deleted from this keyring\n", args[0])
			return nil
		},
	}
	c.Flags().Bool("yes", false, "confirm deletion")
	return c
}
