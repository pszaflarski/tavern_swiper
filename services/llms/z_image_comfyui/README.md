# Z-Image Turbo ComfyUI Service — Prompting & Suite Strategy Guide

> **Service Location:** `services/llms/z_image_comfyui/`  
> **Underlying Engine:** Z-Image-Turbo (S3-DiT bf16, ~6B parameters) + Qwen 3.4B Causal LLM Text Encoder + AE VAE  
> **Inference Speed:** **~18–20 seconds** warm per 896x1152 portrait on Google Cloud Run Gen2 (1x NVIDIA L4 GPU).  
> **Dev Service:** `z-image-comfyui-dev` (`https://z-image-comfyui-dev-hhqol7siba-uc.a.run.app`)

---

## 1. Architectural Overview & Why Anchoring Works

`z_image_comfyui` wraps **Z-Image-Turbo**, an advanced distilled DiT architecture powered by an Alibaba **Qwen 3.4B** causal language model as its text encoder.

### Key Architectural Characteristics
1. **True Causal LLM Text Understanding:**
   Unlike CLIP-based diffusion models that treat prompts as an unordered bag of keywords, Qwen 3.4B parses syntax, subject counts, spatial geometry, and causal sequences literally.
2. **Native Mobile Aspect Ratio (896x1152):**
   Z-Image-Turbo was trained heavily on modern vertical smartphone photography (`896x1152`). Using standard square `1024x1024` often forces awkward body crops, whereas `896x1152` yields natural candid framing, full torso/leg proportions, and lifelike phone snapshot perspectives.
3. **Pure Text-to-Image Freedom (Zero Spatial Tethering):**
   Generating dating profile photo suites via Text-to-Image (`POST /v1/images/generations`) avoids the spatial locks of IP-Adapter or latent img2img. The character can seamlessly switch between close-up portraits, mirror selfies, beach lounging, and mountain hiking without reference pixel artifacts.
4. **Linguistic Anchoring via Front-Loaded Identity:**
   Placing an identical **Identity Prefix** at the start of every prompt forces Qwen 3.4B to configure the exact same bone structure, eye shape, nose bridge, smile, hair color/texture, and freckles across completely different camera angles and scenes.

---

## 2. Prompt Syntax Rules for Z-Image Turbo

To achieve maximum photorealism and avoid visual artifacts on Z-Image Turbo, structure prompts into three distinct layers:

### Layer 1: The Front-Loaded Identity Prefix
Always start with tag-based subject grounding followed by the immutable facial description:
```text
1girl, solo, young adult woman, 22 years old, blonde caucasian woman, natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed smile, shoulder-length wavy honey-blonde hair falling naturally across shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion
```

### Layer 2: Scene, Lighting, Wardrobe, and Pose
Describe the environment, action, and lighting naturally in conversational English:
```text
photorealistic intimate evening dinner photograph, sitting at a small rustic dark wooden table in a cozy dim wine bar bistro, her face clearly visible illuminated by soft warm candlelight and gentle ambient glow, leaning forward slightly with an engaging genuine warm smile looking directly across the table at the viewer, one hand gently holding the stem of a glass of red wine on the table, the other resting relaxed on the table edge, wearing a fitted forest green ribbed knit sweater, soft blurred ambient restaurant bokeh
```

### Layer 3: Explicit Limb Grounding & Realism Suffix
Because causal LLMs parse anatomy literally, explicitly specify limb counts to prevent duplicate hands or phantom arms during complex poses:
```text
candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores, soft natural shadows, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy
```

---

## 3. The 8-Photo Strategic Suite: Concept & Obscuration Masking

Generating 8 near-identical front-facing headshots encourages viewers to spot micro-discrepancies between generations. The **8-Photo Strategic Suite** solves this by combining **2 canonical anchors** with **6 dynamic lifestyle photos** that strategically angle, foreshorten, or obscure features using natural dating app tropes:

| # | Photo Concept | Framing & Angle | Strategic Masking Function |
|---|---|---|---|
| **1** | **Canonical Face Portrait** | 35mm close-up window portrait | Establishes facial likeness, eye color, freckles, and smile. |
| **2** | **Canonical Body Photo** | Head-to-toe athletic swimwear studio | Establishes overall proportions, athletic build, and height. |
| **3** | **Lifestyle 1: Cozy Dinner / Cafe** | Intimate eye-level table view | Reaffirms facial identity in an authentic warm social context. |
| **4** | **Lifestyle 2: Mirror Outfit Selfie** | Handheld phone at eye level | **Hides half the facial plane** behind the smartphone; highlights outfit. |
| **5** | **Lifestyle 3: Spontaneous Laugh** | Head cocked back, laughing upward | **Foreshortens facial features** via extreme upward head tilt. |
| **6** | **Lifestyle 4: Beach Bikini** | Relaxed sand lounge with sunglasses | **Conceals eye shape and pupils** completely behind dark sunglasses. |
| **7** | **Lifestyle 5: Mountain Summit Hike** | Medium-distance 3/4 rear profile | **Emphasizes silhouette and hair** while turning face away toward the view. |
| **8** | **Lifestyle 6: Vinyl Record Store** | Head tilted downward browsing crates | **Highlights jawline and nose bridge** while downward gaze avoids direct gaze scrutiny. |

