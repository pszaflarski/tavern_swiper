#!/bin/bash
# Generate Python code from .proto files
mkdir -p services/profiles/generated
PYTHON_CMD=${PYTHON_CMD:-python3}
$PYTHON_CMD -m grpc_tools.protoc \
    -I services/profiles/proto \
    --python_out=services/profiles/generated \
    --grpc_python_out=services/profiles/generated \
    services/profiles/proto/profile_events.proto

# Create __init__.py to make it a package
touch services/profiles/generated/__init__.py
echo "Protobuf code generated in services/profiles/generated/"
