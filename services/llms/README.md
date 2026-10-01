# LLMs Service Boundary

The `llms` service boundary contains the service definitions, deployment configurations, and operational tooling for Tavern Swiper's self-hosted open-weights large language models.

---

## 1. Overview & Architecture

All self-hosted models are hosted on **Google Cloud Run (Gen2)** using prebuilt **vLLM OpenAI API Server** containers with dedicated Nvidia L4 GPUs.

Model weights are decoupled from container images and mounted dynamically via **Cloud Storage FUSE** from `gs://tavern-swiper-${ENV}-models-cache` into `/models`.

```
┌────────────────────────────────┐
│      agent_router_python       │
│           (:8000)              │
└───────────────┬────────────────┘
                │ OpenAI-compatible HTTP REST
                ▼
┌────────────────────────────────────────────────────────┐
│                   LLM Service Boundary                 │
│                                                        │
│  ┌───────────────────┐  ┌───────────┐  ┌────────────┐  │
│  │    dolphin_24b    │  │ qwen_14b  │  │  qwen_32b  │  │
│  │   (Mistral AWQ)   │  │ (Qwen AWQ)│  │ (Qwen AWQ) │  │
│  └─────────┬─────────┘  └─────┬─────┘  └─────┬──────┘  │
│            │                  │              │         │
│            ▼                  ▼              ▼         │
│  ┌──────────────────────────────────────────────────┐  │
│  │ Cloud Storage FUSE Mount: /models                │  │
│  │ gs://tavern-swiper-${ENV}-models-cache           │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

---

## 2. Model Services

| Service | Model | Quantization | Context Window | Tool Parser | Cloud Run Service |
|---------|-------|--------------|----------------|-------------|-------------------|
| [`dolphin_24b`](./dolphin_24b) | `Valdemardi/Dolphin3.0-Mistral-24B-AWQ` | AWQ Marlin | 32,768 | `mistral` | `dolphin-24b-${ENV}` |
| [`qwen_14b`](./qwen_14b) | `Qwen/Qwen2.5-14B-Instruct-AWQ` | AWQ | 32,768 | `hermes` | `qwen-14b-${ENV}` |
| [`qwen_32b`](./qwen_32b) | `Qwen/Qwen2.5-32B-Instruct-AWQ` | AWQ (FP8 KV) | 16,384 | `hermes` | `qwen-32b-${ENV}` |
| [`nemo_12b`](./nemo_12b) | `neuralmagic/Mistral-Nemo-Instruct-2407-FP8` | FP8 (W8A8 + FP8 KV) | 32,768 | `mistral` | `nemo-12b-${ENV}` |

### Image Generation Services

For full API usage, cURL/Python examples, and prompt engineering instructions, see **[`IMAGE_GENERATION_GUIDE.md`](./IMAGE_GENERATION_GUIDE.md)**.

| Service | Architecture | Engine | Purpose |
|---|---|---|---|
| [`sdxl_comfyui`](./sdxl_comfyui) | SDXL Lightning (8-step) + IP-Adapter-Plus-Face | ComfyUI / PyTorch cu128 | Identity-preserving multi-pose/scene generation |
| [`z_image_comfyui`](./z_image_comfyui) | Z-Image-Turbo (6B S3-DiT + Qwen 3.4B) | ComfyUI / PyTorch cu128 | Hyper-realistic candid smartphone selfies |
| [`flux_comfyui`](./flux_comfyui) | FLUX.1-dev (FP8) + PuLID | ComfyUI / PyTorch cu128 | Complex scene composition & text-heavy prompts |
| [`krea2_comfyui`](./krea2_comfyui) | Krea 2 Turbo (MMDiT + Qwen3-VL 4B) | ComfyUI / PyTorch cu128 | High-fidelity 8-step photorealism & prompt adherence |
| [`kolors_comfyui`](./kolors_comfyui) | Kwai-Kolors FP8 + OpenCLIP-ViT-bigG IP-Adapter | ComfyUI / PyTorch cu128 | Commercially compliant, zero-InsightFace character editing |


---

## 3. Directory Layout

Each model container directory follows standard repository conventions:
- `Dockerfile`: Container image definition pinning the validated vLLM release and default execution arguments.
- `cloudbuild.yaml`: Declarative Cloud Build deployment specification.
- `.env.example`: Environment variable template.
- `README.md`: Specifications, hardware sizing, and operational runbook.
- `fetch_model.py`: Utility script to download weights from Hugging Face and sync them to the GCS models bucket.

---

## 4. Deployment

Deploy individual or all services using the orchestrator:
```bash
# Deploy a single service
bash scripts/deploy_llm_containers.sh dev dolphin-24b

# Deploy all self-hosted models
bash scripts/deploy_llm_containers.sh dev all
```
Or trigger deployment via Cloud Build:
```bash
gcloud builds submit services/llms/dolphin_24b --config=services/llms/dolphin_24b/cloudbuild.yaml --substitutions=_ENV_NAME=dev
```
