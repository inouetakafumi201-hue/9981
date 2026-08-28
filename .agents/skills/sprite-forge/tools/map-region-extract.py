#!/usr/bin/env python3
"""Deterministic map region extraction and author-pass composition.

regions.json describes source image, building groups, shell/floor branches and
anchors. Regions retain native rectangular geometry; no grid or square padding.
"""
from __future__ import annotations
import argparse, json, hashlib, warnings
from pathlib import Path
from typing import Any
from PIL import Image, ImageChops, ImageDraw

SCHEMA = "wakeup.map-regions.v1"

def _box(value: Any) -> tuple[int,int,int,int]:
    if isinstance(value, dict): value = [value[k] for k in ("x","y","width","height")]
    if len(value) != 4: raise ValueError("bbox must be [x,y,width,height]")
    x,y,w,h = map(int, value)
    if x < 0 or y < 0 or w <= 0 or h <= 0: raise ValueError("bbox must be non-negative with positive size")
    return x,y,w,h

def _anchor(a: Any, bbox: tuple[int,int,int,int]) -> dict[str,Any]:
    if not isinstance(a, dict) or "x" not in a or "y" not in a:
        raise ValueError("anchor requires x and y")
    x, y = int(a["x"]), int(a["y"])
    bx, by, bw, bh = bbox
    if not (bx <= x < bx + bw and by <= y < by + bh):
        raise ValueError(f"anchor {(x, y)} outside bbox")
    return {"x": x, "y": y, "kind": a.get("kind", "unknown")}

def _normalized_frame(value: Any, bbox: tuple[int,int,int,int], image_size: tuple[int,int]) -> dict[str,float]:
    if not isinstance(value, dict) or any(key not in value for key in ("x", "y", "width", "height")):
        raise ValueError("normalized_frame requires x, y, width and height")
    frame = {key: float(value[key]) for key in ("x", "y", "width", "height")}
    if not all(0 <= frame[key] <= 1 for key in frame) or frame["width"] <= 0 or frame["height"] <= 0:
        raise ValueError("normalized_frame values must be in 0..1 with positive size")
    if frame["x"] + frame["width"] > 1 or frame["y"] + frame["height"] > 1:
        raise ValueError("normalized_frame must stay inside source")
    x, y, w, h = bbox
    iw, ih = image_size
    expected = {"x": x / iw, "y": y / ih, "width": w / iw, "height": h / ih}
    tolerance = max(1 / iw, 1 / ih) / 2 + 1e-9
    if any(abs(frame[key] - expected[key]) > tolerance for key in frame):
        raise ValueError("normalized_frame does not match bbox/source dimensions")
    return frame

def validate(data: dict[str,Any], image_size: tuple[int,int] | None = None) -> list[str]:
    errors=[]; warnings_=[]
    if data.get("schema") != SCHEMA: errors.append(f"schema must be {SCHEMA}")
    source = data.get("source", {})
    if not source.get("image"): errors.append("source.image is required")
    regions = data.get("regions", [])
    if not isinstance(regions, list):
        errors.append("regions must be an array")
        regions = []
    seen_ids: set[str] = set()
    for i,r in enumerate(regions):
        if not isinstance(r, dict):
            errors.append(f"regions[{i}] must be an object")
            continue
        region_id = r.get("id")
        if not isinstance(region_id, str) or not region_id.strip():
            errors.append(f"regions[{i}] id is required")
        elif region_id in seen_ids:
            errors.append(f"regions[{i}] duplicate id: {region_id}")
        else:
            seen_ids.add(region_id)
        try:
            b=_box(r.get("bbox"));
            if image_size and (b[0]+b[2]>image_size[0] or b[1]+b[3]>image_size[1]): errors.append(f"regions[{i}] bbox outside source")
            if not r.get("building_group"): errors.append(f"regions[{i}] building_group is required")
            if r.get("shell") is None or r.get("floor") is None: errors.append(f"regions[{i}] shell and floor branches are required")
            if not r.get("normalized_frame"):
                errors.append(f"regions[{i}] normalized_frame is required")
            elif image_size:
                _normalized_frame(r["normalized_frame"], b, image_size)
            for key in ("entrance_anchors","stair_anchors"):
                anchors = r.get(key, [])
                if not isinstance(anchors, list): raise ValueError(f"{key} must be an array")
                for a in anchors: _anchor(a,b)
            if r.get("text_detected") or r.get("dynamic_objects_detected"): warnings_.append(f"regions[{i}] contains prohibited content; review author pass")
            if "text_detected" not in r: warnings_.append(f"regions[{i}] text QC cannot reliably determine output")
            if "dynamic_objects_detected" not in r: warnings_.append(f"regions[{i}] dynamic-object QC cannot reliably determine output")
            if r.get("view") not in ("top-down","top-down-plan"): warnings_.append(f"regions[{i}] view is not reliably top-down")
        except (ValueError,TypeError,KeyError) as e: errors.append(f"regions[{i}]: {e}")
    data["_warnings"] = warnings_
    return errors

