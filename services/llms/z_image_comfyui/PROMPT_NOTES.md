# High-Realism Prompt Reference: Candid Bedroom Selfie (Late-Night Snapshot)

> **Saved from successful run:** Produced `/home/peter/.gemini/antigravity/brain/de83fcc2-4078-40b5-9fe3-bab008936052/z_image_selfie.png` on `z-image-comfyui-dev`.
> **Model:** Z-Image-Turbo (S3-DiT bf16 + Qwen 3.4B Text Encoder + AE VAE).
> **Workflow Settings:** Resolution `896x1152`, 8 Steps Euler, Simple Scheduler, CFG `1.0`, Denoise `1.0`. Sampling time: 14.6 seconds on NVIDIA L4 GPU.
> **Stylistic Strengths:** Flawless candid front-facing phone camera perspective, authentic handheld composition, relaxed lying bedroom pose with hand gently supporting temple/cheek, natural sleepy expression, soft warm doorway lighting cast, and ultra-realistic skin and hair textures with zero plastic sheen.

```text
1girl, solo, young adult woman, photorealistic candid bedroom selfie, same facial features and identity as the original character prompt, same face shape, same eyes, same nose, same lips, same natural facial proportions,

lying comfortably on a bed, leaning forward toward the camera, upper body close to the lens, relaxed intimate bedroom pose, one arm extended naturally toward the camera as if holding the smartphone, the other hand gently supporting the side of her head, palm resting against her temple and cheek, elbow resting on the bed, fingers relaxed and naturally curved,

head tilted slightly toward the hand, looking directly into the camera, soft tired gaze, slightly half-lidded eyes, calm sleepy expression, subtle pouty lips, relaxed facial muscles, quiet late-night mood, natural candid expression,

long straight dark black hair, soft naturally messy texture, loose strands falling around the face and shoulders, wispy curtain bangs / soft straight bangs partially covering the forehead and slightly falling between the eyes, a few loose strands framing the cheeks, casual unstyled bedroom hair,

wearing a simple black sleeveless top, fitted but casual, thin shoulder straps, soft lightweight fabric, minimal design, natural casual homewear, no visible accessories,

cozy ordinary bedroom at night, lying on a bed with white and pale gray bedding, slightly messy pillows and blanket, dark wooden headboard visible behind her, open bedroom doorway in the background, warm light softly coming from the adjacent room, pale beige walls, simple curtain visible through the doorway, ordinary lived-in bedroom, quiet private atmosphere,

camera extremely close to the subject, front-facing smartphone selfie perspective, handheld phone camera, approximately eye level with the face, slightly above the mattress, subtle downward angle, close-range wide-angle front camera lens, face and upper body filling most of the frame, one arm appearing slightly larger due to the close perspective, natural imperfect selfie framing, spontaneous composition,

very dim warm indoor lighting, soft warm ambient light from the open doorway, subtle reddish-purple and warm beige color cast, gentle shadows across the face, slightly underexposed bedroom background, soft highlights on the skin, low contrast, muted low-saturation colors,

early smartphone / low-light digital camera aesthetic, nostalgic bedroom selfie, slightly low-resolution appearance, soft focus, subtle digital noise and grain, mild lens softness, slight motion softness, muted shadows, imperfect exposure, subtle color fringing, realistic skin texture, natural facial imperfections, unedited personal photo feeling, authentic late-night snapshot, photorealistic, highly realistic, natural anatomy, realistic hands and fingers
```

---

# High-Realism Prompt Reference: Candid Beach Selfie (Golden Hour Snapshot)

> **Saved from successful run:** Produced `/home/peter/.gemini/antigravity/brain/de83fcc2-4078-40b5-9fe3-bab008936052/blonde_beach_selfie.png` on `z-image-comfyui-dev`.
> **Model:** Z-Image-Turbo (S3-DiT bf16 + Qwen 3.4B Text Encoder + AE VAE).
> **Workflow Settings:** Resolution `896x1152`, 8 Steps Euler, Simple Scheduler, CFG `1.0`, Denoise `1.0`. Sampling time: ~14 seconds (warm generation, 20.37s end-to-end).
> **Stylistic Strengths:** Authentic summer vacation snapshot, natural golden-hour sun rim lighting, wind-blown blonde hair with sun streaks, light natural freckles on nose and cheeks, muted sage green bikini with draped white linen shirt, realistic hand anatomy, and natural sand/surf bokeh.

