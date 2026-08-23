package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/spf13/cobra"
)

func statusCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "status",
		Short: "show the status of a running node",
		RunE: func(cmd *cobra.Command, _ []string) error {
			api, _ := cmd.Flags().GetString("api")
			client := &http.Client{Timeout: 5 * time.Second}
			resp, err := client.Get("http://" + api + "/v1/status")
			if err != nil {
				return fmt.Errorf("cannot reach the node API at %s: %w", api, err)
			}
			defer resp.Body.Close()
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				return err
			}
			var pretty map[string]any
			if err := json.Unmarshal(body, &pretty); err != nil {
				fmt.Println(string(body))
				return nil
			}
			out, _ := json.MarshalIndent(pretty, "", "  ")
			fmt.Println(string(out))
			return nil
		},
	}
	cmd.Flags().String("api", "127.0.0.1:1717", "node API address")
	return cmd
}
