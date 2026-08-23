package rpc

import (
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sort"
	"strings"

	"github.com/yozexa/yozexa/chain/app"
	"github.com/yozexa/yozexa/chain/types"
)

// Prometheus metrics for the application.
//
// CometBFT exposes its own metrics for consensus, p2p and the mempool. Those
// say whether the node is participating; they say nothing about whether the
// money is right. These are the application's own, and the one that matters
// most is `yozexa_invariant_ok`: if any of those falls to 0, the chain's own
// accounting no longer adds up and an operator has to know within seconds, not
// at the next audit.
//
// Prometheus stores every sample as a float64, which cannot hold a base-unit
// figure exactly — 10,000,000 YZXA is 10^25 ayzxa, far past the 2^53 where
// float64 stops counting integers one at a time. Amounts here are therefore
// published in whole YZXA, where float64 has precision to spare, and every
// HELP line points at the endpoint that serves the exact integer. A monitoring
// system is for noticing a change; /v1/supply is for reconciling one.

// metric is one exported sample.
type metric struct {
	name   string
	help   string
	kind   string // "gauge" or "counter"
	labels map[string]string
	value  float64
}

func (s *Server) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	var out []metric

	add := func(name, help, kind string, value float64, labels map[string]string) {
		out = append(out, metric{name: name, help: help, kind: kind, value: value, labels: labels})
	}

	// --- supply ---------------------------------------------------------
	if raw, err := s.query("supply/verify"); err == nil {
		var v struct {
			MaximumSupply     string `json:"maximum_supply"`
			CurrentMinted     string `json:"current_minted"`
			Burned            string `json:"burned"`
			Circulating       string `json:"circulating"`
			RemainingMintable string `json:"remaining_mintable"`
			SumOfAllBalances  string `json:"sum_of_all_balances"`
			ConservationOK    bool   `json:"conservation_ok"`
			EmissionReserve   string `json:"emission_reserve"`
			EmissionEmitted   string `json:"emission_emitted"`
			VestingLocked     string `json:"vesting_locked"`
		}
		if json.Unmarshal(raw, &v) == nil {
			add("yozexa_supply_max_yzxa",
				"The hard cap, in YZXA. Exact integer at /v1/supply.", "gauge", yzxa(v.MaximumSupply), nil)
			add("yozexa_supply_minted_yzxa",
				"Total ever minted, in YZXA. Exact integer at /v1/supply.", "counter", yzxa(v.CurrentMinted), nil)
			add("yozexa_supply_burned_yzxa",
				"Total permanently burned, in YZXA. Exact integer at /v1/supply.", "counter", yzxa(v.Burned), nil)
			add("yozexa_supply_circulating_yzxa",
				"Minted minus burned, in YZXA. Exact integer at /v1/supply.", "gauge", yzxa(v.Circulating), nil)
			add("yozexa_supply_remaining_mintable_yzxa",
				"How much may still be minted before the cap, in YZXA.", "gauge", yzxa(v.RemainingMintable), nil)
			add("yozexa_supply_sum_of_balances_yzxa",
				"Every account and module balance added up, in YZXA. Must equal circulating supply.",
				"gauge", yzxa(v.SumOfAllBalances), nil)
			add("yozexa_supply_conservation_ok",
				"1 when the sum of all balances equals circulating supply. 0 means tokens exist that nothing accounts for.",
				"gauge", boolValue(v.ConservationOK), nil)
			add("yozexa_emission_reserve_yzxa",
				"The total the emission schedule may ever pay out, in YZXA.", "gauge", yzxa(v.EmissionReserve), nil)
			add("yozexa_emission_emitted_yzxa",
				"Emitted so far by the block reward schedule, in YZXA.", "counter", yzxa(v.EmissionEmitted), nil)
			add("yozexa_vesting_locked_yzxa",
				"Still locked by genesis vesting schedules, in YZXA.", "gauge", yzxa(v.VestingLocked), nil)
		}
	}

	// --- invariants -----------------------------------------------------
	//
	// One series per invariant, so an alert can name which one broke rather
	// than only that something did.
	if raw, err := s.query("invariants"); err == nil {
		var v struct {
			OK      bool `json:"ok"`
			Results []struct {
				Name string `json:"name"`
				OK   bool   `json:"ok"`
			} `json:"results"`
		}
		if json.Unmarshal(raw, &v) == nil {
			add("yozexa_invariants_ok",
				"1 when every protocol invariant holds. Alert on this reaching 0.",
				"gauge", boolValue(v.OK), nil)
			for _, r := range v.Results {
				add("yozexa_invariant_ok",
					"1 when this named protocol invariant holds.",
					"gauge", boolValue(r.OK), map[string]string{"invariant": r.Name})
			}
		}
	}

	// --- fee market -----------------------------------------------------
	if raw, err := s.query("feemarket"); err == nil {
		var v struct {
			BaseFee string `json:"base_fee"`
			Tiers   []struct {
				Name     string `json:"name"`
				GasPrice string `json:"gas_price"`
			} `json:"tiers"`
		}
		if json.Unmarshal(raw, &v) == nil {
			add("yozexa_base_fee_ayzxa",
				"The current EIP-1559 base fee per unit of gas, in ayzxa. Small enough for a float64.",
				"gauge", plainFloat(v.BaseFee), nil)
			for _, t := range v.Tiers {
				add("yozexa_fee_tier_gas_price_ayzxa",
					"Gas price offered for each fee tier, in ayzxa.",
					"gauge", plainFloat(t.GasPrice), map[string]string{"tier": t.Name})
			}
		}
	}

	// --- node and network ------------------------------------------------
	application := s.node.App()
	application.Lock()
	chainID := application.ChainID()
	application.Unlock()

	if cn := s.node.CometNode(); cn != nil {
		add("yozexa_block_height", "The height of the latest committed block.",
			"gauge", float64(cn.BlockStore().Height()), nil)
		add("yozexa_peers", "Peers this node is currently connected to. Zero means it is isolated.",
			"gauge", float64(cn.Switch().Peers().Size()), nil)
		catchingUp := 0.0
		if cn.ConsensusReactor().WaitSync() {
			catchingUp = 1
		}
		add("yozexa_catching_up", "1 while this node is still replaying the chain rather than following it.",
			"gauge", catchingUp, nil)
	}

	if raw, err := s.query("validators"); err == nil {
		var v struct {
			Validators []struct {
				Active     bool `json:"active"`
				Jailed     bool `json:"jailed"`
				Tombstoned bool `json:"tombstoned"`
			} `json:"validators"`
		}
		if json.Unmarshal(raw, &v) == nil {
			var active, jailed, tombstoned float64
			for _, val := range v.Validators {
				if val.Active {
					active++
				}
				if val.Jailed {
					jailed++
				}
				if val.Tombstoned {
					tombstoned++
				}
			}
			add("yozexa_validators_active", "Validators currently in the active set.", "gauge", active, nil)
			add("yozexa_validators_jailed", "Validators jailed for downtime.", "gauge", jailed, nil)
			add("yozexa_validators_tombstoned",
				"Validators permanently removed for double signing. This only ever goes up.",
				"gauge", tombstoned, nil)
		}
	}

	// A single series carrying the version and chain id as labels, which is
	// how an operator spots a node running the wrong build or the wrong chain.
	add("yozexa_node_info", "Always 1. The labels carry the node version and chain id.",
		"gauge", 1, map[string]string{"version": app.Version, "chain_id": chainID})

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write([]byte(render(out)))
}

