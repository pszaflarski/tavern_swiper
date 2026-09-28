#!/bin/bash
set -e

PORT=${PORT:-8080}
MODELS_PATH=${MODELS_PATH:-/models}

echo "=== Kolors + IP-Adapter (Commercially Compliant) Container Starting ==="
echo "PORT=${PORT}"

export HF_HUB_OFFLINE=1

mkdir -p /tmp/comfyui_input /tmp/comfyui_output /tmp/input /tmp/output
mkdir -p /ComfyUI/models/unet /ComfyUI/models/LLM /ComfyUI/models/clip_vision /ComfyUI/models/ipadapter /ComfyUI/models/vae

# ── Selective model staging ──────────────────────────────────────────────────
# GCS FUSE mmap causes severe stalls when the transformers library does random
# access reads on large safetensors files. Only ChatGLM3 (12 GB) suffers from
# this — the UNet, VAE, CLIP, and IP-Adapter all load fine via GCS FUSE symlinks.
# We copy ONLY ChatGLM3 to /tmp/ (tmpfs = RAM-backed on Cloud Run), keeping
# RAM usage at ~12 GB tmpfs + ~12 GB model in CPU memory = ~24 GB of 32 GB.

if [ -d "${MODELS_PATH}/kolors" ]; then
    echo "Symlinking small models from GCS FUSE (${MODELS_PATH}/kolors)..."
    ln -sf ${MODELS_PATH}/kolors/clip_vision/* /ComfyUI/models/clip_vision/ 2>/dev/null || true
    ln -sf ${MODELS_PATH}/kolors/ipadapter/* /ComfyUI/models/ipadapter/ 2>/dev/null || true
    ln -sf ${MODELS_PATH}/kolors/vae/* /ComfyUI/models/vae/ 2>/dev/null || true

    mkdir -p /tmp/kolors_unet /tmp/kolors_llm

    # 1. Copy UNet (5.16 GB) from GCS FUSE to local tmpfs
    UNET_SRC="${MODELS_PATH}/kolors/unet/diffusion_pytorch_model.fp16.safetensors"
    UNET_DST="/tmp/kolors_unet/diffusion_pytorch_model.fp16.safetensors"
    if [ -f "${UNET_SRC}" ] && [ ! -f "${UNET_DST}" ]; then
        echo "Copying UNet (5.16 GB) from GCS FUSE to local tmpfs..."
        cp "${UNET_SRC}" "${UNET_DST}"
        echo "UNet copy complete."
    fi
    ln -sf ${UNET_DST} /ComfyUI/models/unet/diffusion_pytorch_model.fp16.safetensors 2>/dev/null || true
    ln -sf ${UNET_DST} /ComfyUI/models/unet/kolors_unet_fp8.safetensors 2>/dev/null || true

    # 2. Copy ChatGLM3 (prefer 8-bit 6.78 GB, fallback to fp16 12 GB) to local tmpfs
    if [ -f "${MODELS_PATH}/kolors/LLM/chatglm3-8bit.safetensors" ]; then
        echo "Copying ChatGLM3 8-bit (6.78 GB) from GCS FUSE to local tmpfs..."
        cp "${MODELS_PATH}/kolors/LLM/chatglm3-8bit.safetensors" "/tmp/kolors_llm/chatglm3-8bit.safetensors"
        ln -sf /tmp/kolors_llm/chatglm3-8bit.safetensors /tmp/kolors_llm/chatglm3-fp16.safetensors
        ln -sf /tmp/kolors_llm/chatglm3-8bit.safetensors /ComfyUI/models/LLM/chatglm3-8bit.safetensors 2>/dev/null || true
        ln -sf /tmp/kolors_llm/chatglm3-8bit.safetensors /ComfyUI/models/LLM/chatglm3-fp16.safetensors 2>/dev/null || true
        ln -sf /tmp/kolors_llm/chatglm3-8bit.safetensors /ComfyUI/models/LLM/chatglm3-6b.safetensors 2>/dev/null || true
        echo "ChatGLM3 8-bit copy complete."
    elif [ -f "${MODELS_PATH}/kolors/LLM/chatglm3-fp16.safetensors" ]; then
        echo "Copying ChatGLM3 fp16 (12 GB) from GCS FUSE to local tmpfs..."
        cp "${MODELS_PATH}/kolors/LLM/chatglm3-fp16.safetensors" "/tmp/kolors_llm/chatglm3-fp16.safetensors"
        ln -sf /tmp/kolors_llm/chatglm3-fp16.safetensors /ComfyUI/models/LLM/chatglm3-fp16.safetensors 2>/dev/null || true
        ln -sf /tmp/kolors_llm/chatglm3-fp16.safetensors /ComfyUI/models/LLM/chatglm3-6b.safetensors 2>/dev/null || true
        echo "ChatGLM3 fp16 copy complete."
    fi
else
    echo "WARNING: ${MODELS_PATH}/kolors not found."
fi

# Additional naming aliases
ln -sf /ComfyUI/models/clip_vision/clip-vit-large-patch14-336.bin /ComfyUI/models/clip_vision/clip-vit-bigG-patch14.safetensors 2>/dev/null || true
ln -sf /ComfyUI/models/ipadapter/ip_adapter_plus_general.bin /ComfyUI/models/ipadapter/kolors-ip-adapter-plus.bin 2>/dev/null || true

echo "Patching ChatGLM3 config/model for transformers compatibility..."
python3 -c '
import glob

for f in glob.glob("/ComfyUI/custom_nodes/**/modeling_chatglm.py", recursive=True):
    with open(f, "r") as fp:
        c = fp.read()
    c = c.replace("self.config.use_cache", "getattr(self.config, \"use_cache\", False)")
    with open(f, "w") as fp:
        fp.write(c)
'

echo "Starting Headless ComfyUI on 127.0.0.1:8188..."
python3 /ComfyUI/main.py \
    --listen 127.0.0.1 \
    --port 8188 \
    --front-end-version none \
    --extra-model-paths-config /app/extra_model_paths.yaml \
    --input-directory /tmp/comfyui_input \
    --output-directory /tmp/comfyui_output &

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

