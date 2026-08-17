import pathlib, sys, base64

# BASE / COMMON / ROLL / NOTES / PT 直接内联在此脚本
BASE = {
 "framing": ("A 1080p (1920x1080, 16:9 widescreen, fill the whole canvas) turn-based battle game screen, "
   "top-down plan view, pixel-art by design. Full-bleed composition, no letterbox, no frame, no border."),
 "ground": ("Foreground: high-saturation pixel-art character tokens (~32-64px) standing on low-saturation hand-drawn "
   "rough-sketch scene nodes; map background low-saturation, slightly dark and cool, minimal. "
   "Top-down plan view: characters read as flat top-down outlines with readable silhouettes and ground shadows, "
   "no front/side faces, no isometric depth; facing is shown in the plan plane."),
 "palette": ("Palette ONLY: orange=AP, red=health/damage, blue=sanity/stamina, green=reachable/free, "
   "purple=ranged/conditional/reversal, coral=melee, gray=unavailable, cyan=UGC, gold/silver=highlight only."),
}
COMMON = (
 f"{BASE['framing']} {BASE['ground']} "
 "HUD strictly layered. LEFT-docked persistent turn-order bar = a vertical column of INDEPENDENT TURN FRAMES (one frame per turn): "
 "each frame = action order number + character avatar + name + 5 red block health + 5 blue block sanity. "
 "The currently-active turn's frame is HIGHLIGHTED with a glossy reflective shine (a highlight that looks like light reflecting, not flat edge-glow). "
 "The PLAYER's own frame is WIDER and THICKER than the others, roughly one dice-width wider, and its sanity/stamina bar carries the same glossy shine; "
 "color rules identical to everyone else. Already-acted turns are dimmed to gray/desaturated. "
 "A DICE icon floats FREELY to the right of the turn-order bar (it is NOT welded to the bar; it only appears during a unified roll or a single action roll). "
 "After rolling, a horizontal bar shoots out from the right of the DICE producing a ROW OF HORIZONTAL BAR COMPARISON across the players, "
 "the player's own bars extend from the right side of the turn frame and the dice sits on a higher z-layer. "
 "TOP thin status bar: 'Turn 5 | Player Action Phase | Player A's Turn'. "
)
ROLL = ("An inline dice-roll mini panel sits beside the bars and contains TWO PUSH-UP SLIDERS: "
   "Power-dice slider (orange) pushable up to 1-2 gears, the higher the gear the heavier the charge/glow; "
   "and Reversal slider (purple) pushable up to 1-2 gears for countering, higher gear = heavier effect. "
   "Gears show clearly different visual intensity.")
NOTES = (f"{BASE['palette']} Overall restrained, dark-ish, semi-transparent UI overlay, glossy highlights, "
   "low cognitive load, one glance shows who is acting now, how much health/sanity remains, "
   "and what the player can still do.")
PT = {
 "A": ("Focused, spare, wide-open map. Small, minimal HUD; dense tree of scene nodes filling the center. "
       "Dominant: canvas/lived-in space feel."),
 "B": ("Neat, paneled, high-contrast. Crisp boxed HUD; a well-laid-out central grid. Dominant: legibility, orderly panel grid."),
 "C": ("Atmospheric, moody, cinematic. Darker, glow-heavy, thin sci-fi gloss, more spatial depth and light bloom around interactive edges."),
 "D": ("Clean, bright, decisive, casual. Broad canvas, airy layout, confident readable HUD, subtle soft shadows."),
}

DOTENV = pathlib.Path(".env")
cfg = {}
for line in DOTENV.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); k, v = k.strip(), v.strip()
        if k.startswith("SPRITE_"):
            cfg[k] = v
base = (cfg.get("SPRITE_BASE_URL") or "https://apiclaude.cc/").rstrip("/")
key = cfg.get("SPRITE_GPT_KEY")
ep = f"{base}/v1/images/generations"
import httpx
outdir = pathlib.Path("D:/coding/WakeUp/run/ui-mockup/v2")
outdir.mkdir(parents=True, exist_ok=True)
for tag in ["A", "B", "C", "D"]:
    prompt = f"{COMMON}{ROLL} {PT[tag]} {NOTES}"
    resp = httpx.post(ep, headers={"Authorization": f"Bearer {key}"},
        json={"model": "gpt-image-2", "prompt": prompt, "size": "1536x1024", "response_format": "b64_json"}, timeout=300)
    n = f"ui_v2_{tag}.png"
    if resp.status_code != 200:
        print(n, "FAIL", resp.status_code, resp.text[:200]); continue
    b64 = resp.json()["data"][0].get("b64_json")
    if not b64:
        print(n, "no b64"); continue
    png = base64.b64decode(b64)
    p = outdir / n
    p.write_bytes(png)
    from PIL import Image
    import numpy as np
    im = Image.open(p).convert('RGB')
    arr = np.asarray(im).astype(int)
    m = (arr[:, :, 0] > 200) & (arr[:, :, 2] > 200) & (arr[:, :, 1] < 120)
    im.save(p.with_suffix('.jpg'), 'JPEG', quality=90)
    print(n, im.size, "mag%0.1f" % (100 * m.mean()))
print("done")