---

## 4. Golden Reference Implementation: Scandinavian Character Suite

This exact suite was generated and verified live on `z-image-comfyui-dev` (Resolution: `896x1152`, Steps: `8`, Scheduler: `simple`, Sampler: `euler`, CFG: `1.0`).

### Master Identity Anchor
```text
1girl, solo, young adult woman, 22 years old, blonde caucasian woman, natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed smile, shoulder-length wavy honey-blonde hair falling naturally across shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion
```

### Master Realism Suffix
```text
candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores, soft natural shadows, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy
```

---

### The 8 Working Prompts (Verbatim)

#### 1. Canonical Face Portrait
```text
1girl, solo, young adult woman, 22 years old, blonde caucasian woman, natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed smile, shoulder-length wavy honey-blonde hair falling naturally across shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion, photorealistic candid front face portrait, looking directly at the camera with clear aligned symmetrical gaze, sitting relaxed near a large window in a bright neutral Scandinavian apartment, wearing a simple casual white cotton linen top, soft diffused overcast natural window daylight, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores, soft natural shadows, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy
```
*Settings:* Seed `501`, Size `896x1152`. Output: `z_image_suite_1_canonical_face.png`.

#### 2. Canonical Body Photo
```text
1girl, solo, young adult woman, 22 years old, blonde caucasian woman, natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed smile, shoulder-length wavy honey-blonde hair falling naturally across shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion, photorealistic full-length photograph showing head to bare feet, standing relaxed in a bright minimalist photo studio, wearing simple solid black two-piece athletic swimwear, standing barefoot on clean neutral floor, complete head to toe full body view, soft natural studio daylight, natural balanced proportions, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores, soft natural shadows, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy
```
*Settings:* Seed `601`, Size `896x1152`. Output: `z_image_suite_2_canonical_body.png` (20.8s warm).

#### 3. Lifestyle 1: Evening Dinner / Wine Bar (Face Clearly Visible)
```text
1girl, solo, young adult woman, 22 years old, blonde caucasian woman, natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed smile, shoulder-length wavy honey-blonde hair falling naturally across shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion, photorealistic intimate evening dinner photograph, sitting at a small rustic dark wooden table in a cozy dim wine bar bistro, her face clearly visible illuminated by soft warm candlelight and gentle ambient glow, leaning forward slightly with an engaging genuine warm smile looking directly across the table at the viewer, one hand gently holding the stem of a glass of red wine on the table, the other resting relaxed on the table edge, wearing a fitted forest green ribbed knit sweater, soft blurred ambient restaurant bokeh, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores, soft natural shadows, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy
```
*Settings:* Seed `705`, Size `896x1152`. Output: `z_image_suite_3_lifestyle_dinner_face.png` (18.8s warm).

#### 4. Lifestyle 2: Mirror Selfie (Face Half-Obscured by Phone)
```text
1girl, solo, young adult woman, 22 years old, blonde caucasian woman, natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed smile, shoulder-length wavy honey-blonde hair falling naturally across shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion, candid modern smartphone mirror selfie, standing in front of a wide full-length bedroom mirror, holding her smartphone up with one hand taking an outfit mirror photo. The smartphone is held up near eye level, partially covering and blocking half of her face, while her other eye, cheek, and confident subtle smile are clearly visible beside the phone. Wearing high-waisted vintage washed blue denim jeans and a fitted ribbed cream crop top showing her athletic toned midriff, wavy honey-blonde hair tumbling casually over one shoulder, cozy bedroom background with soft warm ambient lighting, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores, soft natural shadows, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy
```
*Settings:* Seed `815`, Size `896x1152`. Output: `z_image_suite_4_mirror_selfie_half_obscured.png` (18.4s warm).

