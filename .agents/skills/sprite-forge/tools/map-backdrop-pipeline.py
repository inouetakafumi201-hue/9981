#!/usr/bin/env python3
"""
map-backdrop-pipeline.py — WakeUp 地图背景生成管线（建立中）

设计目标：
  从零建立"AI 草图 → 作者局部重绘 → 硬边化 + 杂色纯化 → ship 资产"完整链路。

与 sprite-component.py 的关系：
  - sprite-component.py：组件（64×64，硬边像素 + 32 色调色板）
  - 本脚本：地图背景（≥1024px，hard-edge + 杂色纯化 + 48 色扩展调色板）

四段式管线：

  ┌─────────────────────────────────────────────────────────────────┐
  │ Stage 1: AI 草图生成                                            │
  │   - 调用 sprite-forge 的 nano-banana-sprite.py 拉一张 1024×1024  │
  │   - 视角：top-down plan view（PLT-01 唯一视角铁律）            │
  │   - 提示词锁定：场景描述 + 调色板约束 + 硬边约束                │
  │   - 产物：run/backdrops/{name}/raw.png + raw.json              │
  └─────────────────────────────────────────────────────────────────┘
                              ↓
  ┌─────────────────────────────────────────────────────────────────┐
  │ Stage 2: 作者局部重绘（人工步骤，跳过自动化）                  │
  │   - 在 raw.png 之上覆盖修改                                    │
  │   - 工具：编辑器内置 paint layer / Photoshop / Aseprite 都可  │
  │   - 关键：这一步是"AI 不可举证"的法律基础                       │
  │   - 产物：run/backdrops/{name}/author-pass.png                 │
  └─────────────────────────────────────────────────────────────────┘
                              ↓
  ┌─────────────────────────────────────────────────────────────────┐
  │ Stage 3: 硬边化 + 杂色纯化                                      │
  │   - 调用 hashi-dither-purifier.py（48 色扩展调色板）           │
  │   - 参数：colors=48, passes=5（比场景图更激进）                │
  │   - 产物：run/backdrops/{name}/final.png                      │
  └─────────────────────────────────────────────────────────────────┘
                              ↓
  ┌─────────────────────────────────────────────────────────────────┐
  │ Stage 4: ship 资产登记                                          │
  │   - 复制 final.png → src/devboard/.../public/games/maps/{name}.png │
  │   - 生成脱敏 manifest.json（无 prompt 字段）                    │
  │   - 同步 MapData JSON 的 backdrop.image 字段                  │
  └─────────────────────────────────────────────────────────────────┘

用法：
  # Stage 1: AI 草图
  python map-backdrop-pipeline.py generate --name warehouse-v1 \\
      --desc "abandoned warehouse, top-down plan view, hard-edged pixel art"

  # Stage 3: 硬边化（Stage 2 是人工，不在这里）
  python map-backdrop-pipeline.py purify --name warehouse-v1 --colors 48

  # Stage 4: ship 资产复制
  python map-backdrop-pipeline.py ship --name warehouse-v1 \\
      --target src/devboard/game-ui-shell-15/public/games/maps/

  # 一键：Stage 1 + Stage 3（跳过 Stage 2，AI 直出后直接纯化）
  python map-backdrop-pipeline.py auto --name warehouse-v1 \
      --desc "abandoned warehouse, top-down plan view" --colors 48

  # 大地图：4K 高密度，迭代打磨提示词
  python map-backdrop-pipeline.py generate --name dorm-room \
      --preset room --desc "出租屋卧室，含床、书桌、衣柜、窗户"
  python map-backdrop-pipeline.py generate --name high-school-campus \
      --preset large-map --desc "高中校园，教学楼、操场、走廊"
  python map-backdrop-pipeline.py generate --name street-outside-school \
      --preset large-map --desc "学校门口的街道，商店、树木、人行道"


依赖：Pillow / httpx（与 sprite-forge 共享）
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

# 共享 path：sprite-forge 工具链
SPRITE_FORGE_DIR = Path(__file__).resolve().parent
BACKDROPS_DIR = Path("run/backdrops")


# ---------------------------------------------------------------- 风格锁 ----

# 地图背景通用风格锁（与 PLT-01 / 05_组件生成风格规范 共享视角铁律）
MAP_BACKDROP_PROMPT = (
    "Top-down plan view of a scene, no front face, no side face, no top face, "
    "no oblique depth, no three-quarter view, not isometric. "
    "Hard-edged solid color blocks, native pixel art aesthetic, "
    "NO anti-aliasing, NO gradients, NO dithering, NO soft blur. "
    "Modern urban low-key realism, muted palette, grounded everyday environment. "
    "Lighting: flat 2-3 shade steps per surface, light source upper-left. "
    "Clean hard silhouette, readable as a flat overhead plan. "
    "Background: 100% solid flat magenta (#FF00FF), no gradients, no shadow, "
    "no text, no labels, no numbers anywhere. "
    "SCENE: {desc}"
)

# 大地图（4K 局内/局外）专用风格锁 — 强调细节密度与禁止可移动物件
# 这是从普通 4K 画面质量路线改为「大比例尺占位底图」路线的关键约束
LARGE_MAP_PRESET = (
    "Top-down plan view, OVERHEAD FLAT 2D map, not isometric, not three-quarter. "
    "Hard-edged solid color blocks, native pixel art aesthetic, "
    "NO anti-aliasing, NO gradients, NO dithering, NO soft blur, NO soft edges. "
    "Render at NATIVE 4K RESOLUTION (3840x2160 or higher), with high density of "
    "architectural details and small props scattered across the entire canvas — "
    "this is a PLACEHOLDER UNDERLAY for level editing, not a quality showcase image. "
    "Every square meter should have visible detail: wall texture variation, "
    "floor pattern, doors, windows, furniture, signage, lighting fixtures, "
    "drainage grates, small static objects, ground cracks, grass tufts. "
    "Scale: a single person is approximately 6-10 pixels wide at the smallest "
    "visible level — the map should feel like it could contain 50+ individual "
    "rooms and 100+ small details. "
    "ABSOLUTELY NO MOVING OBJECTS: no vehicles (cars, trucks, bicycles, scooters), "
    "no people, no animals, no moving props. Only static architecture and fixtures. "
    "Components will be placed on top of this in the editor to fill dynamic roles. "
    "NO shadow casting, NO soft shading — every surface is flat 2-3 tone stepped. "
    "Light source upper-left, but applied as flat color zones, not gradients. "
    "Modern urban low-key realism, muted palette (gray/brown/cool blue), "
    "grounded everyday environment. "
    "NO fantasy armor, no sci-fi glow, no neon, no futuristic elements. "
    "SCENE: {desc}"
)

# 局外小地图（出租屋）专用 — 较小比例尺，仍要 4K 密度（细节为王，不为画面美观让步）
ROOM_PRESET = (
    "Top-down plan view, OVERHEAD FLAT 2D map, not isometric. "
    "Hard-edged solid color blocks, native pixel art aesthetic, "
    "NO anti-aliasing, NO gradients, NO dithering, NO soft blur. "
    "Render at NATIVE 4K RESOLUTION with high detail density. "
    "Interior scene: a single room with all furniture, fixtures, and small props. "
    "ABSOLUTELY NO MOVING OBJECTS, no people, no animals. Only static items. "
    "Every prop the player can interact with must be visible: bed, desk, chair, "
    "wardrobe, window, door, bookshelf, lamp, rug, wall decorations, etc. "
    "Scale: furniture should be small enough that the room feels like a full "
    "interior, not a single bed floating in space. "
    "Light source upper-left as flat 2-3 tone color zones. "
    "NO shadow casting, NO soft shading. "
    "Modern urban low-key realism, muted palette. "
    "Background: 100% solid flat magenta (#FF00FF) for empty floor areas not "
    "covered by furniture. "
    "SCENE: {desc}"
)

COMBINED_DISTRICT_PRESET = (
    "PURE TOP-DOWN PLAN VIEW, flat orthographic overhead 2D, never isometric, oblique, "
    "or three-quarter. Native hard-edged pixel art, solid color zones, no anti-aliasing, "
    "gradients, dithering, blur, or soft edges. 4K means native high detail density, "
    "not enlarging a low-resolution image. No text, letters, words, numbers, signs, "
    "signage, logos, glyphs, UI, labels, icons, captions, or watermarks. No people, "
    "animals, vehicles, cars, trucks, bicycles, scooters, skateboards, or movable "
    "objects; static architecture and grounded scenery only. Connected district plan "
    "with buildings, courtyards, empty roads and paths, parks, walls, and drainage. "
    "Muted urban realism, flat 2-3 tone upper-left lighting, magenta (#FF00FF) empty "
    "background. SCENE: {desc}"
)

PRESETS = {
    "default": MAP_BACKDROP_PROMPT,
    "large-map": LARGE_MAP_PRESET,
    "room": ROOM_PRESET,
    "combined-district": COMBINED_DISTRICT_PRESET,
}


def build_prompt(desc: str, preset: str = "default") -> str:
    template = PRESETS.get(preset, MAP_BACKDROP_PROMPT)
    return template.format(desc=desc)


# ---------------------------------------------------------------- Stage 1 ----

def stage_generate(name: str, desc: str, provider: str | None = None,
                    preset: str = "default", size: int = 4096,
                    dry_run: bool = False) -> Path:
    """Stage 1: AI 草图生成（调用 sprite-forge 的 nano-banana-sprite.py）。

    Args:
        name:  地图名（如 warehouse-v1）
        desc:  场景描述
        provider:  gpt-image-2 / gemini（可选）
        preset:  prompt 预设（default / large-map / room）
        size:  出图尺寸（默认 4096×4096 大地图占位底图）

    Returns:
        run/backdrops/{name}/raw.png
    """
    out_dir = BACKDROPS_DIR / name
    out_dir.mkdir(parents=True, exist_ok=True)

    prompt = build_prompt(desc, preset=preset)
    raw_png = out_dir / "raw.png"
    raw_json = out_dir / "raw.json"

    # 复用 sprite-forge 的 nano-banana-sprite.py（共享出图栈）
    nano_banana = SPRITE_FORGE_DIR / "nano-banana-sprite.py"
    if not nano_banana.exists():
        print(f"✗ 找不到 {nano_banana}，请先安装 sprite-forge")
        sys.exit(1)

    # 这里仅构造命令，让 nano-banana-sprite 接管（用户可在 API key 缺失时跳过 AI 阶段）
    cmd = [
        sys.executable, str(nano_banana), "generate",
        "--prompt", prompt,
        "--out", str(raw_png),
        "--rows", "1", "--cols", "1",
        "--size", {4096: "4K", 2048: "2K", 1024: "1K"}.get(size, str(size)),
    ]
    if provider:
        cmd += ["--provider", provider]

    print(f"→ Stage 1: AI 草图生成")
    print(f"  preset: {preset}")
    print(f"  out: {raw_png}")
    print(f"  prompt: {prompt[:200]}...")
    print(f"  cmd: {' '.join(cmd[:6])}... [--size {size}]")
    print(f"  (请确认已配置 SPRITE_GPT_KEY / SPRITE_GEMINI_KEY 后手动执行)")
    if dry_run:
        print("  dry-run: 仅生成命令与契约，不调用生成器，不声明 raw.png 已生成")
        return raw_png

    import subprocess
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError("Stage 1 生成失败")
    if not raw_png.exists():
        raise RuntimeError(f"生成器未产出 {raw_png}")

    # 写留档
    raw_json.write_text(json.dumps({
        "stage": "1-generate",
        "name": name,
        "desc": desc,
        "preset": preset,
        "size": size,
        "prompt": prompt,
        "provider": provider,
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }, indent=2, ensure_ascii=False), encoding="utf-8")

    return raw_png


# ---------------------------------------------------------------- Stage 3 ----

def stage_purify(name: str, colors: int = 48, passes: int = 5) -> Path:
    """Stage 3: 硬边化 + 杂色纯化（调用 hashi-dither-purifier.py）。

    Returns:
        run/backdrops/{name}/final.png
    """
    in_dir = BACKDROPS_DIR / name
    if not (in_dir / "raw.png").exists():
        print(f"✗ 缺少 {in_dir}/raw.png，请先跑 Stage 1")
        sys.exit(1)
    if not (in_dir / "raw.png").exists():
        raise FileNotFoundError(f"缺少 source 输入 {in_dir / 'raw.png'}，Stage 1 未完成")
    selected = in_dir / "selected.png"
    author_pass = in_dir / "author-pass.png"
    if not selected.exists():
        raise FileNotFoundError(f"缺少 selected 输入 {selected}，请先完成人工选图")
    if not author_pass.exists():
        raise FileNotFoundError(f"缺少 author-pass 输入 {author_pass}，正式交付禁止跳过作者审核")
    source = author_pass

    out_png = in_dir / "final.png"
    purifier = SPRITE_FORGE_DIR / "hashi-dither-purifier.py"
    if not purifier.exists():
        print(f"✗ 找不到 {purifier}")
        sys.exit(1)

    cmd = [
        sys.executable, str(purifier), "single",
        str(source), "--output", str(out_png),
        "--colors", str(colors), "--passes", str(passes),
    ]
    print(f"→ Stage 3: 硬边化 + 杂色纯化")
    print(f"  in: {source}")
    print(f"  out: {out_png}")
    print(f"  colors: {colors}, passes: {passes}")

    import subprocess
    result = subprocess.run(cmd, capture_output=False)
    if result.returncode != 0:
        print(f"✗ 纯化失败")
        sys.exit(1)

    # 写留档
    (in_dir / "final.json").write_text(json.dumps({
        "stage": "3-purify",
        "name": name,
        "colors": colors,
        "passes": passes,
        "source": str(source),
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }, indent=2, ensure_ascii=False), encoding="utf-8")

    return out_png


# ---------------------------------------------------------------- Stage 4 ----

def stage_ship(name: str, target_dir: Path) -> Path:
    """Stage 4: ship 资产登记（复制 final.png + 生成脱敏 manifest）。

    Returns:
        target_dir/{name}.png
    """
    final = BACKDROPS_DIR / name / "final.png"
    if not final.exists():
        print(f"✗ 缺少 {final}，请先跑 Stage 3")
        sys.exit(1)

    target_dir.mkdir(parents=True, exist_ok=True)
    out_png = target_dir / f"{name}.png"
    shutil.copy2(final, out_png)

    # 脱敏 manifest（无 prompt 字段，仅登记 + source provenance）
    manifest = {
        "kind": "wakeup-map-backdrop",
        "name": name,
        "src": f"/games/maps/{name}.png",
        "provenance": "AI 草图 + 作者局部重绘 + hashi-dither-purifier 硬边化后处理",
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    out_manifest = target_dir / f"{name}.manifest.json"
    out_manifest.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"→ Stage 4: ship 资产登记")
    print(f"  png: {out_png}")
    print(f"  manifest: {out_manifest}")
    return out_png


# ---------------------------------------------------------------- 一键 ----

def stage_auto(name: str, desc: str, colors: int, target_dir: Path,
                provider: str | None = None, preset: str = "default",
                size: int = 4096, dry_run: bool = False) -> Path:
    """一键流程；dry-run 只构造 Stage 1 输入，不生成或交付资产。"""
    print(f"=== {name} · 一键全流程 ===\n")
    stage_generate(name, desc, provider, preset=preset, size=size, dry_run=dry_run)
    if dry_run:
        return BACKDROPS_DIR / name / "raw.png"
    print()
    stage_purify(name, colors=colors)
    print()
    return stage_ship(name, target_dir)


# ---------------------------------------------------------------- CLI ----

def main() -> None:
    parser = argparse.ArgumentParser(
        description="WakeUp 地图背景生成管线",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parsers = parser.add_subparsers(dest="command", required=True)

    # Stage 1
    g1 = sub.add_parser("generate", help="Stage 1: AI 草图生成")
    g1.add_argument("--name", required=True, help="地图名（如 warehouse-v1）")
    g1.add_argument("--desc", required=True, help="场景描述")
    g1.add_argument("--provider", default=None, choices=["gpt-image-2", "gemini"])
    g1.add_argument("--preset", default="default",
                    choices=["default", "large-map", "room", "combined-district"],
                    help="prompt 预设（default / room / large-map / combined-district）")
    g1.add_argument("--size", type=int, default=4096,
                    help="出图尺寸（默认 4096×4096 大地图占位底图）")
    g1.add_argument("--dry-run", action="store_true", help="只显示输入契约，不调用生成器")

    # Stage 3
    g3 = sub.add_parser("purify", help="Stage 3: 硬边化 + 杂色纯化")
    g3.add_argument("--name", required=True, help="地图名（与 generate 一致）")
    g3.add_argument("--colors", type=int, default=48, help="调色板色数（默认 48）")
    g3.add_argument("--passes", type=int, default=5, help="混合通过数（默认 5）")

    # Stage 4
    g4 = sub.add_parser("ship", help="Stage 4: ship 资产登记")
    g4.add_argument("--name", required=True, help="地图名")
    g4.add_argument("--target", type=Path, required=True, help="ship 目标目录")

    # 一键
    ga = sub.add_parser("auto", help="一键：Stage 1 + Stage 3 + Stage 4（跳过 Stage 2 人工重绘）")
    ga.add_argument("--name", required=True)
    ga.add_argument("--desc", required=True)
    ga.add_argument("--colors", type=int, default=48)
    ga.add_argument("--target", type=Path, required=True)
    ga.add_argument("--provider", default=None, choices=["gpt-image-2", "gemini"])
    ga.add_argument("--preset", default="default", choices=["default", "large-map", "room", "combined-district"])
    ga.add_argument("--size", type=int, default=4096)

    args = parser.parse_args()

    if args.command == "generate":
        stage_generate(args.name, args.desc, args.provider,
                       preset=args.preset, size=args.size, dry_run=args.dry_run)
    elif args.command == "purify":
        stage_purify(args.name, args.colors, args.passes)
    elif args.command == "ship":
        stage_ship(args.name, args.target)
    elif args.command == "auto":
        stage_auto(args.name, args.desc, args.colors, args.target,
                   args.provider, preset=args.preset, size=args.size)


if __name__ == "__main__":
    main()
