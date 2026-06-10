#!/usr/bin/env python3
"""
optimize_pngs.py — Lossy quantization + lossless compression for PNG assets.

Pipeline:
  1. Pillow: Quantize to 64-color palette (lossy, massive size reduction for
     simple game textures like dice faces with flat gradients).
  2. pyoxipng: Maximum lossless compression pass (DEFLATE optimization).

Usage:
  .venv/bin/python3 scripts/optimize_pngs.py <directory>

Example:
  .venv/bin/python3 scripts/optimize_pngs.py examples/dice-roller/assets/dice
  .venv/bin/python3 scripts/optimize_pngs.py frontend/assets/dice

Requirements (install into .venv):
  pip install Pillow pyoxipng  # pyoxipng installs as 'oxipng'
"""

import sys
import os
from pathlib import Path
from PIL import Image
import oxipng


def optimize_png(filepath: Path, max_colors: int = 64) -> tuple[int, int]:
    """
    Optimize a single PNG file in-place.

    Returns (original_bytes, new_bytes).
    """
    original_size = filepath.stat().st_size

    # Step 1: Lossy quantization — reduce to N-color palette
    img = Image.open(filepath)

    # Ensure RGBA for consistent processing
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    # FASTOCTREE is required for RGBA quantization in Pillow
    quantized = img.quantize(colors=max_colors, method=Image.Quantize.FASTOCTREE)
    quantized = quantized.convert("RGBA")

    quantized.save(filepath, "PNG", optimize=True)

    # Step 2: Lossless compression — oxipng max optimization
    oxipng.optimize(
        str(filepath),
        level=6,  # Max compression (0-6)
        strip=oxipng.StripChunks.safe(),  # Remove non-essential metadata
    )

    new_size = filepath.stat().st_size
    return original_size, new_size


def optimize_directory(directory: str, max_colors: int = 64) -> None:
    """Optimize all PNGs in a directory tree."""
    root = Path(directory)
    if not root.is_dir():
        print(f"Error: {directory} is not a directory")
        sys.exit(1)

    pngs = sorted(root.rglob("*.png"))
    if not pngs:
        print(f"No PNGs found in {directory}")
        sys.exit(1)

    total_before = 0
    total_after = 0

    print(f"Optimizing {len(pngs)} PNGs in {directory}...")
    print(f"  Palette: {max_colors} colors | oxipng level: 6")
    print()

    for png in pngs:
        before, after = optimize_png(png, max_colors)
        total_before += before
        total_after += after
        reduction = (1 - after / before) * 100 if before > 0 else 0
        rel = str(png.relative_to(root))
        print(f"  {rel:<30s}  {before:>6,}B → {after:>6,}B  ({reduction:5.1f}% smaller)")

    total_reduction = (1 - total_after / total_before) * 100 if total_before > 0 else 0
    print()
    print(f"  Total: {total_before:,}B → {total_after:,}B  ({total_reduction:.1f}% reduction)")
    print(f"  Saved: {total_before - total_after:,} bytes")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: .venv/bin/python3 scripts/optimize_pngs.py <directory> [max_colors]")
        print("Example: .venv/bin/python3 scripts/optimize_pngs.py frontend/assets/dice 64")
        sys.exit(1)

    target_dir = sys.argv[1]
    colors = int(sys.argv[2]) if len(sys.argv) > 2 else 64
    optimize_directory(target_dir, colors)
