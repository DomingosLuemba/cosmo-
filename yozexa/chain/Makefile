# YOZEXA chain build

BUILD_DIR ?= ../build
VERSION   := $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT    := $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)

# -trimpath and a fixed build id are the first two steps towards reproducible
# builds: the same source at the same commit produces the same binary on any
# machine, which is what makes a signed release checkable by someone else.
GO_BUILD_FLAGS := -trimpath -ldflags "-X main.commit=$(COMMIT) -buildid="

.PHONY: all build test lint fmt vet clean install fuzz bench

all: build

build:
	@mkdir -p $(BUILD_DIR)
	go build $(GO_BUILD_FLAGS) -o $(BUILD_DIR)/yozexad ./cmd/yozexad
	go build $(GO_BUILD_FLAGS) -o $(BUILD_DIR)/yozexa  ./cmd/yozexa
	@echo "built $(BUILD_DIR)/yozexad and $(BUILD_DIR)/yozexa"

install:
	go install $(GO_BUILD_FLAGS) ./cmd/yozexad ./cmd/yozexa

test:
	go test ./... -count=1

test-race:
	go test ./... -race -count=1

# The fuzz targets run continuously in CI on a schedule; this is the short
# local pass a contributor runs before pushing.
fuzz:
	go test ./tx/... -run=Fuzz -fuzz=FuzzDecodeTx      -fuzztime=30s
	go test ./tx/... -run=Fuzz -fuzz=FuzzParseAmount   -fuzztime=30s
	go test ./store/... -run=Fuzz -fuzz=FuzzStoreProof -fuzztime=30s
	go test ./app/... -run=Fuzz -fuzz=FuzzStateMachine -fuzztime=60s

bench:
	go test ./... -run=XXX -bench=. -benchmem

fmt:
	gofmt -w .

vet:
	go vet ./...

lint: fmt vet
	@gofmt -l . | grep . && echo "files need formatting" && exit 1 || echo "formatting OK"

clean:
	rm -rf $(BUILD_DIR)