// render writes the Prometheus text exposition format. HELP and TYPE are
// emitted once per metric name, before its first sample, as the format
// requires.
func render(metrics []metric) string {
	var b strings.Builder
	seen := map[string]bool{}
	for _, m := range metrics {
		if !seen[m.name] {
			fmt.Fprintf(&b, "# HELP %s %s\n", m.name, m.help)
			fmt.Fprintf(&b, "# TYPE %s %s\n", m.name, m.kind)
			seen[m.name] = true
		}
		b.WriteString(m.name)
		if len(m.labels) > 0 {
			keys := make([]string, 0, len(m.labels))
			for k := range m.labels {
				keys = append(keys, k)
			}
			sort.Strings(keys) // stable output, so a diff of two scrapes is readable
			parts := make([]string, 0, len(keys))
			for _, k := range keys {
				// %s, not %q: escapeLabel has already escaped the three
				// characters the format cares about, and %q would escape the
				// backslashes it added, so a value of a"b would reach the
				// scraper as a\"b.
				parts = append(parts, fmt.Sprintf("%s=\"%s\"", k, escapeLabel(m.labels[k])))
			}
			b.WriteString("{" + strings.Join(parts, ",") + "}")
		}
		fmt.Fprintf(&b, " %s\n", formatValue(m.value))
	}
	return b.String()
}

func escapeLabel(v string) string {
	return strings.NewReplacer("\\", "\\\\", "\n", "\\n", "\"", "\\\"").Replace(v)
}

// formatValue prints a float without an exponent where it can, so a scrape is
// readable by eye as well as by a scraper.
func formatValue(v float64) string {
	if v == float64(int64(v)) && v < 1e15 && v > -1e15 {
		return fmt.Sprintf("%d", int64(v))
	}
	return fmt.Sprintf("%g", v)
}

// yzxa converts a base-unit decimal string to whole-and-fractional YZXA.
//
// The division happens in big.Float rather than by parsing the string as a
// float64 first, so the only precision lost is the last few digits of a
// figure Prometheus could not have stored anyway.
func yzxa(baseUnits string) float64 {
	n, ok := new(big.Int).SetString(strings.TrimSpace(baseUnits), 10)
	if !ok {
		return 0
	}
	f := new(big.Float).SetInt(n)
	f.Quo(f, new(big.Float).SetInt(types.OneYZXA()))
	out, _ := f.Float64()
	return out
}

// plainFloat parses a small integer string that fits a float64 exactly.
func plainFloat(s string) float64 {
	n, ok := new(big.Int).SetString(strings.TrimSpace(s), 10)
	if !ok {
		return 0
	}
	out, _ := new(big.Float).SetInt(n).Float64()
	return out
}

func boolValue(b bool) float64 {
	if b {
		return 1
	}
	return 0
}