```text
1girl, solo, young adult woman, photorealistic candid beach selfie, blonde caucasian woman, natural facial features and identity, defined cheekbones, natural facial proportions,

sitting comfortably on the warm sand, leaning forward toward the camera, upper body close to the lens, relaxed intimate beach pose, one arm extended naturally toward the camera as if holding the smartphone, the other hand gently touching her collarbone or resting on the sand, fingers relaxed and naturally curved,

head tilted slightly, looking directly into the camera, warm gentle sun-dazed gaze, bright hazel-blue eyes slightly squinting against the warm sunlight, soft natural lips with subtle smile, relaxed facial muscles, serene late-afternoon coastal mood, natural candid expression,

long sun-kissed golden blonde hair, soft naturally messy beach texture, loose strands fluttering in the gentle ocean breeze around her face and shoulders, wispy front strands framing the cheeks, salty textured beach hair,

wearing a simple casual ribbed triangle bikini top in muted sage green under a loose open white linen shirt draped naturally off one shoulder, lightweight breathable summer fabric, minimal casual beachwear, small delicate gold pendant necklace,

scenic sandy beach at golden hour, sitting on pale soft sand, gentle seafoam and ocean waves blurred softly in the background, distant coastline, warm low-angle sunlight creating a soft halo in her hair, peaceful quiet cove,

camera close to the subject, front-facing smartphone selfie perspective, handheld phone camera, approximately eye level with the face, subtle downward angle, close-range wide-angle front camera lens, face and upper body filling most of the frame, natural imperfect selfie framing, spontaneous composition,

golden hour afternoon lighting, warm golden sun casting gentle soft shadows across the face and neck, soft warm rim light on the shoulders and hair, low contrast, natural sun-drenched coastal color palette,

modern smartphone camera aesthetic, nostalgic summer beach selfie, slightly soft focus, subtle natural digital grain, realistic skin texture, light natural freckles across the nose and cheeks, natural facial imperfections, sun-warmed skin, unedited personal vacation photo feeling, authentic late-afternoon snapshot, photorealistic, highly realistic, natural anatomy, realistic hands and fingers
```

---

# High-Realism Edit Reference: Cross-Scene Pose & Environment Transfer (Beach to Bedroom)

> **Saved from successful run:** Produced `/home/peter/.gemini/antigravity/brain/de83fcc2-4078-40b5-9fe3-bab008936052/blonde_bedroom_d82.png` on `z-image-comfyui-dev`.
> **Input Image:** `blonde_beach_selfie.png` (outdoor sunny beach, upright sitting pose).
> **Workflow Settings:** Endpoint `POST /v1/images/edits`, Denoise `0.82`, Seed `100`, Steps `8` Euler, CFG `1.0`. Sampling time: 19.59 seconds.
> **Key Achievement:** Completely eliminated phantom/extra limbs from the beach pose, flawlessly transplanting the blonde woman's facial identity, freckles, eye color, and hair into the late-night indoor bedroom scene with two grounded, anatomically correct arms.

```text
1girl, solo, young adult woman, blonde caucasian woman, same facial features and identity as reference image, hazel-blue eyes, natural freckles across nose and cheeks,

candid smartphone bedroom selfie, lying down in bed, upper body propped up on one elbow, resting her cheek comfortably against her hand, her other hand and arm tucked under the white duvet blanket, exactly one hand visible supporting her cheek, no other hands visible, clean anatomy, natural shoulders,

head tilted slightly toward her hand, looking directly into camera, soft tired late-night gaze, gentle relaxed smile, natural facial expression,

long golden blonde hair falling loosely around shoulders and framing the face, messy unstyled late-night hair texture,

wearing a simple fitted black sleeveless tank top, thin straps, bare shoulders,

cozy dim bedroom at night, white and pale gray rumpled bedding, dark wooden headboard, open bedroom doorway in background with warm soft hallway light, quiet intimate atmosphere,

close-up smartphone selfie perspective, slightly high angle looking down at face and upper body, authentic low-light phone camera aesthetic, warm dim ambient lighting, soft shadows, realistic skin texture, unedited personal photo
```

---

# High-Realism Edit Reference: In-Place Wardrobe & Atmosphere Change (Bedroom to Rainy Cafe)

> **Saved from successful run:** Produced `/home/peter/.gemini/antigravity/brain/de83fcc2-4078-40b5-9fe3-bab008936052/z_image_edited_cafe.png` on `z-image-comfyui-dev`.
> **Input Image:** `z_image_selfie.png` (Asian young woman bedroom selfie).
> **Workflow Settings:** Endpoint `POST /v1/images/edits`, Denoise `0.60`, Steps `8` Euler, CFG `1.0`. Sampling time: 18.8 seconds.
> **Key Achievement:** Kept the exact head-tilt pose and facial likeness 100% locked, replaced the black tank top with a burgundy ribbed knit turtleneck, placed a hot ceramic latte mug in her hands, and transformed the background into a rainy window with city streetlights.

