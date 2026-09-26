import importlib.util
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "prepare-batch.py"
spec = importlib.util.spec_from_file_location("prepare_batch", SCRIPT)
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class TransformTests(unittest.TestCase):
    def test_separate_foreground_regions_preserved_and_fitted_square(self):
        photo = Image.new("RGB", (400, 200), "navy")
        mask = Image.new("L", photo.size, 0)
        draw = ImageDraw.Draw(mask)
        draw.rectangle((30, 30, 100, 170), fill=255)
        draw.rectangle((280, 50, 370, 150), fill=255)
        result, warnings = prepare.transform(photo, mask)
        self.assertEqual(result.size, (1024, 1024))
        self.assertEqual(result.mode, "RGBA")
        alpha = result.getchannel("A")
        self.assertGreater(alpha.getbbox()[2] - alpha.getbbox()[0], 500)
        # Both distant components must survive (sample points away from padded edges).
        self.assertGreater(alpha.getpixel((160, 500)), 0)
        self.assertGreater(alpha.getpixel((800, 500)), 0)

    def test_empty_mask_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "empty"):
            prepare.transform(Image.new("RGB", (20, 20), "red"), Image.new("L", (20, 20), 0))

    def test_exif_orientation_is_applied(self):
        import io
        exif = Image.Exif(); exif[274] = 6
        stream = io.BytesIO()
        Image.new("RGB", (40, 20), "red").save(stream, "JPEG", exif=exif)
        stream.seek(0)
        with Image.open(stream) as photo:
            mask = Image.new("L", (20, 40), 255)
            result, _ = prepare.transform(photo, mask)
        bounds = result.getchannel("A").getbbox()
        self.assertLess(bounds[2] - bounds[0], bounds[3] - bounds[1])


if __name__ == "__main__":
    unittest.main()
