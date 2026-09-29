# Krea 2 Turbo ComfyUI Service — Prompting & Suite Strategy Guide

> **Service Location:** `services/llms/krea2_comfyui/`  
> **Underlying Engine:** Krea 2 Turbo (8-step distilled MMDiT) + Qwen3-VL 4B Text Encoder  
> **Inference Speed:** **~23–25 seconds** warm per 1024x1024 image on Google Cloud Run Gen2 (1x NVIDIA L4 GPU).  
> **Production Service:** `krea2-comfyui-prod` (`https://krea2-comfyui-prod-43551826902.us-central1.run.app`)

---

## 1. Architectural Overview & Why Anchoring Works

Krea 2 Turbo operates without an external adapter network (like IP-Adapter or PuLID). Instead, it couples an **8-step distilled MMDiT** with **Qwen3-VL 4B**, a causal vision-language foundation model.

### Key Architectural Advantages
1. **Zero Spatial Tethering:** Image-conditioning models (IP-Adapter, PuLID) often struggle with radical angle changes, full-body poses, or distant actions because pixel reference tokens fight against wide compositions. Krea 2 is driven by pure Text-to-Image (`POST /v1/images/generations`), allowing 100% freedom in camera distance, head orientation, body mechanics, and environmental physics.
2. **Linguistic Cross-Attention Alignment:** Qwen3-VL 4B interprets physical descriptions with extreme precision. Keeping a dedicated **Verbatim Identity Anchor Block** word-for-word identical across all prompts forces the transformer to construct the exact same bone structure, eye shape, nose contour, hair texture, and complexion in every generation.

---

## 2. The Golden Rule: The 8-Photo Strategic Suite

When generating character photo suites on Krea 2, repeating identical front-facing close-up portraits invites viewers to perform side-by-side pixel comparisons looking for AI variances.

Instead, the **Strategic Suite** pairs **1 canonical face anchor** and **1 canonical body anchor** with **6 dynamic lifestyle photos** that use natural real-world angles, props, distances, and expressions to naturally mask micro-variations while synthesizing a vibrant, real-world personality:

| # | Photo Concept | Purpose & Technique | Why It Works |
|---|---|---|---|
| **1** | **Canonical Face Portrait** | 35mm close-up window portrait | Establishes 100% of facial beauty, eye color, freckles, and smile. |
| **2** | **Canonical Body Photo** | Full-length athletic swimwear studio shot | Establishes head-to-toe proportions, athletic physique, and height. |
| **3** | **Lifestyle 1: Cozy Dinner / Cafe** | Face clearly visible, candlelit wine/coffee | Confirms facial identity in a warm, intimate social setting. |
| **4** | **Lifestyle 2: Mirror Outfit Selfie** | Phone at eye level blocking half the face | Universal social media trope; naturally conceals half the facial plane. |
| **5** | **Lifestyle 3: Spontaneous Laugh** | Head cocked back, laughing upward | Tilts head back; extreme upward angle naturally foreshortens facial features. |
| **6** | **Lifestyle 4: Beach Bikini** | Oversized dark sunglasses | Completely conceals eye geometry while showcasing athletic beach build. |
| **7** | **Lifestyle 5: Scenic Overlook / Hike** | Medium-distance 3/4 rear profile | Leverages distance and landscape scale; highlights silhouette and hair. |
| **8** | **Lifestyle 6: Record Store / Bookstore** | Head tilted downward in profile browsing | Highlights jawline and nose bridge while downward gaze avoids direct scrutiny. |

---

## 3. Golden Reference Implementation: Scandinavian Character Suite

This exact 8-photo suite was generated and verified live in production on `krea2-comfyui-prod`.

### The Verbatim Anchor Block
Include this block word-for-word in every prompt:
```text
A beautiful 22-year-old Scandinavian young woman with natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across her nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed friendly smile, shoulder-length wavy honey-blonde hair falling naturally across her shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion.
```

### The Anti-Plastic Realism Suffix
Terminate all prompts with:
```text
Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```

### Master Negative Prompt
```text
blurry, low quality, deformed, distorted, cartoon, anime, 3d render, illustration, painting, plastic skin, waxy skin, airbrushed, shiny skin, glossy highlights, cross-eyed, strabismus, misaligned eyes, asymmetrical pupils, bad hands, deformed hands, extra fingers, missing fingers, fused fingers, distorted fingers, malformed limbs, extra limbs, disconnected limbs, missing feet, cropped feet
```

---

### The 8 Prompts (Verbatim)

