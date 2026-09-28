#!/usr/bin/env bash
set -e

# deploy_llm_containers.sh — Script to deploy self-hosted LLM GPU services (Qwen 32B, Qwen 14B, Dolphin 24B)
# Service definitions, Dockerfiles, and Cloud Build manifests live in services/llms/
# Usage: bash scripts/deploy_llm_containers.sh [dev|test|prod] [qwen-32b|qwen-14b|dolphin-24b|all]

ENV="${1:-dev}"
TARGET="${2:-all}"

if [[ "$ENV" != "dev" && "$ENV" != "test" && "$ENV" != "prod" ]]; then
  echo "Error: Invalid environment '$ENV'. Usage: $0 [dev|test|prod] [qwen-32b|qwen-14b|dolphin-24b|all]"
  exit 1
fi

PROJECT_ID="tavern-swiper-dev"
LOCATION="us-central1"
MODELS_BUCKET="tavern-swiper-dev-models-cache"

if [[ "$ENV" == "prod" ]]; then
  echo "⚠️ WARNING: This command will modify the PRODUCTION environment."
  PROJECT_ID="tavern-swiper-prod"
  LOCATION="us-central1"
  MODELS_BUCKET="tavern-swiper-prod-models-cache"
fi

IMAGE_URI="mirror.gcr.io/vllm/vllm-openai@sha256:3a1e7f5904e1a1192a02aa0086ceaffc33985d7044c7bb25b3a43d61bdbe3ac0"
VLLM_API_KEY="sk-qwen-9814d5cc0c12cc1546bd0d0873602b00aa3f78b421707e80"

deploy_qwen_32b() {
  local service_name="qwen-32b-${ENV}"
  echo "🚀 Deploying ${service_name} to project ${PROJECT_ID} in region ${LOCATION}..."
  gcloud run deploy "${service_name}" \
    --project="${PROJECT_ID}" \
    --region="${LOCATION}" \
    --image="${IMAGE_URI}" \
    --execution-environment=gen2 \
    --cpu=8 \
    --memory=32Gi \
    --gpu=1 \
    --gpu-type=nvidia-l4 \
    --no-gpu-zonal-redundancy \
    --min-instances=0 \
    --max-instances=1 \
    --concurrency=1 \
    --timeout=600 \
    --no-cpu-throttling \
    --cpu-boost \
    --ingress=all \
    --allow-unauthenticated \
    --labels=service-group=self-hosted-llms \
    --startup-probe=tcpSocket.port=8080,initialDelaySeconds=30,periodSeconds=10,timeoutSeconds=10,failureThreshold=60 \
    --set-env-vars="VLLM_API_KEY=${VLLM_API_KEY},VLLM_ENABLE_CUDA_COMPATIBILITY=0,LD_LIBRARY_PATH=/usr/local/nvidia/lib64:/usr/local/nvidia/lib:/usr/lib/x86_64-linux-gnu" \
    --add-volume="name=model-volume,type=cloud-storage,bucket=${MODELS_BUCKET}" \
    --add-volume-mount="volume=model-volume,mount-path=/models" \
    --args="/models/Qwen/Qwen2.5-32B-Instruct-AWQ,--safetensors-load-strategy,prefetch,--port,8080,--max-model-len,16384,--gpu-memory-utilization,0.96,--kv-cache-dtype,fp8,--enable-auto-tool-choice,--tool-call-parser,hermes,--enforce-eager"









  echo "✅ ${service_name} deployed successfully!"
}

