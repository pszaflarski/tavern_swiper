"""FastAPI OpenAI-Compatible Image Generation & Editing API for Z-Image-Turbo."""

import asyncio
import base64
import io
import json
import os
import time
import uuid
from typing import Optional

import cv2
from fastapi import Depends, FastAPI, File, Form, HTTPException, Security, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import httpx
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from pydantic import BaseModel, Field
import websockets

security = HTTPBearer(auto_error=False)


def verify_api_key(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security),
):
    """Validate Bearer API key if IMAGE_API_KEY environment variable is configured."""
    expected_key = os.environ.get("IMAGE_API_KEY")
    if not expected_key:
        return
    if not credentials or credentials.credentials != expected_key:
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing API key. Provide 'Authorization: Bearer <key>'",
            headers={"WWW-Authenticate": "Bearer"},
        )


app = FastAPI(
    title="Z-Image-Turbo Image Generation & Editing Service",
    description="OpenAI-compatible Image API backed by Headless ComfyUI on Cloud Run GPU.",
    version="1.1.0",
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

TURBO_WORKFLOW_PATH = os.path.join(
    os.path.dirname(__file__), "z_image_turbo_workflow_api.json"
)
EDIT_WORKFLOW_PATH = os.path.join(
    os.path.dirname(__file__), "z_image_edit_workflow_api.json"
)
INPAINT_WORKFLOW_PATH = os.path.join(
    os.path.dirname(__file__), "z_image_inpaint_workflow_api.json"
)

with open(TURBO_WORKFLOW_PATH, "r") as f:
    BASE_TURBO_WORKFLOW = json.load(f)

with open(EDIT_WORKFLOW_PATH, "r") as f:
    BASE_EDIT_WORKFLOW = json.load(f)

with open(INPAINT_WORKFLOW_PATH, "r") as f:
    BASE_INPAINT_WORKFLOW = json.load(f)

# Node IDs in workflows
NODE_PROMPT = "5"       # CLIPTextEncode (positive)
NODE_LATENT = "7"       # EmptySD3LatentImage (dimensions)
NODE_SAMPLER = "8"      # KSampler (seed, steps, denoise)

# Edit specific node IDs
NODE_EDIT_IMAGE = "14"   # LoadImage (reference face/image)
NODE_EDIT_SAMPLER = "8" # KSampler (denoise)

# Inpaint specific node IDs
NODE_INPAINT_IMAGE = "14"   # LoadImage (reference image)
NODE_INPAINT_MASK = "16"    # LoadImage (mask image)
NODE_INPAINT_PROMPT = "5"   # CLIPTextEncode (prompt)
NODE_INPAINT_SAMPLER = "8"  # KSampler (denoise, seed)


def generate_face_protection_mask(image_bytes: bytes, feather_radius: int = 25) -> bytes:
    """Detects face/head and returns a feathered inpainting mask (PNG bytes).

    - 0 (Black): Head, face, and hair (Preserved / Protected)
    - 255 (White): Clothing, body, and background (Inpainted / Redrawn)
    """
    img = Image.open(io.BytesIO(image_bytes))
    w, h = img.size

    mask = Image.new("L", (w, h), 255)
    draw = ImageDraw.Draw(mask)

    np_img = np.array(img.convert("RGB"))
    face_detected = False
    head_box = None

    try:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        if hasattr(cv2, "CascadeClassifier") and os.path.exists(cascade_path):
            face_cascade = cv2.CascadeClassifier(cascade_path)
            gray = cv2.cvtColor(np_img, cv2.COLOR_RGB2GRAY)
            faces = face_cascade.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=4, minSize=(int(w * 0.1), int(h * 0.1))
            )
            if len(faces) > 0:
                largest_face = max(faces, key=lambda f: f[2] * f[3])
                fx, fy, fw, fh = largest_face
                x1 = max(0, int(fx - 0.25 * fw))
                x2 = min(w, int(fx + 1.25 * fw))
                y1 = max(0, int(fy - 0.55 * fh))
                y2 = min(h, int(fy + 1.35 * fh))
                head_box = [x1, y1, x2, y2]
                face_detected = True
    except Exception:
        pass

    if not face_detected or head_box is None:
        cx = w // 2
        cy = int(h * 0.22)
        rx = int(w * 0.22)
        ry = int(h * 0.20)
        head_box = [cx - rx, cy - ry, cx + rx, cy + ry]

    draw.ellipse(head_box, fill=0)
    feathered = mask.filter(ImageFilter.GaussianBlur(radius=feather_radius))

    out_buf = io.BytesIO()
    feathered.save(out_buf, format="PNG")
    return out_buf.getvalue()


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


