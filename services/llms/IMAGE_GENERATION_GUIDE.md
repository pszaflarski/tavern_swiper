# Tavern Swiper — Image Generation & Identity Guide

> **Location:** `services/llms/IMAGE_GENERATION_GUIDE.md`  
> **Audience:** AI Agents and Developers working on character portrait generation, profile photo suites, and quest/event illustrations.

---

## 1. Overview & Service Registry

Tavern Swiper runs dedicated, self-hosted image generation microservices on **Google Cloud Run (Gen2)** backed by headless **ComfyUI** and **NVIDIA L4 GPUs (24GB VRAM)**.

### Model Service Matrix

| Service | Underlying Engine | Primary Use Case | Warm Speed | API Endpoints |
|---|---|---|---|---|
| **`sdxl_comfyui`** | `RealVisXL_V4.0_Lightning` (8-step) + `IP-Adapter-Plus-Face` | **Identity-preserving character photo suites** (canonical face → multiple poses, outfits, and 3D angles). | **~8–10s** | `POST /v1/images/generations`<br>`POST /v1/images/edits` |
| **`z_image_comfyui`** | `Z-Image-Turbo` (6B S3-DiT + Qwen 3.4B text encoder) | **Hyper-realistic candid selfies** with natural skin texture, zero plastic sheen, and soft mobile phone lighting. | **~14s** | `POST /v1/images/generations`<br>`POST /v1/images/edits` |
| **`flux_comfyui`** | `FLUX.1-dev` (FP8 quantized) + PuLID | High-complexity multi-element composition and text-accurate rendering. | **~25–35s** | `POST /v1/images/generations`<br>`POST /v1/images/edits` |
| **`krea2_comfyui`** | `Krea 2 Turbo` (MMDiT + Qwen3-VL 4B) | Ultra-crisp photorealism, authentic micro-pores, and 8-step warm inference. | **~19–22s** | `POST /v1/images/generations`<br>`POST /v1/images/edits` |
| **`kolors_comfyui`** | `Kolors UNet FP8` + `ChatGLM3-6B` + OpenCLIP-ViT-bigG | **Commercially compliant** identity-preserving editing with **zero InsightFace** dependencies. | **~8–12s** | `POST /v1/images/generations`<br>`POST /v1/images/edits` |

### Environment Service URLs

| Service | Environment | URL |
|---|---|---|
| `sdxl-comfyui-dev` | `dev` | `https://sdxl-comfyui-dev-hhqol7siba-uc.a.run.app` |
| `z-image-comfyui-dev` | `dev` | `https://z-image-comfyui-dev-hhqol7siba-uc.a.run.app` |
| `flux-comfyui-dev` | `dev` | `https://flux-comfyui-dev-hhqol7siba-uc.a.run.app` |
| `krea2-comfyui-dev` | `dev` | `https://krea2-comfyui-dev-hhqol7siba-uc.a.run.app` |
| `kolors-comfyui-dev` | `dev` | `https://kolors-comfyui-dev-hhqol7siba-uc.a.run.app` |


---

## 2. Authentication

All requests to `/v1/models`, `/v1/images/generations`, and `/v1/images/edits` require the Tavern Image API key passed as a Bearer token:

```http
Authorization: Bearer sk-tavern-img-dev-8f92b7c4a1e35d6092f1b4e7c3a8e9d2
```

In Python or shell scripts, read the environment variable:
```bash
export IMAGE_API_KEY="sk-tavern-img-dev-8f92b7c4a1e35d6092f1b4e7c3a8e9d2"
```

Health check endpoints (`/health` and `/healthz`) do **not** require authentication and report GPU VRAM allocation.

---

## 3. Workflow: Generating Consistent Character Suites

To create a consistent dating profile photo suite (e.g. 1 front close-up + 3 varied scene/pose photos):

```
┌────────────────────────────────────────────────────────┐
│ Step 1: Generate Canonical Portrait                   │
│ POST /v1/images/generations                           │
│ Model: RealVisXL Lightning (8 steps)                  │
│ Output: Pristine front-facing close-up photo           │
└──────────────────────────┬─────────────────────────────┘
                           │ canonical_face.png
                           ▼
┌────────────────────────────────────────────────────────┐
│ Step 2: Inject Identity into New Poses & Scenes        │
│ POST /v1/images/edits (multipart/form-data)           │
│ Engine: IP-Adapter-Plus-Face (cross-attention)         │
│ Input: canonical_face.png + scene prompt               │
│ Output: Target pose with identical facial features    │
└────────────────────────────────────────────────────────┘
```

