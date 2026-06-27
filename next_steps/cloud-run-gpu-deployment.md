# Deploying on Cloud Run with GPU Acceleration

## Summary

We requested and were granted a quota of **2 Nvidia L4 GPUs** in `us-central1` for the dev/prod GCP environment. This quota is granted under the `run.googleapis.com/nvidia_l4_gpu_allocation_no_zonal_redundancy` metric, which requires disabling zonal redundancy when deploying.

This enables us to deploy GPU-accelerated workloads (e.g. self-hosted LLM inference engines like vLLM/Ollama, image generation APIs, or custom embeddings models) on serverless Cloud Run.

## Why

- **Serverless GPUs** — Pay only for the GPU-seconds consumed during request processing, with the ability to scale down to 0 instances when inactive.
- **Model Autonomy** — Allows running open-source models (like Llama-3-8B or Stable Diffusion) directly on our infrastructure instead of relying entirely on external API endpoints.
- **Improved Latency** — Offloading heavy machine learning workloads (like embedding generation or safety classification) to dedicated hardware.

## Current State

- Quota is approved and active in `us-central1` (project: `tavern-swiper-dev` / `tavern-swiper-prod`).
- Limit: **2** concurrent Nvidia L4 GPU allocations.
- Requirement: Zonal redundancy **must be disabled** in the deployment config.

## Deployment Steps

To deploy a service using the L4 GPU quota, include the `--gpu`, `--gpu-type`, and `--no-gpu-zonal-redundancy` flags in your `gcloud` command:

```bash
gcloud run deploy [SERVICE_NAME] \
  --image=[IMAGE_URL] \
  --region=us-central1 \
  --gpu=1 \
  --gpu-type=nvidia-l4 \
  --no-gpu-zonal-redundancy \
  --memory=16Gi \
  --cpu=4
```

### Key Considerations:
1. **Zonal Redundancy**: Since we are using the `no_zonal_redundancy` metric, GCP does not guarantee pre-reserved failover capacity in other availability zones. In the event of a zonal outage, Cloud Run will attempt best-effort failover to another zone.
2. **Cold Starts**: GPU container startup times can be significant (e.g., loading model weights into VRAM). Consider setting a minimum instance count (`--min-instances=1`) if low initial latency is required, or optimize container startup times.
