#!/bin/bash
set -e

PORT=${PORT:-8080}
MODELS_PATH=${MODELS_PATH:-/models}

echo "=== Initializing Krea 2 Headless Service ==="
echo "Linking models from ${MODELS_PATH}/krea2 to ComfyUI..."

mkdir -p /ComfyUI/models/diffusion_models \
         /ComfyUI/models/text_encoders \
         /ComfyUI/models/vae \
         /tmp/input \
         /tmp/output

# Support both nested /models/krea2/ and direct /models/ structures
if [ -d "${MODELS_PATH}/krea2" ]; then
    ln -sf ${MODELS_PATH}/krea2/diffusion_models/* /ComfyUI/models/diffusion_models/ 2>/dev/null || true
    ln -sf ${MODELS_PATH}/krea2/text_encoders/* /ComfyUI/models/text_encoders/ 2>/dev/null || true
    ln -sf ${MODELS_PATH}/krea2/vae/* /ComfyUI/models/vae/ 2>/dev/null || true
else
    ln -sf ${MODELS_PATH}/diffusion_models/* /ComfyUI/models/diffusion_models/ 2>/dev/null || true
    ln -sf ${MODELS_PATH}/text_encoders/* /ComfyUI/models/text_encoders/ 2>/dev/null || true
    ln -sf ${MODELS_PATH}/vae/* /ComfyUI/models/vae/ 2>/dev/null || true
fi

echo "Available diffusion models:"
ls -la /ComfyUI/models/diffusion_models/ || true

echo "Available text encoders:"
ls -la /ComfyUI/models/text_encoders/ || true

echo "Available VAEs:"
ls -la /ComfyUI/models/vae/ || true

echo "Starting Headless ComfyUI on 127.0.0.1:8188 (dynamic memory management)..."
python3 /ComfyUI/main.py \
    --listen 127.0.0.1 \
    --port 8188 \
    --front-end-version none \
    --input-directory /tmp/input \
    --output-directory /tmp/output &

echo "Awaiting ComfyUI startup on 127.0.0.1:8188..."
ATTEMPTS=0
while ! nc -z 127.0.0.1 8188; do
    sleep 1
    ATTEMPTS=$((ATTEMPTS+1))
    if [ $ATTEMPTS -ge 120 ]; then
        echo "ERROR: ComfyUI failed to start within 120 seconds."
        exit 1
    fi
done
echo "ComfyUI initialized successfully."

echo "Starting FastAPI translation proxy on port ${PORT}..."
exec uvicorn app:app --host 0.0.0.0 --port "${PORT}" --workers 1
