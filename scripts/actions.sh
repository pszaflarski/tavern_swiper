#!/usr/bin/env bash
set -e

# actions.sh — Automation script to build and test LLM/Image containers without stopping for prompts.
# Usage:
#   bash scripts/actions.sh [z-image-omni-comfyui|flux2-klein-comfyui|omnigen-comfyui] [build|test|all]

TARGET="${1:-z-image-omni-comfyui}"
ACTION="${2:-all}"

echo "=== Executing actions for target: ${TARGET} (action: ${ACTION}) ==="
.venv/bin/python3 scripts/actions.py "${TARGET}" "${ACTION}"