> **Why IP-Adapter over Post-Generation Inpainting?**  
> Post-generation face inpainting locks the subject's head angle to the source photo and creates unnatural edge halos around hair and collars. IP-Adapter injects the facial identity into the latent cross-attention layers *during* generation, enabling the character to natively turn their head in 3D, change wardrobe, and inherit the target scene's lighting organically.

---

## 4. API Request Specifications

### A. Text-to-Image (Canonical Portrait)

**Endpoint:** `POST /v1/images/generations`  
**Content-Type:** `application/json`

#### Request Payload
```json
{
  "model": "sdxl-lightning",
  "prompt": "masterpiece, raw photo of a 28yo athletic rogue woman, close-up front face portrait, natural skin texture with subtle freckles, expressive emerald green eyes, slight confident smirk, natural messy dark brown hair, natural aligned symmetrical gaze, looking directly at camera, soft natural tavern window lighting, 8k resolution, photorealistic, 35mm lens, f/1.8",
  "negative_prompt": "cross-eyed, strabismus, misaligned eyes, asymmetrical pupils, blurry, low quality, deformed, distorted, cartoon, anime, 3d render, oversaturated, plastic skin, bad anatomy",
  "size": "1024x1024",
  "steps": 8,
  "cfg": 1.2,
  "seed": 42
}
```

#### cURL Example
```bash
curl -X POST "https://sdxl-comfyui-dev-hhqol7siba-uc.a.run.app/v1/images/generations" \
  -H "Authorization: Bearer $IMAGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sdxl-lightning",
    "prompt": "raw photo of an adventurer woman, close-up face portrait, natural skin, green eyes, 35mm lens",
    "size": "1024x1024",
    "steps": 8,
    "cfg": 1.2
  }' | jq -r '.data[0].b64_json' | base64 -d > canonical_face.png
```

---

### B. Face-Conditioned Generation (New Poses & Outfits)

**Endpoint:** `POST /v1/images/edits`  
**Content-Type:** `multipart/form-data`

#### Form Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `image` | File | Required | The canonical reference portrait (PNG/JPEG). |
| `prompt` | String | Required | Target scene, posture, action, wardrobe, and lighting. |
| `negative_prompt` | String | Standard | Negative quality and defect avoidance tokens. |
| `weight` | Float | `0.48` | Identity strength (calibrated range: `0.45`–`0.52`). |
| `end_at` | Float | `0.48` | Step cutoff point (calibrated range: `0.45`–`0.55`). |
| `size` | String | `"1024x1024"` | Output resolution (`WxH`). |
| `steps` | Integer | `8` | SDXL Lightning sampling steps. |
| `cfg` | Float | `1.2` | Guidance scale (keep `1.0`–`1.5` for distilled models). |
| `seed` | Integer | Random | Integer seed for reproducibility. |

#### cURL Example
```bash
curl -X POST "https://sdxl-comfyui-dev-hhqol7siba-uc.a.run.app/v1/images/edits" \
  -H "Authorization: Bearer $IMAGE_API_KEY" \
  -F "image=@canonical_face.png" \
  -F "prompt=raw photo of the woman leaning relaxed against a rustic wooden tavern bar counter, three-quarter side angle view, head tilted, natural aligned symmetrical gaze, looking at camera, wearing a leather vest over linen shirt, warm candlelight, 35mm photo" \
  -F "negative_prompt=cross-eyed, strabismus, misaligned eyes, asymmetrical pupils, blurry, deformed, cartoon, plastic skin" \
  -F "weight=0.48" \
  -F "end_at=0.48" \
  -F "size=1024x1024" \
  -F "steps=8" \
  -F "cfg=1.2" | jq -r '.data[0].b64_json' | base64 -d > pose1_bar.png
```

---

## 5. Python Integration Snippet

Use this production-ready Python client function with `httpx`:

```python
import base64
import os
import httpx

IMAGE_API_KEY = os.environ.get("IMAGE_API_KEY", "sk-tavern-img-dev-8f92b7c4a1e35d6092f1b4e7c3a8e9d2")
SDXL_URL = "https://sdxl-comfyui-dev-hhqol7siba-uc.a.run.app"

def generate_canonical_portrait(prompt: str, seed: int = 42) -> bytes:
    """Generate a clean front-facing base portrait using SDXL Lightning."""
    headers = {"Authorization": f"Bearer {IMAGE_API_KEY}"}
    payload = {
        "model": "sdxl-lightning",
        "prompt": f"masterpiece, raw photo of {prompt}, close-up front face portrait, natural skin pores, natural aligned symmetrical gaze, 8k resolution, 35mm photograph",
        "negative_prompt": "cross-eyed, strabismus, misaligned eyes, asymmetrical pupils, blurry, deformed, cartoon, anime, 3d render, oversaturated, plastic skin",
        "size": "1024x1024",
        "steps": 8,
        "cfg": 1.2,
        "seed": seed,
    }
    # Note: Use timeout=300s to accommodate potential cold-start container boots
    resp = httpx.post(f"{SDXL_URL}/v1/images/generations", headers=headers, json=payload, timeout=300.0)
    resp.raise_for_status()
    b64 = resp.json()["data"][0]["b64_json"]
    return base64.b64decode(b64)


def generate_conditioned_pose(
    canonical_png_bytes: bytes,
    scene_prompt: str,
    weight: float = 0.48,
    end_at: float = 0.48,
    seed: int = 101,
) -> bytes:
    """Inject identity into a new scene and 3D angle via IP-Adapter-Plus-Face."""
    headers = {"Authorization": f"Bearer {IMAGE_API_KEY}"}
    files = {"image": ("canonical.png", canonical_png_bytes, "image/png")}
    data = {
        "prompt": f"raw photo of the woman {scene_prompt}, natural aligned symmetrical gaze, authentic skin texture, photorealistic, 35mm photo",
        "negative_prompt": "cross-eyed, strabismus, misaligned eyes, asymmetrical pupils, lazy eye, blurry, deformed, cartoon, plastic skin, bad anatomy",
        "weight": str(weight),
        "end_at": str(end_at),
        "size": "1024x1024",
        "steps": "8",
        "cfg": "1.2",
        "seed": str(seed),
    }
    resp = httpx.post(f"{SDXL_URL}/v1/images/edits", headers=headers, files=files, data=data, timeout=300.0)
    resp.raise_for_status()
    b64 = resp.json()["data"][0]["b64_json"]
    return base64.b64decode(b64)
```

---

## 6. Prompt Engineering & Calibration Best Practices

### A. Preventing Eye Misalignment / Cross-Eyed Gaze
Because IP-Adapter encodes tokens from the canonical photo (which typically looks straight into the camera lens), applying high adapter strength across the entire generation schedule can pull the pupils inward when generating angled or profile shots.

**The Golden Rules for Eye Alignment:**
1. **Cut Off IP-Adapter at Step 3.8/8 (`end_at: 0.48`):**  
   Facial bone structure, nose shape, and jawline are established in the first 3–4 steps. Detaching the adapter for the remaining 4 steps frees the UNet to draw natural, symmetrical pupils aligned with the head's 3D angle.
2. **Calibrated Weight (`weight: 0.48`):**  
   Avoid weights above `0.55` on 8-step distilled SDXL models.
3. **Always Include Eye Guidance in Prompts:**
   - **Positive:** `natural aligned symmetrical gaze, sharp focused clear eyes, looking at camera`
   - **Negative:** `cross-eyed, strabismus, misaligned eyes, asymmetrical pupils, lazy eye, off-center eyes`

### B. Natural Skin and Texture (Anti-Plastic Aesthetics)
- **Do NOT use:** `"hyperrealistic, unreal engine 5, octane render, smooth silky skin"`. These trigger digital CGI gloss and plastic wax surfaces.
- **DO use:** `"raw photo, authentic skin pores, subtle natural freckles, fine wrinkles, soft natural lighting, 35mm lens, f/1.8, slightly messy hair strands"`.

### C. Full-Body Dermal Realism & Head-to-Toe Framing
When generating full-body or swimwear/beach shots, standard settings can cause the model to crop at the knees and render waxy, airbrushed skin across large exposed body surfaces.

**To achieve authentic, unretouched dermal realism and head-to-toe framing:**
1. **Vertical Aspect Ratio (`768x1344`):**  
   Standard `1024x1024` or `832x1216` frequently truncates feet. `768x1344` provides the vertical canvas needed to render the entire figure from hair down to bare feet and footprints on the ground.
