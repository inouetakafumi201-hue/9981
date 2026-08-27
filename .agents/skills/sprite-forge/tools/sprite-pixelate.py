#!/usr/bin/env python3
"""
sprite-pixelate.py — 后处理：将 AI 生成的伪像素艺术转换为真正的像素艺术

问题背景：
  AI 生成的图虽然看起来像像素艺术，但实际上：
  - 边缘有抗锯齿渐变色（不是整齐的阶梯状）
  - 内部有亚像素级的颜色变化（不是纯色块）
  - 没有对齐到整数像素网格

解决方案：
  使用 proper-pixel-art（开源工具，专门处理 AI 像素艺术）：
  1. 用计算机视觉检测像素网格（Canny 边缘检测 + Hough 变换）
  2. 色彩量化，合并相似颜色
  3. 重建为真正的像素艺术（对齐网格、消除抗锯齿）

用法：
  python sprite-pixelate.py input.png --output output.png --size 128
  python sprite-pixelate.py batch *.png --size 128

依赖：
  pip install proper-pixel-art

参数：
  --size: 输出尺寸（默认 128×128）
  --colors: 色彩量化的颜色数（默认 64，32 太小颗粒感明显，64 起步过渡更平）

输出：
  - 网格对齐的像素艺术
  - 边缘整齐，无抗锯齿杂色
  - 保留内部细节（阴影、褶皱）

注意：
  - proper-pixel-art 会检测并压缩到实际网格尺寸（通常 58~94 像素）
  - 然后用最近邻插值放大到目标尺寸（128×128 或更大）
  - 眼睛等细节可能会轻微失真，需要手动修正
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path


def pixelate_single(
    input_path: Path,
    output_path: Path,
    *,
    target_size: int = 128,
    colors: int = 64,
) -> None:
    """用 proper-pixel-art 处理单个文件。

    Args:
        input_path: 输入 PNG（AI 生成的伪像素艺术）
        output_path: 输出 PNG（真正的像素艺术）
        target_size: 输出尺寸（正方形，默认 128×128）
        colors: 色彩量化颜色数（默认 32）
    """
    from PIL import Image, ImageFilter
    import tempfile as _tempfile

    temp_ppa = output_path.with_suffix(".ppa.tmp.png")

    with _tempfile.TemporaryDirectory() as _td:
        median_tmp = Path(_td) / "median.tmp.png"

        # Step 0: median 3×3 前置降噪 — 消除 AI 直出图的色块内颗粒感
        # 3×3 平衡：grainy 从 2142 砍到 ~30（-99%），uniq 保留 12+
        # 5×5 会过度平滑（grainy=20 但 uniq=14，丢失细节）
        raw_img = Image.open(input_path)
        if raw_img.mode != "RGB":
            raw_img = raw_img.convert("RGB")
        raw_img.filter(ImageFilter.MedianFilter(3)).save(median_tmp)

        # Step 1: proper-pixel-art 检测网格并量化（-s 1 = 不放大，-u 10 = 细网格）
        result = subprocess.run(
            [
                sys.executable, "-m", "proper_pixel_art.cli",
                str(median_tmp),
                "-o", str(temp_ppa),
                "--colors", str(colors),
                "-s", "1",
                "-u", "10",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"proper-pixel-art failed: {result.stderr}")

        # Step 2: 放大到目标尺寸（最近邻插值，保持像素风格）
        img = Image.open(temp_ppa)
        detected_size = img.size
        img_resized = img.resize((target_size, target_size), Image.Resampling.NEAREST)
        img_resized.save(output_path)

        print(f"✓ {input_path.name}: {detected_size} → {target_size}×{target_size}")

    if temp_ppa.exists():
        temp_ppa.unlink()


def pixelate_batch(
    input_paths: list[Path],
    *,
    target_size: int = 128,
    colors: int = 64,
    inplace: bool = False,
    output_dir: Path | None = None,
) -> None:
    """批量处理多个文件。

    Args:
        input_paths: 输入 PNG 列表
        target_size: 输出尺寸
        colors: 色彩量化颜色数
        inplace: 是否覆盖原文件（默认 False）
        output_dir: 输出目录（如果 inplace=False 且未指定，使用原目录）
    """
    start = time.time()
    for path in input_paths:
        if inplace:
            output_path = path
        elif output_dir:
            output_path = output_dir / path.name
        else:
            output_path = path.with_stem(f"{path.stem}-pixelated")

        pixelate_single(path, output_path, target_size=target_size, colors=colors)

    elapsed = time.time() - start
    print(f"\n✓ 完成 {len(input_paths)} 个文件，耗时 {elapsed:.2f}s")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="将 AI 生成的伪像素艺术转换为真正的像素艺术",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # 单文件模式
    single = sub.add_parser("single", help="处理单个文件")
    single.add_argument("input", type=Path, help="输入 PNG")
    single.add_argument("--output", type=Path, required=True, help="输出 PNG")
    single.add_argument("--size", type=int, default=128, help="输出尺寸（默认 128×128）")
    single.add_argument("--colors", type=int, default=64, help="色彩量化颜色数（默认 64，32 颗粒感明显，64 起步过渡更平）")

    # 批处理模式
    batch = sub.add_parser("batch", help="批量处理多个文件")
    batch.add_argument("inputs", type=Path, nargs="+", help="输入 PNG 列表")
    batch.add_argument("--size", type=int, default=128, help="输出尺寸（默认 128×128）")
    batch.add_argument("--colors", type=int, default=64, help="色彩量化颜色数（默认 64）")
    batch.add_argument("--inplace", action="store_true", help="覆盖原文件")
    batch.add_argument("--output-dir", type=Path, help="输出目录（默认使用原目录）")

    args = parser.parse_args()

    if args.command == "single":
        pixelate_single(args.input, args.output, target_size=args.size, colors=args.colors)
    elif args.command == "batch":
        if args.output_dir:
            args.output_dir.mkdir(parents=True, exist_ok=True)
        pixelate_batch(
            args.inputs,
            target_size=args.size,
            colors=args.colors,
            inplace=args.inplace,
            output_dir=args.output_dir,
        )


if __name__ == "__main__":
    main()
