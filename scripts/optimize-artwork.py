"""Optional development asset pipeline: Pillow, never a production dependency.

Re-encode opaque artwork as lossless WebP and transparent artwork as optimized
PNG, retaining dimensions, colour profiles and every decoded RGBA byte.
Original PNGs remain available. Browser pixel verification is also required.
"""
from pathlib import Path
import hashlib
import json
from PIL import Image

root = Path(__file__).resolve().parents[1]
names = ["little-feet-mascot-hq", "sidebar-penguin-hq", "tour-platform-operations",
         "tour-secure-administration", "tour-finance-facilities", "tour-safety-communications"]
records = []
for name in names:
    source = root / "assets" / "4k" / (name + ".png")
    with Image.open(source) as original:
        pixels = original.convert("RGBA")
        transparent = pixels.getchannel("A").getextrema()[0] < 255
        target = source.with_name(name + ".optimized.png") if transparent else source.with_suffix(".webp")
        options = {"optimize": True, "compress_level": 9} if transparent else {"lossless": True, "exact": True, "quality": 100, "method": 6}
        if original.info.get("icc_profile"):
            options["icc_profile"] = original.info["icc_profile"]
        pixels.save(target, "PNG" if transparent else "WEBP", **options)
        with Image.open(target) as encoded:
            assert encoded.size == original.size
            assert encoded.convert("RGBA").tobytes() == pixels.tobytes(), name + " changed pixels"
            assert encoded.info.get("icc_profile") == original.info.get("icc_profile"), name + " changed colour profile"
        assert target.stat().st_size < source.stat().st_size, name + " failed to shrink"
        records.append({"source": source.relative_to(root).as_posix(), "target": target.relative_to(root).as_posix(),
                        "width": original.width, "height": original.height,
                        "pixelSha256": hashlib.sha256(pixels.tobytes()).hexdigest(),
                        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                        "targetSha256": hashlib.sha256(target.read_bytes()).hexdigest(),
                        "beforeBytes": source.stat().st_size, "afterBytes": target.stat().st_size})
        print(name, source.stat().st_size, "->", target.stat().st_size, "identical RGBA pixels")
(root / "tests" / "fixtures" / "lossless-artwork.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