```text
1girl, solo, young adult woman, same facial features and identity, same face shape, same eyes, same nose, same lips,
sitting at a wooden table in a cozy dim cafe at night, holding a warm ceramic coffee mug with both hands near her chin, leaning forward,
wearing an oversized soft knit turtleneck sweater in deep burgundy,
rainy window with blurred city streetlights and golden bokeh in the background,
warm amber interior cafe lighting, soft highlights on cheeks and hair,
candid smartphone photo, photorealistic, natural skin texture, realistic hands
```

---

# Z-Image Prompting & Denoise Guide

### Why Z-Image Requires Explicit Prompting
1. **Qwen 3.4B LLM Text Encoder:**
   Unlike standard CLIP (which acts as a loose bag-of-keywords associator), Qwen is a true causal Large Language Model. It interprets literal counts ("two arms only", "single hand supporting cheek"), spatial relationships, and cause-and-effect literally. Vague descriptions or competing actions create literal visual artifacts.
2. **Latent Img2Img Conditioning:**
   In Z-Image, editing passes the reference pixels directly through `VAEEncode` into latent space. The model inherits the spatial geometry of the input photo. If you change poses significantly, you must supply enough noise (`denoise >= 0.80`) to dissolve the previous pose's latent artifacts, while explicitly guiding the new limb positions.

### Calibration Table

| Edit Intent | Recommended `denoise` | Prompting Strategy |
| :--- | :---: | :--- |
| **In-Place Wardrobe & Props** *(e.g., change tank top to sweater, add latte)* | `0.55` – `0.62` | Keep the prompt focused strictly on the new items; let the original pose anchor all anatomy. |
| **New Background, Similar Posture** *(e.g., bedroom to cafe, outdoor to indoor)* | `0.65` – `0.72` | Describe the background and lighting; maintain the subject's physical orientation. |
| **Radical Cross-Scene & Pose Transfer** *(e.g., beach sitting $\to$ bed lying)* | `0.80` – `0.85` | **Be strictly explicit:** State arm grounding, limb counts, and contrasting clothing to prevent fabric/bedding confusion. |

---

# High-Realism Edit Reference: Cross-Scene Gym Mirror Selfie (Outdoor to Gym)

> **Saved from successful run:** Produced `/home/peter/.gemini/antigravity/brain/de83fcc2-4078-40b5-9fe3-bab008936052/gym_mirror_selfie.png` on `z-image-comfyui-dev`.
> **Input Image:** `skyline_vacation_snapshot.png` (Outdoor limestone rocks, sunglasses, green tank top).
> **Workflow Settings:** Endpoint `POST /v1/images/edits`, Denoise `0.82`, Seed `42`, Steps `8` Euler, CFG `1.0`. Sampling time: 18.84 seconds.
> **Key Achievement:** Flawlessly transferred character identity (smile showing teeth, facial geometry, ponytail, athletic physique) from outdoor limestone rocks to an indoor fitness center mirror selfie. Zero extra limbs, perfectly formed phone reflection, and sunglasses removed naturally to reveal eyes.

```text
1girl, solo, young adult woman, athletic build, same facial features and identity as the reference image, warm genuine smile showing teeth, brown eyes without sunglasses, brown hair pulled back into a neat high ponytail,

candid smartphone gym mirror selfie, standing confidently in front of a wide full-length gym mirror, holding her smartphone in one hand taking a mirror photo, her other hand resting casually on her hip, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, relaxed athletic posture,

wearing a dark charcoal gray ribbed athletic sports bra with thin straps, paired with matching high-waisted compression gym shorts, toned midriff and athletic physique, small wireless earbuds in ears, no heavy jewelry,

modern upscale fitness center gym background, clean black rubber flooring, blurred racks of stainless steel dumbbells, weight benches, and cable machine racks visible in the soft background, bright clean overhead gym lighting, realistic mirror reflection,

authentic smartphone camera photo, candid gym snapshot, subtle workout glow, realistic skin texture with natural sheen, soft natural shadows, photorealistic, unedited personal fitness photo aesthetic
```

---

# High-Realism Edit Reference: Cross-Scene Wardrobe & Posture Transfer (Autumn Stroll to Cocktail Bar)

