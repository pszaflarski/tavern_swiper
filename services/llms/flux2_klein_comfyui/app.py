"""FastAPI OpenAI-Compatible Image Generation & Reference-Conditioned Editing Proxy for FLUX.2 [klein] 4B on ComfyUI."""

import asyncio
import base64
import json
import logging
import os
import time
import uuid
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, Security, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import httpx
from pydantic import BaseModel, Field
import websockets

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("flux2_klein_comfyui")

app = FastAPI(
    title="FLUX.2 [klein] 4B ComfyUI Service",
    version="1.0.0",
    description="Commercially compliant (Apache 2.0) OpenAI-compatible image generation and reference-latent conditioned synthesis with FLUX.2 Klein 4B",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)
COMFY_HOST = os.environ.get("COMFY_HOST", "127.0.0.1:8188")
COMFY_INPUT_DIR = os.environ.get("COMFY_INPUT_DIR", "/tmp/comfyui_input")

WORKFLOW_DIR = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(WORKFLOW_DIR, "flux2_klein_t2i_workflow_api.json"), "r") as f:
    FLUX2_KLEIN_T2I_WORKFLOW = json.load(f)

with open(
    os.path.join(WORKFLOW_DIR, "flux2_klein_reference_workflow_api.json"), "r"
) as f:
    FLUX2_KLEIN_REF_WORKFLOW = json.load(f)

CANDID_REALISM_PROMPT = (
    ", 35mm film photograph, candid shot, natural skin micro-texture with pores, "
    "ambient natural room lighting, shot on 35mm f/2.0, subtle sensor grain, casual amateur composition"
)


def verify_api_key(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
):
    expected_key = os.environ.get("IMAGE_API_KEY")
    if not expected_key:
        return True
    if credentials is None or credentials.credentials != expected_key:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key. Provide 'Authorization: Bearer <key>'",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return True


class ImageGenRequest(BaseModel):
    model: str = Field("flux2-klein-4b", description="Model ID")
    prompt: str = Field(..., description="Text prompt describing the image")
    negative_prompt: Optional[str] = Field(
        "", description="Negative prompt"
    )
    size: str = Field("896x1152", description="Image dimensions WxH")
    n: int = Field(1, description="Number of images")
    seed: Optional[int] = Field(None, description="Random seed")
    steps: Optional[int] = Field(4, description="Inference steps (default: 4 for Klein distilled)")
    cfg: Optional[float] = Field(1.0, description="Guidance scale (default: 1.0 for flow matching)")
    response_format: str = Field("b64_json", description="Response format")


class ImageData(BaseModel):
    b64_json: str
    revised_prompt: str


class ImageResponse(BaseModel):
    created: int
    data: list[ImageData]


class ModelCard(BaseModel):
    id: str
    object: str = "model"
    created: int
    owned_by: str = "tavern-swiper"


class ModelListResponse(BaseModel):
    object: str = "list"
    data: list[ModelCard]


async def _execute_comfy_workflow(workflow: dict, client_id: str) -> str:
    """Submit workflow to ComfyUI, wait for completion, and return base64 PNG."""
    ws_url = f"ws://{COMFY_HOST}/ws?clientId={client_id}"
    prompt_payload = {"prompt": workflow, "client_id": client_id}

    async with websockets.connect(ws_url, close_timeout=5) as ws:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"http://{COMFY_HOST}/prompt", json=prompt_payload
            )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=500,
                    detail=f"ComfyUI rejected prompt: {resp.text}",
                )
            prompt_id = resp.json()["prompt_id"]

        deadline = time.time() + 600
        while time.time() < deadline:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=30.0)
            except asyncio.TimeoutError:
                continue

            if isinstance(msg, str):
                event = json.loads(msg)
                msg_type = event.get("type")
                if msg_type == "execution_error":
                    data = event.get("data", {})
                    err_msg = data.get("exception_message", "Unknown error")
                    node_type = data.get("node_type", "unknown node")
                    logger.error(f"ComfyUI execution error in {node_type}: {err_msg}")
                    raise HTTPException(
                        status_code=500,
                        detail=f"ComfyUI error in {node_type}: {err_msg}",
                    )
                elif msg_type == "execution_interrupted":
                    raise HTTPException(
                        status_code=500, detail="ComfyUI execution was interrupted"
                    )
                elif msg_type == "progress":
                    data = event.get("data", {})
                    val = data.get("value")
                    max_v = data.get("max")
                    logger.info(f"ComfyUI Sampling Progress: {val}/{max_v} steps")
                elif msg_type == "executing":
                    data = event.get("data", {})
                    if data.get("node") is None and data.get("prompt_id") == prompt_id:
                        logger.info(f"ComfyUI execution completed for prompt {prompt_id}")
                        break

    # Fetch output from history
    async with httpx.AsyncClient(timeout=30.0) as client:
        hist_resp = await client.get(f"http://{COMFY_HOST}/history/{prompt_id}")
        if hist_resp.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to fetch execution history: {hist_resp.text}",
            )
        history = hist_resp.json()
        if prompt_id not in history:
            raise HTTPException(
                status_code=500,
                detail=f"Prompt ID {prompt_id} not found in ComfyUI history",
            )

        outputs = history[prompt_id].get("outputs", {})
        output_images = []
        for node_id, node_output in outputs.items():
            if "images" in node_output:
                output_images.extend(node_output["images"])

        if not output_images:
            raise HTTPException(
                status_code=500,
                detail="ComfyUI workflow finished but produced no images",
            )

        img_info = output_images[0]
        filename = img_info["filename"]
        subfolder = img_info.get("subfolder", "")
        folder_type = img_info.get("type", "output")

        img_resp = await client.get(
            f"http://{COMFY_HOST}/view",
            params={"filename": filename, "subfolder": subfolder, "type": folder_type},
        )
        if img_resp.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to fetch generated image: {img_resp.text}",
            )

        return base64.b64encode(img_resp.content).decode("utf-8")


