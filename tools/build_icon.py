"""
Trace the hand-drawn speaker into SVG paths for the sound toggle.

Same idea as tools/build_font.py: the drawing is photographed, so it gets
thresholded to separate ink from paper, converted to a signed distance
field and blurred (which is what gives smooth edges instead of a pixel
staircase), then traced and written out as vector paths.

HOW TO RUN IT (from the project folder)
    python tools/build_icon.py "C:\\Users\\ernes\\Downloads\\Mute button.jpg"

    Prints two <path> blocks: one with the sound waves, one without.
    Paste them into the button in portfolio.html.

WHY THE TWO VERSIONS SHARE A TRANSFORM
    Both are normalised using the bounding box of the WHOLE drawing, so
    the cone sits in exactly the same place in each. Toggling then only
    removes the waves — the speaker itself doesn't shift, which would
    look like a glitch rather than a state change.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage
from skimage import measure

ROOT = Path(__file__).resolve().parent.parent

INK_BELOW = 120     # marker is far darker than the pencil marks behind it
SPECK = 120         # drop blobs smaller than this many pixels
SS = 3              # supersample before tracing, for sub-pixel smoothness
SMOOTH = 0.7        # distance-field blur; higher = rounder. Kept low so
                    # the pointed tips of the cone survive — this drawing
                    # has real corners, unlike the handwriting
RDP_TOL = 0.16      # simplification, in final viewBox units
BOX = 24.0          # target viewBox
PAD = 1.0           # margin inside it


def rdp(pts, tol):
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


def trace(mask):
    """Smooth outlines of one blob, in source-pixel coordinates."""
    pad = 4
    m = np.pad(mask, pad)
    big = np.repeat(np.repeat(m, SS, axis=0), SS, axis=1)
    sdf = (ndimage.distance_transform_edt(big)
           - ndimage.distance_transform_edt(~big))
    sdf = ndimage.gaussian_filter(sdf, SMOOTH * SS)
    out = []
    for c in measure.find_contours(sdf, 0.0):
        # (row, col) -> (x, y), undo the pad and the supersample
        out.append(np.column_stack([c[:, 1] / SS - pad, c[:, 0] / SS - pad]))
    return out


def to_path(poly):
    """Closed path of straight segments.

    A spline through the midpoints would round every corner off, and this
    drawing has real corners — the tips of the cone. The distance field
    has already removed the pixel noise, so joining the simplified points
    with lines is both faithful and smooth at any size the icon is used.
    """
    if len(poly) < 3:
        return None
    d = ['M %.2f %.2f' % (poly[0][0], poly[0][1])]
    for x, y in poly[1:]:
        d.append('L %.2f %.2f' % (x, y))
    d.append('Z')
    return ' '.join(d)


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1
               else Path.home() / 'Downloads' / 'Mute button.jpg')
    g = ImageOps.exif_transpose(Image.open(src)).convert('L')
    a = np.asarray(g).astype(float)

    ink = a < INK_BELOW
    ink = ndimage.binary_fill_holes(ink)      # close the marker's texture gaps

    lab, n = ndimage.label(ink)
    sizes = ndimage.sum(ink, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:][sizes >= SPECK] = True
    ink = keep[lab]
    lab, n = ndimage.label(ink)
    print(f'{n} shapes found in the drawing')

    parts = []
    for i in range(1, n + 1):
        m = lab == i
        ys, xs = np.where(m)
        parts.append({'mask': m, 'x0': xs.min(), 'x1': xs.max(),
                      'y0': ys.min(), 'y1': ys.max(), 'area': int(m.sum())})
    parts.sort(key=lambda p: p['x0'])
    for i, p in enumerate(parts):
        print(f"  shape {i}: x {p['x0']}-{p['x1']}  y {p['y0']}-{p['y1']}  "
              f"area {p['area']}")

    # the cone is the big one on the left; everything right of it is a wave
    cone = max(parts, key=lambda p: p['area'])
    waves = [p for p in parts if p is not cone]
    print(f'-> cone = shape with area {cone["area"]}, {len(waves)} wave(s)')

    # ONE transform for both variants, from the whole drawing's bounds
    X0 = min(p['x0'] for p in parts); X1 = max(p['x1'] for p in parts)
    Y0 = min(p['y0'] for p in parts); Y1 = max(p['y1'] for p in parts)
    scale = (BOX - 2 * PAD) / max(X1 - X0, Y1 - Y0)
    offx = PAD + ((BOX - 2 * PAD) - (X1 - X0) * scale) / 2.0
    offy = PAD + ((BOX - 2 * PAD) - (Y1 - Y0) * scale) / 2.0

    def paths_for(part):
        out = []
        for poly in trace(part['mask']):
            q = np.column_stack([(poly[:, 0] - X0) * scale + offx,
                                 (poly[:, 1] - Y0) * scale + offy])
            q = rdp(q, RDP_TOL)
            if len(q) >= 4:
                out.append(to_path(q[:-1]))
        return [p for p in out if p]

    cone_paths = paths_for(cone)
    wave_paths = [p for w in waves for p in paths_for(w)]

    def block(paths, indent):
        return ('\n' + indent).join('<path d="%s"/>' % p for p in paths)

    print('\n================ paste into portfolio.html ================\n')
    print('<!-- the speaker cone, shown in both states -->')
    print(block(cone_paths, ''))
    print('\n<!-- the sound waves, hidden when muted -->')
    print(block(wave_paths, ''))

    (ROOT / 'tools' / 'icon-paths.txt').write_text(
        'CONE\n' + block(cone_paths, '') + '\n\nWAVES\n' + block(wave_paths, ''),
        encoding='utf-8')
    print('\nalso written to tools/icon-paths.txt')


if __name__ == '__main__':
    main()