def crop_extract(data: dict[str,Any], out: Path) -> dict[str,Any]:
    source=Path(data["source"]["image"]); img=Image.open(source).convert("RGBA")
    errors=validate(data,img.size)
    if errors: raise ValueError("; ".join(errors))
    out.mkdir(parents=True,exist_ok=True); manifest={"schema":SCHEMA,"source":str(source),"regions":[],"warnings":data.get("_warnings",[])}
    for r in data["regions"]:
        x,y,w,h=_box(r["bbox"]); crop=img.crop((x,y,x+w,y+h)); name=r["id"]
        path=out/f"{name}.png"; crop.save(path)
        manifest["regions"].append({"id":name,"path":path.name,"bbox":{"x":x,"y":y,"width":w,"height":h},"size":{"width":w,"height":h},"building_group":r["building_group"],"shell":r["shell"],"floor":r["floor"],"normalized_frame":r["normalized_frame"],"entrance_anchors":r.get("entrance_anchors",[]),"stair_anchors":r.get("stair_anchors",[])})
    (out/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8"); return manifest

def author_pass(data:dict[str,Any], out:Path)->None:
    source=Path(data["source"]["image"]); base=Image.open(source).convert("RGBA"); edited=Path(data["source"].get("author_pass", source)); overlay=Image.open(edited).convert("RGBA")
    if overlay.size != base.size: raise ValueError("author-pass must preserve source dimensions")
    mask=Image.new("L",base.size,0); draw=ImageDraw.Draw(mask)
    for r in data["regions"]:
        x,y,w,h=_box(r["bbox"]); draw.rectangle((x,y,x+w-1,y+h-1),fill=255)
    result=Image.composite(overlay,base,mask)
    # The compositing mask is the contract: pixels outside every region must
    # remain byte-identical to the source, including alpha.
    diff=ImageChops.difference(result,base)
    outside_mask = ImageChops.invert(mask)
    outside = Image.composite(diff, Image.new("RGBA", base.size, (0,0,0,0)), outside_mask)
    if outside.getbbox() is not None:
        raise AssertionError(f"author-pass changed pixels outside mask: {outside.getbbox()}")
    out.parent.mkdir(parents=True,exist_ok=True); result.save(out)

def main()->None:
    p=argparse.ArgumentParser(); sub=p.add_subparsers(dest="cmd",required=True)
    for cmd in ("validate","extract"):
        q=sub.add_parser(cmd); q.add_argument("regions",type=Path); q.add_argument("--out",type=Path)
    q=sub.add_parser("author-pass"); q.add_argument("regions",type=Path); q.add_argument("--out",type=Path,required=True)
    a=p.parse_args(); data=json.loads(a.regions.read_text(encoding="utf-8"))
    if a.cmd=="validate":
        im=Image.open(data["source"]["image"]); errors=validate(data,im.size)
        for w in data.get("_warnings",[]): warnings.warn(w)
        if errors: raise SystemExit("INVALID: "+"; ".join(errors))
        print(json.dumps({"valid":True,"warnings":data.get("_warnings",[])},ensure_ascii=False))
    elif a.cmd=="extract": print(json.dumps(crop_extract(data,a.out),ensure_ascii=False,indent=2))
    else: author_pass(data,a.out)
if __name__=="__main__": main()
