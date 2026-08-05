"""
Rebuild EzekielHand from the photo of the handwritten alphabet.

WHAT THIS DOES
    Reads  fonts/source-handwriting.jpg   (photo of the A-Z / a-z sheet)
    Writes fonts/EzekielHand.woff2        (what the website actually loads)
           fonts/EzekielHand.ttf          (fallback + for installing locally)

HOW TO RUN IT (from the project folder, in PowerShell)
    python -m pip install pillow numpy scipy scikit-image fonttools brotli
    python tools/build_font.py

WHEN YOU'D NEED THIS
    - You reshoot the alphabet and want the font rebuilt from the new photo
    - You want the letters thicker or thinner: change BOLDEN_PX below
      (higher = bolder). Everything else can stay as-is.

HOW IT WORKS, IN PLAIN TERMS
    1. Flatten the photo's uneven lighting so ink/paper separate cleanly
    2. Straighten the page, then find every blob of ink
    3. Group the blobs into 4 text rows, then into 52 individual letters
    4. Work out where each row's baseline sits, so letters line up properly
    5. Thicken each letter slightly, then trace its outline into vectors
    6. Write those outlines into a real font file
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
from skimage import measure
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

sys.setrecursionlimit(20000)

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "fonts" / "source-handwriting.jpg"
FONTS = ROOT / "fonts"

# --- knobs you might reasonably want to touch ---
BOLDEN_PX = 2        # stroke thickening; higher = bolder letters
CAP_TARGET = 700     # cap height in font units (out of 1000)
SIDE_BEARING = 0.055  # breathing room each side of a letter, as a fraction of em

# --- knobs you probably shouldn't ---
UPM = 1000
SS = 4               # supersampling, for sub-pixel control of the thickening
RDP_TOL = 2.0        # outline simplification tolerance
CROP = (0.30, 0.72)  # vertical slice of the photo holding the writing

LETTERS = {0: "AaBbCcDdEeFf", 1: "GgHhIiJjKkLlMm",
           2: "NnOoPpQqRrSsTt", 4: "UuVvWwXxYyZz"}
DESCENDERS = set("gjpqy")


def find_ink():
    """Photo -> clean, straightened black-and-white mask of just the ink."""
    img = Image.open(SRC)
    W, H = img.size
    g = img.convert("L").crop((0, int(H * CROP[0]), W, int(H * CROP[1])))

    # divide out a blurred copy to cancel the shadow gradient across the page
    bg = g.filter(ImageFilter.GaussianBlur(radius=40))
    flat = np.clip(np.asarray(g, np.float32) /
                   np.maximum(np.asarray(bg, np.float32), 1) * 255, 0, 255)
    ink = flat < 205

    # drop dust specks
    lab, n = ndimage.label(ink)
    sizes = ndimage.sum(ink, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:][sizes >= 30] = True
    ink = keep[lab]

    # straighten: the angle whose horizontal ink projection is most peaky
    best, best_score = 0.0, -1.0
    for ang in np.arange(-6, 6.01, 0.25):
        r = ndimage.rotate(ink.astype(np.float32), ang, reshape=False, order=1)
        s = float(np.var(r.sum(axis=1)))
        if s > best_score:
            best, best_score = float(ang), s
    print(f"straightened by {best:+.2f} deg")
    return ndimage.rotate(ink.astype(np.float32), best, reshape=False, order=1) > 0.5


def find_rows_and_glyphs(ink):
    """Split the ink into text rows, then into individual letter boxes."""
    proj = ink.sum(axis=1)
    on = proj > proj.max() * 0.04
    rows, y = [], 0
    while y < len(on):
        if on[y]:
            y0 = y
            while y < len(on) and on[y]:
                y += 1
            if y - y0 > 15:
                rows.append((y0, y))
        else:
            y += 1

    lab, n = ndimage.label(ink)
    boxes = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        ys, xs = sl
        boxes.append([xs.start, ys.start, xs.stop, ys.stop])

    out = []
    for ry0, ry1 in rows:
        inrow = sorted((b for b in boxes
                        if ry0 - 12 <= (b[1] + b[3]) / 2 <= ry1 + 12),
                       key=lambda b: b[0])
        merged = []
        for b in inrow:
            if merged:  # glue i/j dots onto their stems
                p = merged[-1]
                overlap = min(p[2], b[2]) - max(p[0], b[0])
                if overlap > 0.55 * min(p[2] - p[0], b[2] - b[0]):
                    p[0], p[1] = min(p[0], b[0]), min(p[1], b[1])
                    p[2], p[3] = max(p[2], b[2]), max(p[3], b[3])
                    continue
            merged.append(list(b))
        out.append(merged)
    return out


def rdp(pts, tol):
    """Ramer-Douglas-Peucker: drop points that don't change the shape."""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    n = float(np.hypot(*ab))
    if n == 0:
        d = np.hypot(*(pts - a).T)
    else:
        rel = pts - a
        d = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / n
    i = int(np.argmax(d))
    if d[i] > tol:
        return np.vstack([rdp(pts[:i + 1], tol)[:-1], rdp(pts[i:], tol)])
    return np.vstack([a, b])


