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

---

## 6. The "Facial Prefix Attention Trap" & Decoupled Prompt Architecture

### A. Diagnosing the Frontal Head-On Bias
In diffusion transformers featuring causal/autoregressive text encoders (like Qwen 3.4B in Z-Image and Qwen3-VL 4B in Krea 2), tokens positioned at the very front of the prompt receive dominant spatial cross-attention weights.

If an identity prefix begins with detailed facial close-up tokens:
```python
# ❌ THE TRAP: Front-loading facial close-up tokens on every prompt
PREFIX = (
    "1girl, solo, young adult woman, 22 years old, blonde caucasian woman, "
    "clear piercing almond-shaped blue-green eyes with gentle crinkles, magnetic flirtatious gaze, "
    "high defined cheekbones, straight refined nasal bridge, full soft pink lips..."
)
```
1. **Camera Framing Lock:** Emphasizing `"piercing eyes, magnetic gaze, cheekbones, lips"` compels the transformer to allocate the central canvas to a front-facing headshot or medium portrait looking directly down the lens.
2. **Instruction Override:** Even if downstream text specifies `"standing 40 feet away"`, `"phone covering face"`, or `"head turned away"`, the early facial close-up tokens overrule the spatial framing.
3. **The Consequence:** The mirror selfie holds the phone off to the side so the face remains visible, rooftop pool shots become close-up portraits, and distant beach walks place the subject right in the foreground.

### B. The Decoupled Prompt Solution
To achieve genuine face obscuration, gaze diversion, and distant scale, prompts must be decoupled:
- **Photo 1 (Face Anchor):** Retain 100% of facial descriptors to establish canonical facial beauty, eye geometry, and skin texture.
- **Photos 3–8 (Lifestyle, Obscured & Distant):** Strip all intrusive eye/nose/mouth close-up tokens. Lead immediately with **camera framing, angle, and the physical obscuration mechanic**, retaining only macroscopic anchors (hair color/texture, age, ethnicity, and athletic hourglass silhouette).

---

## 7. Golden Reference: Z-Image True Obscuration Suite (Verified)

This exact 6-photo obscuration suite was generated and verified live on `z-image-comfyui-dev` in native `896x1152` mobile aspect ratio (18–20s warm per image):

### Character Macro-Anchor (No Facial Gaze Bias)
```text
22 years old, stunning Scandinavian blonde woman, long voluminous wavy honey-blonde hair, hourglass athletic feminine silhouette with a defined slender waist and toned curves, natural sun-kissed skin texture with visible micro-pores
```

### Realism Suffix
```text
candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural lighting, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, unedited personal photo feeling
```

### The 6 True Obscuration Prompts (Verbatim)

#### 1. Physical Masking: Phone Directly Covering Face (Mirror Selfie)
```text
1girl, solo, mirror selfie, holding smartphone in front of face, the smartphone is held directly over her nose and mouth and eyes, face completely hidden and obscured behind the black smartphone held in both hands, only wavy honey-blonde hair tumbling over shoulders, 22 years old, stunning Scandinavian blonde woman, long voluminous wavy honey-blonde hair, hourglass athletic feminine silhouette with a defined slender waist and toned curves, natural sun-kissed skin texture with visible micro-pores, wearing high-waisted denim jeans and a fitted white crop top showing her athletic toned waist and curves, standing in a cozy bedroom in front of a mirror, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural lighting, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, unedited personal photo feeling
```
*Settings:* Seed `2001`, Size `896x1152`. Output: `z_image_obscured_1_phone_covering_face.png` (19.7s).

#### 2. 3/4 Rear Profile Silhouette (Balcony Skyline)
```text
1girl, solo, from behind, three-quarter rear profile view, looking away toward the glowing city skyline, face turned completely away from the camera, head turned toward the horizon, side profile showing only her jawline and ear, 22 years old, stunning Scandinavian blonde woman, long voluminous wavy honey-blonde hair, hourglass athletic feminine silhouette with a defined slender waist and toned curves, natural sun-kissed skin texture with visible micro-pores, long wavy honey-blonde hair cascading down her back, wearing an alluring backless black silk satin slip dress, standing on a luxury penthouse balcony at twilight, ambient city lights bokeh in the background, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural lighting, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, unedited personal photo feeling
```
*Settings:* Seed `2002`, Size `896x1152`. Output: `z_image_obscured_2_rear_profile_balcony.png` (18.4s).

