FROM nvidia/cuda:12.8.0-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/ComfyUI:${PYTHONPATH}" \
    HF_HUB_OFFLINE=1

WORKDIR /app

# System dependencies + Python 3.11 (Ubuntu 22.04 ships 3.10, we need 3.11+ for PEP-585)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    software-properties-common \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3.11-dev \
    && rm -rf /var/lib/apt/lists/*

# Make python3 point to 3.11 and install pip
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && curl -sS https://bootstrap.pypa.io/get-pip.py | python3

# Install PyTorch 2.7.0 with CUDA 12.8 — natively supports PEP-585 list[T] in custom ops
RUN pip install --no-cache-dir \
    torch==2.7.0 \
    torchvision==0.22.0 \
    torchaudio==2.7.0 \
    --index-url https://download.pytorch.org/whl/cu128

# Install ComfyUI (pinned to v0.36.0 for Kijai FP8 model compatibility)
RUN git clone --branch v0.36.0 --depth 1 https://github.com/comfyanonymous/ComfyUI.git /ComfyUI && \
    pip install --no-cache-dir -r /ComfyUI/requirements.txt

# NOTE: No build-time import check — comfy_kitchen's Triton backend requires a GPU
# which isn't available during docker build. Validation happens at runtime.

# Install proxy and PuLID dependencies
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn[standard] \
    httpx \
    websockets \
    pydantic \
    python-multipart \
    facexlib \
    insightface \
    onnxruntime \
    timm \
    ftfy \
    opencv-python-headless

# Install ComfyUI-PuLID-Flux custom node and patch forward_orig to accept **kwargs
RUN git clone https://github.com/balazik/ComfyUI-PuLID-Flux.git /ComfyUI/custom_nodes/ComfyUI-PuLID-Flux && \
    sed -i 's/control=None,/control=None, **kwargs,/' /ComfyUI/custom_nodes/ComfyUI-PuLID-Flux/pulidflux.py

# Pre-download facexlib weights so no runtime downloads occur
RUN mkdir -p /usr/local/lib/python3.11/dist-packages/facexlib/weights && \
    curl -sL https://github.com/xinntao/facexlib/releases/download/v0.1.0/detection_Resnet50_Final.pth \
      -o /usr/local/lib/python3.11/dist-packages/facexlib/weights/detection_Resnet50_Final.pth && \
    curl -sL https://github.com/xinntao/facexlib/releases/download/v0.2.0/parsing_bisenet.pth \
      -o /usr/local/lib/python3.11/dist-packages/facexlib/weights/parsing_bisenet.pth

# Copy application files
COPY . /app

RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
