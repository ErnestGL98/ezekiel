"""
Prepare a shoot's photos for its own gallery page.

HOW TO RUN IT (from the project folder)
    python tools/build_gallery.py apotts-aw22-skinfolk --newest 6
    python tools/build_gallery.py apotts-aw22-skinfolk IMG_7818.WEBP IMG_7820.WEBP
    python tools/build_gallery.py apotts-aw22-skinfolk --append --newest 2

    --newest N takes the N most recently downloaded images. Naming the
    files explicitly is safer if anything else has landed in Downloads
    since. Either way they are sorted by filename, which for camera
    exports is shoot order.

    --append carries on from the highest number already in the folder
    instead of starting at 01, so photos added later join the end of the
    gallery rather than renumbering everything ahead of them.

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

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = Path.home() / 'Downloads'
DEST_ROOT = ROOT / 'images' / 'galleries'

MAX_W = 1200      # displayed around 380px in a three-across grid
QUALITY = 82

EXTS = {'.webp', '.jpg', '.jpeg', '.png', '.heic', '.tif', '.tiff'}


def trim_white_frame(im):
    """Strip a border that was baked into the export.

    ONLY when it is even on all four sides and genuinely white. These are
    shot on a white backdrop, so a margin on one or two sides is the
    studio floor, not a frame, and trimming that would cut into the
    picture. An even border on all four is somebody's export template.
    """
    a = np.asarray(im.convert('RGB')).astype(int)

    def run(vals):
        for i, v in enumerate(vals):
            if v < 246:
                return i
        return len(vals)

    rows, cols = a.mean(axis=(1, 2)), a.mean(axis=(0, 2))
    t, b = run(rows), run(rows[::-1])
    l, r = run(cols), run(cols[::-1])

    even = max(t, b, l, r) - min(t, b, l, r) <= 3
    if min(t, b, l, r) > 4 and even and a[0, 0].min() >= 250:
        return im.crop((l, t, im.width - r, im.height - b)), (l, t, r, b)
    return im, None


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

    append = '--append' in rest
    rest = [a for a in rest if a != '--append']

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

    first = 1
    if append:
        existing = sorted(dest.glob('*.webp'))
        if existing:
            first = int(existing[-1].stem) + 1

    for i, src in enumerate(sources, first):
        im = ImageOps.exif_transpose(Image.open(src))
        out = dest / f'{i:02d}.webp'

        im, trimmed = trim_white_frame(im)
        note = ''

        if im.width <= MAX_W and src.suffix.lower() == '.webp' and not trimmed:
            shutil.copyfile(src, out)          # already right; don't touch it
            note = 'copied'
        else:
            if im.width > MAX_W:
                im = im.resize((MAX_W, round(im.height * MAX_W / im.width)),
                               Image.LANCZOS)
            im.convert('RGB').save(out, 'WEBP', quality=QUALITY, method=6)
            note = 're-encoded'

        if trimmed:
            note += f' (trimmed a {trimmed[0]}px white frame)'

        print(f'{src.name[:24]:26s} -> {slug}/{out.name}  '
              f'{im.size[0]}x{im.size[1]}  {out.stat().st_size / 1000:5.0f}KB  {note}')

    total = sum(p.stat().st_size for p in dest.glob('*.webp'))
    print(f'\n{len(sources)} photos, {total / 1e6:.2f}MB in '
          f'{dest.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