#### 3. Downward Gaze: Wine / Cocktail Bar
```text
1girl, solo, profile view, looking down, head tilted downward looking at a cocktail glass on the rustic wooden table, eyes cast down, downward gaze, side profile angle, wavy honey-blonde hair falling forward over one cheek partially obscuring her face, 22 years old, stunning Scandinavian blonde woman, long voluminous wavy honey-blonde hair, hourglass athletic feminine silhouette with a defined slender waist and toned curves, natural sun-kissed skin texture with visible micro-pores, wearing a fitted emerald green ribbed top, soft warm candlelight illumination, intimate atmospheric wine bar, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural lighting, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, unedited personal photo feeling
```
*Settings:* Seed `2003`, Size `896x1152`. Output: `z_image_obscured_3_downward_gaze_bar.png` (18.0s).

#### 4. Walking Away: Beach Shoreline into Waves
```text
1girl, solo, from behind, full body view, walking away on the wet sand along the ocean shore, back to camera, walking toward the waves, head turned slightly in profile, face largely obscured, 22 years old, stunning Scandinavian blonde woman, long voluminous wavy honey-blonde hair, hourglass athletic feminine silhouette with a defined slender waist and toned curves, natural sun-kissed skin texture with visible micro-pores, long honey-blonde hair blowing in the sea breeze, wearing a stylish terracotta bikini and breezy open linen shirt, golden hour sunset beach, pastel reflections on the water, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural lighting, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, unedited personal photo feeling
```
*Settings:* Seed `2004`, Size `896x1152`. Output: `z_image_obscured_4_walking_away_beach.png` (18.3s).

#### 5. True Distant Environmental: Rooftop Infinity Pool (40ft Distance)
```text
wide shot, wide-angle environmental photograph, extreme long shot, distant shot, a small full-length female figure standing 40 feet away at the far edge of a massive rooftop infinity pool at twilight, the vast twilight sky and glowing illuminated city skyscrapers fill the entire frame, subject occupies only 20 percent of the frame height, 22 years old, stunning Scandinavian blonde woman, long voluminous wavy honey-blonde hair, hourglass athletic feminine silhouette with a defined slender waist and toned curves, natural sun-kissed skin texture with visible micro-pores, slender athletic silhouette in a dark resort dress outlined against the glowing city skyline, facial features naturally tiny and softened by distance and atmospheric depth, deep depth of field, panoramic composition, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural lighting, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, unedited personal photo feeling
```
*Settings:* Seed `2005`, Size `896x1152`. Output: `z_image_obscured_5_true_distant_rooftop.png` (19.8s).

#### 6. True Distant Environmental: Vast Low-Tide Beach (45ft Distance)
```text
wide shot, extreme long shot, wide-angle landscape photograph, 24mm lens, vast open low-tide sandy beach, a small full-length female figure walking barefoot 45 feet away in the middle distance, occupying only 20 percent of frame height, walking away across mirror-like wet sand reflecting the pastel sunset sky, 22 years old, stunning Scandinavian blonde woman, long voluminous wavy honey-blonde hair, hourglass athletic feminine silhouette with a defined slender waist and toned curves, natural sun-kissed skin texture with visible micro-pores, wearing a light white summer dress billowing in the breeze, honey-blonde hair, facial features naturally generalized and tiny due to distance and atmospheric haze, sweeping vast coastal landscape, candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural lighting, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, unedited personal photo feeling
```
*Settings:* Seed `2006`, Size `896x1152`. Output: `z_image_obscured_6_true_distant_beach.png` (18.3s).

---

## 8. The "Alluring Dating Sim" Aesthetic Calibration

When transitioning from generic lifestyle portraits to elevated dating-sim character assets:

1. **Facial Magnetism Tokens:**
   Replace passive smiles with active attraction cues:
   - `"intensely attractive and captivating with striking facial beauty"`
   - `"clear piercing almond-shaped eyes with a magnetic flirtatious gaze"`
   - `"full soft natural pink lips with a subtle knowing smile and slightly parted lips"`
2. **Physique & Proportion Tokens:**
   Replace neutral descriptions with refined athletic curves:
   - `"stunning hourglass athletic feminine silhouette with a defined slender waist and graceful toned curves"`
3. **High-Tactile Luxury Fabrics:**
   Synthetic flat textures break immersion. Ground wardrobe in tactile materials:
   - *Formal / Evening:* Champagne silk satin cowl camisole, backless black slip dress.
   - *Casual / Lounge:* Emerald green ribbed knit top, fitted white crop top and high-waisted denim.
   - *Beach / Resort:* Ribbed terracotta-orange bikini with open breezy linen shirt.
4. **Cross-Reference:**
   For the full 100-photo taxonomy across demographics, see [**`instagram_archetypes_taxonomy.md`**](../../../instagram_archetypes_taxonomy.md).