2. **Adapter Decoupling (`weight: 0.44`, `end_at: 0.42`):**  
   Lowering adapter weight to `0.44` and ending IP-Adapter at step 3.3/8 (`end_at: 0.42`) preserves facial identity while giving the base SDXL UNet complete freedom during later steps to render authentic human skin micro-texture on the torso and limbs.
3. **Granular Dermal Prompt Cues:**  
   `"authentic natural skin texture, visible skin pores across stomach and legs, subtle goosebumps from cool sea breeze, subtle freckling on shoulders, natural anatomical contours and soft waist fold, unretouched real human skin tone, Kodak Portra 400, fine 35mm film grain"`
4. **Anti-Airbrush & Framing Negatives:**  
   `"airbrushed skin, plastic skin, waxy skin, porcelain, rubber skin, white dots, speckles, flakes, glitter, beauty filter, airbrushed abs, poreless skin, fake tan, CGI sheen, digital smoothing, cropped feet, cropped legs, missing feet, cut off at knees, cut off at shins, close up, medium shot"`
5. **Apparel Material Specification:**  
   Specify solid, opaque fabrics (e.g., `"solid opaque terracotta-orange ribbed halter bikini top and matching tie-side bottoms"`) to prevent accidental sheer or topless rendering under low CFG (1.2–1.3).

### D. Kolors (`kolors_comfyui`) Prompt Engineering & Identity Calibration

`kolors_comfyui` uses **ChatGLM3-6B** as its text encoder and **Kolors-IP-Adapter-Plus** with **OpenCLIP-ViT-bigG** for identity-conditioned editing. Because of this unique architecture, it operates under very different rules than SDXL:

1. **Natural Language Syntax (No Tag Soup):**  
   ChatGLM3-6B is a 6-billion parameter bilingual LLM. It largely ignores SDXL-style comma-separated keyword soup (e.g. `masterpiece, 8k, best quality`) and instead responds to **grammatical English sentence structure, subject-verb-object relationships, and physical lighting cues**.

2. **The CFG 2.5 Rule:**  
   Kolors' UNet has a wide dynamic range and is extraordinarily sensitive to guidance scale.
   * **Recommended CFG: `2.5` (range: `2.0`–`2.8`).** This produces soft, authentic 35mm analog film tones, lifted shadows, and unburned skin pores.
   * **Avoid CFG > 3.5:** Setting CFG to `4.5`–`5.5` introduces hard specular edges, oversaturated skin halos, and digital contrast burn. It also *fails* to break IP-Adapter framing locks.

3. **The Verbatim "Identity Anchor Block":**  
   To prevent identity drift and eye color mutations across a 4-photo suite, define a dedicated anchor block describing the character's facial geometry and keep it **word-for-word identical** in every prompt:
   ```text
   A 31-year-old Caucasian man with a structured square jawline, relaxed straight eyebrows, deep-set hazel eyes, and a straight nose bridge. Untamed, short textured brown hair with subtle natural waves and light five-o'clock stubble shadow across his jaw. Natural, dry matte skin texture with visible pores and faint blemishes, completely non-glossy complexion.
   ```
   ChatGLM3-6B prioritizes this identical linguistic description, perfectly aligning text cross-attention with the OpenCLIP vision tokens.

4. **Anti-Plastic / Realism Lighting Suffix:**  
   Always terminate Kolors prompts with explicit camera and tone curve tokens to counter digital gloss:
   ```text
   Captured on 35mm color negative film, authentic film grain, lifted shadows, low-contrast tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections.
   ```

5. **Calibrating IP-Adapter Weights (Avoiding the Framing Trap):**  
   OpenCLIP-ViT-bigG carries 256 high-capacity vision tokens that encode not just facial identity, but the source image's framing and clothing.
   * **Bust & Medium Shots (Brewery, Cafe, Hiking):** Use weight **`0.48`–`0.52`**. Transfers 100% facial identity while allowing complete wardrobe, pose, and background changes.
   * **Full-Length Standing Shots:** Use weight **`0.32`–`0.40`** (or use a spatially scaled reference with the head occupying ~150px at the top of a 768x1280 canvas) to prevent the vision encoder from forcing a tight bust shot.
   * **Avoid weights > 0.65** on full-body prompts, as OpenCLIP will completely overwrite the prompt's wardrobe and camera distance.

