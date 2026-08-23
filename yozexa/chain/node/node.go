// Package node wires the YOZEXA application into CometBFT.
//
// CometBFT owns consensus, peer-to-peer networking, the block store, evidence
// collection and the mempool. This package owns nothing of the sort: it starts
// CometBFT with the YOZEXA state machine attached, which is exactly the point.
// A network that settles money should not be running a consensus algorithm
// somebody wrote for it from scratch.
package node

import (
	"fmt"
	"os"
	"path/filepath"

	cfg "github.com/cometbft/cometbft/config"
	cmtflags "github.com/cometbft/cometbft/libs/cli/flags"
	cmtlog "github.com/cometbft/cometbft/libs/log"
	cmtnode "github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	"github.com/cometbft/cometbft/proxy"
	"github.com/spf13/viper"

	dbm "github.com/cometbft/cometbft-db"

	"github.com/yozexa/yozexa/chain/app"
)

// Config describes how to start a node.
type Config struct {
	// HomeDir holds config/, data/ and the application database.
	HomeDir string
	// LogLevel is a CometBFT log level string, e.g. "info" or "debug".
	LogLevel string
	// SkipInvariantChecks disables the per-block invariant sweep. Never set
	// this on a network carrying value.
	SkipInvariantChecks bool
}

// Node is a running YOZEXA node.
type Node struct {
	cmt    *cmtnode.Node
	app    *app.App
	db     dbm.DB
	logger cmtlog.Logger
}

// App exposes the application, so the RPC layer can query state directly.
func (n *Node) App() *app.App { return n.app }

// CometNode exposes the consensus node for block and transaction queries.
func (n *Node) CometNode() *cmtnode.Node { return n.cmt }

// New builds a node from a home directory that `yozexad init` has prepared.
func New(c Config) (*Node, error) {
	configPath := filepath.Join(c.HomeDir, "config", "config.toml")
	if _, err := os.Stat(configPath); err != nil {
		return nil, fmt.Errorf("no CometBFT config at %s: run `yozexad init` first", configPath)
	}

	// Read the operator's config.toml, rather than only checking that it
	// exists. Everything a node operator can set lives in that file — which
	// addresses to listen on, which peers to dial, consensus timeouts,
	// mempool limits, pruning. Starting from defaults and ignoring the file
	// makes all of it inert: two nodes on one machine both try to bind the
	// same port, and `persistent_peers` never dials anyone, so a network of
	// more than one validator cannot be assembled at all.
	config := cfg.DefaultConfig()
	v := viper.New()
	v.SetConfigFile(configPath)
	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read %s: %w", configPath, err)
	}
	if err := v.Unmarshal(config); err != nil {
		return nil, fmt.Errorf("parse %s: %w", configPath, err)
	}
	// SetRoot after unmarshalling: the file holds paths relative to the home
	// directory, and this is what turns them absolute.
	config.SetRoot(c.HomeDir)
	if err := config.ValidateBasic(); err != nil {
		return nil, fmt.Errorf("invalid node config in %s: %w", configPath, err)
	}

	logger := cmtlog.NewTMLogger(cmtlog.NewSyncWriter(os.Stdout))
	level := c.LogLevel
	if level == "" {
		level = config.LogLevel
	}
	logger, err := cmtflags.ParseLogLevel(level, logger, cfg.DefaultLogLevel)
	if err != nil {
		return nil, fmt.Errorf("parse log level: %w", err)
	}

	appDB, err := dbm.NewDB("yozexa", dbm.GoLevelDBBackend, filepath.Join(c.HomeDir, "data"))
	if err != nil {
		return nil, fmt.Errorf("open application database: %w", err)
	}

	application, err := app.New(appDB, logger.With("module", "yozexa"), app.Options{
		SkipInvariantChecks: c.SkipInvariantChecks,
	})
	if err != nil {
		appDB.Close()
		return nil, fmt.Errorf("open application: %w", err)
	}

	pv := privval.LoadFilePV(
		config.PrivValidatorKeyFile(),
		config.PrivValidatorStateFile(),
	)
	nodeKey, err := p2p.LoadNodeKey(config.NodeKeyFile())
	if err != nil {
		appDB.Close()
		return nil, fmt.Errorf("load node key: %w", err)
	}

	cmt, err := cmtnode.NewNode(
		config,
		pv,
		nodeKey,
		proxy.NewLocalClientCreator(application),
		cmtnode.DefaultGenesisDocProviderFunc(config),
		cfg.DefaultDBProvider,
		cmtnode.DefaultMetricsProvider(config.Instrumentation),
		logger,
	)
	if err != nil {
		appDB.Close()
		return nil, fmt.Errorf("create CometBFT node: %w", err)
	}

	return &Node{cmt: cmt, app: application, db: appDB, logger: logger}, nil
}

// Start begins producing and validating blocks.
func (n *Node) Start() error { return n.cmt.Start() }

// Stop shuts the node down cleanly, flushing state to disk.
func (n *Node) Stop() error {
	if err := n.cmt.Stop(); err != nil {
		return err
	}
	n.cmt.Wait()
	return n.db.Close()
}
