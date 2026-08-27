import json
from pathlib import Path
from PIL import Image
import importlib.util
TOOL = Path(__file__).with_name('map-region-extract.py')
spec=importlib.util.spec_from_file_location('m', TOOL); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

def test_extract_preserves_rectangular_size_and_pixels(tmp_path):
    src=tmp_path/'source.png'; img=Image.new('RGBA',(40,30),(1,2,3,255)); img.putpixel((10,14),(255,0,0,255)); img.save(src)
    d={"schema":m.SCHEMA,"source":{"image":str(src)},"regions":[{"id":"r","building_group":"g","bbox":[8,10,12,7],"shell":{},"floor":{},"normalized_frame":{"width":12,"height":7},"entrance_anchors":[],"stair_anchors":[],"view":"top-down-plan"}]}
    out=tmp_path/'out'; result=m.crop_extract(d,out)
    got=Image.open(out/'r.png'); assert got.size==(12,7); assert got.getpixel((2,4))==(255,0,0,255); assert result['regions'][0]['size']=={'width':12,'height':7}

def test_invalid_and_qc_warning():
    d={"schema":m.SCHEMA,"source":{"image":"x.png"},"regions":[{"id":"r","building_group":"g","bbox":[0,0,1,1],"shell":{},"floor":{},"normalized_frame":{"width":1,"height":1},"view":"isometric","text_detected":True}]}
    assert m.validate(d)==[]; assert len(d['_warnings'])==2
