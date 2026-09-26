FROM nvidia/cuda:12.8.0-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/ComfyUI:${PYTHONPATH}" \
    MODELS_PATH=/models

WORKDIR /app

# System dependencies + Python 3.11
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    build-essential \
    netcat-openbsd \
    software-properties-common \
    libgl1 \
    libglib2.0-0 \
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

# Install ComfyUI
RUN git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git /ComfyUI && \
    pip install --no-cache-dir -r /ComfyUI/requirements.txt

# Install dependencies for Qwen3-VL and FastAPI proxy
RUN pip install --no-cache-dir \
    "transformers>=4.57.0" \
    accelerate \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.30.0 \
    httpx>=0.27.0 \
    websockets>=12.0 \
    pydantic>=2.8.0 \
    python-multipart>=0.0.9

COPY . /app
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