deploy_qwen_14b() {
  local service_name="qwen-14b-${ENV}"
  echo "🚀 Deploying ${service_name} to project ${PROJECT_ID} in region ${LOCATION}..."
  gcloud run deploy "${service_name}" \
    --project="${PROJECT_ID}" \
    --region="${LOCATION}" \
    --image="${IMAGE_URI}" \
    --execution-environment=gen2 \
    --cpu=8 \
    --memory=32Gi \
    --gpu=1 \
    --gpu-type=nvidia-l4 \
    --no-gpu-zonal-redundancy \
    --min-instances=0 \
    --max-instances=1 \
    --concurrency=1 \
    --timeout=600 \
    --no-cpu-throttling \
    --cpu-boost \
    --ingress=all \
    --allow-unauthenticated \
    --labels=service-group=self-hosted-llms \
    --startup-probe=tcpSocket.port=8080,initialDelaySeconds=30,periodSeconds=10,timeoutSeconds=10,failureThreshold=60 \
    --set-env-vars="VLLM_API_KEY=${VLLM_API_KEY},VLLM_ENABLE_CUDA_COMPATIBILITY=0,LD_LIBRARY_PATH=/usr/local/nvidia/lib64:/usr/local/nvidia/lib:/usr/lib/x86_64-linux-gnu" \
    --add-volume="name=model-volume,type=cloud-storage,bucket=${MODELS_BUCKET}" \
    --add-volume-mount="volume=model-volume,mount-path=/models" \
    --args="/models/Qwen/Qwen2.5-14B-Instruct-AWQ,--port,8080,--max-model-len,32768,--gpu-memory-utilization,0.95,--safetensors-load-strategy,prefetch,--enable-auto-tool-choice,--tool-call-parser,hermes,--enforce-eager"
  echo "✅ ${service_name} deployed successfully!"
}

deploy_dolphin_24b() {
  local service_name="dolphin-24b-${ENV}"
  echo "🚀 Deploying ${service_name} to project ${PROJECT_ID} in region ${LOCATION}..."
  gcloud run deploy "${service_name}" \
    --project="${PROJECT_ID}" \
    --region="${LOCATION}" \
    --image="${IMAGE_URI}" \
    --execution-environment=gen2 \
    --cpu=8 \
    --memory=32Gi \
    --gpu=1 \
    --gpu-type=nvidia-l4 \
    --no-gpu-zonal-redundancy \
    --min-instances=0 \
    --max-instances=1 \
    --concurrency=1 \
    --timeout=600 \
    --no-cpu-throttling \
    --cpu-boost \
    --ingress=all \
    --allow-unauthenticated \
    --labels=service-group=self-hosted-llms \
    --startup-probe=tcpSocket.port=8080,initialDelaySeconds=30,periodSeconds=10,timeoutSeconds=10,failureThreshold=60 \
    --set-env-vars="VLLM_API_KEY=${VLLM_API_KEY},VLLM_ENABLE_CUDA_COMPATIBILITY=0,LD_LIBRARY_PATH=/usr/local/nvidia/lib64:/usr/local/nvidia/lib:/usr/lib/x86_64-linux-gnu" \
    --add-volume="name=model-volume,type=cloud-storage,bucket=${MODELS_BUCKET}" \
    --add-volume-mount="volume=model-volume,mount-path=/models" \
    --args="/models/Valdemardi/Dolphin3.0-Mistral-24B-AWQ,--quantization,awq_marlin,--port,8080,--max-model-len,32768,--gpu-memory-utilization,0.95,--safetensors-load-strategy,prefetch,--enable-auto-tool-choice,--tool-call-parser,mistral,--enforce-eager"


  echo "✅ ${service_name} deployed successfully!"
}

deploy_flux_comfyui() {
  local service_name="flux-comfyui-${ENV}"
  echo "🚀 Deploying ${service_name} via Cloud Build to project ${PROJECT_ID}..."
  gcloud builds submit services/llms/flux_comfyui \
    --project="${PROJECT_ID}" \
    --config=services/llms/flux_comfyui/cloudbuild.yaml
  echo "✅ ${service_name} deployed successfully!"
}

deploy_z_image_comfyui() {
  local service_name="z-image-comfyui-${ENV}"
  echo "🚀 Deploying ${service_name} via Cloud Build to project ${PROJECT_ID}..."
  gcloud builds submit services/llms/z_image_comfyui \
    --project="${PROJECT_ID}" \
    --config=services/llms/z_image_comfyui/cloudbuild.yaml
  echo "✅ ${service_name} deployed successfully!"
}

deploy_sdxl_comfyui() {
  local service_name="sdxl-comfyui-${ENV}"
  echo "🚀 Deploying ${service_name} via Cloud Build to project ${PROJECT_ID}..."
  gcloud builds submit services/llms/sdxl_comfyui \
    --project="${PROJECT_ID}" \
    --config=services/llms/sdxl_comfyui/cloudbuild.yaml
  echo "✅ ${service_name} deployed successfully!"
}