> **Saved from successful run:** Produced `/home/peter/.gemini/antigravity/brain/de83fcc2-4078-40b5-9fe3-bab008936052/z_image_edited_cocktail_man.png` on `z-image-comfyui-dev`.
> **Input Image:** `z_image_autumn_cafe_man.png` (Outdoor cobblestone stroll, grey wool overcoat, hands in pocket).
> **Workflow Settings:** Endpoint `POST /v1/images/edits`, Denoise `0.82`, Seed `42`, Steps `8` Euler, CFG `1.0`. Sampling time: 16.89 seconds.
> **Key Achievement:** Flawlessly preserved 100% of the man's facial likeness, authentic wavy hair curls and volume, friendly smile, and stubble. Dissolved the heavy winter overcoat into a crisp navy blazer and open-collar white shirt, seated at a dark mahogany bar table with a crystal whiskey tumbler. Grounded two natural arms, realistic hands, veins, and tactile wood reflections with zero AI artifacting.

```text
1man, solo, young adult man in his late 20s, same facial features and identity as the reference image, handsome Mediterranean European man, defined angular jawline, dark brown textured wavy hair with loose natural strands, well-groomed neat stubble beard along jaw and mustache, warm dark brown eyes, genuine relaxed smile showing straight white teeth, natural facial proportions,

sitting comfortably at a dark wooden table in a cozy dim cocktail bar at night, leaning slightly forward, one forearm resting naturally on the dark tabletop holding a crystal tumbler with whiskey on the rocks, his other hand and arm resting casually on the table edge, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, relaxed unposed masculine posture,

wearing a tailored midnight navy blazer over an open-collar crisp white dress shirt, unbuttoned top collar, relaxed evening elegance, no tie, no overcoat,

cozy dim speakeasy bar setting at night, dark mahogany wood paneling, softly blurred shelves of glass liquor bottles and warm muted amber bokeh in the deep background, soft indirect ambient lighting, natural soft shadows across the face and table, no harsh spotlights, quiet intimate mood,

candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores and stubble, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy
```

---

# High-Realism Edit Reference: Front-Loaded Facial & Hair Priority (Denoise 0.77)

> **Saved from successful run:** Produced `/home/peter/.gemini/antigravity/brain/de83fcc2-4078-40b5-9fe3-bab008936052/z_image_edited_cocktail_man_d77.png` on `z-image-comfyui-dev`.
> **Input Image:** `z_image_autumn_cafe_man.png` (Outdoor cobblestone stroll, grey wool overcoat).
> **Workflow Settings:** Endpoint `POST /v1/images/edits`, Denoise `0.77`, Seed `42`, Steps `8` Euler, CFG `1.0`. Sampling time: 20.27 seconds.
> **Key Achievement:** Maximum facial and hair preservation. The opening 60 tokens explicitly anchor the immutable facial features, jawline taper, eye crinkles, and exact textured wavy curl ringlets. Tuning denoise down to `0.77` retained the high-frequency latent hair curls from the original photo while still cleanly transforming the clothing and background into an upscale cocktail lounge.

```text
1man, solo, exact identical facial likeness, head structure, and hair as reference image:
identical textured wavy dark brown hair with natural loose curls and volume over the forehead,
identical angular masculine jawline taper, defined chin, and well-groomed short dark stubble beard,
identical warm dark brown eyes, eye crinkles, and genuine friendly smile showing straight white teeth.
The face, head, hair, and facial expression are completely preserved and untouched from the reference photo.

Only the clothing, body posture, and background environment are transformed:
candid indoor photo, sitting comfortably at a dark wooden table in a cozy dim cocktail bar at night, leaning slightly forward, one forearm resting naturally on the dark tabletop holding a crystal tumbler with whiskey on the rocks, his other hand and arm resting casually on the table edge, clear clean anatomy, exactly two arms only, no extra hands, no phantom limbs, relaxed unposed masculine posture,

wearing a tailored midnight navy blazer over an open-collar crisp white dress shirt, unbuttoned top collar, relaxed evening elegance, no tie, no winter overcoat,

cozy dim speakeasy bar setting at night, dark mahogany wood paneling, softly blurred shelves of glass liquor bottles and warm muted amber bokeh in the deep background, soft indirect ambient lighting, natural soft shadows across the face and table, no harsh spotlights, quiet intimate mood,

candid smartphone photo, authentic 35mm snapshot aesthetic, photorealistic, natural skin texture with visible pores and stubble, realistic hands and fingers, unedited personal photo feeling, highly realistic, natural anatomy
```
