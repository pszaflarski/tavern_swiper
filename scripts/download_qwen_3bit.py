#!/usr/bin/env .venv/bin/python3
import os
import subprocess
from huggingface_hub import hf_hub_download, snapshot_download

print("Downloading Qwen2.5-32B-Instruct tokenizer and metadata...")
target_dir = "/tmp/Qwen2.5-32B-Instruct-GGUF"
os.makedirs(target_dir, exist_ok=True)

# Download tokenizer and metadata from main repo
snapshot_download(
    repo_id="Qwen/Qwen2.5-32B-Instruct",
    allow_patterns=["*.json", "*.txt", "tokenizer*"],
    local_dir=target_dir,
)

# Download single-file Q3_K_M GGUF
print("Downloading Qwen2.5-32B-Instruct-Q3_K_M.gguf single file...")
hf_hub_download(
    repo_id="bartowski/Qwen2.5-32B-Instruct-GGUF",
    filename="Qwen2.5-32B-Instruct-Q3_K_M.gguf",
    local_dir=target_dir,
)

print("Syncing to GCS bucket gs://tavern-swiper-dev-models-cache/models/Qwen/Qwen2.5-32B-Instruct-GGUF/...")
subprocess.run(
    ["gcloud", "storage", "rsync", "-r", target_dir, "gs://tavern-swiper-dev-models-cache/models/Qwen/Qwen2.5-32B-Instruct-GGUF/"],
    check=True
)

print("Done! Model synced to GCS.")