def signed_area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def main():
    ink = find_ink()
    rows = find_rows_and_glyphs(ink)

    lab, _ = ndimage.label(ink)
    slices = ndimage.find_objects(lab)

    def only_this_glyph(box):
        """Ink inside this box ONLY - stops neighbouring letters bleeding in."""
        x0, y0, x1, y1 = box
        m = np.zeros_like(ink)
        for ci, sl in enumerate(slices, start=1):
            if sl is None:
                continue
            ys, xs = sl
            sub = lab[ys, xs] == ci
            iy0, iy1 = max(ys.start, y0), min(ys.stop, y1)
            ix0, ix1 = max(xs.start, x0), min(xs.stop, x1)
            if iy0 >= iy1 or ix0 >= ix1:
                continue
            if (lab[iy0:iy1, ix0:ix1] == ci).sum() / max(int(sub.sum()), 1) > 0.5:
                m[ys, xs] |= sub
        return m

    # baseline + cap height per row, which cancels the photo's perspective
    meta = {}
    for ri, letters in LETTERS.items():
        boxes = rows[ri][:len(letters)]
        if len(boxes) < len(letters):
            raise SystemExit(f"row {ri}: found {len(boxes)} letters, expected "
                             f"{len(letters)} - is the photo cropping any off?")
        ups = [b for i, b in enumerate(boxes) if i % 2 == 0]
        baseline = float(np.median([b[3] for b in ups]))
        cap = float(np.median([baseline - b[1] for b in ups]))
        for ch, b in zip(letters, boxes):
            meta[ch] = (b, baseline, CAP_TARGET / cap, cap)

    glyphs, widths = {}, {}
    for ch, (box, baseline, scale, cap) in sorted(meta.items()):
        m = only_this_glyph(box)
        ys, xs = np.where(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1

        # sit on the baseline unless it's a genuine descender (g j p q y)
        drop = (y1 - baseline) / cap
        base = baseline if (ch in DESCENDERS and drop > 0.08) else float(y1)

        sub = m[y0:y1, x0:x1]
        big = np.repeat(np.repeat(sub, SS, axis=0), SS, axis=1)
        big = ndimage.binary_dilation(
            big, ndimage.generate_binary_structure(2, 2), iterations=BOLDEN_PX)

        polys = []
        for c in measure.find_contours(np.pad(big.astype(float), 2), 0.5):
            px = ((c[:, 1] - 2) / SS + x0) * scale
            py = (base - ((c[:, 0] - 2) / SS + y0)) * scale
            p = rdp(np.column_stack([px, py]), RDP_TOL)
            if len(p) >= 4:
                polys.append(p)
        if not polys:
            print("  !! no outline for", ch)
            continue

        polys.sort(key=lambda p: -abs(signed_area(p)))
        outer = np.sign(signed_area(polys[0]))
        pen = TTGlyphPen(None)
        for i, p in enumerate(polys):
            if np.sign(signed_area(p)) != (outer if i == 0 else -outer):
                p = p[::-1]
            pen.moveTo((float(p[0][0]), float(p[0][1])))
            for pt in p[1:-1]:
                pen.lineTo((float(pt[0]), float(pt[1])))
            pen.closePath()
        glyphs[ch] = pen.glyph()
        allx = np.concatenate([p[:, 0] for p in polys])
        widths[ch] = int(round(allx.max() - allx.min() + 2 * SIDE_BEARING * UPM))

    print(f"traced {len(glyphs)} letters")

    names = {c: f"uni{ord(c):04X}" for c in glyphs}
    empty = TTGlyphPen(None).glyph()
    gl = {".notdef": empty, "space": empty}
    mt = {".notdef": (int(0.35 * UPM), 0), "space": (int(0.30 * UPM), 0)}
    cmap = {0x20: "space"}
    for c in sorted(glyphs):
        gl[names[c]] = glyphs[c]
        mt[names[c]] = (widths[c], 0)
        cmap[ord(c)] = names[c]

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder([".notdef", "space"] + [names[c] for c in sorted(glyphs)])
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(gl)
    fb.setupHorizontalMetrics(mt)
    fb.setupHorizontalHeader(ascent=800, descent=-250)
    fb.setupNameTable({"familyName": "Ezekiel Hand", "styleName": "Regular",
                       "psName": "EzekielHand-Regular", "version": "1.0"})
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-250, usWinAscent=950,
                usWinDescent=300, sxHeight=int(CAP_TARGET * 0.52),
                sCapHeight=CAP_TARGET)
    fb.setupPost()
    fb.save(FONTS / "EzekielHand.ttf")

    f = TTFont(FONTS / "EzekielHand.ttf")
    f.flavor = "woff2"
    f.save(FONTS / "EzekielHand.woff2")
    print("wrote fonts/EzekielHand.ttf and fonts/EzekielHand.woff2")


if __name__ == "__main__":
    main()