#### 5. Lifestyle 3: Laughing Photo (Head Cocked Back)
```text
1girl, solo, young adult woman, 22 years old, blonde caucasian woman, natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed smile, shoulder-length wavy honey-blonde hair falling naturally across shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion, candid outdoor photograph, caught in a spontaneous burst of joyful hysterical laughter, her head cocked back and tilted upward toward the open sky, her neck extended naturally and her face largely obscured and foreshortened by the extreme upward angle, eyes crinkled tightly shut in genuine laughter with a wide happy open-mouth laugh showing straight white teeth, her wavy honey-blonde hair tossing back over her shoulders with motion energy, one hand casually raised to her collarbone in mid-laugh, sitting outdoors on a sun-drenched cafe terrace table with friends, warm golden afternoon sunlight creating bright rim highlights in her hair, unposed spontaneous laughter moment, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores, soft natural shadows, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy
```
*Settings:* Seed `922`, Size `896x1152`. Output: `z_image_suite_5_laughing_head_cocked_back.png` (18.4s warm).

#### 6. Lifestyle 4: Beach Bikini with Sunglasses
```text
1girl, solo, young adult woman, 22 years old, blonde caucasian woman, natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed smile, shoulder-length wavy honey-blonde hair falling naturally across shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion, candid beach vacation photograph, lounging relaxed on a soft white beach towel on golden sand at a coastal Mediterranean beach, wearing dark stylish oversized tortoiseshell sunglasses that completely conceal her eyes, wearing a chic textured ribbed terracotta-orange bikini, athletic feminine physique and toned abdomen, warm sun-kissed skin with light freckles on shoulders, leaning back comfortably on one elbow in the sand, a relaxed gentle smile on her lips, wavy honey-blonde beach hair lightly tousled by ocean breeze, clear turquoise sea waves and distant sunny coastline softly blurred in background bokeh, natural midday coastal sun, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores, soft natural shadows, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy
```
*Settings:* Seed `1035`, Size `896x1152`. Output: `z_image_suite_6_beach_sunglasses_bikini.png` (19.0s warm).

#### 7. Lifestyle 5: Mountain Summit Hike (Distant 3/4 Rear Profile)
```text
1girl, solo, young adult woman, 22 years old, blonde caucasian woman, natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed smile, shoulder-length wavy honey-blonde hair falling naturally across shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion, candid outdoor adventure photograph, standing on a rocky mountain summit overlook along an alpine ridge trail, viewed from a natural medium-distance. Her head is turned in three-quarter rear profile, gazing out over a breathtaking panoramic mountain valley and distant blue alpine lake below, her face seen in profile silhouette with the wind blowing wisps of honey-blonde hair from a loose messy textured ponytail, athletic build wearing dark fitted hiking leggings, trail shoes, and a light technical windbreaker tied around her waist, both hands resting naturally on her hips enjoying the majestic mountain view, crisp high-altitude air, clear blue sky with gentle sun flare, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores, soft natural shadows, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy
```
*Settings:* Seed `1142`, Size `896x1152`. Output: `z_image_suite_7_mountain_summit_hike.png` (22.1s warm).

#### 8. Lifestyle 6: Vinyl Record Store (Browsing Downward)
```text
1girl, solo, young adult woman, 22 years old, blonde caucasian woman, natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed smile, shoulder-length wavy honey-blonde hair falling naturally across shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion, candid indoor lifestyle photograph, standing inside a cozy dimly-lit vintage vinyl record shop, leaning over a wooden record crate browsing through album sleeves. Her head is tilted downward in three-quarter profile, her gaze cast down intently at the record album in her hands, face framed by loose strands of wavy honey-blonde hair falling forward naturally, delicate straight nose bridge and calm focused expression in side angle, both hands with natural slender fingers flipping gently through vintage vinyl sleeves, wearing a relaxed oversized charcoal gray vintage crewneck sweatshirt, warm wooden shelves packed with vinyl records and books in soft background bokeh, warm nostalgic golden interior lamp lighting, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores, soft natural shadows, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy
```
*Settings:* Seed `1250`, Size `896x1152`. Output: `z_image_suite_8_record_store_browsing.png` (19.3s warm).

---

## 5. Performance & Operational Benchmarks

| Metric | Cold Boot (Scale to 1) | Warm Generation (Per Image) | Total 8-Photo Suite (Warm) |
|---|---|---|---|
| **Z-Image Turbo** (NVIDIA L4) | ~10–11 minutes (GCS FUSE weights stream) | **18–20 seconds** | **~2 minutes 17 seconds** |
| **Krea 2 Turbo** (NVIDIA L4) | ~8–9 minutes (GCS FUSE weights stream) | **23–25 seconds** | **~2 minutes 51 seconds** |

> **Client Timeout Guidance:** Always set `timeout=1200.0` in API clients to safely handle initial model cold boot loads from Cloud Storage FUSE. Subsequent warm calls respond in under 25 seconds.
