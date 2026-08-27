#!/usr/bin/env python3
"""
sprite-forge 组件管线网格切格 + 质量闸门自测（不发任何 API）。

目标：验证 sprite-component.py 的网格切分契约与成品质量防线：
  1. 以实际检测到的品红分隔带推导真实行列，不把提示词期望当切图事实；
  2. 检测失败时退回安全的等分策略，绝不产生反向裁剪框（left>right / top>bottom）或 1×1 退化帧；
  3. 质量闸门对纯色块/退化帧/帧数不匹配拒绝产出并保留原始素材。

用合成图像覆盖横排、竖排与检测失败回退三种网格。跑通即证明切格逻辑闭环且防御到位。
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "sprite-component.py"

MAGENTA = (255, 0, 255)
BODY = (200, 30, 30)  # solid red content — clearly not magenta, to survive purification


def load_script():
    spec = importlib.util.spec_from_file_location("sprite_component", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def make_horizontal_3x1(w: int = 300, h: int = 300) -> Image.Image:
    """三格横排：三条垂直内容列，被纯品红纵向带隔开（状态=closed/open/broken）。"""
    im = Image.new("RGBA", (w, h), MAGENTA)
    px = im.load()
    for c in range(3):
        x0 = c * w // 3 + 20
        x1 = (c + 1) * w // 3 - 20
        for y in range(h // 5, 4 * h // 5):
            for x in range(x0, x1):
                px[x, y] = BODY
    return im

def make_vertical_1x3(w: int = 300, h: int = 300) -> Image.Image:
    """三格竖排：三条水平内容行，被纯品红横向带隔开（提示词传 3x1 也应按检测结果处理）。"""
    im = Image.new("RGBA", (w, h), MAGENTA)
    px = im.load()
    for r in range(3):
        y0 = r * h // 3 + 20
        y1 = (r + 1) * h // 3 - 20
        for y in range(y0, y1):
            for x in range(w // 5, 4 * w // 5):
                px[x, y] = BODY
    return im


def make_single_blob(w: int = 300, h: int = 300) -> Image.Image:
    """单一内容块（检测到带数异常，应退回等分）。"""
    im = Image.new("RGBA", (w, h), MAGENTA)
    px = im.load()
    for y in range(40, 260):
        for x in range(40, 260):
            px[x, y] = BODY
    return im


def make_split_artifact(w: int = 300, h: int = 300) -> Image.Image:
    """三格横排 + 第三个内容块内部有一条 4px 品红细带（模拟落地阴影偶然切出空隙）。

    回归：窄品红细带不得当作真实分隔带，否则第三个状态会被误切成两格、
    或回退等分后中间帧只剩纯品红。无论细带长短，检测路径都应切出稳定的 3 帧。
    """
    im = Image.new("RGBA", (w, h), MAGENTA)
    px = im.load()
    for c in range(3):
        x0 = c * w // 3 + 20
        x1 = (c + 1) * w // 3 - 20
        for y in range(h // 5, 4 * h // 5):
            for x in range(x0, x1):
                px[x, y] = BODY
    # 在第三个内容块（c=2）中间加一条 4px 宽的全品红竖缝（< MIN_SEP）
    c = 2
    x0 = c * w // 3 + 20
    x1 = (c + 1) * w // 3 - 20
    mid = (x0 + x1) // 2
    for y in range(h // 5, 4 * h // 5):
        for x in range(mid, mid + 4):
            px[x, y] = MAGENTA
    return im


def assert_valid(frames, states):
    assert len(frames) == len(states), f"帧数 {len(frames)} != 状态数 {len(states)}"
    for f in frames:
        w, h = f.size
        assert w > 0 and h > 0, f"出现反向/零宽裁剪框 {w}x{h}"
        assert f.size != (1, 1), "不应产出 1×1 退化帧"


def assert_prompt_contract(sc) -> None:
    """断言组件生成提示词遵守全项目唯一视角契约（正面俯视视图）。

    防止未来的改动把旧"正面斜投影/Cabinet/Cavalier/Among Us 类比"作为必须视角重新注入
    发往图像模型的 prompt。`NO front face` 这类否定禁令是合法的（它是在禁立面，不是要求立面）。
    跑挂=视角契约被破坏，需回归 docs/表现系统/01 §正面俯视视图。
    """
    # 这些词只允许出现在否定禁令里（NO ... / not sidelong）；一旦作为肯定要求出现即违规。
    negatable = ["front face", "side face", "top face", "right side face",
                 "three-quarter", "isometric", "oblique", "sidelong angled"]
    # 下列词出现即违规（自身就是旧视角名或第三方案例），无合法肯定性用法。
    forbidden_anywhere = ["front-facing", "cabinet", "cavalier", "among us", "slightly angled"]
    for context in ("map", "ui"):
        p = sc.build_prompt("environment", "wooden supply crate", ["closed", "open", "broken"], context=context)
        low = p.lower()
        assert "top-down plan view" in low, f"[{context}] 缺少固定口令 top-down plan view"
        # 否定禁令必须带 NO 或 not（NO front face / not isometric 是在禁立面/角度，不是要求）
        hits = [w for w in negatable if w in low and f"no {w}" not in low and f"not {w}" not in low]
        assert not hits, f"[{context}] 视角 prompt 把立面/角度当作肯定要求: {hits}"
        hits2 = [w for w in forbidden_anywhere if w in low]
        assert not hits2, f"[{context}] 视角 prompt 混入被禁旧视角名/案例: {hits2}"
        if context == "map":
            assert "ground shadow" in low, f"[{context}] 缺少落地阴影（正面俯视表达贴地）"
        assert "magenta" in low, f"[{context}] 缺少品红背景描述"
        print(f"=== VIEW contract [{context}]: top-down plan view, forbidden={hits2 or 'none'} GATE PASS ===")


def main() -> int:
    sc = load_script()

    assert_prompt_contract(sc)

    # 老切片路径（依赖期望布局 + 等分回退）：回归既有防御
    samples = [
        ("horizontal_3x1", make_horizontal_3x1(), 3, 1, ["closed", "open", "broken"]),
        ("vertical_1x3", make_vertical_1x3(), 3, 1, ["closed", "open", "broken"]),
        ("single_blob", make_single_blob(), 1, 1, ["single"]),
    ]
    for label, img, rows, cols, states in samples:
        pur = sc.purify_magenta(img)
        frames = sc.slice_grid(pur, rows, cols)
        print(f"=== slice_grid {label}: expected {rows}x{cols} states={len(states)} ===")
        print(f"    frames={len(frames)} sizes={[f.size for f in frames]}")
        assert_valid(frames, states)
        sc._validate_frames(frames, states)
        print(f"    content={[round(sc._frame_content_frac(f), 3) for f in frames]} GATE PASS")

    # 新检测路径（按真实行列切，不依赖期望布局）：横排/竖排都应切出 3 帧
    det_samples = [
        ("det_horizontal_3x1", make_horizontal_3x1(), 3),
        ("det_vertical_1x3", make_vertical_1x3(), 3),
        ("det_single_blob", make_single_blob(), 1),
    ]
    # 内容内部窄品红细带：不得被当成真实分隔带而把一帧切成多格
    det_samples.append(("det_split_artifact", make_split_artifact(), 3))
    for label, img, expected_n in det_samples:
        pur = sc.purify_magenta(img)
        frames = sc.slice_grid_detected(pur)
        print(f"=== slice_grid_detected {label}: expected {expected_n} frames ===")
        print(f"    frames={len(frames)} sizes={[f.size for f in frames]}")
        states = [f"s{i}" for i in range(expected_n)]
        sc._validate_frames(frames, states)
        print(f"    content={[round(sc._frame_content_frac(f), 3) for f in frames]} GATE PASS")

    # 质量闸门必须拒绝退化输入：纯品红单块送 3 态 → 帧数不匹配 / 纯色块应被拒
    degenerate = Image.new("RGBA", (100, 100), MAGENTA)
    try:
        sc._validate_frames([Image.new("RGBA", (100, 100), MAGENTA)] * 3, ["c", "o", "b"])
        raise AssertionError("纯色块三个帧竟然通过质量闸门")
    except RuntimeError:
        print("=== GATE rejected degenerate solid-color frames (expected) ===")
    try:
        sc._validate_frames([degenerate.crop((0, 0, 50, 50)), degenerate], ["only", "two"])
        raise AssertionError("帧数不匹配竟然通过质量闸门")
    except RuntimeError:
        print("=== GATE rejected frame-count mismatch (expected) ===")

    print("\n✓ 组件网格切格 + 质量闸门自测通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
