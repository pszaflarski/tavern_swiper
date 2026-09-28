#!/usr/bin/env python3
"""actions.py — Automated build, deployment, and live inference validation for LLM/Image containers."""

import os
import sys
import time
import base64
import subprocess
import httpx

PROJECT_ID = "tavern-swiper-dev"
REGION = "us-central1"
API_KEY = os.environ.get("IMAGE_API_KEY", "sk-tavern-img-dev-8f92b7c4a1e35d6092f1b4e7c3a8e9d2")

SERVICE_MAP = {
    "z-image-omni-comfyui": {
        "dir": "services/llms/z_image_omni_comfyui",
        "service_name": "z-image-omni-comfyui-dev",
    },
    "flux2-klein-comfyui": {
        "dir": "services/llms/flux2_klein_comfyui",
        "service_name": "flux2-klein-comfyui-dev",
    },
    "omnigen-comfyui": {
        "dir": "services/llms/omnigen_comfyui",
        "service_name": "omnigen-comfyui-dev",
    },
    "sdxl-comfyui": {
        "dir": "services/llms/sdxl_comfyui",
        "service_name": "sdxl-comfyui-dev",
    },
    "kolors-comfyui": {
        "dir": "services/llms/kolors_comfyui",
        "service_name": "kolors-comfyui-dev",
    },
}


def get_service_url(service_name: str) -> str:
    res = subprocess.run(
        [
            "gcloud", "run", "services", "describe", service_name,
            f"--project={PROJECT_ID}", f"--region={REGION}",
            "--format=value(status.url)",
        ],
        capture_output=True,
        text=True,
    )
    url = res.stdout.strip() if res.returncode == 0 else ""
    if not url:
        res = subprocess.run(
            [
                "gcloud", "run", "services", "describe", service_name,
                f"--project={PROJECT_ID}", f"--region={REGION}",
                "--format=value(status.address.url)",
            ],
            capture_output=True,
            text=True,
        )
        url = res.stdout.strip() if res.returncode == 0 else ""
    return url


def build_and_deploy(target: str) -> bool:
    if target not in SERVICE_MAP:
        print(f"Unknown target: {target}. Available: {list(SERVICE_MAP.keys())}")
        return False

    info = SERVICE_MAP[target]
    service_dir = info["dir"]
    config_path = os.path.join(service_dir, "cloudbuild.yaml")

    print(f"\n🚀 [actions] Starting Cloud Build for {target}...")
    cmd = [
        "gcloud", "builds", "submit", service_dir,
        f"--project={PROJECT_ID}",
        f"--config={config_path}",
    ]
    res = subprocess.run(cmd)
    return res.returncode == 0


def test_service(target: str):
    info = SERVICE_MAP[target]
    service_name = info["service_name"]
    url = get_service_url(service_name)
    if not url:
        print(f"❌ Could not retrieve Cloud Run URL for {service_name}")
        return False

    print(f"\n🔍 [actions] Testing service {service_name} at {url}...")
    headers = {"Authorization": f"Bearer {API_KEY}"}

    # 1. Health probe
    try:
        r = httpx.get(f"{url}/health", timeout=180.0)
        print(f"Health check status: {r.status_code}")
        print(f"Health response: {r.text}")
    except Exception as e:
        print(f"Health check failed: {e}")
        return False

    # 2. Text-to-Image test
    print("\n🎨 [actions] Testing /v1/images/generations...")
    gen_payload = {
        "prompt": "candid portrait of a rugged adventurer in a tavern, 35mm film photograph",
        "size": "896x1152" if "z-image" in target or "flux2" in target else "1024x1024",
    }
    t0 = time.time()
    try:
        r = httpx.post(f"{url}/v1/images/generations", json=gen_payload, headers=headers, timeout=600.0)
        elapsed = time.time() - t0
        print(f"Generation status: {r.status_code} (took {elapsed:.2f}s)")
        if r.status_code == 200:
            data = r.json()
            b64_img = data["data"][0]["b64_json"]
            out_filename = f"test_output_{target}.png"
            with open(out_filename, "wb") as f:
                f.write(base64.b64decode(b64_img))
            print(f"✅ Saved output image to: {out_filename}")
            return True
        else:
            print(f"❌ Generation error: {r.text}")
            return False
    except Exception as e:
        print(f"Generation request failed: {e}")
        return False


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "z-image-omni-comfyui"
    action = sys.argv[2] if len(sys.argv) > 2 else "all"

    if action in ("build", "all"):
        success = build_and_deploy(target)
        if not success:
            print(f"❌ Build failed for {target}")
            sys.exit(1)

    if action in ("test", "all"):
        test_service(target)
