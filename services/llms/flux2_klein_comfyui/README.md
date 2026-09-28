# FLUX.2 [klein] 4B ComfyUI Service

Commercially compliant (Apache 2.0) OpenAI-compatible image generation and reference-latent conditioned synthesis using FLUX.2 Klein 4B on ComfyUI.

## Key Features
- **Apache 2.0 License:** Zero InsightFace / CC-BY-NC code. 100% commercially compliant.
- **Distilled Speed:** 4-step flow matching running in ~1.5–2.5 seconds on NVIDIA L4 GPU.
- **Holistic Identity Synthesis:** Uses native `ReferenceLatent` conditioning for full-scene generation from noise (`denoise: 1.0`), preventing 2D mask seam lines and warped facial perspectives.
- **Zero-Trust Auth:** Enforces Bearer token verification against `IMAGE_API_KEY`.

## Endpoints
- `GET /health` — Readiness probe checking ComfyUI `/system_stats`
- `GET /v1/models` — Lists available model cards (`flux2-klein-4b`, `flux2-klein-reference`)
- `POST /v1/images/generations` — Text-to-image synthesis
- `POST /v1/images/edits` — Reference-conditioned holistic portrait synthesis

## Deployment
```bash
# Via deployment script
bash scripts/deploy_llm_containers.sh dev flux2-klein-comfyui

# Direct Cloud Build
gcloud builds submit services/llms/flux2_klein_comfyui \
  --project=tavern-swiper-dev \
  --config=services/llms/flux2_klein_comfyui/cloudbuild.yaml
```
