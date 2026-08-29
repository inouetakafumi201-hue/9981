#!/usr/bin/env python3
"""Local single-zone split, stitch and ship pipeline."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from PIL import Image


def split(source: Path, out: Path, rows: int, cols: int) -> None:
    if rows < 1 or cols < 1:
        raise ValueError("rows and cols must be positive")
    with Image.open(source) as opened:
        image = opened.convert("RGBA")
        if image.width % cols or image.height % rows:
            raise ValueError("source dimensions must divide evenly")
        width, height = image.width // cols, image.height // rows
        out.mkdir(parents=True, exist_ok=True)
        for row in range(rows):
            for col in range(cols):
                image.crop((col * width, row * height, (col + 1) * width, (row + 1) * height)).save(out / f"zone-{row:02d}-{col:02d}.png")


def stitch(parts: Path, target: Path, rows: int, cols: int) -> None:
    paths = [parts / f"zone-{row:02d}-{col:02d}.png" for row in range(rows) for col in range(cols)]
    images = [Image.open(path).convert("RGBA") for path in paths]
    try:
        size = images[0].size
        if any(image.size != size for image in images):
            raise ValueError("all zone parts must share dimensions")
        result = Image.new("RGBA", (size[0] * cols, size[1] * rows))
        for index, image in enumerate(images):
            result.paste(image, ((index % cols) * size[0], (index // cols) * size[1]))
        target.parent.mkdir(parents=True, exist_ok=True)
        result.save(target)
    finally:
        for image in images: image.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Iterate one map zone locally")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("split", "stitch"):
        command = sub.add_parser(name); command.add_argument("source", type=Path); command.add_argument("target", type=Path); command.add_argument("--rows", type=int, required=True); command.add_argument("--cols", type=int, required=True)
    ship = sub.add_parser("ship"); ship.add_argument("source", type=Path); ship.add_argument("target", type=Path); ship.add_argument("--zone-id", required=True)
    args = parser.parse_args()
    if args.command == "split": split(args.source, args.target, args.rows, args.cols)
    elif args.command == "stitch": stitch(args.source, args.target, args.rows, args.cols)
    else:
        args.target.mkdir(parents=True, exist_ok=True); output = args.target / "backdrop.png"; output.write_bytes(args.source.read_bytes()); (args.target / "manifest.json").write_text(json.dumps({"zoneId": args.zone_id, "backdrop": output.name}, indent=2) + "\n")


if __name__ == "__main__": main()