6. **Active Hand Grounding & Master Anatomical Negatives:**  
   To prevent dangling arms from distorting into foot-like appendages or extra fingers:
   * **Active Limb Grounding (Positive Prompt):** Always give hands a purpose (`"both hands resting on the rustic wooden table holding a glass of beer"`, `"one hand relaxed in his jacket pocket"`, `"holding backpack strap across shoulder"`).
   * **Master Negative Prompt:**
     ```text
     plastic skin, 3d render, cgi, airbrushed, oversaturated, shiny skin, high contrast, glossy highlights, deformed, bad anatomy, blur, bad hands, deformed hands, mutated hands, extra fingers, missing fingers, fused fingers, distorted fingers, malformed limbs, deformed wrists, deformed arms, extra arms, missing arms, floating limbs, disconnected limbs, foot hands, deformed feet, bad feet, extra feet
     ```

### E. Krea 2 Turbo (MMDiT + Qwen3-VL 4B) 8-Photo Strategic Suite Guide

`krea2_comfyui` pairs an 8-step distilled **MMDiT** with **Qwen3-VL 4B** as its text encoder. Because Krea 2 operates without an external adapter network (like IP-Adapter or PuLID), identity consistency across photo suites is achieved natively through the **8-Photo Strategic Suite Methodology**:

1. **The Verbatim Linguistic Anchor Block:**
   Define a precise 50–70 word block describing immutable bone structure, eye shape and color, nasal bridge contour, ear shape, hair texture, and natural skin blemishes. Keep this block **100% word-for-word identical** across all prompts in the character's photo suite:
   ```text
   A 22-year-old Scandinavian young woman with natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across her nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed friendly smile, shoulder-length wavy honey-blonde hair falling naturally across her shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion.
   ```
2. **Text-to-Image over Img2Img for Varied Poses:**
   Unlike latent img2img (which locks head angle and crops), Krea 2 Turbo's Qwen3-VL text encoder parses full-body requests, camera distances, and room environments cleanly when driven by Text-to-Image (`POST /v1/images/generations`).
3. **Anti-Plastic Analog Suffix:**
   Counter digital over-sharpening and glossy plastic skin with an analog film suffix:
   ```text
   Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
   ```
4. **Sampler & Scheduling:**
   - **Steps:** `8` (distilled model; exceeding 10 steps introduces over-baking and edge artifacts).
   - **CFG Scale:** `1.0` (optimal for MMDiT turbo distillations).
   - **Sampler/Scheduler:** `euler` / `simple`.
   - **Warm Generation Speed:** **~23–25 seconds** on NVIDIA L4 GPU.
5. **The 8-Photo Strategic Obscuration Suite:**
   Instead of repeating front-facing portraits, construct an 8-photo suite that naturally masks micro-variations using real-world dating app tropes:
   - **1. Canonical Face Portrait:** 35mm close-up window daylight portrait.
   - **2. Canonical Body Photo:** Head-to-toe athletic swimwear studio shot.
   - **3. Cozy Dinner / Cafe:** Candlelit evening table view; face clearly visible.
   - **4. Mirror Outfit Selfie:** Phone held at eye level **blocking half the face**.
   - **5. Spontaneous Laugh:** Head cocked back laughing upward (**extreme upward angle foreshortens face**).
   - **6. Beach Bikini:** Oversized dark sunglasses (**completely conceals eye shape & pupils**).
   - **7. Scenic Overlook / Hike:** Medium-distance 3/4 rear profile looking at panoramic view.
   - **8. Bookstore / Record Store:** Downward profile browsing (**highlights jawline/nose silhouette, avoids direct gaze scrutiny**).
6. **Detailed Implementation Reference:**
   See [`services/llms/krea2_comfyui/README.md`](./krea2_comfyui/README.md) for full verified prompt texts and seeds for both Scandinavian and East Asian character suites.

---

### F. Z-Image Turbo (S3-DiT + Qwen 3.4B) 8-Photo Strategic Suite & Mobile Snapshots

`z_image_comfyui` wraps **Z-Image-Turbo** (6B S3-DiT bf16 + Qwen 3.4B causal LLM). Key rules for generating dating profile suites:

1. **Native Aspect Ratio (`896x1152`):**
   Always use `896x1152` (or `1152x896` for landscapes). Z-Image was trained on mobile phone camera proportions. `1024x1024` often forces unnatural crops.
