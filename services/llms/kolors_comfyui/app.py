"""FastAPI OpenAI-Compatible Image Generation & IP-Adapter Editing Proxy for Kolors on ComfyUI."""

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
logger = logging.getLogger("kolors_comfyui")

app = FastAPI(
    title="Kolors + IP-Adapter ComfyUI API",
    version="1.0.0",
    description="Commercially compliant OpenAI-compatible image generation and OpenCLIP-ViT-bigG IP-Adapter editing using Kwai-Kolors on ComfyUI",
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

with open(os.path.join(WORKFLOW_DIR, "kolors_t2i.json"), "r") as f:
    KOLORS_T2I_WORKFLOW = json.load(f)

with open(os.path.join(WORKFLOW_DIR, "kolors_edit_ipadapter.json"), "r") as f:
    KOLORS_EDIT_WORKFLOW = json.load(f)

CANDID_REALISM_PROMPT = (
    ", 35mm film photograph, dry matte skin texture, rested natural expression, "
    "faded tone curve, lifted shadows, subtle film grain, natural ambient lighting, no specular highlights"
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
    model: str = Field("kolors-t2i", description="Model ID")
    prompt: str = Field(..., description="Text prompt describing the image")
    negative_prompt: Optional[str] = Field(
        "blurry, low quality, deformed, distorted, cartoon, anime, 3d render, plastic skin",
        description="Negative prompt",
    )
    size: str = Field("1080x1350", description="Image dimensions WxH")
    n: int = Field(1, description="Number of images")
    seed: Optional[int] = Field(None, description="Random seed")
    steps: Optional[int] = Field(25, description="Inference steps (default: 25)")
    cfg: Optional[float] = Field(5.0, description="Guidance scale (default: 5.0)")
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

        deadline = time.time() + 1200
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
                    node = data.get("node")
                    if node is not None:
                        logger.info(f"ComfyUI Executing Node: {node}")
                    elif data.get("prompt_id") == prompt_id:
                        logger.info(f"ComfyUI Completed Workflow for prompt {prompt_id}")
                        break
        else:
            raise HTTPException(
                status_code=504, detail="Image generation timed out"
            )

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
                detail=f"Prompt ID {prompt_id} not found in execution history",
            )

        outputs = history[prompt_id].get("outputs", {})
        output_filename = None
        subfolder = ""
        img_type = "output"

        for node_id, node_output in outputs.items():
            if "images" in node_output and len(node_output["images"]) > 0:
                img_info = node_output["images"][0]
                output_filename = img_info["filename"]
                subfolder = img_info.get("subfolder", "")
                img_type = img_info.get("type", "output")
                break

        if not output_filename:
            raise HTTPException(
                status_code=500,
                detail="Workflow completed but produced no output images",
            )

        view_url = f"http://{COMFY_HOST}/view"
        params = {"filename": output_filename, "subfolder": subfolder, "type": img_type}
        img_resp = await client.get(view_url, params=params)
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
                "model": "kolors",
                "compliance": "commercial-clean (zero-insightface, openclip-bigg)",
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
            ModelCard(id="kolors-t2i", created=now),
            ModelCard(id="kolors-ipadapter-plus", created=now),
        ]
    )


@app.post("/v1/images/generations", response_model=ImageResponse)
async def generate_image(
    req: ImageGenRequest, _: bool = Depends(verify_api_key)
):
    """Text-to-image generation with Kolors UNet and ChatGLM3-6B."""
    try:
        width, height = map(int, req.size.split("x"))
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid size '{req.size}'. Format must be WxH (e.g. 1080x1350)",
        )

    wf = json.loads(json.dumps(KOLORS_T2I_WORKFLOW))
    seed = req.seed if req.seed is not None else int(time.time() * 1000) % (2**31)

    # EmptyLatentImage dimensions
    if "9" in wf:
        wf["9"]["inputs"]["width"] = width
        wf["9"]["inputs"]["height"] = height

    # Enriched prompt with candid realism styling tokens
    enriched_prompt = f"{req.prompt}{CANDID_REALISM_PROMPT}"
    if "67" in wf:
        wf["67"]["inputs"]["text"] = enriched_prompt
    if "62" in wf:
        wf["62"]["inputs"]["text"] = req.negative_prompt or ""

    # Sampler settings
    if "79" in wf:
        wf["79"]["inputs"]["seed"] = seed
        wf["79"]["inputs"]["steps"] = req.steps or 25
        wf["79"]["inputs"]["cfg"] = req.cfg or 5.0

    client_id = str(uuid.uuid4())
    b64_json = await _execute_comfy_workflow(wf, client_id)
    return ImageResponse(
        created=int(time.time()),
        data=[ImageData(b64_json=b64_json, revised_prompt=enriched_prompt)],
    )


@app.post("/v1/images/edits", response_model=ImageResponse)
async def edit_image(
    prompt: str = Form(...),
    negative_prompt: str = Form(
        "blurry, low quality, deformed, distorted, cartoon, anime, 3d render, plastic skin"
    ),
    image: UploadFile = File(...),
    size: str = Form("1080x1350"),
    seed: Optional[int] = Form(None),
    steps: Optional[int] = Form(25),
    cfg: Optional[float] = Form(5.0),
    weight: Optional[float] = Form(0.75),
    weight_type: Optional[str] = Form("linear"),
    _: bool = Depends(verify_api_key),
):
    """Identity-preserving generation using Kolors-IP-Adapter-Plus with OpenCLIP-ViT-bigG."""
    try:
        width, height = map(int, size.split("x"))
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid size '{size}'. Format must be WxH (e.g. 1080x1350)",
        )

    ext = os.path.splitext(image.filename)[1] or ".png"
    upload_filename = f"kolors_ref_{uuid.uuid4().hex[:8]}{ext}"

    content = await image.read()
    async with httpx.AsyncClient(timeout=30.0) as client:
        files = {"image": (upload_filename, content, image.content_type or "image/png")}
        up_resp = await client.post(f"http://{COMFY_HOST}/upload/image", files=files)
        if up_resp.status_code != 200:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to upload reference image to ComfyUI: {up_resp.text}",
            )

    wf = json.loads(json.dumps(KOLORS_EDIT_WORKFLOW))
    actual_seed = seed if seed is not None else int(time.time() * 1000) % (2**31)

    # Reference image input
    if "77" in wf:
        wf["77"]["inputs"]["image"] = upload_filename

    # Latent dimensions
    if "9" in wf:
        wf["9"]["inputs"]["width"] = width
        wf["9"]["inputs"]["height"] = height

    # Enriched prompt with candid realism styling tokens
    enriched_prompt = f"{prompt}{CANDID_REALISM_PROMPT}"
    if "67" in wf:
        wf["67"]["inputs"]["text"] = enriched_prompt
    if "62" in wf:
        wf["62"]["inputs"]["text"] = negative_prompt

    # IP-Adapter weight and weight_type
    if "75" in wf:
        wf["75"]["inputs"]["weight"] = weight or 0.75
        wf["75"]["inputs"]["weight_type"] = weight_type or "linear"

    # Sampler settings
    if "79" in wf:
        wf["79"]["inputs"]["seed"] = actual_seed
        wf["79"]["inputs"]["steps"] = steps or 25
        wf["79"]["inputs"]["cfg"] = cfg or 5.0

    client_id = str(uuid.uuid4())
    b64_json = await _execute_comfy_workflow(wf, client_id)
    return ImageResponse(
        created=int(time.time()),
        data=[ImageData(b64_json=b64_json, revised_prompt=enriched_prompt)],
    )
