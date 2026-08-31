"""
Crop the Paris portrait to a square and shrink it for the web.

The photo that goes in the middle of the (b).stroy Paris block has to be
1:1, because it is laid over the point where four rectangles meet and any
other shape would read as a mistake rather than a decision.

HOW TO RUN IT (from the project folder)
    python tools/build_portrait.py

    Writes images/looks/bstroy-paris-portrait.jpg from the source named in
    SRC below — the third of the three Paris stills, the one that wasn't
    used in the grid. Pass a path as the first argument to use a different
    photo.

WHY THE CROP IS BIASED UPWARDS
    A centred square through a portrait takes equal bites off the top and
    the bottom, which on a head-and-shoulders shot means slicing the top of
    the head. VBIAS says how far down the leftover height to sit: 0 keeps
    the very top, 0.5 is dead centre. It is 0 here because the hood in this
    photo starts about 45 pixels from the top edge — even a small bias
    shaves it — so the whole 360 pixels of slack comes off the chest, where
    there is nothing to lose. Pass a second argument to override, e.g.
        python tools/build_portrait.py "<photo>.jpg" 0.25
"""
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'images' / 'looks' / 'bstroy-paris-portrait.jpg'
SRC = Path.home() / 'Downloads' / '(b).stroy Paris fw3.jpg'

SIZE = 900        # displayed around 230px, so this is 3x even on a dense
                  # screen. Cheap at this file size and it means the crop
                  # can be re-tuned later without going back to the source.
QUALITY = 92
VBIAS = 0.0       # see the note above


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SRC
    if not src.exists():
        sys.exit(f'no such file: {src}')
    bias = float(sys.argv[2]) if len(sys.argv) > 2 else VBIAS

    # exif_transpose first: phone photos carry their rotation as a tag
    # rather than in the pixels, and cropping before honouring it would
    # take the square out of the wrong edge
    im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
    w, h = im.size
    print(f'source {w}x{h}')

    side = min(w, h)
    left = (w - side) // 2                      # centred horizontally
    top = int((h - side) * bias)                # biased up vertically
    im = im.crop((left, top, left + side, top + side))
    print(f'cropped to {side}x{side} at ({left}, {top}), vbias {bias}')

    # LANCZOS is the slow, sharp resampler — the same one build_covers.py
    # uses. The difference shows on fabric texture and stitching.
    im = im.resize((SIZE, SIZE), Image.LANCZOS)

    DEST.parent.mkdir(parents=True, exist_ok=True)
    # subsampling=0 keeps full colour resolution (4:4:4). JPEG normally
    # throws away three quarters of the colour detail, which is exactly
    # what smears a saturated edge like the orange against the green.
    im.save(DEST, 'JPEG', quality=QUALITY, subsampling=0, optimize=True)
    print(f'wrote {DEST.relative_to(ROOT)}  '
          f'{DEST.stat().st_size / 1000:.0f}KB')


if __name__ == '__main__':
    main()
