import base64
import json
import os
import time
import uuid

import httpx
import websockets
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

COMFY_HOST = os.getenv("COMFY_HOST", "127.0.0.1:8188")
WORKFLOW_PATH = os.path.join(os.path.dirname(__file__), "flux_realism_workflow_api.json")

app = FastAPI(title="FLUX.1 Realism Image Generation Service", version="1.0.0")

# Load template workflow at import time
with open(WORKFLOW_PATH, "r") as f:
    BASE_WORKFLOW = json.load(f)

# Node IDs in our workflow (must match flux_realism_workflow_api.json)
NODE_PROMPT = "5"       # CLIPTextEncode (positive)
NODE_LATENT = "7"       # EmptySD3LatentImage (dimensions)
NODE_SAMPLER = "8"      # KSampler (seed)

# Anti-gloss prompt injection for photorealism
REALISM_TRIGGER = (
    ", candid shot, natural skin micro-texture with pores, flyaway hair strands, "
    "ambient natural room lighting, shot on 35mm f/2.0, subtle sensor grain, "
    "casual amateur composition"
)


class ImageGenRequest(BaseModel):
    model: str = Field("flux-1-realism", description="Model ID (ignored, single model)")
    prompt: str = Field(..., description="Text prompt describing the image")
    size: str = Field("1080x1350", description="Image dimensions WxH")
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


@app.post("/v1/images/generations", response_model=ImageResponse)
async def generate_image(req: ImageGenRequest):
    client_id = str(uuid.uuid4())
    workflow = json.loads(json.dumps(BASE_WORKFLOW))

    # Parse dimensions
    try:
        width, height = map(int, req.size.split("x"))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid size format: {req.size}")

    # Inject prompt, dimensions, and random seed
    enriched_prompt = f"{req.prompt}{REALISM_TRIGGER}"
    workflow[NODE_PROMPT]["inputs"]["text"] = enriched_prompt
    workflow[NODE_LATENT]["inputs"]["width"] = width
    workflow[NODE_LATENT]["inputs"]["height"] = height
    workflow[NODE_SAMPLER]["inputs"]["seed"] = int(time.time() * 1000) % (2**31)

    # Submit to ComfyUI via WebSocket
    ws_url = f"ws://{COMFY_HOST}/ws?clientId={client_id}"
    prompt_payload = {"prompt": workflow, "client_id": client_id}

    try:
        async with websockets.connect(ws_url, close_timeout=5) as ws:
            # Submit prompt
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"http://{COMFY_HOST}/prompt", json=prompt_payload
                )
                if resp.status_code != 200:
                    raise HTTPException(
                        status_code=500,
                        detail=f"ComfyUI rejected prompt: {resp.text}"
                    )
                prompt_id = resp.json()["prompt_id"]

            # Wait for execution to complete (timeout after 10 minutes)
            import asyncio
            deadline = time.time() + 600
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
            outputs = hist_resp.json()[prompt_id]["outputs"]

            # Find first output image
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
            b64_str = base64.b64encode(img_resp.content).decode("utf-8")

        return ImageResponse(
            created=int(time.time()),
            data=[ImageData(b64_json=b64_str, revised_prompt=enriched_prompt)],
        )

    except websockets.exceptions.WebSocketException as e:
        raise HTTPException(
            status_code=503, detail=f"ComfyUI WebSocket error: {str(e)}"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Generation failed: {str(e)}"
        )


@app.get("/v1/models", response_model=ModelListResponse)
async def list_models():
    return ModelListResponse(
        data=[ModelCard(id="flux-1-realism", created=int(time.time()))]
    )


@app.get("/health")
@app.get("/healthz")
async def health():
    """Check that ComfyUI is up and responsive."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"http://{COMFY_HOST}/system_stats")
            if r.status_code == 200:
                stats = r.json()
                return {
                    "status": "healthy",
                    "comfyui": True,
                    "vram": stats.get("devices", [{}])[0] if stats.get("devices") else {},
                }
    except Exception:
        pass
    raise HTTPException(status_code=503, detail="ComfyUI not ready")
