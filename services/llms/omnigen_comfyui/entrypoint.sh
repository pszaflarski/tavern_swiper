#!/bin/bash
set -e

PORT=${PORT:-8080}

echo "=== OmniGen Container Starting ==="
echo "PORT=${PORT}"

mkdir -p /tmp/comfyui_input /tmp/comfyui_output
mkdir -p /ComfyUI/models/OmniGen /ComfyUI/models/OmniGen/Shitao
if [ -d "/models/models/LLM/OmniGen-v1" ]; then
    ln -sfn /models/models/LLM/OmniGen-v1 /ComfyUI/models/OmniGen/OmniGen-v1
    ln -sfn /models/models/LLM/OmniGen-v1 /ComfyUI/models/OmniGen/Shitao/OmniGen-v1
elif [ -d "/models/LLM/OmniGen-v1" ]; then
    ln -sfn /models/LLM/OmniGen-v1 /ComfyUI/models/OmniGen/OmniGen-v1
    ln -sfn /models/LLM/OmniGen-v1 /ComfyUI/models/OmniGen/Shitao/OmniGen-v1
fi

if [ -f "/app/patch_omnigen.py" ]; then
    echo "Applying OmniGen GPU and Zero-OOM Patches..."
    python3 /app/patch_omnigen.py
fi

echo "Starting Headless ComfyUI on 127.0.0.1:8188..."
python3 /ComfyUI/main.py \
    --listen 127.0.0.1 \
    --port 8188 \
    --highvram \
    --disable-auto-launch \
    --input-directory /tmp/comfyui_input \
    --output-directory /tmp/comfyui_output \
    --extra-model-paths-config /app/extra_model_paths.yaml &

COMFY_PID=$!

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

echo "Starting FastAPI OmniGen Proxy on port ${PORT}..."
exec uvicorn app:app --host 0.0.0.0 --port "${PORT}" --workers 1
