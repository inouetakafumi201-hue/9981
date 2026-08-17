#!/usr/bin/env python3
"""
sprite-forge 出图适配器（多供应商：默认 gpt-image-2，可选 Nano Banana/gemini）

把上游 generate2dsprite 假定由「宿主内置 image_gen」产出的 raw sheet，换成经
开放式：默认 = OpenAI 兼容中转站(apiclaude.cc) 的 `gpt-image-2`；也可切到
Google Gemini(Nano Banana 系列)。本脚本只产出「solid #FF00FF 背景、多行网格、
subject 居中、同帧等大」的 raw sheet，交给 generate2dsprite.py process 去做
切格/对齐/QC/透明导出。后处理一律沿用上游本地脚本，产物一致。

设计债说明（为什么为项目把它留下）：
  上游 SKILL.md 的 raw 出图规则是「必须内置 image_gen」。但对 WakeUp 而言，
  Codex 内置生图要绑 Codex 会话；很多会话没有 Codex，就得有 API key 或中转。
  于是本适配器把「出图引擎」换成两条独立路径：默认 gpt-image-2（OpenAI 兼容
  中转）或 Gemini(Nano Banana)。用户希望「默认 gpt-image-2、不默认 Codex 生图」。
  理由：让大多数会话不用绑 Codex 也能出图；Codex 原味跑法仍可作为兜底(见 SKILL)。

  本脚本 **不需要** google-genai / openai 库——直接 httpx + multipart(base64)
  调 REST。出图结果与上游假设的 raw sheet 一致，后处理不变。

  【已实测 2026-08-15】两个后端都能用、都能图生图，但接入面不同：
    - gpt-image-2：OpenAI 兼容 `/v1/images/generations`（文生图，返回 b64_json）/ 
      `/v1/images/edits`（图生图，multipart files:image）。品红底味好(97%)。
    - gemini(Nano Banana)：**没有 `/v1/images/*`**（会 404 "Images API is not
      supported"），走 `/v1/chat/completions`，把图片放 image_url 消息，模型返回
      markdown data URI `![image](data:image/png;base64,…)`；图生图 = messages 要塞
      一张 image_url + 提示词。品红纯度一般(60%+)，网格直出尺寸不规整(1408x768)。
    - 结论：gpt-image-2 适合 S1 单图调研(品红稳、干净)；grid/多行网格的 raw sheet
      建议优先 gpt-image-2 单帧再拼，或 gemini/Codex 兜底，后用后处理对齐。

密钥（不走环境变量，从本目录 .env 读；.env 已 gitignore）：
  SPRITE_PROVIDER   = gpt-image-2 | gemini       （默认 gpt-image-2）
  SPRITE_BASE_URL   = https://apiclaude.cc/       （默认）
  SPRITE_GPT_KEY    = gpt-image-2 的 key
  SPRITE_GEMINI_KEY = Nano Banana / gemini 的 key

  NERLY：不要在多个供应商之间混用同一个 key。key 只放在 tools/.env，不提交。

环境：
  pip install httpx  （轻量；google-genai / openai 都不要求）
  PRINT_PROMPT_ONLY=1 只打印将发送的 prompt 不上网（用于先在提示词层面校对）。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
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


# ---------------------------------------------------------------- 配置加载 ----

DOTENV = Path(__file__).resolve().parent / ".env"


def load_dotenv() -> None:
    """读同目录 .env(SPRITE_PROVIDER/SPRITE_BASE_URL/SPRITE_GPT_KEY/SPRITE_GEMINI_KEY)。"""
    if not DOTENV.exists():
        return
    for line in DOTENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip()
        if k.startswith("SPRITE_"):
            os.environ.setdefault(k, v)


def resolve_config(provider_override: str | None = None) -> dict:
    """读 .env 的 key。provider 优先级: 命令行 --provider > SPRITE_PROVIDER > 默认 gpt-image-2。

    key 必须与 provider 对应——**不要用错 key**（gpt 的 key 在 gemini 后端会 404
    "Model not supported by any configured account in this group"）。
    """
    load_dotenv()
    env_provider = os.environ.get("SPRITE_PROVIDER", "gpt-image-2").strip().lower()
    provider = (provider_override or env_provider).strip().lower()
    base_url = os.environ.get("SPRITE_BASE_URL", "https://apiclaude.cc/").rstrip("/")
    if provider == "gemini":
        key = os.environ.get("SPRITE_GEMINI_KEY")
        if not key:
            raise SystemExit("provider=gemini 需要 tools/.env 里 SPRITE_GEMINI_KEY")
    else:
        provider = "gpt-image-2"
        key = os.environ.get("SPRITE_GPT_KEY")
        if not key:
            raise SystemExit("provider=gpt-image-2 需要 tools/.env 里 SPRITE_GPT_KEY")
    return {"provider": provider, "key": key, "base_url": base_url}


# ---------------------------------------------------------------- gpt-image-2 --

def gpt_image_2_generate(
    prompt: str, *, key: str, base_url: str, size: str, reference_pngs: list[str]
) -> bytes:
    """经 OpenAI 兼容中转 `/v1/images/edits` 调 gpt-image-2 取 PNG 字节。

    纯文生图走 `/v1/images/generations`，图生图走 `/v1/images/edits`(传 image[n] 文件)。
    实测该中转上两者都能用。
    """
    import httpx  # 延迟导入：没装 httpx 时给友好报错

    if reference_pngs:
        # 图生图：走 /images/edits，传 image[n] 文件 + prompt
        resp = httpx.post(
            f"{base_url}/v1/images/edits",
            data={"model": "gpt-image-2", "prompt": prompt, "size": size,
                  "response_format": "b64_json"},
            files={f"image[{i}]": (Path(p).name, Path(p).read_bytes(), "image/png")
                   for i, p in enumerate(reference_pngs)},
            headers={"Authorization": f"Bearer {key}"}, timeout=300,
        )
    else:
        # 纯文生图：/images/generations（该中转上 edits 无图会 400）
        resp = httpx.post(
            f"{base_url}/v1/images/generations",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": "gpt-image-2", "prompt": prompt, "size": size,
                  "response_format": "b64_json"},
            timeout=300,
        )
    if resp.status_code != 200:
        raise SystemExit(f"gpt-image-2 调用失败 HTTP {resp.status_code}: {resp.text[:400]}")
    try:
        data = resp.json()
    except Exception as exc:  # pragma: no cover
        raise SystemExit(f"gpt-image-2 返回非 JSON: {resp.text[:400]} ({exc})") from exc
    arr = data.get("data")
    if isinstance(arr, list) and arr and isinstance(arr[0], dict):
        b64 = arr[0].get("b64_json")
        if b64:
            return base64.b64decode(b64)
        url = arr[0].get("url")
        if url:
            img = httpx.get(url, timeout=300)
            if img.status_code == 200:
                return img.content
    raise SystemExit(f"gpt-image-2 返回内容里没找图: {resp.text[:400]}")


# -------------------------------------------------------------- gemini(Nano Banana) --

def gemini_generate(
    prompt: str, *, model: str, reference_pngs: list[str], key: str, base_url: str
) -> bytes:
    """走 `POST {base_url}/v1/chat/completions` 调 gemini 图像模型。

    实测该中转没有 `/v1/images/*`(404 "Images API is not supported")。gemini 图模型
    走 chat: 用户消息传 text(可加一张 image_url 图生图),返回 content 是
    `![image](data:image/png;base64,…)`，抽其 base64 即 raw PNG。
    """
    import httpx  # 延迟导入

    content: list[dict] = []
    for ref in reference_pngs:
        content.append({"type": "image_url",
                        "image_url": {"url": "data:image/png;base64,"
                                             + base64.b64encode(
                                                 Path(ref).read_bytes()).decode()}})
    content.append({"type": "text", "text": prompt})
    resp = httpx.post(
        f"{base_url}/v1/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={"model": model, "messages": [{"role": "user", "content": content}]},
        timeout=300,
    )
    if resp.status_code != 200:
        raise SystemExit(f"gemini 调用失败 HTTP {resp.status_code}: {resp.text[:400]}")
    try:
        text = resp.json()["choices"][0]["message"]["content"]
    except Exception as exc:  # pragma: no cover
        raise SystemExit(f"gemini 返回结构异常: {resp.text[:400]} ({exc})") from exc
    if not isinstance(text, str):
        raise SystemExit(f"gemini 未返回图片文本: {str(text)[:200]}")
    m = re.search(r"data:image/png;base64,([A-Za-z0-9+/=]+)", text)
    if not m:
        raise SystemExit(f"gemini 返回里没找到 data URI 图片: {text[:200]}")
    return base64.b64decode(m.group(1))


# -------------------------------------------------------------------- 入口 ----

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="按 gpt-image-2/gemini 出多行网格 raw sheet")
    gen.add_argument("--prompt", required=True, help="用户主题/视觉方向")
    gen.add_argument("--rows", type=int, required=True)
    gen.add_argument("--cols", type=int, required=True)
    gen.add_argument("--cell", type=int, default=384,
                     help="单格像素边长目标；供应商按总尺寸档位近似，文本若冲突以 API 档位为准")
    gen.add_argument("--aspect", default="1:1", help="宽高比,如 1:1 / 3:2")
    gen.add_argument("--art-style", default=None)
    gen.add_argument("--reference", nargs="*", default=[],
                     help="图生图参考图(上一版 raw sheet 或主视觉),用于锁定风格/局部重绘")
    gen.add_argument("--out", required=True, type=Path)
    gen.add_argument("--provider", default=None,
                     help="覆盖 tools/.env 的 provider; gpt-image-2 | gemini。会用对应的 key")
    gen.add_argument("--model", default=None)

    args = parser.parse_args()
    if args.command != "generate":
        parser.error("未知 command")

    cfg = resolve_config(provider_override=args.provider)
    provider = cfg["provider"]
    key = cfg["key"]
    base_url = cfg["base_url"]

    prompt = build_prompt(args.rows, args.cols, args.prompt, args.art_style)
    # 目标原生分辨率: 64×64,像素艺术硬边色块(非厚涂渐变)
    qual = ("Authentic retro pixel art sprite, native 64x64 pixel grid with visible square pixels, "
            "hard-edged solid color blocks for shading, NO gradients, NO dithering, NO soft blur, "
            "strict limited palette 8-12 colors total, each body part uses 2-3 flat distinct shades "
            "(highlight/mid/shadow as separate color areas with clean boundaries), clean geometric shapes, "
            "NOT painted look, NOT anti-aliased edges, classic game sprite aesthetic, "
            "finished high-quality pixel art game sprite,")
    prompt = f"{qual} {prompt}"
    if os.environ.get("PRINT_PROMPT_ONLY"):
        print(f"[provider={provider}]")
        print(prompt)
        return

    # gpt-image-2 只有 1024/1536/1792；cell 仅作语义；选最接近正方形的档
    if provider == "gpt-image-2":
        size = "1024x1024"
        png = gpt_image_2_generate(prompt, key=key, base_url=base_url, size=size,
                                   reference_pngs=args.reference)
        model_name = "gpt-image-2"
    else:
        model = args.model or os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-image-preview")
        size = None  # gemini chat 无 size 档；尺寸由模型出图决定
        png = gemini_generate(prompt, model=model, reference_pngs=args.reference,
                              key=key, base_url=base_url)
        model_name = model

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(png)
    meta = {
        "provider": provider, "model": model_name, "rows": args.rows, "cols": args.cols,
        "size": size, "prompt": prompt, "reference_pngs": args.reference,
    }
    (args.out.with_suffix(".raw.json")).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"wrote {args.out} ({len(png)} bytes) + {args.out.with_suffix('.raw.json')}")


if __name__ == "__main__":
    main()
