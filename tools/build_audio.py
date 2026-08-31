"""
Turn the WAVs in Music/Zeek Site into web audio, and write the playlist.

WHY IT HAS TO BE CONVERTED
    The sources are 48kHz stereo WAV — 332MB for six tracks. GitHub warns
    above 50MB a file and refuses at 100MB, and no visitor is waiting on a
    66MB download to hear a song. MP3 at LAME V2 (~190kbps) brings the set
    under 25MB and is the one format every browser has always played.

HOW TO RUN IT (from the project folder)
    python tools/build_audio.py

    Writes audio/*.mp3 and audio/tracks.json. Needs ffmpeg on PATH.

THE PLAYLIST FILE
    tracks.json is the single source of truth for what the player plays,
    so adding a song means dropping a WAV in the folder and re-running
    this — no HTML to edit. EmptyChildhood is pinned first because that is
    the one that has to open the site; the player shuffles the rest.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path.home() / 'Music' / 'Zeek Site'
DEST = ROOT / 'audio'

FIRST = 'EmptyChildhood'    # stem of the track that always opens the site
QUALITY = '2'               # LAME VBR: 2 is ~190kbps, transparent enough
                            # for a browser and a third the size of V0


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-1500:])
        raise SystemExit('ffmpeg failed')


def duration(path):
    r = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'csv=p=0', str(path)], capture_output=True, text=True)
    return round(float(r.stdout.strip()), 2)


def pretty(stem):
    """'EmptyChildhood' -> 'Empty Childhood'; already-spaced names untouched.

    Only splits where a lower-case letter runs straight into a capital, so
    'Lost at Sea' and 'Ice Cold Samurai' come through exactly as named.
    """
    return re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', stem)


def slug(stem):
    return re.sub(r'[^a-z0-9]+', '-', stem.lower()).strip('-')


def main():
    if not shutil.which('ffmpeg'):
        raise SystemExit('ffmpeg not found on PATH')
    if not SRC.is_dir():
        raise SystemExit(f'no such folder: {SRC}')

    wavs = sorted(SRC.glob('*.wav'))
    if not wavs:
        raise SystemExit(f'no .wav files in {SRC}')

    # the opener first, everything else alphabetical after it. The player
    # shuffles from index 1 on, so this order only fixes the starting point.
    wavs.sort(key=lambda p: (p.stem != FIRST, p.stem.lower()))
    if wavs[0].stem != FIRST:
        print(f'WARNING: {FIRST}.wav not found — "{wavs[0].stem}" opens instead')

    DEST.mkdir(parents=True, exist_ok=True)
    tracks = []

    for wav in wavs:
        title = pretty(wav.stem)
        # slug from the split title, not the raw stem, or EmptyChildhood
        # lands as "emptychildhood.mp3"
        mp3 = DEST / f'{slug(title)}.mp3'
        run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
             '-c:a', 'libmp3lame', '-q:a', QUALITY,
             '-metadata', f'title={title}',
             '-metadata', 'artist=Ezekiel',
             # the encoder delay/padding tags, so the gap either side of a
             # track matches the WAV instead of the ~50ms MP3 adds
             '-write_xing', '1', str(mp3)])

        tracks.append({'src': f'audio/{mp3.name}',
                       'title': title,
                       'duration': duration(mp3)})
        print(f'{wav.name[:26]:28s} -> {mp3.name:26s} '
              f'{wav.stat().st_size/1e6:6.1f}MB -> {mp3.stat().st_size/1e6:5.2f}MB')

    (DEST / 'tracks.json').write_text(
        json.dumps(tracks, indent=2) + '\n', encoding='utf-8')

    total = sum(t['duration'] for t in tracks)
    size = sum((DEST / Path(t['src']).name).stat().st_size for t in tracks)
    print(f'\n{len(tracks)} tracks, {total/60:.1f} min, {size/1e6:.1f}MB total')
    print(f'opens with: {tracks[0]["title"]}')
    print(f'wrote {(DEST / "tracks.json").relative_to(ROOT)}')


if __name__ == '__main__':
    main()
