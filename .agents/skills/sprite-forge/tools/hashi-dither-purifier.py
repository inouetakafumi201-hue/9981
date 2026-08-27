#!/usr/bin/env python3
"""
hashi-dither-purifier.py — WakeUp 场景图 / 背景图去 AI 杂色纯化脚本

设计目标：
  把 AI 生成的高色彩数（万级）场景图 / 背景图转换为：
  - 低色数（≤48）硬边像素艺术
  - 无抗锯齿 / 无抖动 / 无渐变
  - 适合 ship 包的可举证资产

与 sprite-pixelate.py 的分工：
  - sprite-pixelate.py：角色 / 组件的 proper-pixel-art 管线（64×64 网格）
  - 本脚本：场景图 / 背景图通用（尺寸灵活，512~2048 均可）

算法三段：
  1. 【降色】PIL quantize() 将 76959 色 → 目标调色板（≤48 色）
  2. 【边清】逐像素分析：同色邻居 >2 方向被异色包围 → 判定为杂色，替换为相邻主色
  3. 【硬边】每像素做 3×3 投票：若某相邻色得票 ≥4 且该像素本身不是该色，则吞并它

用法：
  # 单文件
  python hashi-dither-purifier.py single input.png --output output.png --colors 32

  # 批处理（保留原文件，输出加 -purified 后缀）
  python hashi-dither-purifier.py batch input1.png input2.png --colors 32

  # 批处理（覆盖原文件）
  python hashi-dither-purifier.py batch input1.png input2.png --colors 32 --inplace

  # 验证：打印色彩统计
  python hashi-dither-purifier.py inspect input.png

依赖：Pillow
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Optional, Iterable


# ---------------------------------------------------------------- 核心算法 ----

def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02x}{g:02x}{b:02x}"


# 调色板：wakeup 场景 / 背景用的固定低饱和暗调色板（16/32/48 色）
# 覆盖：墨、深灰、冷蓝、暖棕、冷绿、暗紫、暗橙、冷青、浅灰
PALETTE_16 = [
    _hex_to_rgb("#0d1418"),  # 0 墨 / 最深背景
    _hex_to_rgb("#1a2530"),  # 1 深蓝黑
    _hex_to_rgb("#2a3a44"),  # 2 冷灰蓝（面板/边框）
    _hex_to_rgb("#3d5060"),  # 3 中灰蓝
    _hex_to_rgb("#5a6e7a"),  # 4 浅灰蓝（次要文字）
    _hex_to_rgb("#8fa5ad"),  # 5 淡灰（禁用态文字）
    _hex_to_rgb("#c8d4da"),  # 6 最浅灰（高亮）
    _hex_to_rgb("#e8d4b8"),  # 7 暖米色（梦境氛围）
    _hex_to_rgb("#a07040"),  # 8 暖棕（地面/木材）
    _hex_to_rgb("#6a4828"),  # 9 深棕（阴影/深木）
    _hex_to_rgb("#3a5a3a"),  # 10 冷深绿（洼地/草地）
    _hex_to_rgb("#5a8a5a"),  # 11 冷中绿（地面植）
    _hex_to_rgb("#3a4a6a"),  # 12 冷深蓝（夜色/窗）
    _hex_to_rgb("#5a7aaa"),  # 13 冷中蓝（金属/天空）
    _hex_to_rgb("#2a2a4a"),  # 14 暗紫蓝（梦境/神秘）
    _hex_to_rgb("#4a2a3a"),  # 15 暗紫红（警戒/血）
]

PALETTE_32 = PALETTE_16 + [
    _hex_to_rgb("#1a1a1a"),  # 16 纯黑
    _hex_to_rgb("#4a4a4a"),  # 17 深灰
    _hex_to_rgb("#8a8a8a"),  # 18 中灰
    _hex_to_rgb("#b0b0b0"),  # 19 浅灰
    _hex_to_rgb("#d0d0d0"),  # 20 亮灰
    _hex_to_rgb("#c0392b"),  # 21 暗红（damage）
    _hex_to_rgb("#e67e22"),  # 22 暗橙（action）
    _hex_to_rgb("#f39c12"),  # 23 橙黄（alert）
    _hex_to_rgb("#1a8a5a"),  # 24 深绿（safe / 高地）
    _hex_to_rgb("#27ae60"),  # 25 浅绿（洼地）
    _hex_to_rgb("#2980b9"),  # 26 蓝（stamina）
    _hex_to_rgb("#8e44ad"),  # 27 紫（远程/梦境）
    _hex_to_rgb("#16a085"),  # 28 冷青绿
    _hex_to_rgb("#e74c3c"),  # 29 红（damage）
    _hex_to_rgb("#f5b041"),  # 30 橙黄（alert）
    _hex_to_rgb("#48c9b0"),  # 31 冷青（cyan）
]

PALETTE_48 = PALETTE_32 + [
    _hex_to_rgb("#1c2833"),  # 32 深墨蓝
    _hex_to_rgb("#283747"),  # 33 冷深灰蓝
    _hex_to_rgb("#34495e"),  # 34 冷中灰蓝
    _hex_to_rgb("#7f8c8d"),  # 35 冷灰
    _hex_to_rgb("#abb2b9"),  # 36 冷浅灰
    _hex_to_rgb("#bfc9ca"),  # 37 冷淡灰
    _hex_to_rgb("#d5dbdb"),  # 38 冷最浅灰
    _hex_to_rgb("#f0e6d3"),  # 39 暖米白
    _hex_to_rgb("#c9a96e"),  # 40 暖金棕
    _hex_to_rgb("#8b6914"),  # 41 深金棕
    _hex_to_rgb("#2d4a2d"),  # 42 极深绿
    _hex_to_rgb("#74c28a"),  # 43 浅绿（洼地）
    _hex_to_rgb("#1f3a5f"),  # 44 深蓝（夜色）
    _hex_to_rgb("#3d6fa5"),  # 45 中蓝（天空/金属）
    _hex_to_rgb("#6a4a8a"),  # 46 暗紫
    _hex_to_rgb("#9a6aaa"),  # 47 亮紫（梦境光）
]


def get_palette(n_colors: int):
    if n_colors <= 16:
        return PALETTE_16[:n_colors]
    if n_colors <= 32:
        return PALETTE_32[:n_colors]
    return PALETTE_48[:n_colors]


def _nearest_palette_color(r: int, g: int, b: int, palette: list[tuple[int, int, int]]) -> int:
    """返回调色板中与 (r,g,b) 欧氏距离最近的色块索引。"""
    best_idx, best_dist = 0, float("inf")
    for i, (pr, pg, pb) in enumerate(palette):
        d2 = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
        if d2 < best_dist:
            best_dist, best_idx = d2, i
    return best_idx


# 8 方向邻居偏移（不含中心）
DIRS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def _edge_clean_pass(pixels, w: int, h: int, palette: list[tuple[int, int, int]],
                     protected: set[tuple[int, int]] = set()) -> list:
    """边清 pass：同色邻居 ≤2 方向被异色包围 → 判定为杂色 → 替换为相邻主色。

    原理：硬边像素艺术里每个色块内部像素周围 8 方向全是同色（≥3 同色邻居）。
    只有边缘像素的同色邻居数少。杂色像素（抗锯齿残留）通常只有 0-1 个同色邻居，
    且被 ≥2 种其他色包围。
    """
    out = [[pixels[y][x] for x in range(w)] for y in range(h)]

    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if (x, y) in protected:
                continue
            center = out[y][x]
            same_neighbors = 0
            neighbor_colors: dict[int, int] = {}
            for dx, dy in DIRS:
                nx, ny = x + dx, y + dy
                n = out[ny][nx]
                if n == center:
                    same_neighbors += 1
                else:
                    neighbor_colors[n] = neighbor_colors.get(n, 0) + 1

            # 杂色判定：同色邻居 ≤2 且被 ≥2 种不同色包围
            if same_neighbors <= 2 and len(neighbor_colors) >= 2:
                # 找得票最多的相邻色（≥2 票才替换，防止偶然误触）
                dominant = max(neighbor_colors.items(), key=lambda kv: kv[1])
                if dominant[1] >= 2:
                    out[y][x] = dominant[0]

    return out


def _majority_vote_pass(pixels, w: int, h: int,
                        protected: set[tuple[int, int]] = set()) -> list:
    """硬边投票 pass：3×3 窗口投票，若某色得票 ≥4 且中心不是该色 → 吞并中心。

    原理：像素艺术色块内部区域投票给同色，边缘区被相邻色吞并。
    这让硬边更利落，消除残余杂边。
    """
    out = [[pixels[y][x] for x in range(w)] for y in range(h)]

    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if (x, y) in protected:
                continue
            votes: dict[int, int] = {}
            for dy in range(-1, 2):
                for dx in range(-1, 2):
                    votes[out[y + dy][x + dx]] = votes.get(out[y + dy][x + dx], 0) + 1
            best_color, best_votes = max(votes.items(), key=lambda kv: kv[1])
            if best_votes >= 4 and out[y][x] != best_color:
                out[y][x] = best_color

    return out


def _parse_xy(value: str) -> tuple[int, int]:
    try:
        x, y = (int(part.strip()) for part in value.split(",", 1))
    except (ValueError, TypeError):
        raise argparse.ArgumentTypeError("坐标格式应为 x,y")
    return x, y


def _parse_frame(value: str) -> tuple[int, int, int, int]:
    try:
        x, y, w, h = (int(part.strip()) for part in value.split(","))
    except (ValueError, TypeError):
        raise argparse.ArgumentTypeError("frame 格式应为 x,y,width,height")
    if w < 1 or h < 1:
        raise argparse.ArgumentTypeError("frame 的 width/height 必须大于 0")
    return x, y, w, h


def _protected_pixels(size: tuple[int, int], frames: Iterable[tuple[int, int, int, int]],
                     anchors: Iterable[tuple[int, int]]) -> set[tuple[int, int]]:
    w, h = size
    protected: set[tuple[int, int]] = set()
    for x, y, fw, fh in frames:
        for px in range(x, x + fw):
            for py in (y, y + fh - 1):
                if 0 <= px < w and 0 <= py < h:
                    protected.add((px, py))
        for py in range(y, y + fh):
            for px in (x, x + fw - 1):
                if 0 <= px < w and 0 <= py < h:
                    protected.add((px, py))
    for x, y in anchors:
        if 0 <= x < w and 0 <= y < h:
            protected.add((x, y))
    return protected


def purify_image(
    input_path: Path,
    output_path: Path,
    *,
    n_colors: int = 32,
    passes: int = 3,
    inspect: bool = False,
    protect_frames: Iterable[tuple[int, int, int, int]] = (),
    protect_anchors: Iterable[tuple[int, int]] = (),
    mask_path: Optional[Path] = None,
) -> None:
    """对输入图像执行 Hashi-Dither 纯化，输出像素艺术。

    Args:
        input_path:  输入 PNG（万级色彩，AI 生成场景图）
        output_path: 输出 PNG（纯化后像素艺术）
        n_colors:    目标调色板色数（默认 32，建议 16/32/48）
        passes:      混合通过数（默认 3：边清+投票×3）
        inspect:     若为 True，跳过写文件，只打印统计信息
    """
    from PIL import Image

    img = Image.open(input_path)
    w, h = img.size

    if img.mode == "RGBA":
        rgb_img = img.convert("RGB")
    elif img.mode == "P":
        rgb_img = img.convert("RGB")
    else:
        rgb_img = img.convert("RGB")

    palette = get_palette(n_colors)
    protected = _protected_pixels((w, h), protect_frames, protect_anchors)
    # Keep a one-pixel guard ring around structural boundaries so neighboring
    # majority votes cannot erase a wall, portal, or building frame edge.
    protected |= {
        (x + dx, y + dy)
        for x, y in protected
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1))
        if 0 <= x + dx < w and 0 <= y + dy < h
    }
    mask = None
    if mask_path is not None:
        mask = Image.open(mask_path).convert("L")
        if mask.size != (w, h):
            raise ValueError("mask 尺寸必须与输入图像一致")

    # ---- Pass 1：降色（quantize 到调色板）----
    quantized = rgb_img.quantize(colors=n_colors)
    quantized = quantized.convert("RGB")

    # 把 PIL palette 索引转成调色板色索引，再存为色块索引数组
    pixels = []
    rgb_pixels = list(quantized.getdata())
    for i in range(h):
        row = []
        for j in range(w):
            idx = i * w + j
            r, g, b = rgb_pixels[idx]
            row.append(_nearest_palette_color(r, g, b, palette))
        pixels.append(row)

    # Masked-out pixels retain their quantized color, but cannot affect neighbors.
    active = lambda x, y: mask is None or mask.getpixel((x, y)) > 0
    for y in range(h):
        for x in range(w):
            if (x, y) in protected:
                continue
            if not active(x, y):
                protected.add((x, y))

    orig_colors = len(set(p for row in pixels for p in row))

    # ---- Pass 2-N：边清 + 投票混合----
    for _ in range(passes):
        pixels = _edge_clean_pass(pixels, w, h, palette, protected)
        pixels = _majority_vote_pass(pixels, w, h, protected)

    final_colors = len(set(p for row in pixels for p in row))

    # ---- 输出----
    out_img = Image.new("RGB", (w, h))
    for y in range(h):
        for x in range(w):
            idx = pixels[y][x]
            out_img.putpixel((x, y), palette[idx])

    if inspect:
        from PIL import Image as _I
        uniq = len(set(_I.open(input_path).convert("RGB").getdata()))
        print(f"  输入文件：{input_path}")
        print(f"  输入尺寸：{w}×{h}")
        print(f"  输入色彩数：{uniq}")
        print(f"  量化后色数：{orig_colors}")
        print(f"  纯化后色数：{final_colors}")
        print(f"  输出尺寸：{w}×{h}（不变）")
        return

    out_img.save(output_path)
    print(f"✓ {input_path.name}: {w}×{h}, {n_colors} 色调色板, "
          f"色数 {orig_colors} → {final_colors}")


# ---------------------------------------------------------------- CLI ----

def _inspect(args) -> None:
    purify_image(args.input, Path(), n_colors=args.colors, inspect=True)


def _single(args) -> None:
    purify_image(args.input, args.output, n_colors=args.colors, passes=args.passes,
                 protect_frames=args.protect_frame, protect_anchors=args.protect_anchor,
                 mask_path=args.mask)


def _batch(args) -> None:
    from PIL import Image
    start = time.time()
    for p in args.inputs:
        p = Path(p)
        if args.inplace:
            out = p
        else:
            out = p.with_stem(f"{p.stem}-purified")
        try:
            purify_image(p, out, n_colors=args.colors, passes=args.passes,
                         protect_frames=args.protect_frame, protect_anchors=args.protect_anchor,
                         mask_path=args.mask)
        except Exception as e:
            print(f"✗ {p.name} 失败: {e}")
    elapsed = time.time() - start
    print(f"\n✓ 完成 {len(args.inputs)} 个文件，耗时 {elapsed:.2f}s")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="WakeUp 场景图 / 背景图去 AI 杂色纯化",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    insp = sub.add_parser("inspect", help="验证图像：打印色彩统计，不写文件")
    insp.add_argument("input", type=Path, help="输入 PNG")
    insp.add_argument("--colors", type=int, default=32, help="调色板色数（默认 32）")

    single = sub.add_parser("single", help="处理单个文件")
    single.add_argument("input", type=Path, help="输入 PNG")
    single.add_argument("--output", type=Path, required=True, help="输出 PNG")
    single.add_argument("--colors", type=int, default=32, help="调色板色数（默认 32）")
    single.add_argument("--passes", type=int, default=3, help="混合通过数（默认 3）")
    single.add_argument("--protect-frame", action="append", type=_parse_frame, default=[], help="保护建筑 frame 边界 x,y,width,height，可重复")
    single.add_argument("--protect-anchor", action="append", type=_parse_xy, default=[], help="保护入口/楼梯锚点 x,y，可重复")
    single.add_argument("--mask", type=Path, help="地图 mask PNG；非零区域参与纯化")

    batch = sub.add_parser("batch", help="批量处理多个文件")
    batch.add_argument("inputs", type=Path, nargs="+", help="输入 PNG 列表")
    batch.add_argument("--colors", type=int, default=32, help="调色板色数（默认 32）")
    batch.add_argument("--passes", type=int, default=3, help="混合通过数（默认 3）")
    batch.add_argument("--inplace", action="store_true", help="覆盖原文件（默认保留原文件，加 -purified 后缀）")
    batch.add_argument("--protect-frame", action="append", type=_parse_frame, default=[], help="保护建筑 frame 边界 x,y,width,height，可重复")
    batch.add_argument("--protect-anchor", action="append", type=_parse_xy, default=[], help="保护入口/楼梯锚点 x,y，可重复")
    batch.add_argument("--mask", type=Path, help="地图 mask PNG；非零区域参与纯化")

    args = parser.parse_args()
    if args.command == "inspect":
        _inspect(args)
    elif args.command == "single":
        _single(args)
    elif args.command == "batch":
        _batch(args)


if __name__ == "__main__":
    main()
