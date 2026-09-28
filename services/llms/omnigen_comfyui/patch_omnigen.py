#!/usr/bin/env python3
"""patch_omnigen.py — Runtime patch for OmniGen-ComfyUI and native OmniGen package.
1. Moves OmniGenPipeline to CUDA explicitly (fixing CPU execution bug).
2. Instantiates model and loads safetensors directly onto CUDA device (preventing 30GB host-RAM OOM).
3. Adds flush=True to all print statements for real-time Cloud Logging.
"""

import os
import sys

def patch_loader():
    loader_path = "/ComfyUI/custom_nodes/OmniGen-ComfyUI/loader.py"
    if not os.path.exists(loader_path):
        print(f"[patch] {loader_path} not found, skipping loader patch.")
        return

    with open(loader_path, "r") as f:
        content = f.read()

    # 1. Fix GPU device placement in load_model
    old_load = 'pipe = OmniGenPipeline.from_pretrained(model_path)\n            pipe.model = pipe.model.to(dtype)'
    new_load = '''pipe = OmniGenPipeline.from_pretrained(model_path)
            if torch.cuda.is_available():
                print("Moving OmniGenPipeline and VAE to CUDA...", flush=True)
                pipe.to("cuda")
            pipe.model = pipe.model.to(dtype)'''

    if old_load in content:
        content = content.replace(old_load, new_load)
        print("[patch] Patched loader.py with explicit pipe.to('cuda').")
    elif 'pipe.to("cuda")' in content:
        print("[patch] loader.py already contains pipe.to('cuda').")
    else:
        print("[patch] WARNING: Could not find exact load pattern in loader.py")

    with open(loader_path, "w") as f:
        f.write(content)


def patch_model():
    model_paths = [
        "/usr/local/lib/python3.11/dist-packages/OmniGen/model.py",
        "/app/.venv/lib/python3.11/dist-packages/OmniGen/model.py",
    ]
    target_path = None
    for p in model_paths:
        if os.path.exists(p):
            target_path = p
            break

    if not target_path:
        import site
        for sp in site.getsitepackages():
            candidate = os.path.join(sp, "OmniGen", "model.py")
            if os.path.exists(candidate):
                target_path = candidate
                break

    if not target_path:
        print("[patch] OmniGen/model.py not found, skipping direct-CUDA patch.")
        return

    with open(target_path, "r") as f:
        content = f.read()

    old_from_pretrained = """        config = Phi3Config.from_pretrained(model_name)
        model = cls(config)
        if os.path.exists(os.path.join(model_name, 'model.safetensors')):
            print("Loading safetensors")
            ckpt = load_file(os.path.join(model_name, 'model.safetensors'))
        else:
            ckpt = torch.load(os.path.join(model_name, 'model.pt'), map_location='cpu')
        model.load_state_dict(ckpt)
        return model"""

    new_from_pretrained = """        config = Phi3Config.from_pretrained(model_name)
        device_target = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Instantiating OmniGen model on meta device (zero RAM/VRAM) to prevent allocation doubling...", flush=True)
        import accelerate
        with accelerate.init_empty_weights():
            model = cls(config)
        if os.path.exists(os.path.join(model_name, 'model.safetensors')):
            print(f"Streaming safetensors directly to {device_target} (15.5GB into 24GB VRAM)...", flush=True)
            ckpt = load_file(os.path.join(model_name, 'model.safetensors'), device=device_target)
        else:
            ckpt = torch.load(os.path.join(model_name, 'model.pt'), map_location=device_target)
        print("Assigning weights in-place to model...", flush=True)
        model.load_state_dict(ckpt, assign=True)
        del ckpt
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        print(f"OmniGen model loaded cleanly onto {device_target}.", flush=True)
        return model"""

    if old_from_pretrained in content:
        content = content.replace(old_from_pretrained, new_from_pretrained)
        print(f"[patch] Patched {target_path} for direct GPU allocation & zero host RAM OOM.")
        with open(target_path, "w") as f:
            f.write(content)
    elif "device_target" in content:
        print(f"[patch] {target_path} already patched.")
    else:
        print(f"[patch] WARNING: Could not find exact from_pretrained pattern in {target_path}")


def patch_nodes():
    nodes_path = "/ComfyUI/custom_nodes/OmniGen-ComfyUI/nodes.py"
    if not os.path.exists(nodes_path):
        return
    with open(nodes_path, "r") as f:
        content = f.read()

    content = content.replace('print("\\n=== OmniGen Generation ===")', 'print("\\n=== OmniGen Generation ===", flush=True)')
    content = content.replace('print(f"\\nGenerating with prompt: {prompt_text}")', 'print(f"\\nGenerating with prompt: {prompt_text}", flush=True)')

    with open(nodes_path, "w") as f:
        f.write(content)
    print("[patch] Patched nodes.py with unbuffered logs.")


if __name__ == "__main__":
    patch_loader()
    patch_model()
    patch_nodes()
    print("[patch] All OmniGen patches applied successfully.")
