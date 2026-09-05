"""
test_asset_pipeline_v2.py — 针对 asset-pipeline-v2.py 的完整单元测试
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
CLI_PATH = SCRIPT_DIR / "asset-pipeline-v2.py"


def has_pil():
    try:
        import PIL
        return True
    except ImportError:
        return False


def create_synthetic_raw_image(path: Path, count: int = 3):
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (128, 128), (255, 0, 255, 255))
    draw = ImageDraw.Draw(img)

    if count == 1:
        draw.rectangle([32, 32, 96, 96], fill=(50, 150, 200, 255))
    elif count <= 3:
        cell_h = 128 // count
        for i in range(count):
            y0 = i * cell_h + 8
            y1 = (i + 1) * cell_h - 8
            draw.rectangle([32, y0, 96, y1], fill=(40 * i + 30, 100 + 20 * i, 150, 255))
    img.save(path)


class TestAssetPipelineV2(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="test_asset_pipeline_"))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_prepare_item_front_view(self):
        out_dir = self.tmp_dir / "key"
        cmd = [
            sys.executable,
            str(CLI_PATH),
            "prepare",
            "--lane", "component",
            "--id", "old-key",
            "--type", "item-tool",
            "--desc", "brass door key",
            "--states", "single",
            "--out", str(out_dir),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"prepare failed: {res.stderr}")

        job_file = out_dir / "job.v2.json"
        self.assertTrue(job_file.exists())
        job_data = json.loads(job_file.read_text(encoding="utf-8"))
        self.assertEqual(job_data["schemaVersion"], "2.0")
        self.assertEqual(job_data["perspective"], "front view")
        self.assertIn("FRONT VIEW", job_data["prompt"])

    def test_prepare_environment_reference_crop(self):
        out_dir = self.tmp_dir / "door"
        crop_path = "run/sample-map/crops/door_subway_45.png"
        cmd = [
            sys.executable,
            str(CLI_PATH),
            "prepare",
            "--lane", "component",
            "--id", "door-subway-45",
            "--type", "environment",
            "--desc", "slanted subway security gate",
            "--states", "closed,cracked,open",
            "--reference-crop", crop_path,
            "--out", str(out_dir),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"prepare failed: {res.stderr}")

        job_file = out_dir / "job.v2.json"
        self.assertTrue(job_file.exists())
        job_data = json.loads(job_file.read_text(encoding="utf-8"))
        self.assertEqual(job_data["perspective"], "front-top axonometric view")
        self.assertEqual(job_data["referenceCrop"], crop_path)
        self.assertIn("Derive strictly from the supplied reference crop", job_data["prompt"])
        self.assertEqual(job_data["states"], ["closed", "cracked", "open"])

    def test_finalize_end_to_end(self):
        if not has_pil():
            self.skipTest("PIL not installed in current environment")

        out_dir = self.tmp_dir / "crate"
        cmd_prep = [
            sys.executable,
            str(CLI_PATH),
            "prepare",
            "--lane", "component",
            "--id", "wooden-crate",
            "--type", "environment",
            "--desc", "wooden supply crate",
            "--states", "closed,cracked,open",
            "--out", str(out_dir),
        ]
        subprocess.run(cmd_prep, check=True)

        raw_path = out_dir / "raw.png"
        create_synthetic_raw_image(raw_path, count=3)

        cmd_fin = [
            sys.executable,
            str(CLI_PATH),
            "finalize",
            "--out", str(out_dir),
        ]
        res = subprocess.run(cmd_fin, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"finalize failed: {res.stderr}")

        manifest_file = out_dir / "manifest.v2.json"
        self.assertTrue(manifest_file.exists())
        manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))

        self.assertEqual(manifest_data["schemaVersion"], "2.0")
        self.assertEqual(manifest_data["id"], "wooden-crate")
        self.assertEqual(manifest_data["status"], "pending-human-review")
        self.assertEqual(manifest_data["qc"]["status"], "passed")
        self.assertEqual(len(manifest_data["frames"]), 3)

        for frame in manifest_data["frames"]:
            self.assertTrue((out_dir / frame["file"]).exists())
            self.assertEqual(len(frame["sha256"]), 64)
            self.assertEqual(frame["width"], 64)
            self.assertEqual(frame["height"], 64)

    def test_registry_aggregation(self):
        out_dir = self.tmp_dir / "sample_item"
        out_dir.mkdir(parents=True, exist_ok=True)
        manifest_data = {
            "schemaVersion": "2.0",
            "id": "sample-item",
            "lane": "component",
            "componentType": "item-tool",
            "description": "sample tool",
            "status": "ready",
            "states": ["single"],
            "frames": [
                {
                    "name": "single",
                    "file": "frames/single.png",
                    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                    "width": 64,
                    "height": 64,
                }
            ],
            "qc": {
                "status": "passed",
                "checks": [{"check": "frame_count", "passed": True}],
            },
            "provenance": {
                "jobId": "job-sample-item",
                "tool": "asset-pipeline-v2.py",
                "generatedAt": "2026-09-05T00:00:00Z",
            },
        }
        (out_dir / "manifest.v2.json").write_text(json.dumps(manifest_data, indent=2), encoding="utf-8")

        reg_out = self.tmp_dir / "registry.v2.json"
        cmd_reg = [
            sys.executable,
            str(CLI_PATH),
            "registry",
            "--dir", str(self.tmp_dir),
            "--out", str(reg_out),
        ]
        res = subprocess.run(cmd_reg, capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, f"registry failed: {res.stderr}")

        self.assertTrue(reg_out.exists())
        reg_data = json.loads(reg_out.read_text(encoding="utf-8"))
        self.assertEqual(reg_data["schemaVersion"], "2.0")
        self.assertGreaterEqual(reg_data["totalReadyCount"], 1)
        self.assertTrue(any(a["id"] == "sample-item" for a in reg_data["assets"]))


if __name__ == "__main__":
    unittest.main()
