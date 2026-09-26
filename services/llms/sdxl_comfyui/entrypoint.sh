#!/bin/bash
set -e

PORT=${PORT:-8080}

echo "=== SDXL ComfyUI + IP-Adapter & ReActor Container Starting ==="
echo "PORT=${PORT}"

export HF_HUB_OFFLINE=1

mkdir -p /tmp/comfyui_input /tmp/comfyui_output

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
