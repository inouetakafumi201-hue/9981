#!/usr/bin/env python3
"""
Nano Banana -> generate2dsprite 出图适配器（sprite-forge 落地桥）

把上游 generate2dsprite 假定由宿主 agent「内置 `image_gen`」产出的 raw sheet，
换成经 Google Gemini API（Nano Banana 系列）生成。其余全部对齐上游 SKILL.md：
本脚本只产「solid #FF00FF 背景、多行网格、subject 居中、同帧等大」的 raw sheet，
交给 generate2dsprite.py process 去做切格/对齐/QC/透明导出。

为什么存在：
  上游 SKILL.md 明文「Use built-in image_gen for every raw image」并把取图路径写成
  `$CODEX_HOME/generated_images`、参考图用 `view_image`。本适配器把「出图引擎」这一个
  接缝替换为 Nano Banana（gemini 原生图片），其余后处理与规范不动。见
  docs/创作系统/04_sprite_forge落地交接.md。

依赖：
  pip install google-genai  （或 openai/httpx 走其它供应商；本脚本只实现 Google 直连）
环境变量：
  GEMINI_API_KEY       必填
  GEMINI_MODEL         可选，默认 gemini-3.1-flash-image （Nano Banana 2）
  可用：gemini-3.1-flash-image / gemini-3.1-flash-lite-image / gemini-3-pro-image
  GEMINI_IMAGE_SIZE    可选，默认 1K；可用 0.5K / 1K / 2K / 4K（仅受模型支持）

典型用法（单行动作序列，例如 2x2 攻击）：
  python nano-banana-sprite.py generate --rows 2 --cols 2 --cell 384 \
    --prompt "side-view pixel knight attack, solid #FF00FF background" \
    --out run/attack-raw.png
  然后：
  python generate2dsprite/scripts/generate2dsprite.py process \
    --input run/attack-raw.png --target player --mode attack --rows 2 --cols 2 \
    --output-dir run/ --cell-size 128 --align feet --scale-strategy preserve \
    --component-mode largest --strict-qc --max-body-scale-cv 0.08 --max-anchor-y-std 0.05

为什么用多行网格：上游 SKILL.md 明确禁止 raw 单行 strip（1x4/1xN）做身体动画，
因模型水平漂移与裁切不一致。2x2=4帧、2x3=6帧、3x3=9帧……请按上游 `sheet` 参数选形。

prompt 内插规范（与上游一致）：
  - 背景必须是 100% solid flat magenta #FF00FF，无渐变无阴影无文字
  - 每格一个动作帧，帧与帧之间不得出现分隔线/边框
  - subject 居中、各帧同一主体同一 scale，不得跨格边缘
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path


# ---------------------------------------------------------------- prompt 组装 --

DEFAULT_MAGENTA_RULE = (
    "Background is 100% solid flat magenta (#FF00FF), no gradients, no shadow, "
    "no text, no labels, no borders, no grid lines, no numbers anywhere."
)

GRID_RULE = (
    "Exactly {rows}x{cols} equal cells in a strict grid (same width and height per cell). "
    "Each cell shows one frame. Cells are connected only by solid magenta (#FF00FF). "
    "No dividers, no frames, no letters, no UX elements."
)

CONSISTENCY_RULE = (
    "Subject is centered in every cell, identical height and width across all cells "
    "(same bounding box, same pixel scale). Do not zoom or crop differently between cells. "
    "Keep ~60% magenta margin on all four sides. Nothing crosses a cell edge."
)


def build_prompt(rows: int, cols: int, user_prompt: str, art_style: str | None = None) -> str:
    """按上游 prompt-rules 的精神,把用户主题压成一张多行网格 raw sheet 的提示词。"""
    grid = GRID_RULE.format(rows=rows, cols=cols)
    style = f"Art style: {art_style}. " if art_style else ""
    return (
        f"{style}{user_prompt.rstrip('.')}. "
        f"{grid} {CONSISTENCY_RULE} {DEFAULT_MAGENTA_RULE}"
    )


# ------------------------------------------------------------- Nano Banana 调用 --

def gemini_generate(
    prompt: str,
    *,
    model: str,
    size: str,
    aspect: str,
    reference_pngs: list[str],
) -> bytes:
    """调 Nano Banana（Gemini Interactions API）生成/编辑并返回 raw PNG 字节。"""
    try:
        from google import genai
        from google.genai import types
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "缺少 google-genai：pip install google-genai\n"
            f"（原错误：{exc}）"
        ) from exc

    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise SystemExit("请设置环境变量 GEMINI_API_KEY")

    client = genai.Client(api_key=key)
    contents: list[object] = []

    # 参考图：若提供上一版底图（图生图局部重绘/风格锁定），转成内联零件
    if reference_pngs:
        parts: list[object] = []
        for ref in reference_pngs:
            blob = Path(ref).read_bytes()
            parts.append(
                types.Part(
                    inline_data=types.Blob(
                        mime_type="image/png",
                        data=base64.b64encode(blob).decode("ascii"),
                    )
                )
            )
        parts.append(types.Part(text=prompt))
        contents.append(types.Content(parts=parts))
    else:
        contents.append(types.Content(parts=[types.Part(text=prompt)]))

    resp = client.models.generate_content(
        model=model,
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            response_format=None,
        ),
    )
    # 提取输出图片字节
    for part in (resp.candidates[0].content.parts if resp.candidates else []):
        data = part.inline_data
        if data is not None and data.data is not None:
            return base64.b64decode(data.data)
    raise SystemExit("Nano Banana 未返回图片;请检查 API 与模型名。")


# -------------------------------------------------------------------- 入口 ----

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="用 Nano Banana 生成一张多行网格 raw sheet")
    gen.add_argument("--prompt", required=True, help="用户主题/视觉方向")
    gen.add_argument("--rows", type=int, required=True)
    gen.add_argument("--cols", type=int, required=True)
    gen.add_argument("--cell", type=int, default=384,
                     help="单格像素边长目标（Nano Banana 只有 0.5K/1K/2K/4K 总尺寸档位,文本若冲突以 API 档位为准）")
    gen.add_argument("--aspect", default="1:1", help="宽高比,如 1:1 / 3:2")
    gen.add_argument("--art-style", default=None)
    gen.add_argument("--reference", nargs="*", default=[],
                     help="图生图参考图（上一版 raw sheet 或主视觉）,用于锁定风格/局部重绘")
    gen.add_argument("--out", required=True, type=Path)
    gen.add_argument("--model", default=None)
    gen.add_argument("--size", default=None)

    args = parser.parse_args()

    if args.command == "generate":
        if args.model:
            model = args.model
        else:
            model = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-image")
        size = args.size or os.environ.get("GEMINI_IMAGE_SIZE", "1K")
        prompt = build_prompt(args.rows, args.cols, args.prompt, args.art_style)
        if os.environ.get("PRINT_PROMPT_ONLY"):
            print(prompt)
            return
        png = gemini_generate(
            prompt,
            model=model,
            size=size,
            aspect=args.aspect,
            reference_pngs=args.reference,
        )
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes(png)
        meta = {
            "rows": args.rows, "cols": args.cols, "model": model,
            "size": size, "aspect": args.aspect, "prompt": prompt,
            "reference_pngs": args.reference,
        }
        (args.out.with_suffix(".json")).write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
        print(f"wrote {args.out} ({len(png)} bytes) + prompt/params json")


if __name__ == "__main__":
    main()
