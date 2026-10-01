#!/usr/bin/env python3
"""Download Mistral-Nemo-Instruct-2407-FP8 weights from Hugging Face and sync to GCS."""

import os
import subprocess
import sys

# Enable fast rust-based hf-transfer if available
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "1")

REPO_ID = "neuralmagic/Mistral-Nemo-Instruct-2407-FP8"
TARGET_DIR = os.getenv("LOCAL_MODEL_DIR", f"/tmp/{REPO_ID.replace('/', '_')}")
ENV = os.getenv("ENV", "dev")
BUCKET_NAME = os.getenv("MODELS_BUCKET", f"tavern-swiper-{ENV}-models-cache")
GCS_DEST = f"gs://{BUCKET_NAME}/{REPO_ID}/"


def fetch_and_sync():
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print("Error: huggingface_hub is required. Install via: pip install huggingface_hub")
        sys.exit(1)

    print(f"📥 Downloading {REPO_ID} to {TARGET_DIR}...")
    os.makedirs(TARGET_DIR, exist_ok=True)
    snapshot_download(repo_id=REPO_ID, local_dir=TARGET_DIR)

    print(f"☁️ Syncing to GCS: {GCS_DEST}...")
    subprocess.run(
        ["gcloud", "storage", "rsync", "-r", TARGET_DIR, GCS_DEST],
        check=True,
    )
    print("✅ Successfully fetched and synced model to GCS!")


if __name__ == "__main__":
    fetch_and_sync()
