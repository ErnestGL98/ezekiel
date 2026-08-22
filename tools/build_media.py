"""
Prepare the (b).stroy Paris runway stills and clips for the web.

WHAT IT DOES
    Stills  -> images/looks/*.jpg   resized and re-encoded
    Clips   -> video/*.mp4          re-encoded smaller, plus a poster frame

    The clips keep their audio track on purpose: the page loads them
    muted, and the visitor unmutes with the player's own control, so the
    sound has to actually be in the file.

HOW TO RUN IT (from the project folder)
    python tools/build_media.py

    Needs ffmpeg on PATH.
"""
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = Path.home() / 'Downloads'

# Displayed at roughly half the 1200px grid, so ~570px. 1200 wide is a
# little over 2x that, which stays sharp on dense screens.
STILL_W = 1200
STILL_Q = 88

STILLS = [
    ('(b).stroy Paris fw.jpg',  'bstroy-paris-orange.jpg'),
    ('(b).stroy Paris fw2.PNG', 'bstroy-paris-fur.jpg'),
]

# (source, output stem, timestamp to grab the poster from)
CLIPS = [
    ('(b).stroy Paris fw Video.MP4',   'bstroy-paris-1', '00:00:06'),
    ('(b).stroy Paris fw Video 2.MP4', 'bstroy-paris-2', '00:00:08'),
]


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1500:])
        raise SystemExit('ffmpeg failed')


def main():
    if not shutil.which('ffmpeg'):
        raise SystemExit('ffmpeg not found on PATH')

    img_dir = ROOT / 'images' / 'looks'
    vid_dir = ROOT / 'video'
    img_dir.mkdir(parents=True, exist_ok=True)
    vid_dir.mkdir(parents=True, exist_ok=True)

    for src_name, out_name in STILLS:
        src = SRC / src_name
        im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
        if im.width > STILL_W:
            im = im.resize((STILL_W, round(im.height * STILL_W / im.width)),
                           Image.LANCZOS)
        dest = img_dir / out_name
        im.save(dest, 'JPEG', quality=STILL_Q, subsampling=0,
                optimize=True, progressive=False)
        print(f'{src_name[:34]:36s} -> {out_name}  {im.size[0]}x{im.size[1]}  '
              f'{dest.stat().st_size/1e6:.2f}MB')

    for src_name, stem, poster_at in CLIPS:
        src = SRC / src_name
        mp4 = vid_dir / f'{stem}.mp4'
        # -movflags +faststart puts the index at the FRONT of the file, so
        # playback can begin while the rest is still downloading. Without
        # it the browser has to fetch the whole clip first.
        # Scaled to 960 wide: these display around 570px, so that is still
        # ~1.7x for dense screens. Left at the source 1280 the re-encode
        # actually came out LARGER than the original file.
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(src),
             '-vf', 'scale=960:-2',
             '-c:v', 'libx264', '-crf', '27', '-preset', 'slow',
             '-pix_fmt', 'yuv420p',            # required for Safari
             '-c:a', 'aac', '-b:a', '96k',     # audio kept: they unmute it
             '-movflags', '+faststart', str(mp4)])

        poster = vid_dir / f'{stem}-poster.jpg'
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
             '-ss', poster_at, '-i', str(src), '-frames:v', '1',
             '-vf', 'scale=1000:-2', '-q:v', '4', str(poster)])

        print(f'{src_name[:34]:36s} -> {stem}.mp4  '
              f'{src.stat().st_size/1e6:.1f}MB -> {mp4.stat().st_size/1e6:.2f}MB  '
              f'(+ poster {poster.stat().st_size/1e6:.2f}MB)')


if __name__ == '__main__':
    main()
