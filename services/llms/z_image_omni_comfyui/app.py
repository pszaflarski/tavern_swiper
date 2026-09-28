"""FastAPI OpenAI-Compatible Image Generation & S3-DiT Multi-Reference Service for Z-Image-Omni."""

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
logger = logging.getLogger("z_image_omni_comfyui")

app = FastAPI(
    title="Z-Image-Omni Single-Stream Multi-Modal Image Service",
    version="1.0.0",
    description="Commercially compliant (Apache 2.0) OpenAI-compatible image generation and multi-reference restyling with Z-Image-Omni on ComfyUI",
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
OMNI_WF_PATH = os.path.join(WORKFLOW_DIR, "z_image_omni_workflow_api.json")

Z_IMAGE_OMNI_WORKFLOW = {}
if os.path.exists(OMNI_WF_PATH):
    with open(OMNI_WF_PATH, "r") as f:
        Z_IMAGE_OMNI_WORKFLOW = json.load(f)

CANDID_REALISM_PROMPT = (
    ", 35mm film photograph, candid shot, dry matte skin texture, natural visible pores, "
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
    model: str = Field("z-image-omni", description="Model ID")
    prompt: str = Field(..., description="Text prompt describing the image")
    size: str = Field("896x1152", description="Image dimensions WxH")
    n: int = Field(1, description="Number of images")
    seed: Optional[int] = Field(None, description="Random seed")
    steps: Optional[int] = Field(14, description="Inference steps (default: 14)")
    cfg: Optional[float] = Field(4.0, description="Guidance scale (default: 4.0)")
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
                    logger.info(f"ComfyUI Progress: {val}/{max_v} steps")
                elif msg_type == "executing":
                    data = event.get("data", {})
                    if data.get("node") is None and data.get("prompt_id") == prompt_id:
                        logger.info(f"Execution completed for prompt {prompt_id}")
                        break

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
                "model": "z-image-omni",
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
            ModelCard(id="z-image-omni", created=now),
            ModelCard(id="z-image-turbo", created=now),
        ]
    )


@app.post("/v1/images/generations", response_model=ImageResponse)
async def generate_image(
    req: ImageGenRequest, _: bool = Depends(verify_api_key)
):
    """Text-to-image generation with Z-Image-Omni."""
    try:
        width, height = map(int, req.size.split("x"))
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid size '{req.size}'. Format must be WxH (e.g. 896x1152)",
        )

    wf = json.loads(json.dumps(Z_IMAGE_OMNI_WORKFLOW))
    seed = req.seed if req.seed is not None else int(time.time() * 1000) % (2**31)

    enriched_prompt = f"{req.prompt}{CANDID_REALISM_PROMPT}"

    # For text-to-image generation, replace LoadImage/VAEEncode with EmptySD3LatentImage
    wf.pop("4", None)
    wf.pop("5", None)
    wf["6"] = {
        "class_type": "EmptySD3LatentImage",
        "inputs": {
            "width": width,
            "height": height,
            "batch_size": 1,
        },
    }

    if "7" in wf:
        wf["7"]["inputs"]["text"] = enriched_prompt
    if "9" in wf:
        wf["9"]["inputs"]["seed"] = seed
        wf["9"]["inputs"]["steps"] = req.steps or 8
        wf["9"]["inputs"]["cfg"] = req.cfg or 1.0
        wf["9"]["inputs"]["denoise"] = 1.0
        wf["9"]["inputs"]["latent_image"] = ["6", 0]

    client_id = str(uuid.uuid4())
    b64_json = await _execute_comfy_workflow(wf, client_id)
    return ImageResponse(
        created=int(time.time()),
        data=[ImageData(b64_json=b64_json, revised_prompt=enriched_prompt)],
    )


@app.post("/v1/images/edits", response_model=ImageResponse)
async def edit_image(
    prompt: str = Form(...),
    image: UploadFile = File(..., description="Canonical reference portrait"),
    scene_image: Optional[UploadFile] = File(None, description="Optional target lifestyle scene"),
    size: str = Form("896x1152"),
    denoise: float = Form(0.55),
    seed: Optional[int] = Form(None),
    steps: Optional[int] = Form(14),
    cfg: Optional[float] = Form(4.0),
    _: bool = Depends(verify_api_key),
):
    """Multi-reference restyling using Z-Image Single-Stream Diffusion Transformer."""
    try:
        width, height = map(int, size.split("x"))
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid size '{size}'. Format must be WxH (e.g. 896x1152)",
        )

    canon_bytes = await image.read()
    if not canon_bytes:
        raise HTTPException(status_code=400, detail="Empty reference image uploaded")

    session_id = uuid.uuid4().hex[:8]
    ext1 = os.path.splitext(image.filename or "canon.png")[1] or ".png"
    canon_filename = f"z_canon_{session_id}{ext1}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        files1 = {"image": (canon_filename, canon_bytes, image.content_type or "image/png")}
        r1 = await client.post(f"http://{COMFY_HOST}/upload/image", files=files1)
        if r1.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Failed to upload canonical image: {r1.text}")

        scene_filename = canon_filename
        if scene_image is not None:
            scene_bytes = await scene_image.read()
            if scene_bytes:
                ext2 = os.path.splitext(scene_image.filename or "scene.png")[1] or ".png"
                scene_filename = f"z_scene_{session_id}{ext2}"
                files2 = {"image": (scene_filename, scene_bytes, scene_image.content_type or "image/png")}
                r2 = await client.post(f"http://{COMFY_HOST}/upload/image", files=files2)
                if r2.status_code != 200:
                    raise HTTPException(status_code=500, detail=f"Failed to upload scene image: {r2.text}")

    wf = json.loads(json.dumps(Z_IMAGE_OMNI_WORKFLOW))
    actual_seed = seed if seed is not None else int(time.time() * 1000) % (2**31)

    enriched_prompt = f"{prompt}{CANDID_REALISM_PROMPT}"

    if "4" in wf:
        wf["4"]["inputs"]["image"] = canon_filename
    if "5" in wf:
        wf["5"]["inputs"]["image"] = scene_filename
    if "7" in wf:
        wf["7"]["inputs"]["text"] = enriched_prompt
    if "9" in wf:
        wf["9"]["inputs"]["seed"] = actual_seed
        wf["9"]["inputs"]["steps"] = steps or 14
        wf["9"]["inputs"]["cfg"] = cfg or 4.0
        wf["9"]["inputs"]["denoise"] = float(denoise)

    client_id = str(uuid.uuid4())
    b64_json = await _execute_comfy_workflow(wf, client_id)
    return ImageResponse(
        created=int(time.time()),
        data=[ImageData(b64_json=b64_json, revised_prompt=enriched_prompt)],
    )
