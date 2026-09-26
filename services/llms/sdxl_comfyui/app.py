"""FastAPI OpenAI-Compatible Image Generation and Face-Conditioned Editing Proxy

for SDXL Lightning / MoP with IP-Adapter-Plus-Face on ComfyUI.
"""

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
logger = logging.getLogger("sdxl_comfyui")

app = FastAPI(
    title="SDXL Lightning & IP-Adapter Face API",
    version="1.0.0",
    description="OpenAI-compatible image generation and face-conditioned generation using SDXL and IP-Adapter-Plus-Face on ComfyUI",
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

# Load workflow templates
WORKFLOW_DIR = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(WORKFLOW_DIR, "sdxl_lightning_workflow_api.json"), "r") as f:
    SDXL_LIGHTNING_WORKFLOW = json.load(f)

with open(os.path.join(WORKFLOW_DIR, "sdxl_ipadapter_workflow_api.json"), "r") as f:
    SDXL_IPADAPTER_WORKFLOW = json.load(f)


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
    model: str = Field("sdxl-lightning", description="Model ID")
    prompt: str = Field(..., description="Text prompt describing the image")
    negative_prompt: Optional[str] = Field(
        "blurry, low quality, deformed, distorted, cartoon, anime",
        description="Negative prompt",
    )
    size: str = Field("1024x1024", description="Image dimensions WxH")
    n: int = Field(1, description="Number of images")
    seed: Optional[int] = Field(None, description="Random seed")
    steps: Optional[int] = Field(8, description="Inference steps (default: 8)")
    cfg: Optional[float] = Field(1.2, description="Guidance scale (default: 1.2)")
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
                elif msg_type == "executing":
                    data = event.get("data", {})
                    if (
                        data.get("node") is None
                        and data.get("prompt_id") == prompt_id
                    ):
                        break
        else:
            raise HTTPException(
                status_code=504, detail="Image generation timed out"
            )

    async with httpx.AsyncClient(timeout=30.0) as client:
        hist_resp = await client.get(f"http://{COMFY_HOST}/history/{prompt_id}")
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


@app.post(
    "/v1/images/generations",
    response_model=ImageResponse,
    dependencies=[Depends(verify_api_key)],
)
async def generate_image(req: ImageGenRequest):
    """Text-to-Image Generation using SDXL Lightning (8 steps)."""
    client_id = str(uuid.uuid4())
    workflow = json.loads(json.dumps(SDXL_LIGHTNING_WORKFLOW))

    try:
        width, height = map(int, req.size.split("x"))
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid size format: {req.size}"
        )

    # Inject parameters
    workflow["5"]["inputs"]["width"] = width
    workflow["5"]["inputs"]["height"] = height
    workflow["6"]["inputs"]["text"] = req.prompt
    if req.negative_prompt:
        workflow["7"]["inputs"]["text"] = req.negative_prompt

    if req.seed is not None:
        workflow["3"]["inputs"]["seed"] = req.seed
    else:
        workflow["3"]["inputs"]["seed"] = int(time.time() * 1000) % (2**31)

    if req.steps:
        workflow["3"]["inputs"]["steps"] = req.steps
    if req.cfg:
        workflow["3"]["inputs"]["cfg"] = req.cfg

    b64_image = await _execute_comfy_workflow(workflow, client_id)

    return ImageResponse(
        created=int(time.time()),
        data=[ImageData(b64_json=b64_image, revised_prompt=req.prompt)],
    )


@app.post(
    "/v1/images/edits",
    response_model=ImageResponse,
    dependencies=[Depends(verify_api_key)],
)
async def edit_image(
    image: UploadFile = File(..., description="Canonical reference face image"),
    prompt: str = Form(..., description="Description of the target scene, pose, and wardrobe"),
    negative_prompt: Optional[str] = Form(
        "blurry, low quality, deformed, distorted, cartoon, anime",
        description="Negative prompt",
    ),
    weight: float = Form(0.52, description="IP-Adapter face injection weight"),
    end_at: float = Form(0.68, description="IP-Adapter cutoff point (0.68 = step 5/8)"),
    size: str = Form("1024x1024", description="Output dimensions WxH"),
    seed: Optional[int] = Form(None, description="Random seed"),
    steps: int = Form(8, description="Sampling steps"),
    cfg: float = Form(1.2, description="CFG scale"),
):
    """Face-Conditioned Generation using IP-Adapter-Plus-Face on SDXL Lightning."""
    client_id = str(uuid.uuid4())
    workflow = json.loads(json.dumps(SDXL_IPADAPTER_WORKFLOW))

    try:
        width, height = map(int, size.split("x"))
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Invalid size format: {size}"
        )

    # Save uploaded reference image to ComfyUI input directory
    os.makedirs(COMFY_INPUT_DIR, exist_ok=True)
    input_filename = f"canonical_face_{uuid.uuid4().hex[:12]}.png"
    input_path = os.path.join(COMFY_INPUT_DIR, input_filename)

    image_bytes = await image.read()
    with open(input_path, "wb") as f:
        f.write(image_bytes)

    # Wire parameters into IP-Adapter workflow
    workflow["1"]["inputs"]["image"] = input_filename
    workflow["6"]["inputs"]["width"] = width
    workflow["6"]["inputs"]["height"] = height
    workflow["7"]["inputs"]["text"] = prompt
    if negative_prompt:
        workflow["8"]["inputs"]["text"] = negative_prompt

    workflow["5"]["inputs"]["weight"] = weight
    workflow["5"]["inputs"]["end_at"] = end_at

    if seed is not None:
        workflow["9"]["inputs"]["seed"] = seed
    else:
        workflow["9"]["inputs"]["seed"] = int(time.time() * 1000) % (2**31)

    workflow["9"]["inputs"]["steps"] = steps
    workflow["9"]["inputs"]["cfg"] = cfg

    b64_image = await _execute_comfy_workflow(workflow, client_id)

    # Clean up uploaded temp image
    try:
        if os.path.exists(input_path):
            os.remove(input_path)
    except Exception:
        pass

    return ImageResponse(
        created=int(time.time()),
        data=[ImageData(b64_json=b64_image, revised_prompt=prompt)],
    )


@app.get(
    "/v1/models",
    response_model=ModelListResponse,
    dependencies=[Depends(verify_api_key)],
)
async def list_models():
    now = int(time.time())
    return ModelListResponse(
        data=[
            ModelCard(id="sdxl-lightning", created=now),
            ModelCard(id="realvisxl-lightning", created=now),
            ModelCard(id="sdxl-ipadapter-face", created=now),
        ]
    )


@app.get("/health")
@app.get("/healthz")
async def health_check():
    """Health check endpoint: verifies ComfyUI readiness and GPU status."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"http://{COMFY_HOST}/system_stats")
            if resp.status_code != 200:
                return {
                    "status": "degraded",
                    "comfyui": False,
                    "error": f"ComfyUI returned status {resp.status_code}",
                }
            stats = resp.json()
            devices = stats.get("devices", [])
            gpu_info = devices[0] if devices else {"name": "cpu", "type": "cpu"}
            return {
                "status": "healthy",
                "comfyui": True,
                "vram": gpu_info,
            }
    except Exception as e:
        return {
            "status": "unhealthy",
            "comfyui": False,
            "error": str(e),
        }