@app.get("/health")
@app.get("/healthz")
async def health():
    """Health check validating ComfyUI readiness and GPU VRAM."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            r = await client.get(f"http://{COMFY_HOST}/system_stats")
            stats = r.json()
            devices = stats.get("devices", [])
            vram_info = devices[0] if devices else {"name": "cpu"}
            return {
                "status": "healthy",
                "model": "flux2-klein-4b",
                "compliance": "commercial-clean (Apache 2.0, zero-insightface)",
                "comfyui": True,
                "vram": vram_info,
            }
        except Exception as e:
            return {"status": "degraded", "comfyui": False, "error": str(e)}


@app.get("/v1/models")
async def list_models(_: bool = Depends(verify_api_key)):
    now = int(time.time())
    return ModelListResponse(
        data=[
            ModelCard(id="flux2-klein-4b", created=now),
            ModelCard(id="flux2-klein-reference", created=now),
        ]
    )


@app.post("/v1/images/generations", response_model=ImageResponse)
async def generate_image(
    req: ImageGenRequest, _: bool = Depends(verify_api_key)
):
    """Text-to-image generation with FLUX.2 Klein 4B and Qwen text encoder."""
    try:
        width, height = map(int, req.size.split("x"))
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid size '{req.size}'. Format must be WxH (e.g. 896x1152)",
        )

    wf = json.loads(json.dumps(FLUX2_KLEIN_T2I_WORKFLOW))
    seed = req.seed if req.seed is not None else int(time.time() * 1000) % (2**31)

    # EmptySD3LatentImage dimensions
    if "4" in wf:
        wf["4"]["inputs"]["width"] = width
        wf["4"]["inputs"]["height"] = height

    # Enriched prompt with candid realism styling tokens
    enriched_prompt = f"{req.prompt}{CANDID_REALISM_PROMPT}"
    if "5" in wf:
        wf["5"]["inputs"]["text"] = enriched_prompt
    if "6" in wf:
        wf["6"]["inputs"]["text"] = req.negative_prompt or ""

    # Sampler settings
    if "7" in wf:
        wf["7"]["inputs"]["seed"] = seed
        wf["7"]["inputs"]["steps"] = req.steps or 4
        wf["7"]["inputs"]["cfg"] = req.cfg or 1.0

    client_id = str(uuid.uuid4())
    b64_json = await _execute_comfy_workflow(wf, client_id)
    return ImageResponse(
        created=int(time.time()),
        data=[ImageData(b64_json=b64_json, revised_prompt=enriched_prompt)],
    )


@app.post("/v1/images/edits", response_model=ImageResponse)
async def edit_image(
    prompt: str = Form(...),
    negative_prompt: str = Form(""),
    image: UploadFile = File(...),
    size: str = Form("896x1152"),
    seed: Optional[int] = Form(None),
    steps: Optional[int] = Form(4),
    cfg: Optional[float] = Form(1.0),
    _: bool = Depends(verify_api_key),
):
    """Holistic reference-conditioned generation using FLUX.2 Klein with ReferenceLatent."""
    try:
        width, height = map(int, size.split("x"))
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid size '{size}'. Format must be WxH (e.g. 896x1152)",
        )

    ext = os.path.splitext(image.filename)[1] or ".png"
    upload_filename = f"flux2_ref_{uuid.uuid4().hex[:8]}{ext}"

    content = await image.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty reference image uploaded")

    async with httpx.AsyncClient(timeout=30.0) as client:
        files = {"image": (upload_filename, content, image.content_type or "image/png")}
        up_resp = await client.post(f"http://{COMFY_HOST}/upload/image", files=files)
        if up_resp.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to upload reference image to ComfyUI: {up_resp.text}",
            )

    wf = json.loads(json.dumps(FLUX2_KLEIN_REF_WORKFLOW))
    actual_seed = seed if seed is not None else int(time.time() * 1000) % (2**31)

    # Reference image input
    if "7" in wf:
        wf["7"]["inputs"]["image"] = upload_filename

    # Latent dimensions
    if "4" in wf:
        wf["4"]["inputs"]["width"] = width
        wf["4"]["inputs"]["height"] = height

    # Enriched prompt with candid realism styling tokens
    enriched_prompt = f"{prompt}{CANDID_REALISM_PROMPT}"
    if "5" in wf:
        wf["5"]["inputs"]["text"] = enriched_prompt
    if "6" in wf:
        wf["6"]["inputs"]["text"] = negative_prompt

    # Sampler settings
    if "10" in wf:
        wf["10"]["inputs"]["seed"] = actual_seed
        wf["10"]["inputs"]["steps"] = steps or 4
        wf["10"]["inputs"]["cfg"] = cfg or 1.0

    client_id = str(uuid.uuid4())
    b64_json = await _execute_comfy_workflow(wf, client_id)
    return ImageResponse(
        created=int(time.time()),
        data=[ImageData(b64_json=b64_json, revised_prompt=enriched_prompt)],
    )
