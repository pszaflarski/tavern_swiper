# Qwen 14B (`qwen_14b`)

This service runs the **Qwen 2.5 14B Instruct AWQ** model using vLLM on Google Cloud Run with Nvidia L4 GPU acceleration.

---

## 1. Specifications

| Parameter | Value |
|-----------|-------|
| Base Architecture | Qwen 2.5 14B Instruct |
| Hugging Face Repo | `Qwen/Qwen2.5-14B-Instruct-AWQ` |
| Quantization | AWQ |
| Max Model Length | 32,768 tokens |
| GPU Type | Nvidia L4 (24GB VRAM) |
| vLLM Tool Parser | `hermes` |
| Cloud Run Service | `qwen-14b-${ENV}` |
| Cloud Storage Mount | `gs://tavern-swiper-${ENV}-models-cache` mounted at `/models` |

---

## 2. API & Integration

Qwen 14B exposes standard OpenAI-compatible API routes at port 8080:
- `GET /v1/models`: List loaded model
- `POST /v1/chat/completions`: Chat completions with tool calling support

The `agent_router` service integrates with Qwen 14B via `QWEN_BASE_URL` and `QWEN_API_KEY`:
```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="/models/Qwen/Qwen2.5-14B-Instruct-AWQ",
    openai_api_base="https://qwen-14b-dev-hhqol7siba-uc.a.run.app/v1",
    openai_api_key=os.getenv("QWEN_API_KEY"),
)
```

---

## 3. Operations & Weight Preparation

To download the weights from Hugging Face and upload them to the GCS model cache bucket:

```bash
# Set ENV if uploading to test or prod (defaults to dev)
export ENV=dev
.venv/bin/python3 services/llms/qwen_14b/fetch_model.py
```

---

## 4. Deployment

Deploy directly via Cloud Build:
```bash
gcloud builds submit services/llms/qwen_14b \
  --config=services/llms/qwen_14b/cloudbuild.yaml \
  --substitutions=_ENV_NAME=dev
```
Or via the root deployment orchestrator:
```bash
bash scripts/deploy_llm_containers.sh dev qwen-14b
```
