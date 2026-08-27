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
    if isinstance(a, dict) and "x" in a and "y" in a:
        return {"x": int(a["x"]), "y": int(a["y"]), "kind": a.get("kind", "unknown")}
    raise ValueError("anchor requires x and y")

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
            if not r.get("normalized_frame"): errors.append(f"regions[{i}] normalized_frame is required")
            for key in ("entrance_anchors","stair_anchors"):
                for a in r.get(key,[]): _anchor(a,b)
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
    outside=ImageChops.difference(diff, Image.new("RGBA", base.size, (0,0,0,0)))
    for y in range(base.height):
        for x in range(base.width):
            if mask.getpixel((x,y)) == 0 and result.getpixel((x,y)) != base.getpixel((x,y)):
                raise AssertionError(f"author-pass changed pixel outside mask at {(x,y)}")
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
