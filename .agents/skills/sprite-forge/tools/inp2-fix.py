#!/usr/bin/env python3
"""Deterministic INP-2 pixel repair: nearest-neighbour resize and bounded palette."""
from __future__ import annotations
import argparse
from pathlib import Path
from PIL import Image


def repair(source: Path, target: Path, width: int | None, height: int | None, colors: int) -> None:
    if not 2 <= colors <= 256:
        raise ValueError("colors must be between 2 and 256")
    with Image.open(source) as opened:
        image = opened.convert("RGBA")
        size = (width or image.width, height or image.height)
        if min(size) <= 0:
            raise ValueError("dimensions must be positive")
        image = image.resize(size, Image.Resampling.NEAREST)
        alpha = image.getchannel("A")
        rgb = image.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT).convert("RGB")
        result = Image.merge("RGBA", (*rgb.split(), alpha.point(lambda value: 255 if value >= 128 else 0)))
        target.parent.mkdir(parents=True, exist_ok=True)
        result.save(target, optimize=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Repair one pixel-art input deterministically")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--width", type=int)
    parser.add_argument("--height", type=int)
    parser.add_argument("--colors", type=int, default=32)
    args = parser.parse_args()
    repair(args.input, args.output, args.width, args.height, args.colors)


if __name__ == "__main__":
    main()
