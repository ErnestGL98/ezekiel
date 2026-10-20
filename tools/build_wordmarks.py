"""
BUILD THE HOME PAGE'S FOUR WORDS AS VECTOR OUTLINES
===================================================

WHY THIS EXISTS
    The home page is set in Old English Text MT, which ships with
    Windows and Microsoft Office. It is a licensed Monotype font: the
    FILE cannot be put in a public repository or served as a webfont
    without a web licence. What a font draws, though, is output — the
    same as a logo or a PDF — so these four words are converted to plain
    SVG outlines and the font file itself never leaves this machine.

    The result looks identical on every device, phone or desktop, with no
    font to download, and scales perfectly because it is vector, not a
    picture of text.

WHAT IT WRITES
    images/wordmarks/*.svg — one per word, each with fill="currentColor"
    so the CSS colour still drives it, and a viewBox trimmed to the ink.

RUNNING IT AGAIN
    python tools/build_wordmarks.py
    Needs Old English Text MT installed (C:/Windows/Fonts/OLDENGL.TTF).
    It only has to be re-run if the WORDS change — the site does not
    depend on this script at runtime.
"""
import pathlib
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

FONT = pathlib.Path('C:/Windows/Fonts/OLDENGL.TTF')
OUT = pathlib.Path('images/wordmarks')

# filename -> the words exactly as they appear on the page
WORDS = {
    'ezekiel-scott': 'Ezekiel Scott',
    'portfolio': 'Portfolio',
    'contact': 'Contact',
    'instagram': 'Instagram',
}


def kerning(font):
    """Kerning pairs, by glyph name. Old English Text MT has a real kern
    table and the pairs matter: without them the capitals sit too far
    from what follows, which on blackletter reads as a gap."""
    try:
        return font['kern'].kernTables[0].kernTable
    except Exception:
        return {}


def extent(font, words):
    """One vertical extent shared by every word.

    Each word's own ink box is a different height — "Portfolio" has no
    descender, "Instagram" has the g, "Contact" neither reaches as high
    nor as low. Trimming each to its own ink would leave four boxes whose
    BASELINES no longer line up, and the row would read as if the words
    sat at different heights. One extent for all four fixes it: align the
    boxes and the baselines come with them."""
    glyf = font.getGlyphSet()
    cmap = font.getBestCmap()
    top = bottom = None
    for text in words:
        for ch in text:
            if ord(ch) not in cmap:
                continue
            bp = BoundsPen(glyf)
            glyf[cmap[ord(ch)]].draw(bp)
            if bp.bounds:
                _, y0, _, y1 = bp.bounds
                top = y1 if top is None else max(top, y1)
                bottom = y0 if bottom is None else min(bottom, y0)
    return top, bottom


def build(font, text, top, bottom):
    glyf = font.getGlyphSet()
    cmap = font.getBestCmap()
    upem = font['head'].unitsPerEm
    kern = kerning(font)
    hmtx = font['hmtx']

    names = []
    for ch in text:
        if ord(ch) not in cmap:
            raise SystemExit(f'{text!r}: the font has no glyph for {ch!r}')
        names.append(cmap[ord(ch)])

    paths = []
    x = 0
    for i, name in enumerate(names):
        pen = SVGPathPen(glyf)
        glyf[name].draw(pen)
        d = pen.getCommands()
        if d:
            # Flip vertically: font coordinates run up from the baseline,
            # SVG's run down. Done per glyph with a transform so the path
            # data itself stays untouched and readable.
            paths.append((x, d))
        x += hmtx[name][0]
        if i + 1 < len(names):
            x += kern.get((name, names[i + 1]), 0)

    total = x
    height = top - bottom
    body = '\n'.join(
        f'    <path transform="translate({px} {top}) scale(1 -1)" d="{d}"/>'
        for px, d in paths
    )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} {height}" '
        f'fill="currentColor" role="img" aria-label="{text}">\n{body}\n</svg>\n'
    )
    return svg, total, height, upem


def main():
    if not FONT.exists():
        raise SystemExit(f'not found: {FONT}\nOld English Text MT must be installed.')
    font = TTFont(FONT)
    OUT.mkdir(parents=True, exist_ok=True)
    upem = font['head'].unitsPerEm
    print(f'{font["name"].getDebugName(4)}  (units per em {upem})')
    top, bottom = extent(font, WORDS.values())
    print(f'  shared extent {bottom} to {top} units = {(top - bottom) / upem:.4f}em tall\n')
    for slug, text in WORDS.items():
        svg, w, h, _ = build(font, text, top, bottom)
        path = OUT / f'{slug}.svg'
        path.write_text(svg, encoding='utf-8')
        # The em figures are what the CSS needs: at a given font-size the
        # word then takes exactly the space the real text would have.
        print(f'  {text:16s} -> {path}  {w}x{h} units  '
              f'=> {w / upem:.4f}em wide, {h / upem:.4f}em tall  '
              f'{len(svg) / 1024:.1f}KB')
    print('\nThese are outlines, not a font. The font file stays on this machine.')


if __name__ == '__main__':
    main()