#### 1. Canonical Face Portrait
```text
raw candid 35mm close-up face portrait of A beautiful 22-year-old Scandinavian young woman with natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across her nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed friendly smile, shoulder-length wavy honey-blonde hair falling naturally across her shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion. Looking directly at the camera with clear aligned symmetrical gaze, centered composition, wearing a simple casual white cotton linen top, sitting near a large window in a bright Scandinavian apartment, soft diffused overcast daylight illuminating her face with gentle natural shadows. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `501`, Steps `8`, CFG `1.0`, Size `1024x1024`.

#### 2. Canonical Body Photo
```text
raw candid 35mm full-length photograph showing head to bare feet of A beautiful 22-year-old Scandinavian young woman with natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across her nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed friendly smile, shoulder-length wavy honey-blonde hair falling naturally across her shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion. Standing relaxed in a bright minimalist photo studio, wearing simple solid black two-piece athletic swimwear, standing barefoot on a clean neutral floor, complete head to toe full body view, soft natural daylight, normal neck length and proportions. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `601`, Steps `8`, CFG `1.0`, Size `1024x1024`.

#### 3. Lifestyle 1: Wine Bar Dinner (Face Clearly Visible)
```text
raw candid 35mm intimate evening dinner photograph of A beautiful 22-year-old Scandinavian young woman with natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across her nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed friendly smile, shoulder-length wavy honey-blonde hair falling naturally across her shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion. Sitting at a small rustic dark wooden table in a cozy dimly-lit wine bar bistro, her face clearly visible and illuminated by soft warm candlelight and gentle amber ambient glow, leaning forward slightly with an engaging warm genuine smile looking directly at her dinner companion across the table, one hand delicately holding the stem of a glass of red wine resting on the table, wearing a stylish fitted forest green ribbed knit sweater, soft blurred restaurant background bokeh. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `705`, Steps `8`, CFG `1.0`, Size `1024x1024`.

#### 4. Lifestyle 2: Mirror Selfie (Face Half-Obscured)
```text
raw candid modern smartphone mirror selfie of A beautiful 22-year-old Scandinavian young woman with natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across her nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed friendly smile, shoulder-length wavy honey-blonde hair falling naturally across her shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion. Standing in front of a wide full-length bedroom mirror, holding her smartphone up with one hand to take a casual outfit selfie. The smartphone is held up near eye level, partially obscuring and blocking half of her face, while her other eye, cheek, and confident subtle smile are visible beside the phone. Wearing high-waisted vintage washed blue denim jeans and a fitted ribbed cream-colored sleeveless crop top, showing her toned athletic midriff, wavy honey-blonde hair casually tumbling over one bare shoulder, authentic lived-in bedroom background with soft warm ambient lighting, unedited personal phone photo aesthetic, authentic mirror reflection, natural hand and finger grip on the phone. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `815`, Steps `8`, CFG `1.0`, Size `1024x1024`.

#### 5. Lifestyle 3: Laughing Photo (Head Cocked Back)
```text
raw candid 35mm outdoor photograph of A beautiful 22-year-old Scandinavian young woman with natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across her nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed friendly smile, shoulder-length wavy honey-blonde hair falling naturally across her shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion. Caught in a spontaneous burst of joyful hysterical laughter, her head cocked back and tilted upward toward the open sky, her neck extended naturally and her face largely obscured and foreshortened by the extreme upward angle, eyes crinkled tightly shut in genuine hilarity with a wide happy open-mouth laugh showing straight white teeth, her shoulder-length wavy honey-blonde hair tossing back over her shoulders with motion energy, one hand casually raised to her collarbone in mid-laugh, sitting outdoors on a sun-drenched cafe terrace or beer garden table with friends, warm golden afternoon sunlight creating bright highlights in her hair, unposed spontaneous laughter moment. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `922`, Steps `8`, CFG `1.0`, Size `1024x1024`.

#### 6. Lifestyle 4: Beach Bikini with Sunglasses
```text
raw candid 35mm beach vacation photograph of A beautiful 22-year-old Scandinavian young woman with natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across her nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed friendly smile, shoulder-length wavy honey-blonde hair falling naturally across her shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion. Lounging relaxed on a soft white beach towel on pale golden sand at a Mediterranean beach, wearing dark stylish oversized tortoiseshell sunglasses that completely conceal her eyes, wearing a chic textured ribbed terracotta-orange bikini, athletic feminine physique and toned abdomen, warm sun-kissed skin with light freckling on her shoulders, leaning back comfortably on one elbow in the sand, a relaxed gentle smile on her lips, wavy honey-blonde beach hair lightly tousled by the ocean breeze, turquoise clear sea waves and distant sunny coastline softly blurred in the background bokeh, natural midday sun. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `1035`, Steps `8`, CFG `1.0`, Size `1024x1024`.

