"""
Rebuild EzekielHand from the photo of the handwritten alphabet.

WHAT THIS DOES
    Reads  fonts/source-handwriting.jpg   (photo of the A-Z / a-z sheet)
    Writes fonts/EzekielHand.woff2        (the normal weight)
           fonts/EzekielHand-Bold.woff2   (a genuinely heavier cut)
           plus .ttf versions of both

    Both weights are traced from the SAME handwriting. The bold one
    isn't the browser smearing the normal one — it's the real letter
    outlines pushed further outward, the way a thicker pen would.

HOW TO RUN IT (from the project folder, in PowerShell)
    python -m pip install pillow numpy scipy scikit-image fonttools brotli
    python tools/build_font.py

WHEN YOU'D NEED THIS
    - You reshoot the alphabet and want the font rebuilt from the new photo
    - You want either weight thicker or thinner: change the numbers in
      WEIGHTS below (higher = bolder). Everything else can stay as-is.

HOW IT WORKS, IN PLAIN TERMS
    1. Flatten the photo's uneven lighting so ink/paper separate cleanly
    2. Straighten the page, then find every blob of ink
    3. Group the blobs into 4 text rows, then into 52 individual letters
    4. Work out where each row's baseline sits, so letters line up properly
    5. Convert each letter to a signed distance field, which is what gives
       smooth outlines instead of the pixel staircase you'd get from
       tracing a hard black-and-white mask
    6. Trace the outline at a chosen offset (that's the "bolder" control)
    7. Fit curves through the traced points and write out a font file
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
# The two weights to build. The number is how far each letter's outline is
# pushed outward, in pixels of the original photo — so it's literally "use
# a thicker pen". The pen in the photo is about 2.8px wide, and the push
# applies to both sides, so 0.5 gives a ~3.8px stroke and 1.15 a ~5.1px one.
WEIGHTS = [
    # (name suffix, CSS weight, push in source px)
    ("",      400, 0.50),
    ("-Bold", 700, 1.15),
]
SMOOTH = 2.2         # edge smoothing. Higher = softer, rounder letterforms;
                     # lower = crisper but starts showing the photo's pixels.
CAP_TARGET = 700     # cap height in font units (out of 1000)
SIDE_BEARING = 0.055  # breathing room each side of a letter, as a fraction of em

# --- knobs you probably shouldn't ---
UPM = 1000
SS = 6               # supersampling; sub-pixel accuracy for the outline
RDP_TOL = 3.0        # outline simplification tolerance, in font units
CORNER_DEG = 62      # turn sharper than this stays a corner, not a curve
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


def trace_smooth(mask, push):
    """Outline a letter with smooth edges instead of a pixel staircase.

    `push` is how far to move the outline outward, in source pixels —
    the boldness control. Because it comes from the distance field, a
    heavier weight is a genuinely fatter pen stroke, not the same shape
    scaled up or the browser's fake-bold smear.

    Tracing a hard black/white mask directly follows the square edge of
    every pixel, which is what made the first version look painted. So
    instead we build a signed distance field - for each point, how far
    inside or outside the stroke it is - blur THAT, and take the outline
    at a chosen distance. Blurring a distance field rounds off the
    staircase without dissolving the letter, and picking a negative
    distance pushes the outline outward, which is the boldness control.
    """
    pad = 4
    m = np.pad(mask, pad)
    big = np.repeat(np.repeat(m, SS, axis=0), SS, axis=1)
    inside = ndimage.distance_transform_edt(big)
    outside = ndimage.distance_transform_edt(~big)
    sdf = inside - outside                       # positive inside the stroke
    sdf = ndimage.gaussian_filter(sdf, SMOOTH * SS)
    return measure.find_contours(sdf, -push * SS), pad


def emit_contour(pen, p):
    """Write one outline, keeping sharp corners sharp and curves curved.

    In TrueType, a run of off-curve points renders as a smooth spline,
    while an on-curve point pins the outline to an exact spot. So we mark
    genuine corners (a sharp change of direction) as on-curve and let
    everything else be off-curve, which smooths the strokes without
    rounding off the corners of letters like A, K, W and Z.
    """
    v1 = p - np.roll(p, 1, axis=0)
    v2 = np.roll(p, -1, axis=0) - p
    a1 = np.arctan2(v1[:, 1], v1[:, 0])
    a2 = np.arctan2(v2[:, 1], v2[:, 0])
    turn = np.abs(np.degrees(np.arctan2(np.sin(a2 - a1), np.cos(a2 - a1))))
    on = turn > CORNER_DEG

    if not on.any():                     # a fully smooth loop, e.g. O
        pen.qCurveTo(*[(float(x), float(y)) for x, y in p], None)
        pen.closePath()
        return
    k = int(np.argmax(on))
    p, on = np.roll(p, -k, axis=0), np.roll(on, -k)
    pen.moveTo((float(p[0][0]), float(p[0][1])))
    offs = []
    for i in range(1, len(p)):
        pt = (float(p[i][0]), float(p[i][1]))
        if on[i]:
            pen.qCurveTo(*offs, pt) if offs else pen.lineTo(pt)
            offs = []
        else:
            offs.append(pt)
    if offs:
        pen.qCurveTo(*offs, (float(p[0][0]), float(p[0][1])))
    pen.closePath()


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

    # Each letter's ink only needs isolating once; only the tracing below
    # changes between weights.
    masks = {ch: only_this_glyph(box) for ch, (box, _, _, _) in meta.items()}

    for suffix, css_weight, push in WEIGHTS:
        build_weight(meta, masks, suffix, css_weight, push)


def build_weight(meta, masks, suffix, css_weight, push):
    glyphs, widths = {}, {}
    for ch, (box, baseline, scale, cap) in sorted(meta.items()):
        m = masks[ch]
        ys, xs = np.where(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1

        # sit on the baseline unless it's a genuine descender (g j p q y)
        drop = (y1 - baseline) / cap
        base = baseline if (ch in DESCENDERS and drop > 0.08) else float(y1)

        contours, pad = trace_smooth(m[y0:y1, x0:x1], push)

        polys = []
        for c in contours:
            px = (x0 - pad + c[:, 1] / SS) * scale
            py = (base - (y0 - pad + c[:, 0] / SS)) * scale
            p = rdp(np.column_stack([px, py]), RDP_TOL)
            if len(p) >= 4:
                polys.append(p[:-1])          # drop the duplicated closing point
        if not polys:
            print("  !! no outline for", ch)
            continue

        polys.sort(key=lambda p: -abs(signed_area(p)))
        outer = np.sign(signed_area(polys[0]))
        pen = TTGlyphPen(None)
        for i, p in enumerate(polys):
            if np.sign(signed_area(p)) != (outer if i == 0 else -outer):
                p = p[::-1]
            emit_contour(pen, p)
        glyphs[ch] = pen.glyph()
        allx = np.concatenate([p[:, 0] for p in polys])
        widths[ch] = int(round(allx.max() - allx.min() + 2 * SIDE_BEARING * UPM))

    style = "Bold" if css_weight >= 700 else "Regular"
    print(f"traced {len(glyphs)} letters at weight {css_weight} "
          f"(pen pushed {push}px)")

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
    fb.setupNameTable({"familyName": "Ezekiel Hand", "styleName": style,
                       "psName": f"EzekielHand-{style}", "version": "1.0"})
    # usWeightClass is what tells the browser this file IS the bold one,
    # so it uses these outlines instead of faking bold from the regular.
    fb.setupOS2(sTypoAscender=800, sTypoDescender=-250, usWinAscent=950,
                usWinDescent=300, sxHeight=int(CAP_TARGET * 0.52),
                sCapHeight=CAP_TARGET, usWeightClass=css_weight)
    fb.setupPost()

    ttf = FONTS / f"EzekielHand{suffix}.ttf"
    fb.save(ttf)
    f = TTFont(ttf)
    f.flavor = "woff2"
    f.save(FONTS / f"EzekielHand{suffix}.woff2")
    print(f"  wrote fonts/EzekielHand{suffix}.ttf + .woff2")


if __name__ == "__main__":
    main()
