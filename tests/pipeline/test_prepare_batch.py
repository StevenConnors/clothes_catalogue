import contextlib
import hashlib
import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

from PIL import Image

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "prepare-batch.py"
spec = importlib.util.spec_from_file_location("prepare_batch", SCRIPT)
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class FakeModel:
    def __init__(self):
        self.sessions = 0
        self.empty = False

    def new_session(self, model, providers):
        self.sessions += 1
        assert model == "birefnet-general"
        assert providers == ["CPUExecutionProvider"]
        return object()

    def remove(self, image_bytes, session, only_mask):
        import io
        with Image.open(io.BytesIO(image_bytes)) as image:
            mask = Image.new("L", image.size, 0 if self.empty else 255)
            target = io.BytesIO(); mask.save(target, "PNG"); return target.getvalue()


class PrepareBatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_data = prepare.DATA
        prepare.DATA = Path(self.temp.name) / "wardrobe-data"
        self.incoming = prepare.DATA / "incoming" / "demo"
        self.incoming.mkdir(parents=True)
        self.model = FakeModel()
        self.old_module = sys.modules.get("rembg")
        sys.modules["rembg"] = types.SimpleNamespace(new_session=self.model.new_session, remove=self.model.remove)
        self.old_argv = sys.argv

    def tearDown(self):
        prepare.DATA = self.old_data
        sys.argv = self.old_argv
        if self.old_module is None: sys.modules.pop("rembg", None)
        else: sys.modules["rembg"] = self.old_module
        self.temp.cleanup()

    def image(self, name, color):
        Image.new("RGB", (40, 30), color).save(self.incoming / name, "JPEG")

    def run_cli(self, *args):
        sys.argv = [str(SCRIPT), "--batch", "demo", *args]
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            code = prepare.main()
        return code, output.getvalue()

    def manifest(self):
        return json.loads((prepare.DATA / "processed/demo/manifest.json").read_text())

    def test_limit_benchmark_dedup_rerun_reprocess_changed_input_and_unsupported(self):
        self.image("a.jpg", "red"); self.image("b.jpg", "blue"); self.image("c.jpg", "green")
        (self.incoming / "a-copy.jpg").write_bytes((self.incoming / "a.jpg").read_bytes())
        (self.incoming / "phone.heic").write_bytes(b"unsupported")
        code, output = self.run_cli("--limit", "3", "--benchmark")
        self.assertEqual(code, 0); self.assertIn("phone.heic", output)
        manifest = self.manifest(); self.assertEqual(len(manifest["entries"]), 3)
        self.assertEqual([e["sourcePath"] for e in manifest["entries"]], ["a-copy.jpg", "b.jpg", "c.jpg"])
        self.assertTrue(all(e["type"] is None and e["reviewStatus"] == "pending" for e in manifest["entries"]))
        for entry in manifest["entries"]:
            cutout = prepare.DATA / "processed/demo" / entry["cutoutPath"]
            with Image.open(cutout) as image: self.assertEqual((image.size, image.mode), ((1024, 1024), "RGBA"))
            source = self.incoming / entry["sourcePath"]
            self.assertEqual(entry["sourceSha256"], hashlib.sha256(source.read_bytes()).hexdigest())
        benchmark = json.loads((prepare.DATA / "processed/demo/benchmark.json").read_text())
        self.assertEqual(len(benchmark["processing"]), 3); self.assertIn("peakProcessMemoryBytes", benchmark)
        self.assertEqual(self.model.sessions, 1)

        manifest["entries"][0]["type"] = "shirt"; manifest["entries"][0]["reviewStatus"] = "approved"
        (prepare.DATA / "processed/demo/manifest.json").write_text(json.dumps(manifest))
        order = [e["sourceSha256"] for e in manifest["entries"]]
        code, _ = self.run_cli()
        self.assertEqual(code, 0); self.assertEqual(self.model.sessions, 1)
        self.assertEqual([e["sourceSha256"] for e in self.manifest()["entries"]], order)
        target_hash = manifest["entries"][0]["sourceSha256"]
        code, _ = self.run_cli("--reprocess", target_hash)
        self.assertEqual(code, 0); self.assertEqual(self.model.sessions, 2)
        refreshed = self.manifest()["entries"][0]
        self.assertEqual(refreshed["type"], "shirt"); self.assertEqual(refreshed["reviewStatus"], "pending")
        self.assertTrue(any("Approval reset" in warning for warning in refreshed["warnings"]))

        # Changed bytes produce a new entry appended without changing prior numbering.
        self.image("b.jpg", "yellow")
        code, _ = self.run_cli("--limit", "1")
        self.assertEqual(code, 0)
        changed = self.manifest()["entries"]
        self.assertEqual(len(changed), 4); self.assertEqual([e["sourceSha256"] for e in changed[:3]], order)

    def test_empty_mask_fails_entry_and_path_escape_is_rejected(self):
        self.image("one.jpg", "red")
        code, _ = self.run_cli("--limit", "1")
        self.assertEqual(code, 0)
        entry_hash = self.manifest()["entries"][0]["sourceSha256"]
        self.model.empty = True
        code, _ = self.run_cli("--reprocess", entry_hash)
        self.assertEqual(code, 0)
        failed = self.manifest()["entries"][0]
        self.assertIsNone(failed["cutoutPath"]); self.assertTrue(any("Preparation failed" in w for w in failed["warnings"]))
        manifest = self.manifest(); manifest["entries"][0]["sourcePath"] = "../../outside.jpg"
        (prepare.DATA / "processed/demo/manifest.json").write_text(json.dumps(manifest))
        code, output = self.run_cli()
        self.assertEqual(code, 2); self.assertIn("escapes", output)

    def test_review_sheet_numbers_entries_and_maps_current_hashes(self):
        self.image("review.jpg", "purple")
        code, _ = self.run_cli("--limit", "1")
        self.assertEqual(code, 0)
        review_path = Path(__file__).resolve().parents[2] / "scripts" / "review-sheet.py"
        review_spec = importlib.util.spec_from_file_location("review_sheet", review_path)
        review = importlib.util.module_from_spec(review_spec); review_spec.loader.exec_module(review)
        review.DATA = prepare.DATA
        sys.argv = [str(review_path), "--batch", "demo"]
        output = io.StringIO()
        with contextlib.redirect_stdout(output): code = review.main()
        self.assertEqual(code, 0)
        folder = prepare.DATA / "processed/demo"
        self.assertTrue((folder / "review-001.png").is_file())
        index = json.loads((folder / "review-index.json").read_text())
        self.assertEqual(index["entries"][0]["number"], 1)
        self.assertEqual(index["entries"][0]["sourceSha256"], self.manifest()["entries"][0]["sourceSha256"])


if __name__ == "__main__": unittest.main()
