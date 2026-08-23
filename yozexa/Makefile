# YOZEXA monorepo.
#
#   make build      build everything
#   make test       run every test suite
#   make devnet     bring up the whole stack locally
#   make check      what CI runs, locally

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

.PHONY: help build test check lint devnet devnet-down devnet-status devnet-reset \
        chain chain-test fuzz js js-test test-e2e test-consensus \
        multinode multinode-down clean

help:
	@echo "YOZEXA"
	@echo
	@echo "  make build          build the chain binaries and every JavaScript package"
	@echo "  make test           run every test suite"
	@echo "  make test-e2e       drive the wallet in a browser against a running devnet"
	@echo "  make test-consensus build a 4-validator network and test consensus against it"
	@echo "  make multinode      start a 4-validator network"
	@echo "  make multinode-down stop it"
	@echo "  make check          formatting, vet, typecheck and tests — what CI runs"
	@echo "  make fuzz           a short fuzzing pass over the parsers and state machine"
	@echo "  make devnet         start the whole stack against a local chain"
	@echo "  make devnet-status  show what is running"
	@echo "  make devnet-down    stop it"
	@echo "  make devnet-reset   wipe the chain data and start fresh"
	@echo
	@echo "  Tests that need PostgreSQL skip themselves when DATABASE_URL is unset."

build: chain js

chain:
	$(MAKE) -C chain build

js:
	npm install --no-audit --no-fund
	npm run build

test: chain-test js-test

chain-test:
	$(MAKE) -C chain test

js-test:
	npm test

# The wallet is client-rendered, so it is verified by driving a browser against
# a running devnet. Skips itself when the devnet or a Chromium is missing.
test-e2e:
	npm run test:e2e --workspace @yozexa/wallet-web

# Consensus properties only exist with a real validator set: agreement, block
# replication, surviving a lost validator, halting without two thirds,
# recovering, and syncing a new node from genesis. Builds its own network.
test-consensus:
	./scripts/consensus-test.sh

multinode:
	./scripts/multinode.sh up

multinode-down:
	./scripts/multinode.sh down

fuzz:
	$(MAKE) -C chain fuzz

lint:
	$(MAKE) -C chain lint
	npm run typecheck

check: lint test

devnet:
	./scripts/devnet.sh up

devnet-down:
	./scripts/devnet.sh down

devnet-status:
	./scripts/devnet.sh status

devnet-reset:
	./scripts/devnet.sh reset

clean:
	$(MAKE) -C chain clean
	rm -rf build node_modules */node_modules */dist */.next wallet/web/.next