#### 7. Lifestyle 5: Mountain Summit Hike (Distant 3/4 Rear Profile)
```text
raw candid 35mm outdoor adventure photograph of A beautiful 22-year-old Scandinavian young woman with natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across her nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed friendly smile, shoulder-length wavy honey-blonde hair falling naturally across her shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion. Standing on a rocky mountain summit overlook along a scenic alpine ridge trail, viewed from a natural medium-distance. Her head is turned in three-quarter rear profile, gazing out over a breathtaking panoramic mountain valley and distant blue lake below, her face seen in profile silhouette with the wind blowing wisps of honey-blonde hair from a loose messy textured ponytail, athletic build wearing dark fitted hiking leggings, trail running shoes, and a light technical windbreaker tied around her waist, both hands resting naturally on her hips as she catches her breath and enjoys the majestic view, crisp high-altitude mountain air, clear blue sky with gentle sun flare. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `1142`, Steps `8`, CFG `1.0`, Size `1024x1024`.

#### 8. Lifestyle 6: Vinyl Record Store (Browsing Downward)
```text
raw candid 35mm indoor lifestyle photograph of A beautiful 22-year-old Scandinavian young woman with natural facial features and identity: clear almond-shaped blue-green eyes with gentle crinkles, soft natural bridge freckles across her nose and cheeks, structured delicate jawline, straight refined nasal bridge, subtle relaxed friendly smile, shoulder-length wavy honey-blonde hair falling naturally across her shoulders, healthy athletic build with natural feminine curves, authentic unretouched skin texture with visible micro-pores and faint natural blemishes, completely non-glossy complexion. Standing inside a cozy dimly-lit vintage vinyl record and bookstore, leaning over a wooden record crate browsing through album sleeves. Her head is tilted downward in three-quarter profile, her gaze cast down intently at the record album in her hands, face framed by loose strands of wavy honey-blonde hair falling forward naturally, delicate straight nose bridge and calm focused expression in side angle, both hands with natural slender fingers flipping gently through vintage record sleeves, wearing a relaxed oversized charcoal gray vintage crewneck sweatshirt, warm wooden shelves packed with books and vinyl records in soft background bokeh, warm nostalgic golden interior lamp lighting. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `1250`, Steps `8`, CFG `1.0`, Size `1024x1024`.

---

## 4. Distant High-Speed Action Technique (e.g. Windsurfing, Surfing, Skiing)

For extreme sports or water actions, posing directly for the lens looks unnatural. Instead, instruct the camera to shoot with a **telephoto perspective from the shore**, and let **natural distance, forward motion focus, and windswept hair completely obscure the face**:

```text
raw candid 35mm wide-action sports photograph of A 22-year-old Scandinavian young woman with healthy athletic build and natural proportions, shoulder-length wavy honey-blonde hair, authentic natural sun-warmed skin. Windsurfing far out on the turquoise ocean waves, viewed from a natural distance across the water. Her head is turned away from the camera, looking forward at the oncoming rolling waves ahead. Her face is largely obscured by distance and thick wet strands of windswept honey-blonde hair whipping across her face in the high sea wind. Athletic full-body posture in action, leaning powerfully back into the windsurfing harness, both hands gripping the boom firmly, carving an aggressive turn with a high white spray of sea foam erupting from beneath the board. Wearing a fitted navy blue shorty wetsuit, sun glistening on the sea spray and choppy ocean swell, wide open coastal sea with distant beach shoreline. Captured on 35mm color negative film with a 70-200mm telephoto lens from the beach, authentic fine film grain, natural ocean mist, soft directional daylight, candid sports photography, no posing, no airbrushing, photorealistic, natural fluid dynamics.
```
*Result:* Eliminates 100% of facial comparison artifacts while authentically conveying high fitness, skill, and outdoor lifestyle.

---

## 5. Second Golden Reference Implementation: 18-Year-Old East Asian Character Suite

This exact 8-photo suite was generated and verified live in production on `krea2-comfyui-prod` (`https://krea2-comfyui-prod-43551826902.us-central1.run.app`).

- **Total Suite Warm Generation Time:** **204.1 seconds (3.4 minutes)**
- **Average Time per Image:** **25.5 seconds** (NVIDIA L4 GPU)
- **User Validation:** *"The strategy gave excellent facial variation, it's very difficult to tell that it's not the same person."*

### The Verbatim Anchor Block
Include this block word-for-word in every prompt:
```text
A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion.
```

### The Anti-Plastic Realism Suffix
```text
Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```

### Master Negative Prompt
```text
blurry, low quality, deformed, distorted, cartoon, anime, 3d render, illustration, painting, plastic skin, waxy skin, airbrushed, shiny skin, glossy highlights, cross-eyed, strabismus, misaligned eyes, asymmetrical pupils, bad hands, deformed hands, extra fingers, missing fingers, fused fingers, distorted fingers, malformed limbs, extra limbs, disconnected limbs, missing feet, cropped feet
```

---

### The 8 Prompts (Verbatim)

#### 1. Canonical Face Portrait
```text
raw candid 35mm close-up front face portrait of A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion. Looking directly at the camera with clear aligned symmetrical gaze, centered composition, wearing a simple casual white linen top, sitting near a large window in a bright minimalist apartment, soft diffused overcast natural daylight illuminating her face with gentle natural shadows. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `101`, Steps `8`, CFG `1.0`, Size `1024x1024`. Output: `krea2_asian_1_canonical_face.png` (24.2s warm).

#### 2. Canonical Body Photo
```text
raw candid 35mm full-length photograph showing head to bare feet of A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion. Standing relaxed in a bright minimalist photo studio, wearing simple solid black two-piece athletic swimwear, standing barefoot on a clean neutral floor, complete head to toe full body view, soft natural daylight, normal neck length and proportions. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `202`, Steps `8`, CFG `1.0`, Size `1024x1024`. Output: `krea2_asian_2_canonical_body.png` (24.7s warm).

