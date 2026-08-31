"""
Prepare a shoot's photos for its own gallery page.

HOW TO RUN IT (from the project folder)
    python tools/build_gallery.py apotts-aw22-skinfolk --newest 6
    python tools/build_gallery.py apotts-aw22-skinfolk IMG_7818.WEBP IMG_7820.WEBP

    --newest N takes the N most recently downloaded images. Naming the
    files explicitly is safer if anything else has landed in Downloads
    since. Either way they are sorted by filename, which for camera
    exports is shoot order.

    Writes images/galleries/<slug>/01.webp, 02.webp, ...

WHY IT MOSTLY JUST COPIES
    These arrive already web-sized and already lossy. Re-encoding a
    960px WEBP would cost quality and, at these settings, gain nothing —
    a JPEG of the same picture came out roughly twice the size. So a file
    that is already small enough is copied byte-for-byte, and only
    oversized ones are actually re-encoded.
"""
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = Path.home() / 'Downloads'
DEST_ROOT = ROOT / 'images' / 'galleries'

MAX_W = 1200      # displayed around 380px in a three-across grid
QUALITY = 82

EXTS = {'.webp', '.jpg', '.jpeg', '.png', '.heic', '.tif', '.tiff'}


def newest(n):
    files = [p for p in SRC.iterdir()
             if p.is_file() and p.suffix.lower() in EXTS]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return sorted(files[:n], key=lambda p: p.name.lower())


def main():
    if len(sys.argv) < 3:
        sys.exit('usage: build_gallery.py <slug> --newest N | <file> [file...]')

    slug = sys.argv[1]
    rest = sys.argv[2:]

    if rest[0] == '--newest':
        sources = newest(int(rest[1]))
    else:
        sources = sorted((SRC / f if not Path(f).is_absolute() else Path(f))
                         for f in rest)

    missing = [p for p in sources if not p.exists()]
    if missing:
        sys.exit('no such file: ' + ', '.join(str(m) for m in missing))

    dest = DEST_ROOT / slug
    dest.mkdir(parents=True, exist_ok=True)

    for i, src in enumerate(sources, 1):
        im = ImageOps.exif_transpose(Image.open(src))
        out = dest / f'{i:02d}.webp'

        if im.width <= MAX_W and src.suffix.lower() == '.webp':
            shutil.copyfile(src, out)          # already right; don't touch it
            note = 'copied'
        else:
            if im.width > MAX_W:
                im = im.resize((MAX_W, round(im.height * MAX_W / im.width)),
                               Image.LANCZOS)
            im.convert('RGB').save(out, 'WEBP', quality=QUALITY, method=6)
            note = 're-encoded'

        print(f'{src.name[:24]:26s} -> {slug}/{out.name}  '
              f'{im.size[0]}x{im.size[1]}  {out.stat().st_size / 1000:5.0f}KB  {note}')

    total = sum(p.stat().st_size for p in dest.glob('*.webp'))
    print(f'\n{len(sources)} photos, {total / 1e6:.2f}MB in '
          f'{dest.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
