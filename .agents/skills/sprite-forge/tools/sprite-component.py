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
from pathlib import Path

# ---------------------------------------------------------------- 风格规范 ----

# 组件基础风格（所有组件共用，硬编码锁定；视角规则单独一块，见 VIEW_RULES）
COMPONENT_STYLE = (
    "WakeUp game asset pixel art, consistent with character sprite style. "
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

# 视角规则：全项目唯一视角 = 俯视平面视图（top-down plan view）。地图实体与背包/UI 图标
# 统一同一视图——只有识别侧重差异，没有"侧面/顶面/斜投影"可言。
# 权威：docs/表现系统/01_图形化与UI.md §视觉风格定位·俯视平面视图、PLT-01、05_组件生成风格规范。
VIEW_RULES = {
    "map": (
        "TOP-DOWN PLAN VIEW (STRICT, THE ONLY ALLOWED VIEW): overhead plan-view sprite. "
        "The object reads as a flat top-down outline and readable silhouette, with a ground shadow "
        "to show where it sits on the map. NO front face, NO side face, NO top face, "
        "NO oblique depth, no three-quarter depth, not isometric, not a side profile. "
        "Every generated object MUST use this exact flat top-down plan view - never any other angle."
    ),
    "ui": (
        "UI / INVENTORY ICON VIEW: same top-down plan view, but an icon - clean readable silhouette "
        "and strong contrast for recognition at small size on magenta background. "
        "Still flat top-down plan view: NO front face, NO side face, NO top face, NO oblique depth, "
        "not angled, not isometric. Not bound to the in-world placement rule, but identical view."
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


def _call_gpt(cfg: dict, prompt: str, out_path: Path) -> None:
    import httpx

    payload = {
        "model": "gpt-image-2",
        "prompt": prompt,
        "n": 1,
        "size": "1024x1024",
        "response_format": "b64_json",
    }
    resp = httpx.post(
        f"{cfg['base_url']}/v1/images/generations",
        headers={"Authorization": f"Bearer {cfg['key']}"},
        json=payload,
        timeout=300,
    )
    if resp.status_code != 200:
        raise SystemExit(f"gpt-image-2 调用失败 HTTP {resp.status_code}: {resp.text[:400]}")
    data = resp.json()
    b64 = data["data"][0].get("b64_json")
    if not b64:
        raise SystemExit(f"gpt-image-2 返回内容里没找图: {resp.text[:400]}")
    out_path.write_bytes(base64.b64decode(b64))


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
    payload = {
        "model": cfg["model"],
        "messages": [{"role": "user", "content": content}],
    }
    resp = httpx.post(
        f"{cfg['base_url']}/v1/chat/completions",
        headers={"Authorization": f"Bearer {cfg['key']}"},
        json=payload,
        timeout=300,
    )
    if resp.status_code != 200:
        raise SystemExit(f"gemini 调用失败 HTTP {resp.status_code}: {resp.text[:400]}")
    text = resp.json()["choices"][0]["message"]["content"]
    m = re.search(r"data:image/png;base64,([A-Za-z0-9+/=]+)", text)
    if not m:
        raise SystemExit(f"gemini 返回里没找到 data URI 图片: {text[:200]}")
    out_path.write_bytes(base64.b64decode(m.group(1)))


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


def pixelate_frame(img, target_size: int = 64, colors: int = 32) -> Image.Image:
    """proper-pixel-art 网格重建 → 放到 target_size 画布（保持纵横比）。

    直接用切出的原生分辨率喂给 proper-pixel-art（`-s 1` 不放大、最接近像素网格），
    不再先 NEAREST 放大到 1024——放大只会把纯色块/低分辨率帧的缝隙放大掩盖问题。
    """
    import tempfile
    from PIL import Image

    td = tempfile.mkdtemp(prefix="sprite-component-")
    tin = Path(td) / "in.png"
    tout = Path(td) / "out.png"
    try:
        img.save(tin)
        result = subprocess.run(
            [sys.executable, "-m", "proper_pixel_art.cli", str(tin), "-o", str(tout),
             "--colors", str(colors), "-s", "1"],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"proper-pixel-art failed: {result.stderr[:200]}")
        out = Image.open(tout)
        # 先读入内存再释放文件句柄，避免 Windows 文件占用
        out.load()
        out = out.copy()
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


# ---------------------------------------------------------------- 主流程 ----

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--type", required=True,
                        choices=sorted(SEMANTIC_COLORS.keys()),
                        help="组件类型（决定语义色与材质倾向）")
    parser.add_argument("--desc", required=True, help="组件描述，如 'old brass door key'")
    parser.add_argument("--states", default=None,
                        help="状态列表，逗号分隔：closed,open,broken；不传=单帧(single)")
    parser.add_argument("--context", default="map", choices=["map", "ui"],
                        help="语境：map=地图实体（强制俯视平面视图，默认）；ui=背包/界面图标（同样俯视平面，强调剪影识别）")
    parser.add_argument("--provider", default=None, choices=["gpt-image-2", "gemini"])
    parser.add_argument("--reference", default=None,
                        help="风格参考图（可选，图生图锁风格）")
    parser.add_argument("--out", required=True, type=Path, help="输出目录")
    parser.add_argument("--cell", type=int, default=64, help="成品帧尺寸（默认 64）")
    parser.add_argument("--colors", type=int, default=32, help="像素化色彩数（默认 32）")
    args = parser.parse_args()

    states = [s.strip() for s in (args.states or "single").split(",") if s.strip()]
    prompt = build_prompt(args.type, args.desc, states, context=args.context)
    if os.environ.get("PRINT_PROMPT_ONLY"):
        print(prompt)
        return

    out_dir = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    frames_dir = out_dir / "frames"
    frames_dir.mkdir(exist_ok=True)

    cfg = resolve_config(args.provider)
    print(f"[{cfg['provider']}] type={args.type} context={args.context} states={len(states)} desc={args.desc}", flush=True)

    raw_path = out_dir / "raw.png"
    ref = Path(args.reference) if args.reference else None
    call_backend(cfg, prompt, raw_path, ref)
    print("  ✓ raw sheet 已生成", flush=True)

    # 留档提示词
    (out_dir / "raw.json").write_text(
        json.dumps({
            "type": args.type, "desc": args.desc, "states": states,
            "context": args.context,
            "provider": cfg["provider"], "model": cfg["model"],
            "grid": list(pick_grid(len(states))), "prompt": prompt,
            "reference": args.reference,
        }, indent=2, ensure_ascii=False), encoding="utf-8")

    # 背景纯化
    from PIL import Image
    raw = Image.open(raw_path)
    purified = purify_magenta(raw)
    purified.convert("RGB").save(out_dir / "sheet.png")
    print("  ✓ 背景纯化", flush=True)

    # 切格：先按检测到的真实行列切（尊重模型实际画出来的网格）；得到的状态格数若与
    # 期望一致就采用，否则退回等分（保证帧数匹配、不产反向框）。
    rows, cols = pick_grid(len(states))
    detected = slice_grid_detected(purified)
    if len(detected) == len(states):
        frames = detected
    else:
        frames = slice_grid(purified, rows, cols)

    # 成品质量闸门：帧数/尺寸/内容任一不合格即失败并保留原始素材
    try:
        _validate_frames(frames, states)
    except RuntimeError as e:
        # 不清除 raw/sheet，方便重跑或人工排查
        print(f"\n✗ 组件质量闸门失败，保留原始素材待处理: {e}", flush=True)
        print(f"  raw.png / sheet.png 已留在: {out_dir}", flush=True)
        raise SystemExit(1)

    manifest_frames = []
    for i, (state, frame) in enumerate(zip(states, frames)):
        out_img = pixelate_frame(frame, target_size=args.cell, colors=args.colors)
        fname = f"{state}.png"
        out_img.convert("RGBA").save(frames_dir / fname)
        manifest_frames.append({"state": state, "file": f"frames/{fname}", "size": args.cell})
        print(f"  ✓ frames/{fname}", flush=True)

    # contact sheet（按状态顺序排一行，自动换行）
    from PIL import Image as _I
    n = len(manifest_frames)
    cw = min(n, 8)
    ch = math.ceil(n / cw)
    contact = _I.new("RGB", (args.cell * cw, args.cell * ch), (255, 0, 255))
    for i, mf in enumerate(manifest_frames):
        fimg = _I.open(out_dir / mf["file"]).convert("RGBA")
        contact.paste(fimg.convert("RGB"), ((i % cw) * args.cell, (i // cw) * args.cell))
    contact.save(out_dir / "contact.png")

    # manifest
    (out_dir / "manifest.json").write_text(
        json.dumps({
            "kind": "wakeup-component",
            "type": args.type,
            "desc": args.desc,
            "states": states,
            "context": args.context,
            "provider": cfg["provider"],
            "frames": manifest_frames,
            "contact": "contact.png",
        }, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n✓ 组件完成: {out_dir}")
    print(f"  manifest: {out_dir / 'manifest.json'}")


if __name__ == "__main__":
    main()
