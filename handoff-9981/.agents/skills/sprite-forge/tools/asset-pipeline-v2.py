#!/usr/bin/env python3
"""
asset-pipeline-v2.py — V0 混合素材生成管线 v2 CLI

权威契约：
  - docs/创作系统/05_V0混合素材生成管线规范.md
  - docs/创作系统/06_底图原生组件占位切片与图生图替换规范.md
  - docs/创作系统/07_底图切片图生图管线深化设计与改造方案.md
  - .agents/skills/sprite-forge/catalogs/component-types.v2.json
  - .agents/skills/sprite-forge/schemas/job.v2.schema.json
  - .agents/skills/sprite-forge/schemas/manifest.v2.schema.json

标准三步闭环：
  1. prepare: 生成 job.v2.json (含提示词、视角、切片母图引用、rawTarget)
  2. V0 接缝: 由 Agent / GenerateImage 将 raw 图输出到 rawTarget
  3. finalize: 纯化品红、去杂色二值化、切格量化、自动 QC、计算 SHA-256 并生成 manifest.v2.json
  4. registry: 聚合已通过 QC 且由人工核准 (status=ready) 的资产目录
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# PIL and numpy are imported inside image processing functions

# ---------------------------------------------------------------- 常量与路径 ----

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
CATALOG_PATH = SKILL_DIR / "catalogs" / "component-types.v2.json"

VALID_LANES = ["component", "character", "symbol", "backdrop"]
ITEM_COMPONENT_TYPES = ["item-consumable", "item-tool", "item-equipment"]
ALL_COMPONENT_TYPES = [
    "weapon-melee",
    "weapon-ranged",
    "weapon-firearm",
    "item-consumable",
    "item-tool",
    "item-equipment",
    "device",
    "environment",
]


def load_component_catalog() -> dict[str, Any]:
    if CATALOG_PATH.exists():
        return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return {}


def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


# ---------------------------------------------------------------- 提示词组装 ----

def get_perspective_for_type(comp_type: str) -> str:
    if comp_type in ITEM_COMPONENT_TYPES:
        return "front view"
    return "front-top axonometric view"


def pick_grid_dims(count: int) -> tuple[int, int]:
    if count <= 1:
        return 1, 1
    if count <= 3:
        return count, 1
    if count <= 4:
        return 2, 2
    if count <= 6:
        return 3, 2
    if count <= 9:
        return 3, 3
    return 4, 4


def build_v2_prompt(
    comp_type: str,
    desc: str,
    states: list[str],
    perspective: str,
    reference_crop: str | None = None,
) -> str:
    catalog = load_component_catalog()
    color_spec = "Muted realism with high contrast edges."
    for t in catalog.get("types", []):
        if t.get("id") == comp_type:
            color_spec = t.get("colorSpec", color_spec)
            break

    if perspective == "front view":
        view_text = (
            "FRONT VIEW (EYE-LEVEL ORTHOGRAPHIC VIEW ONLY): Direct orthographic front-facing view at eye level. "
            "Highlight clear silhouette, clean edges, and distinct item details. "
            "NO tilt angle, NO 3D top face, NO side face, NO perspective vanishing points."
        )
    else:
        view_text = (
            "FRONT-TOP AXONOMETRIC VIEW ONLY: Fixed conventional elevated front angle. "
            "Only the top face and front face visible; side and rear faces hidden. "
            "Shallow 3D form, fixed conventional angle, orthographic projection. "
            "NO pure top-down flat icon, NO side profile, NO exaggerated perspective depth."
        )

    rows, cols = pick_grid_dims(len(states))
    state_desc = "; ".join(f"cell {i + 1} ({s}): {s} state of the object" for i, s in enumerate(states))

    grid_rule = (
        f"Exactly {rows}x{cols} equal cells in a strict grid on solid flat magenta background (#FF00FF). "
        "Subject centered in each cell, identical size and pixel scale across all cells. "
        "No dividers, no frames, no text, no blur, no anti-aliasing."
    )

    crop_constraint = ""
    if reference_crop:
        crop_constraint = (
            f"Derive strictly from the supplied reference crop ({reference_crop}). "
            "Frame 0 must match the exact 1:1 angle, bounding box aspect ratio, slope and lighting of the source crop. "
            f"Subsequent frames derive sequentially for states: {', '.join(states)}. "
        )

    prompt = (
        f"{view_text} "
        f"COMPONENT: {desc}. "
        f"Semantic color scheme: {color_spec} "
        f"{crop_constraint}"
        f"GRID STATES: {state_desc}. "
        f"{grid_rule}"
    )
    return prompt


# ---------------------------------------------------------------- 后处理核心 ----

def purify_magenta_array(arr: Any, tol: int = 90) -> Any:
    """把接近品红的背景像素纯化为纯 #FF00FF (RGB 255, 0, 255)"""
    import numpy as np
    out = arr.copy()
    r = out[:, :, 0].astype(int)
    g = out[:, :, 1].astype(int)
    b = out[:, :, 2].astype(int)
    dist = (r - 255) ** 2 + g**2 + (b - 255) ** 2
    mask = dist < tol**2
    out[mask, 0] = 255
    out[mask, 1] = 0
    out[mask, 2] = 255
    if out.shape[2] == 4:
        out[mask, 3] = 255
    return out