#### 3. Lifestyle 1: Cozy Evening Cafe (Face Clearly Visible)
```text
raw candid 35mm intimate evening cafe photograph of A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion. Sitting at a small rustic dark wooden bistro table in a cozy warm cafe, her face clearly visible and illuminated by soft warm ambient candlelight and hanging amber filament lamps, leaning forward slightly with an engaging genuine warm smile looking directly across the table at the viewer, both hands holding a warm ceramic ceramic matcha latte mug on the table, wearing a stylish soft cream ribbed knit sweater, soft blurred background bokeh. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `303`, Steps `8`, CFG `1.0`, Size `1024x1024`. Output: `krea2_asian_3_lifestyle_cafe_face.png` (24.9s warm).

#### 4. Lifestyle 2: Mirror Outfit Selfie (Face Half-Obscured by Phone)
```text
raw candid modern smartphone mirror selfie of A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion. Standing in front of a wide full-length bedroom mirror, holding her smartphone up with one hand to take a casual outfit selfie. The smartphone is held up near eye level, partially covering and blocking half of her face, while her other eye, cheek, and confident subtle smile are clearly visible beside the phone. Wearing high-waisted wide-leg vintage washed blue denim jeans and a fitted ribbed black sleeveless crop top, showing her toned athletic midriff, long dark silky hair casually falling over one shoulder, cozy bedroom background with soft warm ambient lighting, unedited personal phone photo aesthetic, authentic mirror reflection, natural hand and finger grip on the phone. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `404`, Steps `8`, CFG `1.0`, Size `1024x1024`. Output: `krea2_asian_4_mirror_selfie_half_obscured.png` (25.6s warm).

#### 5. Lifestyle 3: Laughing Photo (Head Cocked Back)
```text
raw candid 35mm outdoor photograph of A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion. Caught in a spontaneous burst of joyful hysterical laughter, her head cocked back and tilted upward toward the open sky, her neck extended naturally and her face largely obscured and foreshortened by the extreme upward angle, eyes crinkled tightly shut in genuine hilarity with a wide happy open-mouth laugh showing straight white teeth, her long dark hair tossing back over her shoulders with motion energy, one hand casually raised to her collarbone in mid-laugh, sitting outdoors on a sun-drenched terrace table with friends, warm golden afternoon sunlight creating bright rim highlights in her hair, unposed spontaneous laughter moment. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `505`, Steps `8`, CFG `1.0`, Size `1024x1024`. Output: `krea2_asian_5_laughing_head_cocked_back.png` (24.6s warm).

#### 6. Lifestyle 4: Beach Bikini with Sunglasses
```text
raw candid 35mm beach vacation photograph of A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion. Lounging relaxed on a soft white beach towel on golden sand at a sunny tropical beach, wearing dark stylish oversized black sunglasses that completely conceal her eyes, wearing a chic solid sage-green ribbed bikini, slender toned athletic physique and flat abdomen, healthy warm skin, leaning back comfortably on one elbow in the sand, a relaxed gentle smile on her lips, long dark silky hair lightly tousled by the ocean sea breeze, clear turquoise sea waves and sunny shoreline softly blurred in the background bokeh, natural midday sun. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `606`, Steps `8`, CFG `1.0`, Size `1024x1024`. Output: `krea2_asian_6_beach_sunglasses_bikini.png` (28.3s warm).

#### 7. Lifestyle 5: Coastal Lookout Overlook (3/4 Rear Profile)
```text
raw candid 35mm outdoor scenic photograph of A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion. Standing along a scenic coastal cliff railing overlooking the open ocean, viewed from a natural medium-distance. Her head is turned in three-quarter rear profile, gazing out thoughtfully over the majestic blue ocean horizon, her face seen in profile silhouette with the coastal wind blowing strands of dark hair from a loose messy high ponytail, slender athletic build wearing dark fitted leggings, sneakers, and a casual light gray oversized windbreaker jacket, both hands resting naturally on the wooden railing as she enjoys the panoramic ocean view, bright coastal daylight, soft blue sky with gentle sun glare. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `707`, Steps `8`, CFG `1.0`, Size `1024x1024`. Output: `krea2_asian_7_coastal_lookout_view.png` (26.3s warm).

#### 8. Lifestyle 6: Book & Record Store (Browsing Downward in Profile)
```text
raw candid 35mm indoor lifestyle photograph of A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion. Standing inside a cozy dimly-lit vintage bookstore and record shop, leaning over a wooden shelf browsing through vintage books and vinyl. Her head is tilted downward in three-quarter profile, her gaze cast down intently at an art book in her hands, face framed by loose strands of long dark hair falling forward naturally, delicate straight nose bridge and calm focused expression in side angle, both hands with natural slender fingers holding the book open gently, wearing a relaxed oversized charcoal gray vintage knit sweater, warm wooden shelves packed with books and warm nostalgic golden interior lamp lighting in soft background bokeh. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `808`, Steps `8`, CFG `1.0`, Size `1024x1024`. Output: `krea2_asian_8_bookstore_browsing.png` (25.2s warm).

