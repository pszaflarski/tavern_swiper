#!/bin/bash
set -e

PORT=${PORT:-8080}

echo "=== FLUX.1 Realism + PuLID Container Starting ==="
echo "PORT=${PORT}"

# Point Hugging Face cache to GCS volume so EVA02-CLIP weights are read from disk
export HF_HOME=/models/comfyui/hf_cache

# Create temp directories for ComfyUI input/output
mkdir -p /tmp/comfyui_input /tmp/comfyui_output

# Symlink models for ComfyUI custom nodes that expect default paths
mkdir -p /ComfyUI/models
if [ -d /models/comfyui/insightface ]; then
    rm -rf /ComfyUI/models/insightface
    ln -sfn /models/comfyui/insightface /ComfyUI/models/insightface
fi
if [ -d /models/comfyui/pulid ]; then
    rm -rf /ComfyUI/models/pulid
    ln -sfn /models/comfyui/pulid /ComfyUI/models/pulid
fi
if [ -d /models/comfyui/clip_vision ]; then
    rm -rf /ComfyUI/models/clip_vision
    ln -sfn /models/comfyui/clip_vision /ComfyUI/models/clip_vision
fi

echo "Starting Headless ComfyUI on 127.0.0.1:8188..."
python3 /ComfyUI/main.py \
    --listen 127.0.0.1 \
    --port 8188 \
    --highvram \
    --disable-auto-launch \
    --disable-triton-backend \
    --input-directory /tmp/comfyui_input \
    --output-directory /tmp/comfyui_output \
    --extra-model-paths-config /app/extra_model_paths.yaml &

COMFY_PID=$!

# Wait for ComfyUI to be ready (port open + system_stats responsive)
echo "Waiting for ComfyUI to initialize..."
MAX_WAIT=600
ELAPSED=0
while [ $ELAPSED -lt $MAX_WAIT ]; do
    if curl -s http://127.0.0.1:8188/system_stats > /dev/null 2>&1; then
        echo "ComfyUI is ready! (took ${ELAPSED}s)"
        break
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
    if [ $((ELAPSED % 30)) -eq 0 ]; then
        echo "  Still waiting... (${ELAPSED}s elapsed)"
    fi
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo "ERROR: ComfyUI failed to start within ${MAX_WAIT}s"
    kill $COMFY_PID 2>/dev/null || true
    exit 1
fi

echo "Starting FastAPI OpenAI Proxy on port ${PORT}..."
exec uvicorn app:app --host 0.0.0.0 --port "${PORT}" --workers 1