@app.post(
    "/v1/images/generations",
    response_model=ImageResponse,
    dependencies=[Depends(verify_api_key)],
)
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


@app.post(
    "/v1/images/edits",
    response_model=ImageResponse,
    dependencies=[Depends(verify_api_key)],
)
async def edit_image(
    image: UploadFile = File(..., description="Reference face image"),
    mask: Optional[UploadFile] = File(
        None, description="Optional inpaint mask (white=modify/inpaint, black=preserve)"
    ),
    prompt: str = Form(..., description="Prompt describing the new scene or variation"),
    preserve_face: bool = Form(
        True, description="Automatically protect face and hair during scene changes"
    ),
    denoise: float = Form(
        0.85, description="Image editing denoise strength (0.3 to 1.0)"
    ),
    seed: Optional[int] = Form(None, description="Random seed"),
):
    """Image-to-Image Editing with Face-Preserving Latent Noise Masking."""
    client_id = str(uuid.uuid4())

    os.makedirs(COMFY_INPUT_DIR, exist_ok=True)
    ref_filename = f"ref_{uuid.uuid4().hex[:12]}.png"
    ref_filepath = os.path.join(COMFY_INPUT_DIR, ref_filename)

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty reference image uploaded")

    with open(ref_filepath, "wb") as f:
        f.write(image_bytes)

    mask_filename = None
    mask_filepath = None
    use_inpaint = False

    # Check for client-provided mask
    if mask is not None:
        mask_bytes = await mask.read()
        if mask_bytes:
            mask_filename = f"mask_{uuid.uuid4().hex[:12]}.png"
            mask_filepath = os.path.join(COMFY_INPUT_DIR, mask_filename)
            with open(mask_filepath, "wb") as f:
                f.write(mask_bytes)
            use_inpaint = True
    elif preserve_face:
        # Generate automatic head and face protection mask
        try:
            auto_mask_bytes = generate_face_protection_mask(image_bytes)
            mask_filename = f"mask_auto_{uuid.uuid4().hex[:12]}.png"
            mask_filepath = os.path.join(COMFY_INPUT_DIR, mask_filename)
            with open(mask_filepath, "wb") as f:
                f.write(auto_mask_bytes)
            use_inpaint = True
        except Exception:
            use_inpaint = False

    if use_inpaint and mask_filename:
        workflow = json.loads(json.dumps(BASE_INPAINT_WORKFLOW))
        workflow[NODE_INPAINT_IMAGE]["inputs"]["image"] = ref_filename
        workflow[NODE_INPAINT_MASK]["inputs"]["image"] = mask_filename
        workflow[NODE_INPAINT_PROMPT]["inputs"]["text"] = prompt
        workflow[NODE_INPAINT_SAMPLER]["inputs"]["denoise"] = float(denoise)
        if seed is not None:
            workflow[NODE_INPAINT_SAMPLER]["inputs"]["seed"] = seed
        else:
            workflow[NODE_INPAINT_SAMPLER]["inputs"]["seed"] = int(time.time() * 1000) % (2**31)
    else:
        workflow = json.loads(json.dumps(BASE_EDIT_WORKFLOW))
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
        for p in [ref_filepath, mask_filepath]:
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass


@app.get(
    "/v1/models",
    response_model=ModelListResponse,
    dependencies=[Depends(verify_api_key)],
)
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