---

## 6. Distant Full-Body Obscuration Strategy (The Resolution Threshold Effect)

When generating character suites, close-up portraits invite human viewers to inspect micro-details (eyelid creases, freckles, tooth alignment). The **Distant Full-Body Strategy** eliminates 100% of facial comparison artifacts by leveraging the **Resolution Threshold of Digital Image Rendering**:

1. **The Scale Ratio:**
   In a `1024x1024` render, placing the subject **35–45 feet away** ensures the full figure occupies only **25–35% of the vertical frame** (around 250–350 pixels). The head itself is only **30–45 pixels across**.
2. **Mathematical Impossibility of Scrutiny:**
   At 35 pixels, fine facial features collapse into basic tonal lighting shapes. The viewer's brain shifts entirely to **macro-identity cues** (silhouette, posture, athletic build, hair volume/color, and natural movement) while the surrounding landscape conveys scale, travel, and adventure.
3. **Qwen3-VL 4B Spatial Cue Anchoring:**
   Diffusion models instinctively want to fill the frame vertically with the subject. To force Krea 2 Turbo to place the subject genuinely far away, use explicit spatial prompts:
   - `"camera is positioned 40 feet away"`
   - `"occupying roughly one-third of the frame height"`
   - `"wide environmental landscape photography, 24mm wide-angle lens, deep depth of field"`
   - `"the monumental stone architecture / landscape fills the frame and dwarfs the subject"`

---

### The 4 Verified Distant Archetype Prompts (Verbatim)

These 4 prompts were generated and verified live in production on `krea2-comfyui-prod` with the 18yo East Asian character. All 4 ran warm in **24.3 seconds each** on the NVIDIA L4 GPU.

#### Archetype A: The Low-Tide Beach Stroll (Distant Seascape)
```text
raw candid 35mm wide-angle environmental travel photograph of A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion. standing in the middle distance on a vast, open low-tide sandy beach at late afternoon golden hour. The camera is positioned 40 feet away, capturing a wide panoramic seascape where she occupies roughly one-third of the frame height. She is walking barefoot on the wet mirror-like sand reflecting the soft warm sky, wearing a simple breezy pale sage-green linen summer dress gently fluttering in the sea breeze, full head-to-toe figure visible with graceful natural proportions. Her head is turned slightly toward the rolling ocean waves, dark silky hair blowing naturally across her shoulders, facial features naturally softened and generalized by the camera distance and warm atmospheric mist. Gentle white surf and distant coastal headlands softly blurred in the background bokeh, vast open pastel sky, warm golden rim light on her silhouette. Captured on 35mm color negative film, wide-angle 24mm lens, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional daylight, candid unposed travel snapshot, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `901`, Steps `8`, CFG `1.0`, Size `1024x1024`. Output: `krea2_asian_distant_1_beach_stroll.png` (552.7s cold start).

#### Archetype B: Monumental European Plaza / Colonnade (Architectural Scale)
```text
raw candid 35mm wide-angle architectural travel photograph of A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion. walking across a vast historic European cobblestone plaza surrounded by towering classical Roman stone arches and ancient colonnades. The camera is positioned far back at a wide environmental angle, with the monumental stone architecture filling the frame and dwarfing the subject, who occupies one-third of the frame height in the middle distance. She is captured mid-stride walking across the weathered stone paving, wearing a stylish tailored camel trench coat over dark jeans and white sneakers, carrying a small leather crossbody bag, graceful upright walking posture. Her head is turned in three-quarter profile looking up admiringly at the majestic stone arches above, long dark hair falling down her back, facial features naturally softened by distance and ambient outdoor shadow. Soft diffused overcast daylight, realistic stone reflections, grand architectural depth and scale. Captured on 35mm color negative film, wide-angle 24mm lens, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional daylight, candid unposed travel snapshot, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `902`, Steps `8`, CFG `1.0`, Size `1024x1024`. Output: `krea2_asian_distant_2_european_plaza.png` (**24.3s warm**).

