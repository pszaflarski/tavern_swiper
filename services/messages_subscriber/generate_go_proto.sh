#!/bin/bash
# Generate Go code from .proto files
# Required: protoc, protoc-gen-go, protoc-gen-go-grpc

export PATH=$PATH:$(go env GOPATH)/bin

PROTO_SRC="../../services/discovery/proto/match_events.proto"
OUT_DIR="."

echo "Generating Go code from $PROTO_SRC..."

protoc -I ../../services/discovery/proto \
    --go_out=$OUT_DIR \
    --go_opt=paths=source_relative \
    --go-grpc_out=$OUT_DIR \
    --go-grpc_opt=paths=source_relative \
    $PROTO_SRC

echo "Go code generated successfully."
