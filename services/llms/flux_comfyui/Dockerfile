FROM nvidia/cuda:12.8.0-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH="/ComfyUI:${PYTHONPATH}"

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

# Install proxy dependencies
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn[standard] \
    httpx \
    websockets \
    pydantic

# Copy application files
COPY . /app

RUN chmod +x /app/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