#### Archetype C: Red Rock Canyon / Desert Trail (Outdoor Scale)
```text
raw candid 35mm outdoor adventure travel photograph of A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion. walking along a winding scenic dirt trail through a grand red sandstone canyon under vast open blue skies. Captured from a wide distance where the colossal red rock canyon walls and sandstone towers dominate the composition, while she is a full-length figure walking in the middle ground occupying roughly one-third of the frame height. Wearing dark athletic trail leggings, trail running shoes, and a fitted black technical tank top, small hiking daypack on her back, athletic toned physique and natural outdoor posture. Her body is angled along the trail leading into the canyon, head turned toward the trail ahead, long dark ponytail swishing with walking motion, facial details naturally softened by the wide perspective and bright desert sunlight. Warm golden canyon glow, natural desert dust in the air, deep panoramic landscape perspective. Captured on 35mm color negative film, wide-angle 24mm lens, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional daylight, candid unposed travel snapshot, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `903`, Steps `8`, CFG `1.0`, Size `1024x1024`. Output: `krea2_asian_distant_3_canyon_trail.png` (**24.3s warm**).

#### Archetype D: Luxury Rooftop Infinity Pool Sunset (Skyline Backlighting)
```text
raw candid 35mm luxury evening travel photograph of A stunningly attractive 18-year-old East Asian young woman with natural delicate facial features and identity: expressive almond-shaped dark brown eyes with subtle double eyelids and natural eyelashes, delicate soft jawline with gentle high cheekbones, straight slender nasal bridge with a softly rounded natural tip, soft natural pink lips with a subtle relaxed smile, long silky dark brown hair with natural soft waves falling gracefully past her shoulders, slender athletic feminine build with natural curves and graceful posture, authentic unretouched skin texture with visible micro-pores and a healthy youthful glow, completely non-glossy complexion. standing at the far edge of a stunning high-altitude infinity pool deck on a luxury rooftop overlooking a vast metropolitan skyline at twilight. The camera captures a wide environmental composition from 35 feet away across the pool deck, with the expansive twilight sky and illuminated city skyscrapers filling the panoramic background while she stands in the middle distance. She is standing relaxed by the glass railing, wearing a chic sleek black backless evening resort dress, full slender silhouette and graceful posture outlined by the glowing twilight horizon and ambient city lights. Her head is turned toward the panoramic skyline view, long dark hair resting over one bare shoulder, facial features naturally silhouetted and softened by the evening backlighting and distance. Glassy water pool surface reflecting the warm amber city lights, soft evening breeze, deep twilight blue and violet sky. Captured on 35mm color negative film, wide-angle 24mm lens, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional daylight, candid unposed travel snapshot, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `904`, Steps `8`, CFG `1.0`, Size `1024x1024`. Output: `krea2_asian_distant_4_rooftop_sunset.png` (**24.3s warm**).

---

## 7. The Alluring East Asian Dating Sim Suite (Production Verified)

This complete 8-photo suite was generated and verified live in production on `krea2-comfyui-prod` (`1024x1024`, Steps: `8`, CFG: `1.0`, Sampler: `euler`, Scheduler: `simple`).
Average warm execution speed: **24.1s–28.8s** on NVIDIA L4 GPU.

### Master Alluring Asian Anchor Block
```text
A stunningly attractive 21-year-old East Asian woman with intensely captivating facial beauty: mesmerizing almond-shaped dark brown eyes with delicate natural double eyelids and long natural eyelashes, magnetic flirtatious gaze, elegant high cheekbones, straight refined slender nasal bridge, full soft natural pink lips with a subtle knowing smile and slightly parted lips, long voluminous wavy dark espresso hair cascading gracefully past her shoulders and collarbones, stunning hourglass athletic feminine silhouette with a defined slender waist and graceful toned curves, luminous unretouched porcelain skin texture with visible micro-pores and a soft natural warm radiance, completely non-glossy complexion.
```

### Master Film Realism Suffix
```text
Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```

### The 8 Verbatim Working Prompts

#### 1. Canonical Face Anchor (Champagne Silk Cowl Camisole)
```text
raw candid 35mm close-up front face portrait of A stunningly attractive 21-year-old East Asian woman with intensely captivating facial beauty: mesmerizing almond-shaped dark brown eyes with delicate natural double eyelids and long natural eyelashes, magnetic flirtatious gaze, elegant high cheekbones, straight refined slender nasal bridge, full soft natural pink lips with a subtle knowing smile and slightly parted lips, long voluminous wavy dark espresso hair cascading gracefully past her shoulders and collarbones, stunning hourglass athletic feminine silhouette with a defined slender waist and graceful toned curves, luminous unretouched porcelain skin texture with visible micro-pores and a soft natural warm radiance, completely non-glossy complexion. Sitting relaxed near a large sunlit window in a luxury hotel suite, wearing a delicate champagne silk satin cowl neck camisole resting softly on bare shoulders and collarbones, soft diffused natural daylight illuminating her radiant face with gentle soft shadows, centered direct gaze, alluring confident expression. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `1001`. Output: `krea2_alluring_asian_1_canonical_face.png` (587.0s cold boot).

#### 2. Canonical Body Anchor (Two-Piece Swimwear Studio Shot)
```text
raw candid 35mm full-length photograph showing head to bare feet of A stunningly attractive 21-year-old East Asian woman with intensely captivating facial beauty: mesmerizing almond-shaped dark brown eyes with delicate natural double eyelids and long natural eyelashes, magnetic flirtatious gaze, elegant high cheekbones, straight refined slender nasal bridge, full soft natural pink lips with a subtle knowing smile and slightly parted lips, long voluminous wavy dark espresso hair cascading gracefully past her shoulders and collarbones, stunning hourglass athletic feminine silhouette with a defined slender waist and graceful toned curves, luminous unretouched porcelain skin texture with visible micro-pores and a soft natural warm radiance, completely non-glossy complexion. Standing confidently in a bright minimalist photo studio, wearing a stylish solid black two-piece athletic bikini accentuating her hourglass curves, slender waist, and long toned legs, standing barefoot on clean neutral studio floor, complete head to toe full body view, soft natural studio daylight, natural balanced proportions. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `1002`. Output: `krea2_alluring_asian_2_canonical_body.png` (**24.1s warm**).

