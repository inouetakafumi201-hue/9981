"""
pytest suite for map-region-extract.
Run with: npm run test:python

The implementation file is `map-region-extract.py` (hyphenated name, not a
Python-importable module).  We load it via importlib.spec_from_file_location
so the test suite can use pytest fixtures (e.g. `tmp_path`) while still
exercising the real tool entry point without copying code.
"""
import importlib.util
from pathlib import Path
from types import ModuleType

from PIL import Image


def _load_tool() -> ModuleType:
    tool = Path(__file__).with_name("map-region-extract.py")
    spec = importlib.util.spec_from_file_location("map_region_extract", tool)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_extract_preserves_rectangular_size_and_pixels(tmp_path: Path) -> None:
    """Region PNG dimensions match normalized_frame; source pixels survive crop."""
    m = _load_tool()
    src = tmp_path / "source.png"
    img = Image.new("RGBA", (40, 30), (1, 2, 3, 255))
    img.putpixel((10, 14), (255, 0, 0, 255))
    img.save(src)

    d = {
        "schema": m.SCHEMA,
        "source": {"image": str(src)},
        "regions": [{
            "id": "r",
            "building_group": "g",
            "bbox": [8, 10, 12, 7],
            "shell": {},
            "floor": {},
            "normalized_frame": {"width": 12, "height": 7},
            "entrance_anchors": [],
            "stair_anchors": [],
            "view": "top-down-plan",
        }],
    }

    out = tmp_path / "out"
    result = m.crop_extract(d, out)
    got = Image.open(out / "r.png")

    assert got.size == (12, 7)
    assert got.getpixel((2, 4)) == (255, 0, 0, 255)
    assert result["regions"][0]["size"] == {"width": 12, "height": 7}


def test_invalid_and_qc_warning() -> None:
    """isometric / text-detected regions trigger QC warnings without blocking extract.

    QC fires on text-prohibited content, dynamic-objects, and non-top-down view —
    three independent checks.  The important invariant is: validate returns []
    (no errors) while _warnings is non-empty (QC fired).
    """
    m = _load_tool()
    d = {
        "schema": m.SCHEMA,
        "source": {"image": "x.png"},
        "regions": [{
            "id": "r",
            "building_group": "g",
            "bbox": [0, 0, 1, 1],
            "shell": {},
            "floor": {},
            "normalized_frame": {"width": 1, "height": 1},
            "view": "isometric",
            "text_detected": True,
        }],
    }

    assert m.validate(d) == []
    assert len(d["_warnings"]) >= 2, f"expected >=2 QC warnings, got {d['_warnings']}"
    text_warnings = [w for w in d["_warnings"] if "prohibited content" in w]
    view_warnings = [w for w in d["_warnings"] if "top-down" in w]
    assert text_warnings, "expected text-prohibited QC warning"
    assert view_warnings, "expected non-top-down view QC warning"


def test_rejects_bbox_outside_source(tmp_path: Path) -> None:
    """bbox that overflows source image must fail validation when image_size is given."""
    m = _load_tool()
    src = tmp_path / "source.png"
    Image.new("RGBA", (10, 10), (0, 0, 0, 255)).save(src)
    d = {
        "schema": m.SCHEMA,
        "source": {"image": str(src)},
        "regions": [{
            "id": "too-big",
            "building_group": "g",
            "bbox": [5, 5, 200, 200],
            "shell": {},
            "floor": {},
            "normalized_frame": {"width": 200, "height": 200},
            "entrance_anchors": [],
            "stair_anchors": [],
            "view": "top-down-plan",
        }],
    }
    errors = m.validate(d, (10, 10))
    assert any("outside source" in e for e in errors)


def test_rejects_duplicate_region_id(tmp_path: Path) -> None:
    """Same id used twice -> diagnostic in the error list."""
    m = _load_tool()
    src = tmp_path / "source.png"
    Image.new("RGBA", (20, 20), (0, 0, 0, 255)).save(src)
    d = {
        "schema": m.SCHEMA,
        "source": {"image": str(src)},
        "regions": [
            {
                "id": "dup", "building_group": "g", "bbox": [0, 0, 4, 4],
                "shell": {}, "floor": {}, "normalized_frame": {"width": 4, "height": 4},
                "entrance_anchors": [], "stair_anchors": [], "view": "top-down-plan",
            },
            {
                "id": "dup", "building_group": "g", "bbox": [8, 8, 4, 4],
                "shell": {}, "floor": {}, "normalized_frame": {"width": 4, "height": 4},
                "entrance_anchors": [], "stair_anchors": [], "view": "top-down-plan",
            },
        ],
    }
    errors = m.validate(d, (20, 20))
    assert any("duplicate" in e for e in errors)


def test_rejects_wrong_schema() -> None:
    """Documents with unknown schema must be rejected."""
    m = _load_tool()
    d = {"schema": "wrong", "source": {"image": "x.png"}, "regions": []}
    errors = m.validate(d)
    assert any("schema" in e for e in errors)


def test_author_pass_preserves_pixels_outside_mask(tmp_path: Path) -> None:
    """Author-pass overlay changes only the region area; pixels outside every bbox stay intact."""
    m = _load_tool()
    src = tmp_path / "source.png"
    base = Image.new("RGBA", (16, 16), (10, 20, 30, 255))
    base.save(src)

    edited = Image.new("RGBA", (16, 16), (10, 20, 30, 255))
    for y in range(2, 6):
        for x in range(2, 6):
            edited.putpixel((x, y), (200, 0, 0, 255))
    edit_path = tmp_path / "edit.png"
    edited.save(edit_path)

    d = {
        "schema": m.SCHEMA,
        "source": {"image": str(src), "author_pass": str(edit_path)},
        "regions": [{
            "id": "r", "building_group": "g", "bbox": [2, 2, 4, 4],
            "shell": {}, "floor": {},
            "normalized_frame": {"width": 4, "height": 4},
            "entrance_anchors": [], "stair_anchors": [],
            "view": "top-down-plan",
        }],
    }
    out = tmp_path / "composed.png"
    m.author_pass(d, out)
    comp = Image.open(out).convert("RGBA")

    # Outside the region bbox must equal the original source
    assert comp.getpixel((0, 0)) == base.getpixel((0, 0))
    assert comp.getpixel((15, 15)) == base.getpixel((15, 15))
    # Inside the region must equal the author-pass overlay
    assert comp.getpixel((3, 3)) == (200, 0, 0, 255)
