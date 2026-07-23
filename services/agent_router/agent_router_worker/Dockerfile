# ---------- Stage 1: install deps into a clean layer ----------
FROM python:3.12-slim AS deps

WORKDIR /app

ENV FASTEMBED_CACHE_PATH=/root/.cache/fastembed

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Pre-download the embedding model into the specified cache layer
RUN PYTHONPATH=/install/lib/python3.12/site-packages \
    python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/root/.cache/fastembed')"

# ---------- Stage 2: final runtime image ----------
FROM python:3.12-slim

WORKDIR /app

ENV FASTEMBED_CACHE_PATH=/root/.cache/fastembed

# Copy installed packages
COPY --from=deps /install /usr/local

# Copy the pre-downloaded model cache
COPY --from=deps /root/.cache/fastembed /root/.cache/fastembed

COPY . .

EXPOSE 8009

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8009} --workers 1
