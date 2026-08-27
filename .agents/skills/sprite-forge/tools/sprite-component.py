#!/usr/bin/env python3
"""
sprite-component.py — WakeUp 组件生成管线（外包化：AI 只需传参数，直接拿成品）

与角色管线（sprite-pixelate.py / generate2dsprite.py）不同，本管线专门生成
「统一美学的静态组件」——武器、物品、设备、环境交互件。风格完全锁定在脚本内部
（视角/光影/像素/语义色/背景），AI 或迭代者不需要关心怎么做贴图，只需要说
「要一个什么类型的什么组件、有几个状态」，拿回来就是品红底、纯化背景、按固定
比例切好、已像素化的成品帧。

设计原则（2026-08-16 定案）：
  1. 极其稳定：提示词高度结构化、风格参数硬编码、后处理固定，不做任何随机发挥。
  2. 外包化：不消耗 AI 心智。调用方只提供 类型+描述+状态；其余全由本脚本决定。
  3. 风格锁定靠提示词：语义色表（docs/表现系统/01 §五条视觉定律）与组件风格规范
     写死在脚本里，任何组件生成都输出同一种美学。
  4. 帧数由调用方决定：单帧（钥匙）或多帧（箱子=closed/open/broken）都支持，
     脚本自动排网格（2x2/2x3/3x3/4x4）并切格。

用法：
  # 单帧组件（钥匙）
  python sprite-component.py --type item-tool --desc "old brass door key" --out run/assets/key

  # 多帧组件（箱子三态）
  python sprite-component.py --type environment --desc "wooden supply crate" \
      --states closed,open,broken --out run/assets/crate

  # 指定后端
  python sprite-component.py --type weapon-firearm --desc "revolver" \
      --provider gemini --out run/assets/revolver

  # 只打印提示词不调用 API（校对用）
  PRINT_PROMPT_ONLY=1 python sprite-component.py --type item-consumable --desc "bandage" --out /tmp/x

  # 批量模式：读『待生成素材登记清单』逐条生成（失败跳过继续，写批量报告）
  python sprite-component.py --registry run/assets/batch-registry.json --delay 4

  # 批量演练：校验清单 + 打印提示词，不发 API、不写盘
  python sprite-component.py --registry run/assets/batch-registry.json --dry-run

批量登记清单（run/assets/batch-registry.json，kind="wakeup-batch-manifest"）：
  { "kind": "wakeup-batch-manifest", "version": 1,
    "defaults": { "context": "map", "provider": null, "cell": 64, "colors": 32 },
    "entries": [
      { "name": "ui-knife", "type": "weapon-melee", "desc": "rusty combat knife", "context": "ui" },
      { "name": "crate-supply", "type": "environment", "desc": "wooden supply crate",
        "states": ["closed", "open", "broken"] }
    ] }
  name=出图目录名（唯一）；type=8 类组件；desc=描述；states=状态数组（缺省 single）；
  context=map|ui（缺省 map）；可选逐条覆盖 defaults：provider/reference/out_override/cell/colors。
  批量模式默认跳过已有 manifest.json 的条目（--force 强制重生成），失败记入失败清单继续下一条。

产物结构（输出目录内）：
  raw.png         后端原始网格 sheet
  raw.json        提示词留档（含状态表）
  sheet.png       背景纯化后的整 sheet（品红底）
  frames/         N 个 64×64 成品帧，按状态命名（single.png / closed.png ...）
  contact.png     各帧拼版总览
  manifest.json   组件登记（类型/状态/路径/提示词摘要）

依赖：httpx / Pillow / proper-pixel-art / numpy
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------- 异常与分类 ----

# API 429 限流退避基线（秒）与最大尝试次数。批量模式由 --delay 负责请求间隔，
# 429 是网关/上游的额外防护层：首次 429 等 30s 重试一次，仍失败则归类记入失败清单。
API_RETRY_BACKOFF = 30
API_RETRY_ATTEMPTS = 2


class BatchItemError(Exception):
    """单条组件生成失败：stage=阶段，error_type=可归类错误码。

    批量模式靠 (stage, error_type) 做失败模式统计与可识别可修正：
      api.{rate_limited,server,http_*,timeout,network,parse,config}
      purify.purify_failed / slice.slice_failed
      gate.{count_mismatch,frame_too_small,content_too_low}
      pixelate.pixelate_failed / write.{mkdir,write,write_frame,contact,manifest}
    """

    def __init__(self, stage: str, error_type: str, error: str):
        super().__init__(error)
        self.stage = stage
        self.error_type = error_type
        self.error = error


def _api_error(provider: str, status: int, detail: str) -> BatchItemError:
    """后端 HTTP 非 200 → 分类错误（429 限流 / 5xx 服务端 / 其余按状态码）。"""
    if status == 429:
        error_type = "rate_limited"
    elif 500 <= status < 600:
        error_type = "server"
    else:
        error_type = f"http_{status}"
    return BatchItemError("api", error_type, f"{provider} 调用失败 HTTP {status}: {detail[:400]}")


def _gate_error_type(msg: str) -> str:
    """把质量闸门 RuntimeError 文案映射到可归类错误码。"""
    if "不匹配" in msg:
        return "count_mismatch"
    if "过小" in msg:
        return "frame_too_small"
    if "占比" in msg:
        return "content_too_low"
    return "gate"

# ---------------------------------------------------------------- 风格规范 ----

# 组件基础风格（所有组件共用，硬编码锁定；视角规则单独一块，见 VIEW_RULES）
COMPONENT_STYLE = (
    "Front-top axonometric game asset, seen from a conventional elevated front angle. "
    "Only the top face and front face should be visible; no side face, no rear face, no flat bird's-eye icon. "
    "Hard-edged solid color blocks, native 64x64 pixel grid aesthetic, "
    "NO anti-aliasing, NO gradients, NO dithering, NO soft blur. "
    "Clean hard silhouette, readable at 64x64. "
    "Modern urban low-key realism, muted palette, grounded everyday objects, "
    "no fantasy armor, no gore, no sci-fi glow. "
    "Lighting: flat 2-3 shade steps per surface (bright highlight / mid tone / dark shadow "
    "as separate solid color areas with clean boundaries), light source upper-left. "
    "Background: 100% solid flat magenta (#FF00FF), no gradients, no shadow, "
    "no text, no labels, no numbers anywhere."
)

# 视角规则：全项目唯一视角 = 正面俯视视图（front-top axonometric view）。地图实体与背包/UI 图标
# 统一同一视图——都必须保留顶部与前部的体积感；不能退回纯俯视或纯侧视。
# 权威：docs/表现系统/01_图形化与UI.md §正面俯视视图、PLT-01、05_组件生成风格规范。
VIEW_RULES = {
    "map": (
        "FRONT-TOP AXONOMETRIC VIEW ONLY: a conventional oblique front-top sprite. "
        "The object must read as a shallow 3D form with the top plane and front plane visible. "
        "NO pure top-down plan view, NO side profile, NO rear face, NO visible side face, "
        "NO three-quarter side view, NO exaggerated perspective depth. "
        "Keep the viewing angle fixed and conventional; never collapse the object into a flat bird's-eye icon."
    ),
    "ui": (
        "UI / INVENTORY ICON VIEW: the same front-top axonometric view, but compact and highly readable. "
        "The icon still shows the top plane and front plane, never a side face or flat bird's-eye icon. "
        "NO pure top-down plan view, NO side profile, NO three-quarter side, NO isometric three-face cube. "
        "Keep the icon as a front-top oblique object, not a flat overhead symbol."
    ),
}

# 语义色表（docs/表现系统/01_图形化与UI.md §五条视觉定律 1）
# 每个组件族给出主色语义 + 材质倾向；金银只作高光/描边，不构成主色。
SEMANTIC_COLORS = {
    "weapon-melee": (
        "Primary semantic color: CORAL (coral / warm orange-red) for melee attack identity. "
        "Secondary: dark steel gray, worn leather grip. Highlight: silver edge."
    ),
    "weapon-ranged": (
        "Primary semantic color: PURPLE accent (long-range / relationship constraint). "
        "Secondary: matte dark gray composite, tan strap. Highlight: silver."
    ),
    "weapon-firearm": (
        "Primary semantic color: gunmetal gray-blue with ORANGE accent (consumes AP / ammo). "
        "Secondary: dark polymer, brass casing detail. Highlight: silver slide."
    ),
    "item-consumable": (
        "Primary semantic color: GREEN (positive / safe / free) or ORANGE (consumption) "
        "depending on the item's main function. Secondary: white bandage / amber liquid / paper wrap. "
        "Highlight: bright green accent."
    ),
    "item-tool": (
        "Primary semantic color: ORANGE (action / in-progress) or YELLOW (senses / attention) "
        "depending on the tool's main function. Secondary: black rubber grip, steel. Highlight: silver."
    ),
    "item-equipment": (
        "Primary semantic color: BLUE (tech / exhaustion-adjacent utility). "
        "Secondary: gray fabric, dark straps. Highlight: cyan-blue edge."
    ),
    "device": (
        "Primary semantic color: off-white gray (interactive-but-state-bound) with BLUE tech accent. "
        "Secondary: dark screen, metal casing. Highlight: white edge glow when active."
    ),
    "environment": (
        "Primary semantic color: muted low-saturation gray/brown matching the sketch-line background, "
        "with clear hard silhouette. Secondary: wood / concrete / metal. Highlight: subtle."
    ),
}

# 状态名 → 提示词里的姿态/状态描述补充
STATE_HINTS = {
    "single": "single idle state, the object in its default appearance",
    "closed": "CLOSED state: fully sealed, latch engaged",
    "open": "OPEN state: lid/cover swung open, contents visible",
    "broken": "BROKEN state: damaged, cracked, debris around base",
    "idle": "idle state: resting, default appearance",
    "active": "ACTIVE state: powered on, glowing indicator, in use",
    "empty": "EMPTY state: depleted, no contents",
    "full": "FULL state: fully loaded, contents visible",
    "used": "USED state: partially consumed, worn",
    "charging": "CHARGING state: energy indicator active",
}

# ---------------------------------------------------------------- 配置加载 ----

DOTENV = Path(__file__).resolve().parent / ".env"


def load_dotenv() -> None:
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


def resolve_config(provider_override: str | None) -> dict:
    load_dotenv()
    env_provider = os.environ.get("SPRITE_PROVIDER", "gpt-image-2").strip().lower()
    provider = (provider_override or env_provider).strip().lower()
    base_url = os.environ.get("SPRITE_BASE_URL", "https://apiclaude.cc/").rstrip("/")
    if provider == "gemini":
        key = os.environ.get("SPRITE_GEMINI_KEY")
        if not key:
            raise SystemExit("provider=gemini 需要 tools/.env 里 SPRITE_GEMINI_KEY")
        model = os.environ.get("SPRITE_GEMINI_MODEL", "gemini-3.1-flash-image-preview")
    else:
        provider = "gpt-image-2"
        key = os.environ.get("SPRITE_GPT_KEY")
        if not key:
            raise SystemExit("provider=gpt-image-2 需要 tools/.env 里 SPRITE_GPT_KEY")
        model = "gpt-image-2"
    return {"provider": provider, "key": key, "base_url": base_url, "model": model}


# ---------------------------------------------------------------- 提示词组装 ----

def pick_grid(state_count: int) -> tuple[int, int]:
    """按状态数选网格（竖排优先，避免上游明令禁止的 1xN 水平漂移）：
    1→1x1, 2→2x1, 3→3x1, 4→2x2, 5-6→3x2, 7-9→3x3, 10-16→4x4"""
    if state_count <= 1:
        return 1, 1
    if state_count <= 3:
        return state_count, 1
    if state_count <= 4:
        return 2, 2
    if state_count <= 6:
        return 3, 2
    if state_count <= 9:
        return 3, 3
    return 4, 4


def build_prompt(comp_type: str, desc: str, states: list[str], context: str = "map") -> str:
    rows, cols = pick_grid(len(states))
    color_rule = SEMANTIC_COLORS.get(comp_type, SEMANTIC_COLORS["environment"])
    view_rule = VIEW_RULES.get(context, VIEW_RULES["map"])
    state_desc = "; ".join(
        f"cell {i + 1} ({name}): {STATE_HINTS.get(name, f'{name} state of the object')}"
        for i, name in enumerate(states)
    )
    grid_rule = (
        f"Exactly {rows}x{cols} equal cells in a strict grid (same width and height per cell). "
        "Each cell shows one state of the same object. Cells are connected only by solid magenta (#FF00FF). "
        "No dividers, no frames, no letters, no UX elements. "
        "Subject is centered in every cell, identical size and pixel scale across all cells. "
        "Keep ~60% magenta margin on all four sides. Nothing crosses a cell edge."
    )
    prompt = (
        f"{COMPONENT_STYLE} "
        f"{view_rule} "
        f"COMPONENT: {desc}. "
        f"Semantic color scheme: {color_rule} "
        f"GRID STATES: {state_desc}. "
        f"{grid_rule}"
    )
    return prompt


# ---------------------------------------------------------------- 后端调用 ----

def call_backend(cfg: dict, prompt: str, out_path: Path, reference: Path | None) -> None:
    provider = cfg["provider"]
    if provider == "gpt-image-2":
        _call_gpt(cfg, prompt, out_path)
    else:
        _call_gemini(cfg, prompt, out_path, reference)


def _post_with_retry(post_fn, provider: str) -> "httpx.Response":
    """带 429 退避重试的 POST：首次 429 等 API_RETRY_BACKOFF 后重试一次。

    超时/网络错误直接归类抛错（批量模式继续下一条）；其余状态码返回给调用方分类。
    """
    import httpx

    for attempt in range(API_RETRY_ATTEMPTS):
        try:
            resp = post_fn()
        except httpx.TimeoutException:
            raise BatchItemError("api", "timeout", f"{provider} 请求超时（>300s）") from None
        except httpx.HTTPError as e:
            raise BatchItemError("api", "network", f"{provider} 请求失败: {e}") from None
        if resp.status_code == 429 and attempt < API_RETRY_ATTEMPTS - 1:
            print(f"  ⚠ {provider} HTTP 429 限流，退避 {API_RETRY_BACKOFF}s 后重试", flush=True)
            time.sleep(API_RETRY_BACKOFF)
            continue
        return resp
    raise RuntimeError("unreachable")  # 仅当 API_RETRY_ATTEMPTS <= 0 时可达


def _call_gpt(cfg: dict, prompt: str, out_path: Path) -> None:
    import httpx

    def post() -> "httpx.Response":
        return httpx.post(
            f"{cfg['base_url']}/v1/images/generations",
            headers={"Authorization": f"Bearer {cfg['key']}"},
            json={
                "model": "gpt-image-2",
                "prompt": prompt,
                "n": 1,
                "size": "1024x1024",
                "response_format": "b64_json",
            },
            timeout=300,
        )

    resp = _post_with_retry(post, "gpt-image-2")
    if resp.status_code != 200:
        raise _api_error("gpt-image-2", resp.status_code, resp.text)
    try:
        data = resp.json()
    except ValueError as e:
        raise BatchItemError("api", "parse", f"gpt-image-2 返回非法 JSON: {e}") from e
    b64 = data["data"][0].get("b64_json")
    if not b64:
        raise BatchItemError("api", "parse", f"gpt-image-2 返回内容里没找图: {resp.text[:400]}")
    try:
        out_path.write_bytes(base64.b64decode(b64))
    except (OSError, ValueError) as e:
        raise BatchItemError("api", "parse", f"gpt-image-2 图片解码失败: {e}") from e


def _call_gemini(cfg: dict, prompt: str, out_path: Path, reference: Path | None) -> None:
    import httpx

    content: list[dict] = []
    if reference is not None and reference.exists():
        content.append({
            "type": "image_url",
            "image_url": {"url": "data:image/png;base64,"
                                 + base64.b64encode(reference.read_bytes()).decode()},
        })
    content.append({"type": "text", "text": prompt})

    def post() -> "httpx.Response":
        return httpx.post(
            f"{cfg['base_url']}/v1/chat/completions",
            headers={"Authorization": f"Bearer {cfg['key']}"},
            json={"model": cfg["model"], "messages": [{"role": "user", "content": content}]},
            timeout=300,
        )

    resp = _post_with_retry(post, "gemini")
    if resp.status_code != 200:
        raise _api_error("gemini", resp.status_code, resp.text)
    try:
        text = resp.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError) as e:
        raise BatchItemError("api", "parse", f"gemini 返回结构异常: {e}") from e
    m = re.search(r"data:image/png;base64,([A-Za-z0-9+/=]+)", text)
    if not m:
        raise BatchItemError("api", "parse", f"gemini 返回里没找到 data URI 图片: {text[:200]}")
    try:
        out_path.write_bytes(base64.b64decode(m.group(1)))
    except (OSError, ValueError) as e:
        raise BatchItemError("api", "parse", f"gemini 图片解码失败: {e}") from e


# ---------------------------------------------------------------- 后处理 ----

def purify_magenta(img, tol: int = 90):
    """近品红 → 纯品红（消除抗锯齿残边）"""
    import numpy as np
    from PIL import Image

    arr = np.array(img.convert("RGBA"))
    r, g, b = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)
    dist = (r - 255) ** 2 + g**2 + (b - 255) ** 2
    mask = dist < tol**2
    arr[mask, 0] = 255
    arr[mask, 1] = 0
    arr[mask, 2] = 255
    return Image.fromarray(arr)


def _detect_bands(img, axis: int):
    """检测纯品红分隔带（axis=0 水平带 / axis=1 垂直带）。

    返回 (bands, regions)：bands 是分隔带区间列表（含外边框），regions 是
    相邻分隔带之间的内容区区间列表。检测失败（无内容或带数异常）返回 (None, None)。
    """
    import numpy as np

    arr = np.array(img.convert("RGBA"))
    r, g, b = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)
    dist = (r - 255) ** 2 + g**2 + (b - 255) ** 2
    bg = dist < 90**2
    h, w = bg.shape

    if axis == 0:  # 水平带：整行几乎全品红
        counts = bg.sum(axis=1)
        threshold = w * 0.97
        idx = np.where(counts > threshold)[0]
    else:  # 垂直带：整列几乎全品红
        counts = bg.sum(axis=0)
        threshold = h * 0.97
        idx = np.where(counts > threshold)[0]

    if len(idx) == 0:
        return None, None

    # 把相邻的带索引聚成区间（间隔 >3 视为新带）
    bands = []
    start = prev = int(idx[0])
    for v in idx[1:]:
        v = int(v)
        if v - prev > 3:
            bands.append((start, prev))
            start = v
        prev = v
    bands.append((start, prev))

    # 内容区 = 相邻分隔带之间的空隙
    regions = []
    for i in range(len(bands) - 1):
        a, b_ = bands[i][1], bands[i + 1][0]
        if b_ - a > 1:
            regions.append((a, b_))
    return bands, regions


def slice_grid(img, rows: int, cols: int):
    """按期望布局切格的安全回退（仅当真实检测格数不等于状态数时使用）。

    此函数不把提示词期望当作实际网格：常规路径由 `slice_grid_detected()` 决定。
    回退只保证帧数匹配且不会出现反向裁剪框（left>right / top>bottom）。
    """
    h, w = img.size
    hb, hregions = _detect_bands(img, axis=0)
    vb, vregions = _detect_bands(img, axis=1)

    # 期望 rows+1 条水平带、cols+1 条垂直带（含外边框），且内容区数量匹配
    if (
        hb is not None and vb is not None
        and len(hb) == rows + 1 and len(vb) == cols + 1
        and len(hregions) == rows and len(vregions) == cols
    ):
        rows_region = hregions
        cols_region = vregions
    else:
        # 检测失败：等分（每格至少覆盖整幅，保证 left<right / top<bottom）
        rows_region = [(i * h // rows, (i + 1) * h // rows - 1) if rows > 1 else (0, h - 1)
                       for i in range(rows)]
        cols_region = [(i * w // cols, (i + 1) * w // cols - 1) if cols > 1 else (0, w - 1)
                       for i in range(cols)]

    frames = []
    for r in range(rows):
        for c in range(cols):
            left, right = cols_region[c]
            top, bottom = rows_region[r]
            if left >= right or top >= bottom:
                # 防御：任何反向/零宽裁剪框都跳过，避免产出 1×1 退化帧
                continue
            frames.append(img.crop((left, top, right, bottom)))
    return frames


def slice_grid_detected(img):
    """按检测到的真实行列切格，返回帧图列表（数量即实际状态格数）。

    不依赖期望布局：横向有几个内容列、纵向有几个内容行，就切几格。只有单个内容
    区（无分隔带）时返回整图。尊重模型实际画出来的网格。

    已知坑（proper-pixel-art 兼容）：切出的帧若在横轴只有 1px 高或没有非品红内容
    （横轴分隔带把相邻帧误判成"同一帧"的上下半区，或整幅都被背景覆盖），会得到
    0 高度/空内容帧，proper_pixel_art 的网格重建会把 (w,0) 的空图一路传到
    `pixelated.save()` → "cannot write empty image" 崩溃。这里在产出帧列表前直接
    过滤掉这些退化帧：对帧数 <= 期望值且横轴压缩后为空的情况视为"该状态没有独立
    内容"，按整个内容区重新切，宁可产出非预期数量帧（由质量闸门兜底），也绝不
    把空帧交给下游。
    """
    h, w = img.size
    _, hregions = _detect_bands2(img)
    _, vregions = _detect_bands2_v(img)
    row_ranges = [(a, b) for (a, b) in hregions]
    col_ranges = [(a, b) for (a, b) in vregions]
    # 纵横都用内容区；若某轴没有分隔（单行/单列），则该轴内容区覆盖整幅
    if len(row_ranges) == 0:
        row_ranges = [(0, h - 1)]
    if len(col_ranges) == 0:
        col_ranges = [(0, w - 1)]
    if len(row_ranges) == 1 and len(col_ranges) == 1 and (row_ranges, col_ranges) == ([(0, h - 1)], [(0, w - 1)]):
        # 全整幅单块：单一状态
        return [img]
    out = []
    for (r0, r1) in row_ranges:
        for (c0, c1) in col_ranges:
            if c0 >= c1 or r0 >= r1:
                continue
            out.append(img.crop((c0, r0, c1, r1)))
    return out


def _detect_bands2(img):
    """水平分隔带检测：整行几乎全品红的行带 + 这些带之间的内容区区间。

    只采信宽度 >= MIN_SEP 的真实分隔带；窄于该宽度的全品红细带是物体内部或落地阴影
    偶然切出的空隙，不是网格分隔，直接并入相邻内容区，避免把一个状态误切成多格。
    """
    import numpy as np
    h, w = img.size
    bg = _bg_mask(img)
    rows = bg.sum(axis=1)
    thr = w * 0.97
    idx = np.where(rows > thr)[0]
    bands = _cluster(idx)
    return bands, _regions_between(bands)


def _detect_bands2_v(img):
    """垂直分隔带检测：整列几乎全品红的列带 + 这些带之间的内容区区间。

    与 _detect_bands2 相同的 MIN_SEP 过滤：窄的全品红细列不成为分隔带。
    """
    import numpy as np
    h, w = img.size
    bg = _bg_mask(img)
    cols = bg.sum(axis=0)
    thr = h * 0.97
    idx = np.where(cols > thr)[0]
    bands = _cluster(idx)
    return bands, _regions_between(bands)


# 最小可信分隔带宽度：落在 < 该宽度说明是内容内部/阴影空隙，不是真网格分隔。
# 真实分隔带一般 >30px（外壳 + 格间距）；落地阴影/物体内部偶然的全品红细带通常 1-6px。
MIN_SEP = 8


def _regions_between(bands):
    """相邻分隔带之间的内容区（保证至少跨 1px，避免零宽区）。"""
    regions = []
    for i in range(len(bands) - 1):
        a, b_ = bands[i][1], bands[i + 1][0]
        if b_ - a > 1:
            regions.append((a, b_))
    return regions


def _bg_mask(img):
    import numpy as np
    arr = np.array(img.convert("RGBA"))
    r, g, b = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)
    dist = (r - 255) ** 2 + g**2 + (b - 255) ** 2
    return dist < 90**2


def _cluster(idx, min_sep: int | None = None):
    """把相邻的带索引聚成区间（间隔 >3 视为新带）。

    min_sep 是最小可信分隔带宽度：用于区分"真实分隔带"与"内容里偶然的全品红细列"
    （如物体下的落地阴影在某 1-6 列刚好被背景分隔）。宽度 < min_sep 的带是噪声，
    不应把连续内容切开。默认取模块级 MIN_SEP。
    """
    if min_sep is None:
        min_sep = MIN_SEP
    out = []
    start = prev = int(idx[0])
    for v in idx[1:]:
        v = int(v)
        if v - prev > 3:
            # 上一段过窄视为噪声：丢弃它，让内容区保持连续
            if prev - start + 1 >= min_sep:
                out.append((start, prev))
            start = v
        prev = v
    if prev - start + 1 >= min_sep:
        out.append((start, prev))
    return out


def _frame_content_frac(img) -> float:
    """非品红内容占比（0~1）。"""
    import numpy as np

    arr = np.array(img.convert("RGBA"))
    r, g, b = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)
    dist = (r - 255) ** 2 + g**2 + (b - 255) ** 2
    return float((dist >= 90**2).mean())


def _frame_content_bands(img, axis: int) -> int:
    """内容在指定轴跨越的条带数（每行/每列有非品红内容则算一条带）。"""
    import numpy as np

    arr = np.array(img.convert("RGBA"))
    r, g, b = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)
    dist = (r - 255) ** 2 + g**2 + (b - 255) ** 2
    proj = (dist >= 90**2).sum(axis=axis)
    return int((proj > 0).sum())


def _validate_frames(frames, states, min_side: int = 8, min_content: float = 0.02):
    """成品质量闸门：每帧有效尺寸 + 非品红内容占比。

    任一帧退化（过小 / 纯色块）或帧数与状态数不匹配即抛错，由调用方保留原始素材。
    """
    if len(frames) != len(states):
        raise RuntimeError(
            f"切格帧数 {len(frames)} 与状态数 {len(states)} 不匹配，拒绝产出损坏资产"
        )
    for i, (state, frame) in enumerate(zip(states, frames)):
        w, h = frame.size
        if w < min_side or h < min_side:
            raise RuntimeError(
                f"帧 {state} 尺寸 {w}x{h} 过小（<{min_side}px），拒绝产出退化帧"
            )
        content = _frame_content_frac(frame)
        if content < min_content:
            raise RuntimeError(
                f"帧 {state} 非品红内容占比 {content:.3f} 过低（<{min_content}），疑似纯色块，拒绝产出"
            )


def pixelate_frame(img, target_size: int = 64, colors: int = 64) -> Image.Image:
    """proper-pixel-art 网格重建 → 放到 target_size 画布（保持纵横比）。

    直接用切出的原生分辨率喂给 proper-pixel-art（`-s 1` 不放大、最接近像素网格），
    不再先 NEAREST 放大到 1024——放大只会把纯色块/低分辨率帧的缝隙放大掩盖问题。
    """
    import tempfile
    from PIL import Image, ImageFilter

    # 兜底：proper-pixel-art 是 Canny/Hough 网格重建器，对"无内部边缘的大色块"
    # 会退化输出 (w,0) 空图并崩 "cannot write empty image"。本管线的切格/兜底
    # 已保证帧有内容且跨多条内容带，此处仅防御异常输入，防止直接抛到外层。
    def _has_meshable_content(f):
        try:
            import numpy as np
            arr = np.array(f.convert("RGBA"))
            r, g, b = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)
            mask = (r - 255) ** 2 + g**2 + (b - 255) ** 2 >= 90**2
            return int(mask.sum(axis=0).max() > 0) and int(mask.sum(axis=1).max() > 0)
        except Exception:
            return True

    if not _has_meshable_content(img):
        raise RuntimeError("帧无 proper-pixel-art 可重建的内容（无内部边缘/纯色块）")

    td = tempfile.mkdtemp(prefix="sprite-component-")
    tin = Path(td) / "in.png"
    tout = Path(td) / "out.png"
    try:
        # 前置 median3 降噪 — 消除 AI 直出图的色块内颗粒感（grainy -99%）
        if img.mode != "RGB" and img.mode != "RGBA":
            img = img.convert("RGBA")
        denoised = img.filter(ImageFilter.MedianFilter(3)) if img.mode == "RGB" else img.convert("RGB").filter(ImageFilter.MedianFilter(3))
        denoised.save(tin)
        result = subprocess.run(
            [sys.executable, "-m", "proper_pixel_art.cli", str(tin), "-o", str(tout),
             "--colors", str(colors), "-s", "1", "-u", "10"],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            # proper-pixel-art 的 "cannot write empty image" 是它自身对空网格的崩溃
            # （把 (w,0) 空图传到 save）。这里给出可识别错误，不裸抛栈。
            raise RuntimeError(f"proper-pixel-art failed: {result.stderr[-400:]}")
        out = Image.open(tout)
        # 先读入内存再释放文件句柄，避免 Windows 文件占用
        out.load()
        out = out.copy()
        if out.size[0] == 0 or out.size[1] == 0:
            raise RuntimeError("proper-pixel-art 输出空图，拒绝产出退化帧")
    finally:
        import shutil
        shutil.rmtree(td, ignore_errors=True)
    # 保持纵横比放进 target_size 画布（品红底）
    canvas = Image.new("RGBA", (target_size, target_size), (255, 0, 255, 255))
    w, h = out.size
    scale = target_size / max(w, h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = out.resize((nw, nh), Image.NEAREST)
    canvas.paste(resized, ((target_size - nw) // 2, (target_size - nh) // 2), resized)
    return canvas


# ---------------------------------------------------------------- 批量登记 ----

BATCH_KIND = "wakeup-batch-manifest"
VALID_CONTEXTS = ("map", "ui")
MAX_STATES = 9  # pick_grid 表支持的最大状态数


def _load_registry(path: Path) -> list[dict]:
    """读取并校验『待生成素材登记清单』（增量登记），返回规范化条目（已合并 defaults）。

    违规项一次性全部列出、在发任何 API 前失败。清单格式（run/assets/batch-registry.json）：
      kind="wakeup-batch-manifest", version, defaults{context,provider,cell,colors},
      entries[{name, type, desc, states?, context?, provider?, reference?, out_override?, cell?, colors?}]
    """
    raw = json.loads(path.read_text(encoding="utf-8"))
    errors: list[str] = []
    if not isinstance(raw, dict):
        raise SystemExit(f"登记清单必须是 JSON 对象: {path}")
    if raw.get("kind") != BATCH_KIND:
        errors.append(f"kind 必须是 {BATCH_KIND!r}")
    if not isinstance(raw.get("version"), int):
        errors.append("version 必须存在且为整数")
    defaults = raw.get("defaults") or {}
    entries = raw.get("entries")
    if not isinstance(entries, list) or not entries:
        errors.append("entries 必须是非空数组")

    normalized: list[dict] = []
    seen: set[str] = set()
    for i, ent in enumerate(entries or []):
        tag = f"entries[{i}]"
        if not isinstance(ent, dict):
            errors.append(f"{tag}: 必须是对象")
            continue
        name = ent.get("name")
        if not isinstance(name, str) or not name.strip():
            errors.append(f"{tag}: name 必须是非空字符串")
        elif name in seen:
            errors.append(f"{tag}: name {name!r} 重复")
        else:
            seen.add(name)
        if ent.get("type") not in SEMANTIC_COLORS:
            errors.append(f"{tag}: type {ent.get('type')!r} 不在 {sorted(SEMANTIC_COLORS)}")
        desc = ent.get("desc")
        if not isinstance(desc, str) or not desc.strip():
            errors.append(f"{tag}: desc 必须是非空字符串")
        context = ent.get("context", defaults.get("context", "map"))
        if context not in VALID_CONTEXTS:
            errors.append(f"{tag}: context {context!r} 必须是 map|ui")
        states = ent.get("states", ["single"])
        if not isinstance(states, list) or not states or not all(isinstance(s, str) and s.strip() for s in states):
            errors.append(f"{tag}: states 必须是非空字符串数组")
        elif len(states) > MAX_STATES:
            errors.append(f"{tag}: states 长度 {len(states)} 超出最大 {MAX_STATES}")
        provider = ent.get("provider", defaults.get("provider"))
        if provider not in (None, "gpt-image-2", "gemini"):
            errors.append(f"{tag}: provider {provider!r} 必须是 gpt-image-2|gemini")
            for field in ("cell", "colors"):
            val = ent.get(field, defaults.get(field, 64 if field == "cell" else 64))
            if not isinstance(val, int) or val <= 0:
                errors.append(f"{tag}: {field} 必须是正整数")
        if errors:
            continue  # 已有违规，整批失败；不再追加条目
        normalized.append({
            "name": name,
            "type": ent["type"],
            "desc": desc.strip(),
            "states": [s.strip() for s in states],
            "context": context,
            "provider": provider,
            "reference": ent.get("reference"),
            "out_override": ent.get("out_override"),
            "cell": ent.get("cell", defaults.get("cell", 64)),
            "colors": ent.get("colors", defaults.get("colors", 32)),
        })
    if errors:
        raise SystemExit("登记清单校验失败:\n" + "\n".join(f"  - {e}" for e in errors))
    return normalized


# ---------------------------------------------------------------- 单条生成 ----

def generate_one(*, comp_type: str, desc: str, states: list[str], context: str,
                 out_dir, provider: str | None = None, reference: str | None = None,
                 cell: int = 64, colors: int = 64, delay: float = 0) -> dict:
    """生成单个组件：出图 → 纯化 → 切格 → 质量闸门 → 像素化 → manifest。

    失败统一抛 BatchItemError(stage, error_type, error)，由调用方决定单条中止（单组件
    模式）还是跳过继续（批量模式）。返回写好的 manifest dict。
    """
    states = [s.strip() for s in states if s.strip()]
    prompt = build_prompt(comp_type, desc, states, context=context)
    out_dir = Path(out_dir)
    frames_dir = out_dir / "frames"

    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        frames_dir.mkdir(exist_ok=True)
    except OSError as e:
        raise BatchItemError("write", "mkdir", str(e)) from e

    cfg = resolve_config(provider)
    print(f"[{cfg['provider']}] type={comp_type} context={context} states={len(states)} desc={desc}", flush=True)

    if delay > 0:
        time.sleep(delay)

    raw_path = out_dir / "raw.png"
    ref = Path(reference) if reference else None
    try:
        call_backend(cfg, prompt, raw_path, ref)
    except BatchItemError:
        raise
    except SystemExit as e:
        raise BatchItemError("api", "config", str(e)) from e
    print("  ✓ raw sheet 已生成", flush=True)

    # 留档提示词
    try:
        (out_dir / "raw.json").write_text(
            json.dumps({
                "type": comp_type, "desc": desc, "states": states,
                "context": context,
                "provider": cfg["provider"], "model": cfg["model"],
                "grid": list(pick_grid(len(states))), "prompt": prompt,
                "reference": reference,
            }, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError as e:
        raise BatchItemError("write", "write", str(e)) from e

    # 背景纯化
    from PIL import Image
    try:
        raw = Image.open(raw_path)
        purified = purify_magenta(raw)
        purified.convert("RGB").save(out_dir / "sheet.png")
    except Exception as e:
        raise BatchItemError("purify", "purify_failed", str(e)) from e
    print("  ✓ 背景纯化", flush=True)

    # 切格：先按检测到的真实行列切（尊重模型实际画出来的网格）；得到的状态格数若与
    # 期望一致就采用，否则退回等分（保证帧数匹配、不产反向框）。
    rows, cols = pick_grid(len(states))
    try:
        detected = slice_grid_detected(purified)
        if len(detected) == len(states):
            frames = detected
        else:
            frames = slice_grid(purified, rows, cols)
    except Exception as e:
        raise BatchItemError("slice", "slice_failed", str(e)) from e

    # 切格兜底：过滤 0 尺寸/全品红帧（proper-pixel-art 对空帧会崩 "cannot write
    # empty image"）。出现时按期望布局等分重切，宁缺毋滥，剩下的交给质量闸门。
    frames = [f for f in frames if f.size[0] > 0 and f.size[1] > 0]
    if not frames or any(_frame_content_frac(f) < 1e-6 for f in frames):
        frames = slice_grid(purified, rows, cols)
        frames = [f for f in frames if f.size[0] > 0 and f.size[1] > 0]

    # proper-pixel-art 兜底：它是基于 Canny/Hough 的网格重建器，对"无内部边缘的
    # 大色块"会退化输出 (w,0) 空图并崩 "cannot write empty image"。对每个帧预先
    # 自检：内容须在横纵两个方向都跨越 >= 2 条内容带（不是单条贴边带），否则退回
    # 等分重切。若等分仍不合格则直接判闸门失败，绝不把退化帧交给下游。
    def _has_grid_content(f):
        return _frame_content_bands(f, axis=0) >= 2 and _frame_content_bands(f, axis=1) >= 2

    try:
        frames = [f for f in frames if _has_grid_content(f)]
        if not frames or len(frames) != len(states):
            frames = slice_grid(purified, rows, cols)
            frames = [f for f in frames if f.size[0] > 0 and f.size[1] > 0 and _has_grid_content(f)]
    except Exception:
        raise BatchItemError("slice", "slice_failed", "proper-pixel-art 网格兜底失败") from None

    # 成品质量闸门：帧数/尺寸/内容任一不合格即失败并保留原始素材
    # 若兜底后仍一帧不剩（整幅纯品红等），直接按退化处理，避免对空列表做 zip。
    if not frames:
        raise BatchItemError("gate", "count_mismatch",
                             f"切格帧数 0 与状态数 {len(states)} 不匹配，拒绝产出损坏资产")
    try:
        _validate_frames(frames, states)
    except RuntimeError as e:
        raise BatchItemError("gate", _gate_error_type(str(e)), str(e)) from e

    manifest_frames = []
    for i, (state, frame) in enumerate(zip(states, frames)):
        try:
            out_img = pixelate_frame(frame, target_size=cell, colors=colors)
        except Exception as e:
            raise BatchItemError("pixelate", "pixelate_failed", str(e)) from e
        fname = f"{state}.png"
        try:
            out_img.convert("RGBA").save(frames_dir / fname)
        except OSError as e:
            raise BatchItemError("write", "write_frame", str(e)) from e
        manifest_frames.append({"state": state, "file": f"frames/{fname}", "size": cell})
        print(f"  ✓ frames/{fname}", flush=True)

    # contact sheet（按状态顺序排一行，自动换行）
    from PIL import Image as _I
    try:
        n = len(manifest_frames)
        cw = min(n, 8)
        ch = math.ceil(n / cw)
        contact = _I.new("RGB", (cell * cw, cell * ch), (255, 0, 255))
        for i, mf in enumerate(manifest_frames):
            fimg = _I.open(out_dir / mf["file"]).convert("RGBA")
            contact.paste(fimg.convert("RGB"), ((i % cw) * cell, (i // cw) * cell))
        contact.save(out_dir / "contact.png")
    except Exception as e:
        raise BatchItemError("write", "contact", str(e)) from e

    manifest = {
        "kind": "wakeup-component",
        "type": comp_type,
        "desc": desc,
        "states": states,
        "context": context,
        "provider": cfg["provider"],
        "frames": manifest_frames,
        "contact": "contact.png",
    }
    try:
        (out_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError as e:
        raise BatchItemError("write", "manifest", str(e)) from e

    print(f"\n✓ 组件完成: {out_dir}", flush=True)
    print(f"  manifest: {out_dir / 'manifest.json'}", flush=True)
    return manifest


# ---------------------------------------------------------------- 主流程 ----

def _run_single(args) -> None:
    states = [s.strip() for s in (args.states or "single").split(",") if s.strip()]
    if os.environ.get("PRINT_PROMPT_ONLY"):
        print(build_prompt(args.type, args.desc, states, context=args.context))
        return
    try:
        generate_one(
            comp_type=args.type, desc=args.desc, states=states, context=args.context,
            out_dir=args.out, provider=args.provider, reference=args.reference,
            cell=args.cell, colors=args.colors,
        )
    except BatchItemError as e:
        if e.stage == "api":
            # 复刻原 SystemExit(message) 语义：错误走 stderr、退出码 1
            print(str(e), file=sys.stderr)
        else:
            # 不清除 raw/sheet，方便重跑或人工排查
            print(f"\n✗ 组件质量闸门失败，保留原始素材待处理: {e}", flush=True)
            print(f"  raw.png / sheet.png 已留在: {args.out}", flush=True)
        raise SystemExit(1)


def _run_batch(args) -> None:
    registry = _load_registry(args.registry)
    base = args.registry.resolve().parent
    started = datetime.now(timezone.utc).isoformat(timespec="seconds")

    succeeded: list[str] = []
    skipped: list[str] = []
    failed: list[dict] = []
    for ent in registry:
        out_dir = Path(ent["out_override"]) if ent["out_override"] else base / ent["name"]
        print(f"\n=== [{ent['name']}] {ent['type']} states={len(ent['states'])} context={ent['context']} ===", flush=True)
        if args.dry_run:
            print(build_prompt(ent["type"], ent["desc"], ent["states"], context=ent["context"]), flush=True)
            continue
        if (out_dir / "manifest.json").exists() and not args.force:
            print("  ⤼ 已有成品 manifest，跳过（--force 可强制重生成）", flush=True)
            skipped.append(ent["name"])
            continue
        try:
            generate_one(
                comp_type=ent["type"], desc=ent["desc"], states=ent["states"],
                context=ent["context"], out_dir=out_dir, provider=ent["provider"],
                reference=ent["reference"], cell=ent["cell"], colors=ent["colors"],
                delay=args.delay,
            )
            succeeded.append(ent["name"])
        except BatchItemError as e:
            print(f"  ✗ {ent['name']} 失败 [{e.stage}.{e.error_type}]: {e}", flush=True)
            failed.append({"name": ent["name"], "stage": e.stage,
                           "error_type": e.error_type, "error": str(e)})

    if args.dry_run:
        print(f"\n[dry-run] 校验并打印 {len(registry)} 条提示词完成，未发任何 API、未写盘。")
        return

    ended = datetime.now(timezone.utc).isoformat(timespec="seconds")
    total = len(registry)
    success_rate = round(len(succeeded) / total, 3) if total else 0.0
    by_stage: dict[str, int] = {}
    by_error_type: dict[str, int] = {}
    for f in failed:
        by_stage[f["stage"]] = by_stage.get(f["stage"], 0) + 1
        by_error_type[f["error_type"]] = by_error_type.get(f["error_type"], 0) + 1
    report = {
        "run_id": started, "started": started, "ended": ended, "delay": args.delay,
        "total": total, "succeeded": succeeded, "skipped": skipped, "failed": failed,
        "success_rate": success_rate, "by_stage": by_stage, "by_error_type": by_error_type,
    }
    report_dir = Path(args.report_dir) if args.report_dir else base
    report_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_path = report_dir / f"batch-report-{ts}.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n{'=' * 60}", flush=True)
    print(f"批量完成: 共 {total} 条 | 成功 {len(succeeded)} | 跳过 {len(skipped)} | 失败 {len(failed)}", flush=True)
    print(f"成功率: {success_rate:.0%}（目标 ≥70%）", flush=True)
    if failed:
        print("失败清单（按失败模式可操盘修正）:", flush=True)
        for f in failed:
            print(f"  ✗ {f['name']}: [{f['stage']}.{f['error_type']}] {f['error']}", flush=True)
    print(f"报告: {report_path}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--type", default=None,
                        choices=sorted(SEMANTIC_COLORS.keys()),
                        help="组件类型（决定语义色与材质倾向）；批量模式忽略")
    parser.add_argument("--desc", default=None,
                        help="组件描述，如 'old brass door key'；批量模式忽略")
    parser.add_argument("--states", default=None,
                        help="状态列表，逗号分隔：closed,open,broken；不传=单帧(single)")
    parser.add_argument("--context", default="map", choices=["map", "ui"],
                        help="语境：map=地图实体（强制正面俯视视图，默认）；ui=背包/界面图标（同样正面俯视，强调剪影识别）")
    parser.add_argument("--provider", default=None, choices=["gpt-image-2", "gemini"])
    parser.add_argument("--reference", default=None,
                        help="风格参考图（可选，图生图锁风格）")
    parser.add_argument("--out", default=None, type=Path,
                        help="输出目录；批量模式忽略（按清单 name 落到清单同目录）")
    parser.add_argument("--cell", type=int, default=64, help="成品帧尺寸（默认 64）")
    parser.add_argument("--colors", type=int, default=64, help="像素化色彩数（默认 64，32 颗粒感明显）")
    parser.add_argument("--registry", default=None, type=Path,
                        help="批量登记清单 JSON（如 run/assets/batch-registry.json）；指定后忽略 --type/--desc/--out，按清单逐条生成")
    parser.add_argument("--delay", type=int, default=3,
                        help="批量模式每次出图请求前的间隔秒数（默认 3，限流防护）")
    parser.add_argument("--dry-run", action="store_true",
                        help="批量模式只读演练：解析清单+校验+打印提示词，不发任何 API、不写盘")
    parser.add_argument("--force", action="store_true",
                        help="批量模式强制重生成已存在 manifest.json 的条目（默认跳过续跑）")
    parser.add_argument("--report-dir", default=None, type=Path,
                        help="批量报告输出目录（默认与登记清单同目录）")
    args = parser.parse_args()

    if args.registry:
        _run_batch(args)
    else:
        for opt, val in (("--type", args.type), ("--desc", args.desc), ("--out", args.out)):
            if val is None:
                parser.error(f"单组件模式需要 {opt}")
        _run_single(args)


if __name__ == "__main__":
    main()
