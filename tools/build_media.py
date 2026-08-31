"""
Prepare the (b).stroy Paris runway stills and clips for the web.

WHAT IT DOES
    Stills  -> images/looks/*.jpg   resized and re-encoded
    Clips   -> video/*.mp4          re-encoded smaller, plus a poster frame

    The clips keep their audio track on purpose: the page loads them
    muted, and the visitor unmutes with the player's own control, so the
    sound has to actually be in the file.

HOW TO RUN IT (from the project folder)
    python tools/build_media.py            # everything
    python tools/build_media.py famous     # only sources matching "famous"

    The filter is worth using: re-encoding a clip takes minutes, and there
    is no point redoing the ones that haven't changed.

    Needs ffmpeg on PATH.
"""
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = Path.home() / 'Downloads'

STILL_Q = 88

# (source, output name, target width). Roughly 2x the size each one is
# actually displayed at, which stays sharp on dense screens. Nothing is
# ever upscaled past its source — see fit() below.
STILLS = [
    ('(b).stroy Paris fw.jpg',  'bstroy-paris-orange.jpg', 1200),
    ('(b).stroy Paris fw2.PNG', 'bstroy-paris-fur.jpg',    1200),
    # portrait, and shown narrower than the Paris pair, so it needs less
    ('Famous Nobodys.jpg',      'famous-nobodys.jpg',      1000),
]

# (source, output stem, poster timestamp, target width, crf)
CLIPS = [
    ('(b).stroy Paris fw Video.MP4',   'bstroy-paris-1', '00:00:06', 960, 27),
    ('(b).stroy Paris fw Video 2.MP4', 'bstroy-paris-2', '00:00:08', 960, 27),
    # 9:16 and a full minute, where the others are 16:9 and under 20s. It
    # autoplays like they do, so a gentler CRF keeps that affordable — at
    # 27 this one alone outweighed both Paris clips put together.
    ('Famous Nobodys Video.MP4',       'famous-nobodys', '00:00:14', 720, 30),
]


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1500:])
        raise SystemExit('ffmpeg failed')


def video_width(path):
    r = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=width', '-of', 'csv=p=0', str(path)],
        capture_output=True, text=True)
    return int(r.stdout.strip().split(',')[0])


def fit(target, source_w):
    """Never upscale.

    The scale filter is given a plain number rather than min(w,iw), because
    a comma inside a filter function has to be escaped and getting that
    wrong fails silently in ways that are tedious to spot. Asking ffprobe
    first is duller and always right.
    """
    return min(target, source_w)


def main():
    if not shutil.which('ffmpeg'):
        raise SystemExit('ffmpeg not found on PATH')

    only = sys.argv[1].lower() if len(sys.argv) > 1 else None
    wanted = lambda name: only is None or only in name.lower()

    img_dir = ROOT / 'images' / 'looks'
    vid_dir = ROOT / 'video'
    img_dir.mkdir(parents=True, exist_ok=True)
    vid_dir.mkdir(parents=True, exist_ok=True)

    for src_name, out_name, width in STILLS:
        if not wanted(src_name):
            continue
        src = SRC / src_name
        im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
        w = fit(width, im.width)
        if im.width > w:
            im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        dest = img_dir / out_name
        im.save(dest, 'JPEG', quality=STILL_Q, subsampling=0,
                optimize=True, progressive=False)
        print(f'{src_name[:34]:36s} -> {out_name}  {im.size[0]}x{im.size[1]}  '
              f'{dest.stat().st_size/1e6:.2f}MB')

    for src_name, stem, poster_at, width, crf in CLIPS:
        if not wanted(src_name):
            continue
        src = SRC / src_name
        w = fit(width, video_width(src))
        mp4 = vid_dir / f'{stem}.mp4'
        # -movflags +faststart puts the index at the FRONT of the file, so
        # playback can begin while the rest is still downloading. Without
        # it the browser has to fetch the whole clip first.
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(src),
             '-vf', f'scale={w}:-2',
             '-c:v', 'libx264', '-crf', str(crf), '-preset', 'slow',
             '-pix_fmt', 'yuv420p',            # required for Safari
             '-c:a', 'aac', '-b:a', '96k',     # audio kept: they unmute it
             '-movflags', '+faststart', str(mp4)])

        poster = vid_dir / f'{stem}-poster.jpg'
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
             '-ss', poster_at, '-i', str(src), '-frames:v', '1',
             '-vf', f'scale={fit(1000, w)}:-2', '-q:v', '4', str(poster)])

        print(f'{src_name[:34]:36s} -> {stem}.mp4  {w}w crf{crf}  '
              f'{src.stat().st_size/1e6:.1f}MB -> {mp4.stat().st_size/1e6:.2f}MB  '
              f'(+ poster {poster.stat().st_size/1e6:.2f}MB)')


if __name__ == '__main__':
    main()
