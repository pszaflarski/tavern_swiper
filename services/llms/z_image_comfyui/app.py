"""FastAPI OpenAI-Compatible Image Generation & Editing API for Z-Image-Turbo."""

import asyncio
import base64
import json
import os
import time
import uuid
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import httpx
from pydantic import BaseModel, Field
import websockets

app = FastAPI(
    title="Z-Image-Turbo Image Generation & Editing Service",
    description="OpenAI-compatible Image API backed by Headless ComfyUI on Cloud Run GPU.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

COMFY_HOST = os.environ.get("COMFY_HOST", "127.0.0.1:8188")
COMFY_INPUT_DIR = "/tmp/comfyui_input"

TURBO_WORKFLOW_PATH = "/app/z_image_turbo_workflow_api.json"
EDIT_WORKFLOW_PATH = "/app/z_image_edit_workflow_api.json"

with open(TURBO_WORKFLOW_PATH, "r") as f:
    BASE_TURBO_WORKFLOW = json.load(f)

with open(EDIT_WORKFLOW_PATH, "r") as f:
    BASE_EDIT_WORKFLOW = json.load(f)

# Node IDs in workflows
NODE_PROMPT = "5"       # CLIPTextEncode (positive)
NODE_LATENT = "7"       # EmptySD3LatentImage (dimensions)
NODE_SAMPLER = "8"      # KSampler (seed, steps, denoise)

# Edit specific node IDs
NODE_EDIT_IMAGE = "14"   # LoadImage (reference face/image)
NODE_EDIT_SAMPLER = "8" # KSampler (denoise)


class ImageGenRequest(BaseModel):
    model: str = Field("z-image-turbo", description="Model ID")
    prompt: str = Field(..., description="Text prompt describing the image")
    size: str = Field("896x1152", description="Image dimensions WxH")
    n: int = Field(1, description="Number of images (only 1 supported)")
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

        # Wait for execution to complete (timeout after 20 minutes)
        deadline = time.time() + 1200
        while time.time() < deadline:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=30.0)
            except asyncio.TimeoutError:
                continue

            if isinstance(msg, str):
                event = json.loads(msg)
                if event.get("type") == "executing":
                    data = event.get("data", {})
                    if (data.get("node") is None
                            and data.get("prompt_id") == prompt_id):
                        break
        else:
            raise HTTPException(
                status_code=504, detail="Image generation timed out"
            )

    # Fetch result from ComfyUI history
    async with httpx.AsyncClient(timeout=30.0) as client:
        hist_resp = await client.get(
            f"http://{COMFY_HOST}/history/{prompt_id}"
        )
        outputs = hist_resp.json().get(prompt_id, {}).get("outputs", {})

        output_filename = None
        subfolder = ""
        img_type = "output"
        for node_id in outputs:
            if "images" in outputs[node_id]:
                img_info = outputs[node_id]["images"][0]
                output_filename = img_info["filename"]
                subfolder = img_info.get("subfolder", "")
                img_type = img_info.get("type", "output")
                break

        if output_filename is None:
            raise HTTPException(
                status_code=500, detail="No output image found in ComfyUI result"
            )

        img_resp = await client.get(
            f"http://{COMFY_HOST}/view",
            params={
                "filename": output_filename,
                "subfolder": subfolder,
                "type": img_type,
            },
        )
        return base64.b64encode(img_resp.content).decode("utf-8")


@app.post("/v1/images/generations", response_model=ImageResponse)
async def generate_image(req: ImageGenRequest):
    """Text-to-Image Generation using Z-Image-Turbo (8 steps)."""
    client_id = str(uuid.uuid4())
    workflow = json.loads(json.dumps(BASE_TURBO_WORKFLOW))

    try:
        width, height = map(int, req.size.split("x"))
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid size format: {req.size}"
        )

    workflow[NODE_PROMPT]["inputs"]["text"] = req.prompt
    workflow[NODE_LATENT]["inputs"]["width"] = width
    workflow[NODE_LATENT]["inputs"]["height"] = height
    workflow[NODE_SAMPLER]["inputs"]["seed"] = int(time.time() * 1000) % (2**31)

    try:
        b64_str = await _execute_comfy_workflow(workflow, client_id)
        return ImageResponse(
            created=int(time.time()),
            data=[ImageData(b64_json=b64_str, revised_prompt=req.prompt)],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Generation failed: {str(e)}"
        )


@app.post("/v1/images/edits", response_model=ImageResponse)
async def edit_image(
    image: UploadFile = File(..., description="Reference face image"),
    prompt: str = Form(..., description="Prompt describing the new scene or variation"),
    denoise: float = Form(
        0.65, description="Image editing denoise strength (0.3 to 0.85)"
    ),
    seed: Optional[int] = Form(None, description="Random seed"),
):
    """Image-to-Image Editing using Z-Image Latent Conditioning."""
    client_id = str(uuid.uuid4())
    workflow = json.loads(json.dumps(BASE_EDIT_WORKFLOW))

    # Save uploaded reference image directly to ComfyUI input directory
    os.makedirs(COMFY_INPUT_DIR, exist_ok=True)
    ref_filename = f"ref_{uuid.uuid4().hex[:12]}.png"
    ref_filepath = os.path.join(COMFY_INPUT_DIR, ref_filename)

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty reference image uploaded")

    with open(ref_filepath, "wb") as f:
        f.write(image_bytes)

    # Configure edit workflow
    workflow[NODE_EDIT_IMAGE]["inputs"]["image"] = ref_filename
    workflow[NODE_PROMPT]["inputs"]["text"] = prompt
    workflow[NODE_EDIT_SAMPLER]["inputs"]["denoise"] = float(denoise)

    if seed is not None:
        workflow[NODE_EDIT_SAMPLER]["inputs"]["seed"] = seed
    else:
        workflow[NODE_EDIT_SAMPLER]["inputs"]["seed"] = int(time.time() * 1000) % (2**31)

    try:
        b64_str = await _execute_comfy_workflow(workflow, client_id)
        return ImageResponse(
            created=int(time.time()),
            data=[ImageData(b64_json=b64_str, revised_prompt=prompt)],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Editing failed: {str(e)}")
    finally:
        if os.path.exists(ref_filepath):
            try:
                os.remove(ref_filepath)
            except OSError:
                pass


@app.get("/v1/models", response_model=ModelListResponse)
async def list_models():
    now = int(time.time())
    return ModelListResponse(
        data=[
            ModelCard(id="z-image-turbo", created=now),
            ModelCard(id="z-image-edit", created=now),
        ]
    )


@app.get("/health")
@app.get("/healthz")
async def health():
    """Health check validating ComfyUI responsiveness."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"http://{COMFY_HOST}/system_stats")
            if r.status_code == 200:
                stats = r.json()
                return {
                    "status": "healthy",
                    "comfyui": True,
                    "vram": stats.get("devices", [{}])[0]
                    if stats.get("devices")
                    else {},
                }
    except Exception:
        pass
    raise HTTPException(status_code=503, detail="ComfyUI not ready")