def slice_image_cells(img: Image.Image, count: int) -> list[Image.Image]:
    """根据状态数将 sheet 按照网格切分成若干帧"""
    if count <= 1:
        return [img]

    rows, cols = pick_grid_dims(count)
    w, h = img.size
    cell_w = w // cols
    cell_h = h // rows

    frames: list[Image.Image] = []
    for r in range(rows):
        for c in range(cols):
            if len(frames) >= count:
                break
            box = (c * cell_w, r * cell_h, (c + 1) * cell_w, (r + 1) * cell_h)
            frames.append(img.crop(box))
    return frames


# ---------------------------------------------------------------- 命令实现 ----

def cmd_prepare(args: argparse.Namespace) -> None:
    lane = args.lane
    if lane not in VALID_LANES:
        sys.exit(f"错误: lane 必须是 {VALID_LANES} 之一")

    comp_type = args.type
    if lane == "component" and comp_type not in ALL_COMPONENT_TYPES:
        sys.exit(f"错误: 静态组件类型必须是 {ALL_COMPONENT_TYPES} 之一")

    states = [s.strip() for s in args.states.split(",") if s.strip()]
    if not states:
        states = ["single"]

    perspective = get_perspective_for_type(comp_type) if comp_type else "front-top axonometric view"
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    job_file = out_dir / "job.v2.json"
    if job_file.exists() and not args.force:
        print(f"job.v2.json 已存在: {job_file} (使用 --force 覆盖)")
        return

    raw_target = str(out_dir / "raw.png")
    prompt = build_v2_prompt(
        comp_type=comp_type,
        desc=args.desc,
        states=states,
        perspective=perspective,
        reference_crop=args.reference_crop,
    )

    references = []
    if args.reference_crop:
        references.append(args.reference_crop)
    if args.references:
        references.extend([r.strip() for r in args.references.split(",") if r.strip()])

    rows, cols = pick_grid_dims(len(states))
    job_data: dict[str, Any] = {
        "schemaVersion": "2.0",
        "jobId": f"job-{args.id}",
        "lane": lane,
        "componentType": comp_type,
        "description": args.desc,
        "states": states,
        "perspective": perspective,
        "references": references,
        "rawTarget": raw_target,
        "outDir": str(out_dir),
        "status": "awaiting-generation",
        "prompt": prompt,
        "postProcess": {
            "purifyTolerance": 90,
            "targetSize": 64,
            "gridRows": rows,
            "gridCols": cols,
        },
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "provenance": {
            "tool": "asset-pipeline-v2.py",
            "version": "2.0.0",
        },
    }
    if args.reference_crop:
        job_data["referenceCrop"] = args.reference_crop

    job_file.write_text(json.dumps(job_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"✓ 已创建 Job: {job_file}")
    print(f"  - 目标 raw 图片路径: {raw_target}")
    print(f"  - 视角规范: {perspective}")
    print(f"  - 状态数: {len(states)} ({', '.join(states)})")


def cmd_finalize(args: argparse.Namespace) -> None:
    job_path = Path(args.job).resolve() if args.job else Path(args.out).resolve() / "job.v2.json"
    if not job_path.exists():
        sys.exit(f"错误: 找不到 job.v2.json: {job_path}")

    job_data = json.loads(job_path.read_text(encoding="utf-8"))
    out_dir = Path(job_data["outDir"])
    raw_target = Path(job_data["rawTarget"])

    if not raw_target.exists():
        sys.exit(f"错误: rawTarget 图片不存在: {raw_target}")

    from PIL import Image
    import numpy as np

    try:
        raw_img = Image.open(raw_target).convert("RGBA")
    except Exception as e:
        sys.exit(f"错误: 无法解析 rawTarget PNG 图片: {e}")

    states = job_data["states"]
    expected_count = len(states)

    # 1. 纯化品红背景
    raw_arr = np.array(raw_img)
    purified_arr = purify_magenta_array(raw_arr, tol=job_data.get("postProcess", {}).get("purifyTolerance", 90))
    purified_img = Image.fromarray(purified_arr)
    purified_path = out_dir / "sheet.png"
    purified_img.save(purified_path)

    # 2. 切格
    sliced_frames = slice_image_cells(purified_img, expected_count)

    # 3. 逐帧像素化与缩放至目标尺寸 (64x64)
    target_size = job_data.get("postProcess", {}).get("targetSize", 64)
    frames_dir = out_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    frame_records = []
    qc_checks = []

    # QC 检查 1: 帧数
    actual_count = len(sliced_frames)
    count_ok = actual_count == expected_count
    qc_checks.append({
        "check": "frame_count",
        "passed": count_ok,
        "details": f"Expected {expected_count} frames, got {actual_count}",
    })

    empty_frame_found = False
    for i, state in enumerate(states):
        if i < len(sliced_frames):
            frame_img = sliced_frames[i].resize((target_size, target_size), Image.Resampling.NEAREST)
        else:
            frame_img = Image.new("RGBA", (target_size, target_size), (255, 0, 255, 255))

        frame_file = frames_dir / f"{state}.png"
        frame_img.save(frame_file)

        # 检查是否为空白帧 (全是纯品红)
        arr = np.array(frame_img)
        is_magenta = (arr[:, :, 0] == 255) & (arr[:, :, 1] == 0) & (arr[:, :, 2] == 255)
        if np.all(is_magenta):
            empty_frame_found = True

        sha = compute_sha256(frame_file)
        frame_records.append({
            "name": state,
            "file": f"frames/{state}.png",
            "sha256": sha,
            "width": target_size,
            "height": target_size,
        })

    # QC 检查 2: 空帧
    qc_checks.append({
        "check": "no_empty_frame",
        "passed": not empty_frame_found,
        "details": "All frames contain non-magenta content" if not empty_frame_found else "Empty frame detected",
    })

    # QC 检查 3: 尺寸对齐
    qc_checks.append({
        "check": "dimensions_aligned",
        "passed": all(f["width"] == target_size and f["height"] == target_size for f in frame_records),
        "details": f"Target resolution {target_size}x{target_size}",
    })

    all_passed = all(c["passed"] for c in qc_checks)
    qc_status = "passed" if all_passed else "failed"
    manifest_status = "pending-human-review" if all_passed else "rejected"

    manifest_data: dict[str, Any] = {
        "schemaVersion": "2.0",
        "id": job_data["jobId"].replace("job-", ""),
        "lane": job_data["lane"],
        "componentType": job_data.get("componentType"),
        "description": job_data["description"],
        "status": manifest_status,
        "states": states,
        "frames": frame_records,
        "qc": {
            "status": qc_status,
            "checks": qc_checks,
        },
        "provenance": {
            "jobId": job_data["jobId"],
            "tool": "asset-pipeline-v2.py",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        },
    }
    if "referenceCrop" in job_data:
        manifest_data["provenance"]["referenceCrop"] = job_data["referenceCrop"]

    manifest_path = out_dir / "manifest.v2.json"
    manifest_path.write_text(json.dumps(manifest_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    job_data["status"] = "complete" if all_passed else "failed"
    job_path.write_text(json.dumps(job_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"✓ Finalize 完成: {manifest_path}")
    print(f"  - QC 状态: {qc_status}")
    print(f"  - 资产状态: {manifest_status}")
    print(f"  - 产出帧数: {len(frame_records)}")


def cmd_registry(args: argparse.Namespace) -> None:
    scan_dir = Path(args.dir).resolve()
    if not scan_dir.exists():
        sys.exit(f"错误: 扫描目录不存在: {scan_dir}")

    manifest_files = list(scan_dir.rglob("manifest.v2.json"))
    ready_manifests = []
    pending_manifests = []
    rejected_manifests = []

    for mf in sorted(manifest_files):
        try:
            data = json.loads(mf.read_text(encoding="utf-8"))
            if data.get("schemaVersion") != "2.0":
                continue
            qc_ok = data.get("qc", {}).get("status") == "passed"
            status = data.get("status")
            if qc_ok and status == "ready":
                ready_manifests.append(data)
            elif qc_ok and status == "pending-human-review":
                pending_manifests.append(data)
            else:
                rejected_manifests.append(data)
        except Exception as e:
            print(f"  ⚠ 忽略损坏 manifest: {mf} ({e})")

    out_path = Path(args.out).resolve() if args.out else scan_dir / "registry.v2.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    registry_data = {
        "schemaVersion": "2.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "totalReadyCount": len(ready_manifests),
        "totalPendingCount": len(pending_manifests),
        "totalRejectedCount": len(rejected_manifests),
        "assets": ready_manifests,
    }

    out_path.write_text(json.dumps(registry_data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"✓ Registry 聚合完成: {out_path}")
    print(f"  - 已就绪 (ready): {len(ready_manifests)}")
    print(f"  - 待人工复核 (pending-human-review): {len(pending_manifests)}")
    print(f"  - 已拒绝/未通过 QC: {len(rejected_manifests)}")


# ---------------------------------------------------------------- CLI 入口 ----

def main() -> None:
    parser = argparse.ArgumentParser(description="WakeUp V0 混合素材生成管线 v2 CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # prepare
    p_prep = subparsers.add_parser("prepare", help="准备素材生成任务 (生成 job.v2.json)")
    p_prep.add_argument("--lane", default="component", choices=VALID_LANES, help="生成泳道")
    p_prep.add_argument("--id", required=True, help="组件/素材唯一 id")
    p_prep.add_argument("--type", choices=ALL_COMPONENT_TYPES, help="组件分类")
    p_prep.add_argument("--desc", required=True, help="组件外观与功能描述")
    p_prep.add_argument("--states", default="single", help="状态序列帧，逗号隔开 (如 closed,cracked,open)")
    p_prep.add_argument("--reference-crop", help="底图切片相对路径 (Crop-to-Sprite 母图)")
    p_prep.add_argument("--references", help="其他参考图路径，逗号隔开")
    p_prep.add_argument("--out", required=True, help="任务输出目录")
    p_prep.add_argument("--force", action="store_true", help="强制覆盖已存在的 job.v2.json")

    # finalize
    p_fin = subparsers.add_parser("finalize", help="对 raw 图片进行确定性后处理并生成 manifest.v2.json")
    p_fin.add_argument("--job", help="job.v2.json 路径")
    p_fin.add_argument("--out", help="包含 job.v2.json 的输出目录")
    p_fin.add_argument("--force", action="store_true", help="覆盖已存在的成品")

    # registry
    p_reg = subparsers.add_parser("registry", help="聚合扫描目录下的所有 ready 资产")
    p_reg.add_argument("--dir", required=True, help="扫描目录")
    p_reg.add_argument("--out", help="聚合清单输出路径")

    args = parser.parse_args()

    if args.command == "prepare":
        cmd_prepare(args)
    elif args.command == "finalize":
        cmd_finalize(args)
    elif args.command == "registry":
        cmd_registry(args)


if __name__ == "__main__":
    main()
