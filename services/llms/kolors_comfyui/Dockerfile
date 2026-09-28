FROM nvidia/cuda:12.8.0-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/ComfyUI:${PYTHONPATH}" \
    HF_HUB_OFFLINE=1

WORKDIR /app

# System dependencies + Python 3.11
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    build-essential \
    g++ \
    software-properties-common \
    libgl1-mesa-glx \
    libglib2.0-0 \
    netcat-openbsd \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-venv \
    python3.11-dev \
    && rm -rf /var/lib/apt/lists/*

# Point python3 to 3.11 and install pip
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && curl -sS https://bootstrap.pypa.io/get-pip.py | python3

# Install PyTorch 2.7.0 with CUDA 12.8
RUN pip install --no-cache-dir \
    torch==2.7.0 \
    torchvision==0.22.0 \
    torchaudio==2.7.0 \
    --index-url https://download.pytorch.org/whl/cu128

# Install ComfyUI (pinned to v0.36.0)
RUN git clone --branch v0.36.0 --depth 1 https://github.com/comfyanonymous/ComfyUI.git /ComfyUI && \
    pip install --no-cache-dir -r /ComfyUI/requirements.txt

# Install ComfyUI Custom Node: KolorsWrapper (Kijai)
RUN git clone --depth 1 https://github.com/kijai/ComfyUI-KwaiKolorsWrapper.git /ComfyUI/custom_nodes/ComfyUI-KolorsWrapper && \
    pip install --no-cache-dir -r /ComfyUI/custom_nodes/ComfyUI-KolorsWrapper/requirements.txt || true

# Install ComfyUI Custom Node: Kolors-MZ (MinusZone native loaders & samplers)
RUN git clone --depth 1 https://github.com/MinusZoneAI/ComfyUI-Kolors-MZ.git /ComfyUI/custom_nodes/ComfyUI-Kolors-MZ

# Install ComfyUI Custom Node: IP-Adapter Plus (cubiq)
RUN git clone --depth 1 https://github.com/cubiq/ComfyUI_IPAdapter_plus.git /ComfyUI/custom_nodes/ComfyUI_IPAdapter_plus && \
    pip install --no-cache-dir -r /ComfyUI/custom_nodes/ComfyUI_IPAdapter_plus/requirements.txt || true

# Install FastAPI proxy dependencies and model processing libraries
# STRICTLY NO insightface or antelopev2 (commercially compliant)
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn[standard] \
    httpx \
    websockets \
    pydantic \
    python-multipart \
    sentencepiece \
    "transformers>=4.38.0" \
    accelerate \
    diffusers \
    opencv-python-headless

# Copy application files
COPY . /app

RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
