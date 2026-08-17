"""
Turn the original cover photos into web-sized copies.

WHY THIS EXISTS
    The originals are camera/phone files - one of them is 90MB. Putting
    those straight on a web page would make it take minutes to load on
    a phone, and would bloat the repository. This shrinks each one to
    roughly the size it's actually displayed at.

HOW TO RUN IT (from the project folder)
    python tools/build_covers.py "C:\\Users\\ernes\\Downloads\\portfolio covers"

    Writes web-ready .jpg files into images/covers/ and prints a report.
    Re-run it any time you add more photos to the source folder.
"""
import re
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = None          # these files are huge; that's expected

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "images" / "covers"

# Quality-first settings.
#
# The tiles display around 350px wide, so 1400 is 4x that — enough to stay
# crisp on the sharpest phone screens, to survive being reused bigger on a
# gallery page later, and to tolerate the 3:4 crop eating into the frame.
COVER_W, COVER_H = 1400, 1867

# 92 is visually indistinguishable from the original for photographic
# content. SUBSAMPLING 0 means 4:4:4 — colour is stored at full resolution
# rather than being halved, which is what normally smears saturated edges
# (the embroidered fruit on that jacket is exactly the sort of thing that
# suffers). Costs bytes; that's the trade being made deliberately.
QUALITY = 92
SUBSAMPLING = 0


def slug(name: str) -> str:
    """A filename that's safe in a URL: lowercase, hyphens, no punctuation."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return re.sub(r"-+", "-", s)


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1
               else Path.home() / "Downloads" / "portfolio covers")
    if not src.is_dir():
        raise SystemExit(f"source folder not found: {src}")

    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in src.iterdir()
                   if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    if not files:
        raise SystemExit(f"no images found in {src}")

    before = after = 0
    for p in files:
        im = Image.open(p)
        # Phone photos carry a rotation flag instead of being rotated. Without
        # this, some would appear sideways on the page.
        im = ImageOps.exif_transpose(im)
        if im.mode != "RGB":
            im = im.convert("RGB")

        w, h = im.size
        # Scale so the photo still fully covers a 3:4 tile, but never enlarge
        # a small original (that would only add bytes, not detail).
        scale = min(1.0, max(COVER_W / w, COVER_H / h))
        if scale < 1.0:
            # LANCZOS is the highest-quality resampler Pillow offers. Going
            # straight from 8000px to 1400px in one step with it is sharper
            # than any staged downscale.
            im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)

        dest = OUT / (slug(p.stem) + ".jpg")
        # Baseline rather than progressive. Progressive JPEGs decode in
        # several passes, which is a nice touch on a slow connection but
        # is meaningfully slower to decode once the bytes have arrived —
        # and these are lazy-loaded grid thumbnails, not a hero image, so
        # there's no slow reveal to benefit from either way.
        im.save(dest, "JPEG", quality=QUALITY, subsampling=SUBSAMPLING,
                optimize=True, progressive=False)

        b, a = p.stat().st_size, dest.stat().st_size
        before += b
        after += a
        print(f"{p.name[:40]:42s} {w}x{h} -> {im.size[0]}x{im.size[1]}  "
              f"{b/1e6:7.1f}MB -> {a/1e6:5.2f}MB   {dest.name}")

    print(f"\n{len(files)} covers: {before/1e6:.1f}MB -> {after/1e6:.1f}MB "
          f"({after/before*100:.1f}% of original)")


if __name__ == "__main__":
    main()