deploy_krea2_comfyui() {
  local service_name="krea2-comfyui-${ENV}"
  echo "🚀 Deploying ${service_name} via Cloud Build to project ${PROJECT_ID}..."
  gcloud builds submit services/llms/krea2_comfyui \
    --project="${PROJECT_ID}" \
    --config=services/llms/krea2_comfyui/cloudbuild.yaml
  echo "✅ ${service_name} deployed successfully!"
}

deploy_kolors_comfyui() {
  local service_name="kolors-comfyui-${ENV}"
  echo "🚀 Deploying ${service_name} via Cloud Build to project ${PROJECT_ID}..."
  gcloud builds submit services/llms/kolors_comfyui \
    --project="${PROJECT_ID}" \
    --config=services/llms/kolors_comfyui/cloudbuild.yaml
  echo "✅ ${service_name} deployed successfully!"
}

deploy_flux2_klein_comfyui() {
  local service_name="flux2-klein-comfyui-${ENV}"
  echo "🚀 Deploying ${service_name} via Cloud Build to project ${PROJECT_ID}..."
  gcloud builds submit services/llms/flux2_klein_comfyui \
    --project="${PROJECT_ID}" \
    --config=services/llms/flux2_klein_comfyui/cloudbuild.yaml
  echo "✅ ${service_name} deployed successfully!"
}

deploy_omnigen_comfyui() {
  local service_name="omnigen-comfyui-${ENV}"
  echo "🚀 Deploying ${service_name} via Cloud Build to project ${PROJECT_ID}..."
  gcloud builds submit services/llms/omnigen_comfyui \
    --project="${PROJECT_ID}" \
    --config=services/llms/omnigen_comfyui/cloudbuild.yaml
  echo "✅ ${service_name} deployed successfully!"
}

deploy_z_image_omni_comfyui() {
  local service_name="z-image-omni-comfyui-${ENV}"
  echo "🚀 Deploying ${service_name} via Cloud Build to project ${PROJECT_ID}..."
  gcloud builds submit services/llms/z_image_omni_comfyui \
    --project="${PROJECT_ID}" \
    --config=services/llms/z_image_omni_comfyui/cloudbuild.yaml
  echo "✅ ${service_name} deployed successfully!"
}

case "$TARGET" in
  qwen-32b)
    deploy_qwen_32b
    ;;
  qwen-14b)
    deploy_qwen_14b
    ;;
  dolphin-24b)
    deploy_dolphin_24b
    ;;
  flux-comfyui)
    deploy_flux_comfyui
    ;;
  flux2-klein-comfyui)
    deploy_flux2_klein_comfyui
    ;;
  omnigen-comfyui)
    deploy_omnigen_comfyui
    ;;
  z-image-omni-comfyui)
    deploy_z_image_omni_comfyui
    ;;
  z-image-comfyui)
    deploy_z_image_comfyui
    ;;
  sdxl-comfyui)
    deploy_sdxl_comfyui
    ;;
  krea2-comfyui)
    deploy_krea2_comfyui
    ;;
  kolors-comfyui)
    deploy_kolors_comfyui
    ;;
  all)
    echo "📦 Deploying all self-hosted GPU services sequentially..."
    deploy_qwen_32b
    deploy_qwen_14b
    deploy_dolphin_24b
    deploy_flux_comfyui
    deploy_flux2_klein_comfyui
    deploy_omnigen_comfyui
    deploy_z_image_omni_comfyui
    deploy_z_image_comfyui
    deploy_sdxl_comfyui
    deploy_krea2_comfyui
    deploy_kolors_comfyui
    echo "🎉 All self-hosted GPU services deployed successfully!"
    ;;
  *)
    echo "Error: Unknown target '$TARGET'. Usage: $0 [dev|test|prod] [qwen-32b|qwen-14b|dolphin-24b|flux-comfyui|flux2-klein-comfyui|omnigen-comfyui|z-image-omni-comfyui|z-image-comfyui|sdxl-comfyui|krea2-comfyui|kolors-comfyui|all]"
    exit 1
    ;;
esac



