FROM mirror.gcr.io/vllm/vllm-openai@sha256:3a1e7f5904e1a1192a02aa0086ceaffc33985d7044c7bb25b3a43d61bdbe3ac0

ENV LD_LIBRARY_PATH="/usr/local/nvidia/lib64:/usr/local/nvidia/lib:/usr/lib/x86_64-linux-gnu" \
    VLLM_ENABLE_CUDA_COMPATIBILITY="0"

ENTRYPOINT ["python3", "-m", "vllm.entrypoints.openai.api_server"]
CMD [ \
    "--model", "/models/neuralmagic/Mistral-Nemo-Instruct-2407-FP8", \
    "--port", "8080", \
    "--max-model-len", "32768", \
    "--gpu-memory-utilization", "0.90", \
    "--kv-cache-dtype", "fp8", \
    "--enable-prefix-caching", \
    "--tool-call-parser", "mistral", \
    "--enable-auto-tool-choice", \
    "--enforce-eager" \
]
