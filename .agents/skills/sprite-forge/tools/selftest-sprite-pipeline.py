#!/usr/bin/env python3
"""
sprite-forge 落地自测（不发任何 API / 不写产品区）。

目标：验证「上游 generate2dsprite 后处理」在本机真实可跑、且我们补齐的
Nano Banana 适配输出能接进去。方法：合成一张符合上游约定的 raw sheet
（solid #FF00FF 背景 + 2x2 多行网格 + 每格一个居中主体 + 帧间等大），
喂给 generate2dsprite.py process，断言其产出明细（透明 sheet、逐帧 PNG、
pipeline-meta.json、QC 元数据）。跑通即证明管线本身闭环可复用。

相当于 generate2dsprite 的确定性冒烟测试，替代掉它依赖的宿主 image_gen。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
PROCESSOR = HERE.parent / "generate2dsprite" / "scripts" / "generate2dsprite.py"
MAGENTA = (255, 0, 255)
BODY = (64, 140, 210)      # 主体固有色
DARK = (20, 20, 40)        # 描边
CELL = 384
ROWS, COLS = 2, 2


def make_raw_sheet(out: Path) -> None:
    """合成长 2x2 solid-#FF00FF 品红背景的 raw sheet，两个格子分别两帧。"""
    sheet = Image.new("RGB", (CELL * COLS, CELL * ROWS), MAGENTA)
    d = ImageDraw.Draw(sheet)
    # 每格一个居中小方块，两帧只做细节区别（保证同主体同 scale、居中、留 60% 边距）
    for r in range(ROWS):
        for c in range(COLS):
            x0 = c * CELL + CELL * 0.20
            y0 = r * CELL + CELL * 0.22
            x1 = c * CELL + CELL * 0.80
            y1 = r * CELL + CELL * 0.78
            d.rectangle([x0, y0, x1, y1], fill=BODY, outline=None)
            d.rectangle([x0, y0, x1, y1], outline=DARK, width=6)
            # 第二列加一个小差异当作"帧间变化"，主体框尺度不变
            if c == 1:
                d.rectangle([x0 + CELL * 0.05, y0 + CELL * 0.08, x1 - CELL * 0.05, y1 - CELL * 0.06],
                            outline=(255, 230, 90), width=4)
    sheet.save(out)
    print(f"  synthetic raw sheet -> {out} ({CELL*COLS}x{CELL*ROWS})")


def run_process(raw: Path, out_dir: Path) -> dict:
    cmd = [
        sys.executable, str(PROCESSOR), "process",
        "--input", str(raw),
        "--target", "asset",
        "--mode", "attack",
        "--rows", str(ROWS),
        "--cols", str(COLS),
        "--output-dir", str(out_dir),
        "--cell-size", "128",
        "--align", "center",
        "--shared-scale",
        "--strict-qc",
        "--max-body-scale-cv", "0.08",
        "--max-anchor-y-std", "0.05",
        "--prompt", "synthetic selftest attack sheet (deterministic)",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit("process failed:\n" + proc.stdout + "\n" + proc.stderr)
    meta_path = out_dir / "pipeline-meta.json"
    if not meta_path.exists():
        raise SystemExit("pipeline-meta.json 未生成")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    return meta


def main() -> None:
    work = HERE / "selftest-run"
    raw = work / "raw.png"
    out_dir = work / "processed"
    import shutil
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)

    print("[1/2] 合成 raw sheet ...")
    make_raw_sheet(raw)

    print("[2/2] 跑 generate2dsprite process (strict QC) ...")
    meta = run_process(raw, out_dir)

    files = sorted(p.name for p in out_dir.iterdir())
    print("  产出文件:", files)
    required = ["sheet-transparent.png", "pipeline-meta.json", "prompt-used.txt"]
    miss = [f for f in required if f not in files]
    if miss:
        raise SystemExit("缺少必需产出: " + ", ".join(miss))

    qc = meta.get("qc_summary") or {}
    np_frames = len(meta.get("frames", []))
    print(f"  frames={np_frames}  edge_touch_frames={meta.get('edge_touch_frames')} "
          f"empty_frames={meta.get('empty_frames')}  body_scale_cv={qc.get('body_scale_cv')} "
          f"anchor_y_std={qc.get('anchor_y_std')}")
    expected_frames = ROWS * COLS
    assert np_frames == expected_frames, f"期望 {expected_frames} 帧,实得 {np_frames}"
    # strict-qc 通过的最低证据：process 无异常且空帧为 0
    assert not meta.get("empty_frames"), "strict QC 出现空帧"

    print("\nPASS: sprite-forge 后处理管线在本机闭环可跑。")
    # 自测产物保留在 tools/selftest-run，不进产品区；接口交接处由使用者（agent/人工）清理


if __name__ == "__main__":
    main()
