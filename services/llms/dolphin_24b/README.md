# Dolphin 24B (`dolphin_24b`)

This service runs the **Dolphin 3.0 Mistral 24B** open-weights model using vLLM on Google Cloud Run with Nvidia L4 GPU acceleration.

---

## 1. Specifications

| Parameter | Value |
|-----------|-------|
| Base Architecture | Mistral Small 24B Instruct |
| Fine-tune | Dolphin 3.0 (Cognitive Computations) |
| Hugging Face Repo | `Valdemardi/Dolphin3.0-Mistral-24B-AWQ` |
| Quantization | AWQ Marlin (`awq_marlin`) |
| Max Model Length | 32,768 tokens |
| GPU Type | Nvidia L4 (24GB VRAM) |
| vLLM Tool Parser | `mistral` |
| Cloud Run Service | `dolphin-24b-${ENV}` |
| Cloud Storage Mount | `gs://tavern-swiper-${ENV}-models-cache` mounted at `/models` |

---

## 2. API & Integration

Dolphin exposes standard OpenAI-compatible API routes at port 8080:
- `GET /v1/models`: List loaded model
- `POST /v1/chat/completions`: Chat completions with tool calling support

The `agent_router` service integrates with Dolphin via `DOLPHIN_BASE_URL` and `DOLPHIN_API_KEY`:
```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="/models/Valdemardi/Dolphin3.0-Mistral-24B-AWQ",
    openai_api_base="https://dolphin-24b-dev-hhqol7siba-uc.a.run.app/v1",
    openai_api_key=os.getenv("DOLPHIN_API_KEY"),
)
```

---

## 3. Operations & Weight Preparation

To download the weights from Hugging Face and upload them to the GCS model cache bucket:

```bash
# Set ENV if uploading to test or prod (defaults to dev)
export ENV=dev
.venv/bin/python3 services/llms/dolphin_24b/fetch_model.py
```

---

## 4. Deployment

Deploy directly via Cloud Build:
```bash
gcloud builds submit services/llms/dolphin_24b \
  --config=services/llms/dolphin_24b/cloudbuild.yaml \
  --substitutions=_ENV_NAME=dev
```
Or via the root deployment orchestrator:
```bash
bash scripts/deploy_llm_containers.sh dev dolphin-24b
```
