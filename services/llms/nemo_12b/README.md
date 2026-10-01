# Mistral Nemo 12B FP8 (`nemo_12b`)

This service runs the **Mistral-Nemo-Instruct-2407** 12.24B model (W8A8 FP8 quantized by Neural Magic) using vLLM on Google Cloud Run with Nvidia L4 GPU acceleration.

---

## 1. Specifications

| Parameter | Value |
|-----------|-------|
| Base Architecture | Mistral Nemo 12.24B Instruct (Tekken Tokenizer) |
| Fine-tune / Quantization | `neuralmagic/Mistral-Nemo-Instruct-2407-FP8` (W8A8) |
| License | Apache 2.0 (Commercially Permissive) |
| Max Model Length | 32,768 tokens |
| KV Cache Precision | FP8 (`--kv-cache-dtype fp8`) |
| Prefix Caching | Enabled (`--enable-prefix-caching`) |
| GPU Type | Nvidia L4 (24GB VRAM) |
| Scaling | `--min-instances=0 --max-instances=1` (complete spindown when idle) |
| Tool Parser | `mistral` (`--tool-call-parser mistral --enable-auto-tool-choice`) |
| Cloud Run Service | `nemo-12b-${ENV}` |
| Cloud Storage Mount | `gs://tavern-swiper-${ENV}-models-cache` mounted at `/models` |

---

## 2. API & Integration

`nemo_12b` exposes standard OpenAI-compatible API routes at port 8080:
- `GET /health`: Unauthenticated health check returning 200 OK once weights are loaded in VRAM.
- `GET /v1/models`: List loaded model.
- `POST /v1/chat/completions`: Chat completions with tool calling and streaming support.

Integration via Python OpenAI client:
```python
from openai import OpenAI

client = OpenAI(
    base_url="https://nemo-12b-dev-<hash>.a.run.app/v1",
    api_key="sk-qwen-9814d5cc0c12cc1546bd0d0873602b00aa3f78b421707e80",
)

response = client.chat.completions.create(
    model="/models/neuralmagic/Mistral-Nemo-Instruct-2407-FP8",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"}
    ],
    temperature=0.75,
    extra_body={"min_p": 0.05},
)
print(response.choices[0].message.content)
```

---

## 3. Operations & Weight Preparation

To download the weights from Hugging Face and upload them to the GCS model cache bucket:

```bash
# Set ENV if uploading to test or prod (defaults to dev)
export ENV=dev
.venv/bin/python3 services/llms/nemo_12b/fetch_model.py
```

---

## 4. Deployment

Deploy directly via Cloud Build:
```bash
gcloud builds submit services/llms/nemo_12b \
  --config=services/llms/nemo_12b/cloudbuild.yaml \
  --substitutions=_ENV_NAME=dev
```
Or via the root deployment orchestrator:
```bash
bash scripts/deploy_llm_containers.sh dev nemo-12b
```
