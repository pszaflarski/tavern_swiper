# OmniGen ComfyUI Service (`omnigen_comfyui`)

Commercially compliant (Apache 2.0) OpenAI-compatible image generation and multi-reference in-context editing using **OmniGen-v1** on NVIDIA L4 GPUs (Cloud Run, `tavern-swiper-dev` / `prod`).

---

## 1. System Architecture & Resource Footprint

* **Backbone**: Single-Stream Autoregressive Multimodal Diffusion Transformer (Phi-3 3.8B language model backbone + SDXL VAE).
* **VRAM Precision**: In-VRAM FP8 quantization (`torch.float8_e4m3fn`).
  - Active VRAM Allocation: **~7.54 GB** (fits comfortably within the 24 GB NVIDIA L4 GPU).
  - Free Headroom: **~15 GB** remaining VRAM.
* **Zero Host-RAM OOM Architecture**:
  - The model architecture is instantiated on the `meta` device (`accelerate.init_empty_weights()`), allocating **0 bytes** of initial RAM.
  - Weights stream directly from disk/GCSFuse into GPU VRAM and assign in-place (`load_state_dict(ckpt, assign=True)`).
  - System host RAM consumption stays under **2 GB** (safe against Cloud Run's 32Gi cgroup limit).
* **Zero-Trust Auth**: Enforces Bearer token verification against `IMAGE_API_KEY`.

---

## 2. In-Context Prompting Strategy

Unlike traditional UNet/ControlNet/IP-Adapter pipelines that segment and warp faces with 2D affine transforms, OmniGen processes images directly as visual tokens (`<img><|image_1|></img>`, `<img><|image_2|></img>`) alongside text tokens.

### A. The Golden Rule: Active Replacement vs. Passive Placement

| Phrasing Type | Example | Behavior |
| :--- | :--- | :--- |
| ❌ **Passive Placement** | *"Place the person from image_1 into the tavern scene of image_2"* | **Fails to transfer identity.** OmniGen treats Image 2's composition as dominant and merely alters the pose of the person already in Image 2. |
| ✅ **Active Replacement** | *"Replace the person in image_2 with the person in image_1. The person from image_1 is now sitting at..."* | **Transfers identity successfully.** OmniGen treats Image 1 as the primary subject donor and Image 2 as the environment donor. |

### B. Dual-Image In-Context Syntax

When sending two images to `POST /v1/images/edits`:
* **`image` (Image 1)**: Canonical reference person / face.
* **`scene_image` (Image 2)**: Target environment / lifestyle setting.

In your prompt, reference them directly:
```text
Replace the person in image_2 with the person in image_1. The person in image_1 is now sitting at the wooden table in the tavern of image_2 holding the drink, facing the camera with a gentle smile, with natural slender arms, proportional hands, retaining the warm lighting and cozy tavern interior of image_2
```
*(The API proxy automatically maps `image_1` to `<img><|image_1|></img>` and `image_2` to `<img><|image_2|></img>`)*.

### C. Hand & Limb Anatomy Strategy

Because OmniGen uses **Phi-3 (a 3.8B LLM)** as its text encoder rather than basic CLIP, it has strong semantic comprehension of human anatomy. To avoid floating digits or limb distortion around complex objects (e.g. glass drinkware):

1. **Explicit Anatomy Phrasing**:
   Include descriptive structural keywords:
   ```text
   "...with natural slender arms, five well-defined fingers wrapped cleanly around the base of the glass, anatomically correct hands, proportional posture..."
   ```
2. **Step Allocation (25 vs. 35 Steps)**:
   * **25 Steps (~2m 10s warm)**: Excellent for macro composition and face identity. High-frequency limb boundaries (fingers, liquid refraction) may retain slight edge blurring.
   * **35 Steps (~3m 20s warm)**: Recommended for complex hand-object interactions. Gives the high-frequency spatial latents enough denoising trajectory to cleanly resolve finger joints and glass stems.
3. **Guidance Parameters**:
   * **`img_guidance_scale: 2.0`** (Default: 1.6): Higher image guidance forces the transformer to heavily prioritize the donor face features from `image_1`.
   * **`guidance_scale: 3.0`** (Default: 2.5): Higher text guidance forces strict adherence to the replacement instruction and anatomical constraints.

### D. Gaze Direction & Strabismus (Cross-Eyed) Prevention

When requesting the character to look sideways or avert their gaze, diffusion models can suffer from **diffusion strabismus (cross-eyed pupils)**. This happens because local spatial attention patches synthesize each eye independently, and the frontal reference portrait pulls the pupils inward.

To achieve clean averted gaze or candid laughter without cross-eyes:

1. **Lower Image Guidance for Head/Expression Rotation**:
   * Set **`img_guidance_scale: 1.5`** (down from 2.0). A value of 2.0 locks the face into the frontal camera-stare of the canonical portrait. 1.5 preserves bone structure and identity while giving the text encoder freedom to rotate the head and morph the expression.
2. **Conjugate Gaze Directives**:
   * Explicitly specify parallel binocular tracking:
     ```text
     "...parallel eye alignment, symmetrical gaze looking to the side, conjugate eye tracking..."
     ```
3. **Authentic Laughter Squint**:
   * When generating laughing expressions, instruct the eyelids to crinkle rather than leaving wide-open unblinking eyes:
     ```text
     "...eyes joyfully crinkled and naturally narrowed into a warm candid laugh with authentic laugh lines..."
     ```

---

## 3. Ready-to-Use Prompt Templates

### Template 1: Lifestyle / Tavern Profile Photo (Character Swap)
```text
Replace the person in image_2 with the person in image_1. The person in image_1 is now sitting at the wooden table in the tavern of image_2 holding the drink, looking toward the camera with a friendly expression, natural slender arms, five well-defined fingers, retaining the warm candlelight and cozy tavern atmosphere of image_2
```

### Template 2: Pensive Window Gaze (Looking Away)
```text
A candid 35mm lifestyle photograph of the woman in image_1 lounging comfortably on a modern fabric sofa in a Scandinavian apartment. Three-quarter profile angle, head turned looking sideways toward a large sunny window, gazing thoughtfully into the distance with a gentle contemplative expression, peaceful relaxed lips, looking completely away from the camera, soft natural daylight, 50mm lens
```
*(Recommended: `img_guidance_scale=1.5`, `guidance_scale=3.2`, `steps=35`)*

### Template 3: Spontaneous Candid Laughter (Aligned Gaze / Eye Squint)
```text
A candid 35mm street lifestyle photograph of the woman in image_1 sitting outdoors at a small round wooden bistro table at a Parisian sidewalk cafe. Three-quarter profile angle, head turned to the side laughing genuinely at an off-camera companion. Her eyes are joyfully crinkled and naturally narrowed into a warm candid laugh with authentic laugh lines, parallel eye alignment, symmetrical gaze, happy relaxed spontaneous expression looking to the side, holding a small ceramic coffee cup with two hands, natural slender arms, five well-defined fingers wrapped cleanly around the cup, 50mm lens
```
*(Recommended: `img_guidance_scale=1.5`, `guidance_scale=3.2`, `steps=35`)*

### Template 4: Outdoor Vista / Action Pose Transfer
```text
Replace the traveler in image_2 with the person in image_1. The person in image_1 is standing on the mountain overlook in image_2, facing the sunset with a subtle smile, maintaining the exact hiking outfit, lighting, and landscape from image_2
```

### Template 5: Solo Subject Conditioning (Single Image)
```text
A candid 35mm film photograph of the person in image_1 exploring a bustling fantasy marketplace, smiling naturally, ambient sunlight, highly detailed facial features
```

---

## 4. API Reference

### `POST /v1/images/edits`
Multi-reference in-context editing and subject restyling.

**Content-Type**: `multipart/form-data`

| Field | Type | Description | Recommended Value |
| :--- | :--- | :--- | :--- |
| `prompt` | `string` | In-context instruction prompt referencing `image_1` and optional `image_2` | See templates above |
| `image` | `file` | Canonical identity portrait (Image 1) | PNG/JPEG |
| `scene_image` | `file` (optional) | Target environment / lifestyle setting (Image 2) | PNG/JPEG |
| `size` | `string` | Canvas dimensions (WxH) | `"1024x1024"` |
| `steps` | `integer` | Denoising steps | `35` (quality) or `25` (speed) |
| `guidance_scale` | `float` | Text guidance weight | `3.0` |
| `img_guidance_scale` | `float` | Image reference guidance weight | `2.0` |
| `seed` | `integer` (optional) | Random seed for reproducibility | Integer |

### `POST /v1/images/generations`
Text-to-image generation without reference images.

**Content-Type**: `application/json`

```json
{
  "prompt": "35mm portrait of an elven archer in a misty forest",
  "size": "1024x1024",
  "steps": 25,
  "guidance_scale": 2.5
}
```

### `GET /health`
Returns service readiness, active GPU model, and real-time VRAM allocation.

```json
{
  "status": "healthy",
  "model": "omnigen-v1",
  "compliance": "commercial-clean (Apache 2.0, zero-insightface)",
  "comfyui": true,
  "vram": {
    "name": "cuda:0 NVIDIA L4",
    "vram_total": 23659151360,
    "vram_free": 15275965508,
    "torch_vram_total": 8522825728
  }
}
```

---

## 5. Performance & Operational Benchmarks

* **Cold Start**: ~3.5 to 5 minutes (streams 15.5GB checkpoint from GCSFuse into GPU VRAM on first request).
* **Warm Inference**:
  - 25 steps: **~155 seconds** (2m 35s).
  - 35 steps: **~207 seconds** (3m 27s).
* **Concurrency**: Set to `--concurrency=4` with `--max-instances=1` on Cloud Run.
* **Keep-Warm Cost**: Setting `--min-instances=1` keeps the GPU warm in VRAM for instant subsequent calls (~$0.70/hr).
