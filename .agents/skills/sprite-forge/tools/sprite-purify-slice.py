#!/usr/bin/env python3
"""
sprite-purify-slice.py — 素材回收管线：AI 4×4 sheet → 品红纯化 → 切格 → 像素化 → contact 重建

这是 sprite-forge 的"回收端"标准流程。创建新角色/新组件时，把 AI 生成的
一张 4×4 网格 raw sheet（近品红背景）交给本工具，它自动完成：

  1. 背景纯化：近品红像素 → 纯品红 #FF00FF（消除 AI 的渐变色残边）
  2. 网格检测：自动找全背景带 → 切出 4×4 = 16 帧（按固定比例）
  3. 像素化：每帧放大到 1024×1024 → proper-pixel-art 网格重建（色彩量化 + 硬边对齐）
  4. 重新拼版：16 帧统一放大到固定尺寸 → 重建 4×4 contact sheet

产出物（风格统一、可直接用色键抠图的品红素材）：
  <out>/sheet-<N>-purified.png     背景纯化后的原 sheet
  <out>/frames/<N>-<帧号>.png       16 帧（切格原始）
  <out>/pixelated/<N>-<帧号>.png    16 帧（像素化重建）
  <out>/contact-<N>.png             16 帧重新拼的 4×4 contact

参数定案（2026-08-16，与 PLT-01 一致）：
  --threshold   背景纯化距离阈值（默认 90；AI 残边越明显可调大）
  --colors      像素化色彩数量（默认 32；细节丢太多可调大）
  --cell        输出帧统一尺寸（默认 128×128）
  --grid        网格行列数（默认 4×4）

用法：
  python sprite-purify-slice.py <input1.png> [input2.png ...] --out <输出目录>
  python sprite-purify-slice.py *.png --out run/new-char/

依赖：
  pip install proper-pixel-art pillow numpy
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

MAGENTA = (255, 0, 255)


# ---------------------------------------------------------------- 背景纯化 ----

def purify_background(img: Image.Image, threshold: int = 90) -> Image.Image:
    """近品红像素 → 纯品红 #FF00FF。消除 AI 的渐变残边。

    threshold 是 RGB 欧氏距离阈值：距离纯品红 < threshold 的像素改纯品红。
    """
    arr = np.array(img.convert("RGBA")).astype(np.int64)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    dist = np.sqrt((r - 255) ** 2 + g**2 + (b - 255) ** 2)
    near = dist < threshold
    # 改纯品红（保留 alpha）
    arr[near, 0] = 255
    arr[near, 1] = 0
    arr[near, 2] = 255
    arr[near, 3] = 255
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


# ---------------------------------------------------------------- 网格检测 ----

def _bands(vals: list[int], gap: int = 3) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    start = prev = None
    for v in vals:
        if start is None:
            start = v
        elif prev is not None and v - prev > gap:
            out.append((start, prev))
            start = v
        prev = v
    if start is not None:
        out.append((start, prev))
    return out


def detect_grid(img: Image.Image, bg_ratio: float = 0.97) -> tuple[list[tuple[int, int]], list[tuple[int, int]]] | None:
    """检测 4×4 网格的全背景带。返回 (行区域, 列区域)，各 4 个 (start, end)。

    思路：对每一行/列，统计纯品红像素占比。占比 > bg_ratio 的行/列是分隔带；
    相邻分隔带之间的间隙是行/列区域。期望 5 条带 → 4 个区域。
    """
    w, h = img.size
    px = img.load()

    def is_bg(p) -> bool:
        return p[0] == 255 and p[1] == 0 and p[2] == 255 and p[3] > 0

    row_all_bg = [
        y for y in range(h)
        if sum(1 for x in range(0, w, 2) if is_bg(px[x, y])) > (w // 2) * bg_ratio
    ]
    col_all_bg = [
        x for x in range(w)
        if sum(1 for y in range(0, h, 2) if is_bg(px[x, y])) > (h // 2) * bg_ratio
    ]

    hb = _bands(row_all_bg)
    vb = _bands(col_all_bg)
    if len(hb) != 5 or len(vb) != 5:
        return None
    rows = [(hb[i][1], hb[i + 1][0]) for i in range(4)]
    cols = [(vb[i][1], vb[i + 1][0]) for i in range(4)]
    return rows, cols


# ---------------------------------------------------------------- 切格 ----

def slice_grid(img: Image.Image, rows: list[tuple[int, int]], cols: list[tuple[int, int]]) -> list[Image.Image]:
    """按行/列区域切出 16 帧。"""
    frames = []
    for r_idx, (y0, y1) in enumerate(rows):
        for c_idx, (x0, x1) in enumerate(cols):
            frames.append(img.crop((x0, y0, x1, y1)))
    return frames


# ---------------------------------------------------------------- 像素化 ----

def pixelate_frame(img: Image.Image, colors: int = 32) -> Image.Image:
    """放大到 1024×1024 居中 → proper-pixel-art 网格重建 → 返回像素化帧。

    放大用最近邻（保持像素风）；proper-pixel-art 用 -s 1 保留检测到的原生网格。
    """
    w, h = img.size
    scale = 1024 / max(w, h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    up = img.convert("RGBA").resize((nw, nh), Image.NEAREST)
    canvas = Image.new("RGBA", (1024, 1024), (*MAGENTA, 255))
    canvas.paste(up, ((1024 - nw) // 2, (1024 - nh) // 2), up)

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.png"
        dst = Path(tmp) / "out.png"
        canvas.save(src)
        result = subprocess.run(
            [sys.executable, "-m", "proper_pixel_art.cli", str(src), "-o", str(dst),
             "--colors", str(colors), "-s", "1"],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"proper-pixel-art 失败: {result.stderr[:300]}")
        return Image.open(dst).convert("RGBA")


# ---------------------------------------------------------------- 主流程 ----

def process_sheet(
    input_path: Path,
    out_dir: Path,
    *,
    threshold: int = 90,
    colors: int = 32,
    cell: int = 128,
    index: int = 1,
) -> dict:
    """处理一张 raw sheet，产出全部产物。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = out_dir / "frames"
    pix_dir = out_dir / "pixelated"
    frames_dir.mkdir(exist_ok=True)
    pix_dir.mkdir(exist_ok=True)

    # 1. 背景纯化
    raw = Image.open(input_path)
    purified = purify_background(raw, threshold)
    sheet_out = out_dir / f"sheet-{index}-purified.png"
    purified.convert("RGB").save(sheet_out)

    # 2. 网格检测 + 切格
    grid = detect_grid(purified)
    if grid is None:
        raise RuntimeError(f"{input_path.name}: 未检测到 4×4 网格（期望 5 条带），跳过")
    rows, cols = grid
    frames = slice_grid(purified, rows, cols)

    frame_paths = []
    for i, frame in enumerate(frames, 1):
        p = frames_dir / f"{index}-{i:02d}.png"
        frame.save(p)
        frame_paths.append(p)

    # 3. 像素化
    pix_paths = []
    for i, frame in enumerate(frames, 1):
        p = pix_dir / f"{index}-{i:02d}.png"
        pixelated = pixelate_frame(frame, colors)
        pixelated.save(p)
        pix_paths.append(p)

    # 4. 重建 contact（统一到 cell 尺寸）
    contact = Image.new("RGBA", (cell * 4, cell * 4), (*MAGENTA, 255))
    for i, p in enumerate(pix_paths):
        im = Image.open(p).convert("RGBA")
        im_cell = im.resize((cell, cell), Image.NEAREST)
        r, c = divmod(i, 4)
        contact.paste(im_cell, (c * cell, r * cell), im_cell)
    contact_out = out_dir / f"contact-{index}.png"
    contact.convert("RGB").save(contact_out)

    return {
        "input": str(input_path),
        "sheet_purified": str(sheet_out),
        "frames": [str(p) for p in frame_paths],
        "pixelated": [str(p) for p in pix_paths],
        "contact": str(contact_out),
        "grid_rows": rows,
        "grid_cols": cols,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("inputs", nargs="+", type=Path, help="AI 生成的 4×4 raw sheet（近品红背景）")
    parser.add_argument("--out", required=True, type=Path, help="输出目录")
    parser.add_argument("--threshold", type=int, default=90, help="背景纯化距离阈值（默认 90）")
    parser.add_argument("--colors", type=int, default=32, help="像素化色彩数量（默认 32）")
    parser.add_argument("--cell", type=int, default=128, help="contact 帧统一尺寸（默认 128）")
    args = parser.parse_args()

    start = time.time()
    results = []
    for idx, path in enumerate(args.inputs, 1):
        print(f"[{idx}/{len(args.inputs)}] {path.name} ...", flush=True)
        try:
            r = process_sheet(path, args.out, threshold=args.threshold,
                              colors=args.colors, cell=args.cell, index=idx)
            results.append(r)
            print(f"  ✓ 16 帧已切格 + 像素化 + contact 重建", flush=True)
        except RuntimeError as e:
            print(f"  ✗ {e}", flush=True)

    elapsed = time.time() - start
    print(f"\n=== 素材回收管线完成：{len(args.inputs)} 张 sheet，耗时 {elapsed:.1f}s ===")
    for r in results:
        print(f"  {Path(r['input']).name} → {r['contact']}")


if __name__ == "__main__":
    main()
