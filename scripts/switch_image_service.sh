#!/bin/bash
# ==============================================================================
# GPU Service Switcher (Quotas: 1 active L4 GPU instance)
# Usage:
#   bash scripts/switch_image_service.sh flux
#   bash scripts/switch_image_service.sh z-image
# ==============================================================================
set -e

PROJECT_ID=${PROJECT_ID:-"tavern-swiper-dev"}
REGION=${REGION:-"us-central1"}
TARGET=$1

if [ "$TARGET" == "flux" ]; then
    echo "=== Switching active GPU service to FLUX.1 ==="
    echo "1. Disabling external traffic for z-image-comfyui-dev..."
    gcloud run services update z-image-comfyui-dev \
        --project="$PROJECT_ID" \
        --region="$REGION" \
        --ingress=internal 2>/dev/null || true

    echo "2. Enabling flux-comfyui-dev (ingress=all)..."
    gcloud run services update flux-comfyui-dev \
        --project="$PROJECT_ID" \
        --region="$REGION" \
        --ingress=all
    echo "SUCCESS: FLUX.1 is now active on the L4 GPU quota!"

elif [ "$TARGET" == "z-image" ]; then
    echo "=== Switching active GPU service to Z-Image ==="
    echo "1. Disabling external traffic for flux-comfyui-dev..."
    gcloud run services update flux-comfyui-dev \
        --project="$PROJECT_ID" \
        --region="$REGION" \
        --ingress=internal 2>/dev/null || true

    echo "2. Enabling z-image-comfyui-dev (ingress=all)..."
    gcloud run services update z-image-comfyui-dev \
        --project="$PROJECT_ID" \
        --region="$REGION" \
        --ingress=all
    echo "SUCCESS: Z-Image is now active on the L4 GPU quota!"

else
    echo "Usage: bash scripts/switch_image_service.sh [flux|z-image]"
    exit 1
fi