#### 3. Lifestyle 1: Intimate Cocktail Lounge
```text
raw candid 35mm intimate evening cocktail photograph of A stunningly attractive 21-year-old East Asian woman with intensely captivating facial beauty: mesmerizing almond-shaped dark brown eyes with delicate natural double eyelids and long natural eyelashes, magnetic flirtatious gaze, elegant high cheekbones, straight refined slender nasal bridge, full soft natural pink lips with a subtle knowing smile and slightly parted lips, long voluminous wavy dark espresso hair cascading gracefully past her shoulders and collarbones, stunning hourglass athletic feminine silhouette with a defined slender waist and graceful toned curves, luminous unretouched porcelain skin texture with visible micro-pores and a soft natural warm radiance, completely non-glossy complexion. Sitting at a small rustic dark wooden table in a cozy dimly-lit cocktail bar bistro, her face and collarbones clearly visible illuminated by soft warm candlelight and amber ambient glow, leaning forward slightly with an alluring genuine smile looking directly across the table at the viewer, one hand gently holding the stem of a cocktail glass on the table, wearing a fitted forest-green ribbed knit top with a flattering neckline, soft blurred background bokeh. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `1003`. Output: `krea2_alluring_asian_3_cocktail_lounge.png` (**25.5s warm**).

#### 4. Lifestyle 2: Mirror Outfit Selfie (Half-Obscured)
```text
raw candid modern smartphone mirror selfie of A stunningly attractive 21-year-old East Asian woman with intensely captivating facial beauty: mesmerizing almond-shaped dark brown eyes with delicate natural double eyelids and long natural eyelashes, magnetic flirtatious gaze, elegant high cheekbones, straight refined slender nasal bridge, full soft natural pink lips with a subtle knowing smile and slightly parted lips, long voluminous wavy dark espresso hair cascading gracefully past her shoulders and collarbones, stunning hourglass athletic feminine silhouette with a defined slender waist and graceful toned curves, luminous unretouched porcelain skin texture with visible micro-pores and a soft natural warm radiance, completely non-glossy complexion. Standing in front of a wide full-length bedroom mirror, holding her smartphone up with one hand taking an outfit mirror photo. The smartphone is held up near eye level, partially covering and blocking half of her face, while her other eye, cheek, and confident subtle smile are clearly visible beside the phone. Wearing high-waisted vintage washed blue denim jeans and a fitted ribbed cream crop top showing her athletic toned midriff and curves, wavy dark hair tumbling casually over one shoulder, cozy bedroom background with soft warm ambient lighting, candid smartphone photo aesthetic. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `1004`. Output: `krea2_alluring_asian_4_mirror_selfie_half_obscured.png` (**25.3s warm**).

