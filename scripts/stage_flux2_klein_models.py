#!/usr/bin/env python3
"""Stage FLUX.2 [klein] 4B and support weights into GCS models cache.

Usage:
    .venv/bin/python3 scripts/stage_flux2_klein_models.py [dev|prod]
"""

import os
import sys
import subprocess
import shutil
from huggingface_hub import hf_hub_download

ENV = sys.argv[1] if len(sys.argv) > 1 else "dev"
if ENV not in ("dev", "test", "prod"):
    print(f"Invalid environment: {ENV}. Use dev, test, or prod.")
    sys.exit(1)

BUCKET = f"tavern-swiper-{ENV}-models-cache"
TMP_DIR = "/tmp/flux2_klein_staging"

MODELS_TO_STAGE = [
    {
        "repo_id": "black-forest-labs/FLUX.2-klein-4b-fp8",
        "filename": "flux-2-klein-4b-fp8.safetensors",
        "gcs_dest": f"gs://{BUCKET}/models/diffusion_models/flux-2-klein-4b-fp8.safetensors",
    },
    {
        "repo_id": "Comfy-Org/vae-text-encorder-for-flux-klein-4b",
        "filename": "split_files/text_encoders/qwen_3_4b.safetensors",
        "gcs_dest": f"gs://{BUCKET}/models/text_encoders/qwen_3_4b.safetensors",
    },
    {
        "repo_id": "Comfy-Org/vae-text-encorder-for-flux-klein-4b",
        "filename": "split_files/vae/flux2-vae.safetensors",
        "gcs_dest": f"gs://{BUCKET}/models/vae/flux2-vae.safetensors",
    },
]


def check_gcs_exists(gcs_path: str) -> bool:
    res = subprocess.run(["gcloud", "storage", "ls", gcs_path], capture_output=True, text=True)
    return res.returncode == 0 and gcs_path in res.stdout


def stage_models():
    os.makedirs(TMP_DIR, exist_ok=True)
    print(f"🚀 Staging FLUX.2 Klein 4B models to gs://{BUCKET}/models/...")

    for item in MODELS_TO_STAGE:
        gcs_dest = item["gcs_dest"]
        print(f"\nChecking destination: {gcs_dest}")
        if check_gcs_exists(gcs_dest):
            print(f"✅ Already exists in GCS: {gcs_dest}")
            continue

        repo_id = item["repo_id"]
        filename = item["filename"]
        print(f"📥 Downloading {filename} from {repo_id}...")

        local_path = hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            local_dir=TMP_DIR,
        )
        print(f"✅ Downloaded to: {local_path}")

        print(f"📤 Uploading to {gcs_dest}...")
        subprocess.run(["gcloud", "storage", "cp", local_path, gcs_dest], check=True)
        print(f"✅ Successfully uploaded to {gcs_dest}")

        # Clean up local file to conserve disk space
        if os.path.exists(local_path):
            os.remove(local_path)

    # Clean up temp dir
    shutil.rmtree(TMP_DIR, ignore_errors=True)
    print("\n🎉 All FLUX.2 Klein 4B model weights staged successfully!")


if __name__ == "__main__":
    stage_models()
