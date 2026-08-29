from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).parent

def load(name: str, file: str):
    spec = spec_from_file_location(name, ROOT / file)
    module = module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_inp2_repair_is_deterministic(tmp_path: Path):
    tool = load("inp2_fix", "inp2-fix.py")
    source = tmp_path / "source.png"
    Image.new("RGBA", (3, 3), (12, 34, 56, 255)).save(source)
    a, b = tmp_path / "a.png", tmp_path / "b.png"
    tool.repair(source, a, 6, 6, 8)
    tool.repair(source, b, 6, 6, 8)
    assert a.read_bytes() == b.read_bytes()


def test_zone_split_stitch_round_trip(tmp_path: Path):
    tool = load("zone_pipeline", "map-pipeline-iterate.py")
    source = tmp_path / "source.png"
    image = Image.new("RGBA", (4, 4))
    image.putdata([(x * 40, y * 40, 10, 255) for y in range(4) for x in range(4)])
    image.save(source)
    parts, output = tmp_path / "parts", tmp_path / "output.png"
    tool.split(source, parts, 2, 2)
    tool.stitch(parts, output, 2, 2)
    assert list(Image.open(source).getdata()) == list(Image.open(output).getdata())
