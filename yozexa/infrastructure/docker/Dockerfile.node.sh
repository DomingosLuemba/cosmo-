#!/bin/sh
# Reference for building and running the node image. Not run by anything.
set -eu

# Build from the repository root, not from this directory: the build context
# must include chain/.
#   docker build -f infrastructure/docker/Dockerfile.node -t yozexa/node:0.1.0 .
#
# Initialise a home directory on the host first, so keys stay on the host and
# never enter an image layer:
#   docker run --rm -v yozexa-node:/home/nonroot/.yozexa yozexa/node:0.1.0 \
#     init my-node --network testnet
#
# Then run it:
#   docker run -d --name yozexa-node \
#     -v yozexa-node:/home/nonroot/.yozexa \
#     -p 127.0.0.1:1717:1717 -p 26656:26656 \
#     yozexa/node:0.1.0
#
# Never mount a validator's priv_validator_key.json into more than one running
# container. Two nodes signing with the same consensus key is double signing,
# and double signing is permanent.