#### 5. Lifestyle 3: Playful Morning Laugh (Head Cocked Back)
```text
raw candid 35mm outdoor photograph of A stunningly attractive 21-year-old East Asian woman with intensely captivating facial beauty: mesmerizing almond-shaped dark brown eyes with delicate natural double eyelids and long natural eyelashes, magnetic flirtatious gaze, elegant high cheekbones, straight refined slender nasal bridge, full soft natural pink lips with a subtle knowing smile and slightly parted lips, long voluminous wavy dark espresso hair cascading gracefully past her shoulders and collarbones, stunning hourglass athletic feminine silhouette with a defined slender waist and graceful toned curves, luminous unretouched porcelain skin texture with visible micro-pores and a soft natural warm radiance, completely non-glossy complexion. Caught in a spontaneous burst of joyful flirtatious laughter, her head cocked back and tilted upward toward the open sky, her neck extended naturally and her face largely obscured and foreshortened by the extreme upward angle, eyes crinkled tightly shut in genuine laughter with a wide happy open-mouth smile showing straight white teeth, her wavy dark hair tossing back over her shoulders with motion energy, one hand casually raised to her collarbone in mid-laugh, sitting outdoors on a sun-drenched cafe terrace table with friends, warm golden afternoon sunlight. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `1005`. Output: `krea2_alluring_asian_5_playful_laugh_head_cocked.png` (**24.4s warm**).

#### 6. Lifestyle 4: Beach Bikini with Sunglasses
```text
raw candid 35mm beach vacation photograph of A stunningly attractive 21-year-old East Asian woman with intensely captivating facial beauty: mesmerizing almond-shaped dark brown eyes with delicate natural double eyelids and long natural eyelashes, magnetic flirtatious gaze, elegant high cheekbones, straight refined slender nasal bridge, full soft natural pink lips with a subtle knowing smile and slightly parted lips, long voluminous wavy dark espresso hair cascading gracefully past her shoulders and collarbones, stunning hourglass athletic feminine silhouette with a defined slender waist and graceful toned curves, luminous unretouched porcelain skin texture with visible micro-pores and a soft natural warm radiance, completely non-glossy complexion. Lounging relaxed on a soft white beach towel on golden sand at a coastal Mediterranean beach, wearing dark stylish oversized tortoiseshell cat-eye sunglasses that completely conceal her eyes, wearing a chic textured ribbed terracotta-orange bikini, athletic feminine physique, toned curves, and flat abdomen, warm sun-kissed skin with light freckles on shoulders, leaning back comfortably on one elbow in the sand, a relaxed gentle smile on her lips, wavy dark beach hair lightly tousled by ocean breeze, clear turquoise sea waves softly blurred in background bokeh. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `1006`. Output: `krea2_alluring_asian_6_beach_bikini_sunglasses.png` (**26.1s warm**).

#### 7. Lifestyle 5: 3/4 Rear Rooftop Infinity Pool (High-Slit Gown)
```text
raw candid 35mm evening travel photograph of A stunningly attractive 21-year-old East Asian woman with intensely captivating facial beauty: mesmerizing almond-shaped dark brown eyes with delicate natural double eyelids and long natural eyelashes, magnetic flirtatious gaze, elegant high cheekbones, straight refined slender nasal bridge, full soft natural pink lips with a subtle knowing smile and slightly parted lips, long voluminous wavy dark espresso hair cascading gracefully past her shoulders and collarbones, stunning hourglass athletic feminine silhouette with a defined slender waist and graceful toned curves, luminous unretouched porcelain skin texture with visible micro-pores and a soft natural warm radiance, completely non-glossy complexion. Standing at the far edge of a stunning high-altitude infinity pool deck on a luxury rooftop overlooking a vast metropolitan skyline at twilight. The camera captures a wide environmental composition from 35 feet away across the pool deck, with the glowing twilight sky and city skyscrapers filling the background while she stands in the middle distance occupying one-third of the frame height. She is standing relaxed by the glass railing, wearing a chic sleek dark evening resort dress with a high side slit, full slender silhouette and athletic posture outlined by the glowing twilight horizon and ambient city lights, complete head to toe view, head turned toward the panoramic skyline in 3/4 rear profile. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `1007`. Output: `krea2_alluring_asian_7_rooftop_high_slit_gown.png` (**28.8s warm**).

#### 8. Lifestyle 6: Low-Tide Shoreline Stroll
```text
raw candid 35mm wide-angle environmental photograph of A stunningly attractive 21-year-old East Asian woman with intensely captivating facial beauty: mesmerizing almond-shaped dark brown eyes with delicate natural double eyelids and long natural eyelashes, magnetic flirtatious gaze, elegant high cheekbones, straight refined slender nasal bridge, full soft natural pink lips with a subtle knowing smile and slightly parted lips, long voluminous wavy dark espresso hair cascading gracefully past her shoulders and collarbones, stunning hourglass athletic feminine silhouette with a defined slender waist and graceful toned curves, luminous unretouched porcelain skin texture with visible micro-pores and a soft natural warm radiance, completely non-glossy complexion. Standing in the middle distance on a vast open low-tide sandy beach at late afternoon golden hour. The camera is positioned 40 feet away capturing a wide panoramic landscape where she occupies approximately one-third of the frame height. She is walking barefoot on wet mirror-like sand reflecting the soft sky, wearing a casual light white linen beach dress fluttering in the ocean breeze, complete full-length head to toe view with natural athletic proportions, wavy dark hair blowing softly, facial features naturally generalized and softened by camera distance. Captured on 35mm color negative film, authentic fine film grain, lifted soft shadows, low-contrast natural tone curve, soft directional light, candid unposed photography, no airbrushing, no plastic skin reflections, photorealistic, natural anatomy.
```
*Settings:* Seed `1008`. Output: `krea2_alluring_asian_8_beach_shoreline_stroll.png` (**25.8s warm**).

---

## 8. Cross-Reference: 100 Instagram & Dating Photo Archetypes

For the full cross-demographic taxonomy of 100 photo archetypes (50 Women, 50 Men across Gen Z, Young Professionals, and Established demographics), see:
[**`instagram_archetypes_taxonomy.md`**](../../../instagram_archetypes_taxonomy.md)