2. **Qwen 3.4B Prompt Structure (3-Layered):**
   - **Layer 1 (Identity Prefix):** `1girl, solo, young adult woman, 22 years old, blonde caucasian woman, natural facial features and identity: [verbatim anchor block]...`
   - **Layer 2 (Scene & Action):** Conversational, natural English describing lighting, posture, and clothing.
   - **Layer 3 (Explicit Limb Grounding & Snapshot Suffix):**
     `"candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores, soft natural shadows, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy"`
3. **Warm Performance:**
   - **Per Image:** **~18–20 seconds** on NVIDIA L4 GPU.
   - **Complete 8-Photo Suite:** **~2 minutes 17 seconds** warm.
4. **Detailed Implementation Reference:**
   See [`services/llms/z_image_comfyui/README.md`](./z_image_comfyui/README.md) for full verified prompt texts and seeds (`501`–`1250`).

---

### G. The "Facial Prefix Attention Trap" & Decoupled Prompt Architecture

When generating suites using pure Text-to-Image models with causal language encoders (e.g., Qwen 3.4B in Z-Image, Qwen3-VL 4B in Krea 2):
1. **The Trap:** Reusing a front-loaded facial anchor containing detailed eye/nose/mouth tokens (`"clear piercing blue-green eyes, magnetic flirtatious gaze, straight nasal bridge, full pink lips"`) forces the model's cross-attention into generating front-facing, head-on portraits looking directly down the lens.
2. **The Override:** Downstream tokens such as `"camera 40 feet away"`, `"phone covering face"`, or `"turned away"` are overruled because early tokens receive dominant spatial attention.
3. **The Solution (Decoupled Architecture):**
   - **Canonical Face Anchor:** Retain 100% of facial descriptors to define canonical bone structure and eye color.
   - **Obscured & Distant Photos:** Strip all intrusive facial close-up tokens. Lead immediately with **camera framing, angle, and the physical obscuration mechanic** (`"mirror selfie, holding smartphone in front of face completely covering eyes nose mouth"`, `"from behind, three-quarter rear profile view, looking away toward skyline"`), retaining only macroscopic body/hair anchors.

---

### H. The 100 Instagram & Dating Photo Archetypes Taxonomy

To programmatic construct realistic 8-to-12 photo dating suites without visual repetition, Tavern Swiper maintains a complete, field-tested taxonomy of **100 distinct photo archetypes** (50 for Women, 50 for Men) segmented across three core demographics:
1. **Gen Z / College (Ages 18–24):** Anti-curation, 0.5x ultra-wide angles, flash photography, vintage streetwear, raw authenticity.
2. **Young Professionals / Millennials (Ages 25–34):** Aspirational travel, luxury fabrics (silk satin, ribbed knit, breezy linen), wellness/Pilates sets, cocktail glamour, athletic competence.
3. **Established / Mature (Ages 35+):** "Quiet luxury," architectural scale, equestrian/nautical command, tailored power suits, refined confidence.

For full prompt templates, camera angles, lighting instructions, and obscuration mechanics for all 100 archetypes, consult:
[**`instagram_archetypes_taxonomy.md`**](../../instagram_archetypes_taxonomy.md)

---


## 7. Infrastructure & Cost Rules

1. **Scale-to-Zero (`--min-instances=0`):**  
   In `dev`, both `sdxl-comfyui-dev` and `z-image-comfyui-dev` must run with `min-instances=0`. Cloud Run with GPU costs ~$0.00065/second when active and **$0.00 when idle**.
2. **Cold Starts vs. Warm Inference:**  
   - **Cold Start (0 instances):** Takes ~30–45s to boot ComfyUI + 120s on first load to stream model weights from GCS FUSE into GPU VRAM. Total first call: ~2–3 minutes.  
   - **Warm Inference:** Once loaded into VRAM, text-to-image takes **0.6 seconds** and face-conditioned generation takes **8–10 seconds**.
   - Always set HTTP client timeouts to `timeout=300.0` or `600.0` to avoid dropping connections during cold boots.
3. **Concurrency:**  
   Services enforce `--concurrency=1` to guarantee dedicated 100% GPU VRAM for the active generation without out-of-memory crashes.

---

## 8. Redeployment Runbook

To modify workflows or update dependencies and deploy to Cloud Run:

```bash
# 1. Run local service unit tests first (Rule 11)
.venv/bin/python3 -m pytest services/llms/ -v

# 2. Deploy via Cloud Build
bash scripts/deploy_llm_containers.sh dev sdxl-comfyui

# 3. Check health and GPU availability
curl https://sdxl-comfyui-dev-hhqol7siba-uc.a.run.app/health
```
