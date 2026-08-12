#!/usr/bin/env python3
"""Extract high-FPS transparent frames from Imagine pet videos.

Usage:
  python3 scripts/video_to_smooth_frames.py <theme-id> [--states idle,working,...]
  python3 scripts/video_to_smooth_frames.py --all

Reads local source videos from media-src/<theme>/<state>.mp4, writes
frames under renderer/assets/<theme>/frames/ and rewrites animations.json
with fps=24 (smooth). Keeps a short loop (~2s for looping states).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "renderer" / "assets"
MEDIA_SRC = ROOT / "media-src"

THEMES = ["race-crab", "cloud-pup", "bubble-axolotl", "matcha-frog"]
STATES = ["idle", "thinking", "working", "done", "alert", "sleep", "wake"]

# Target playback
FPS = 24
FRAME_SIZE = 256

# How many seconds of video to keep per state (from t=0)
# Short loops keep 24fps smoothness without huge on-disk packs
CLIP_SEC = {
    "idle": 1.25,
    "thinking": 1.25,
    "working": 1.25,
    "done": 1.5,
    "alert": 1.0,
    "sleep": 1.5,
    "wake": 1.25,
    "click": 0.8,
}

LOOP = {
    "idle": True,
    "thinking": True,
    "working": True,
    "done": False,
    "alert": True,
    "sleep": True,
    "wake": False,
    "click": False,
}


def chroma_black(im: Image.Image, thr: int = 28, soft: int = 18) -> Image.Image:
    """Remove near-black background → transparent RGBA."""
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            # Luma-ish darkness
            dark = (r + g + b) / 3
            mx = max(r, g, b)
            # Pure/near black → transparent; soft edge
            if dark < thr and mx < thr + 20:
                px[x, y] = (r, g, b, 0)
            elif dark < thr + soft and mx < thr + soft + 25:
                # Feather
                t = (dark - thr) / max(1, soft)
                alpha = int(max(0, min(255, a * t)))
                px[x, y] = (r, g, b, alpha)
    return im


def extract_frames(video: Path, out_dir: Path, seconds: float, fps: int = FPS) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    # Clear prior extract
    for p in out_dir.glob("raw_*.png"):
        p.unlink()
    pattern = str(out_dir / "raw_%04d.png")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video),
        "-t",
        f"{seconds:.3f}",
        "-vf",
        f"fps={fps},scale={FRAME_SIZE}:{FRAME_SIZE}:flags=lanczos",
        "-start_number",
        "0",
        pattern,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    frames = sorted(out_dir.glob("raw_*.png"))
    if not frames:
        raise RuntimeError(f"No frames extracted from {video}")
    return frames


def process_state(theme: str, state: str, dry_run: bool = False) -> dict:
    theme_dir = ASSETS / theme
    video = MEDIA_SRC / theme / f"{state}.mp4"
    if not video.is_file():
        raise FileNotFoundError(f"Missing video: {video}")

    frames_dir = theme_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    # Remove old state frames (state_NN.png only)
    for old in frames_dir.glob(f"{state}_*.png"):
        if not dry_run:
            old.unlink()

    seconds = CLIP_SEC.get(state, 2.0)
    with tempfile.TemporaryDirectory(prefix=f"petvid_{theme}_{state}_") as tmp:
        tmp_path = Path(tmp)
        raws = extract_frames(video, tmp_path, seconds=seconds, fps=FPS)
        rels = []
        for i, raw in enumerate(raws):
            im = Image.open(raw)
            im = chroma_black(im)
            name = f"{state}_{i:02d}.png"
            dest = frames_dir / name
            if not dry_run:
                im.save(dest, optimize=True)
            rels.append(f"frames/{name}")
        return {
            "frames": rels,
            "fps": FPS,
            "loop": LOOP.get(state, True),
            "source": f"media-src/{theme}/{state}.mp4",
            "smooth": True,
        }


def build_click(theme_dir: Path, anims: dict) -> dict:
    """Click ack: short happy bounce from alert + wake + idle stills if present."""
    frames = []
    for key, idxs in (("alert", [0, 4, 8]), ("wake", [0, 6]), ("idle", [0])):
        defn = anims.get(key) or {}
        flist = defn.get("frames") or []
        for i in idxs:
            if i < len(flist):
                frames.append(flist[i])
    # Dedupe while preserving order
    seen = set()
    uniq = []
    for f in frames:
        if f not in seen:
            seen.add(f)
            uniq.append(f)
    if len(uniq) < 2 and (anims.get("alert") or {}).get("frames"):
        uniq = list(anims["alert"]["frames"][:8])
    return {"frames": uniq, "fps": 18, "loop": False, "smooth": True}


def process_theme(theme: str, states: list[str] | None = None) -> None:
    theme_dir = ASSETS / theme
    if not theme_dir.is_dir():
        raise SystemExit(f"Unknown theme dir: {theme_dir}")

    want = states or STATES
    anims: dict = {}
    meta_path = theme_dir / "animations.json"
    if meta_path.is_file():
        try:
            existing = json.loads(meta_path.read_text(encoding="utf-8"))
            anims = dict(existing.get("animations") or {})
        except Exception:
            anims = {}

    for state in want:
        print(f"[{theme}] {state} …", flush=True)
        anims[state] = process_state(theme, state)
        print(f"  → {len(anims[state]['frames'])} frames @ {FPS}fps", flush=True)

    # Always rebuild click from current packs
    anims["click"] = build_click(theme_dir, anims)

    out = {
        "frameSize": FRAME_SIZE,
        "source": "imagine-video",
        "fpsDefault": FPS,
        "animations": anims,
    }
    meta_path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(f"[{theme}] wrote {meta_path}", flush=True)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("theme", nargs="?", help="Theme id (e.g. race-crab)")
    ap.add_argument("--all", action="store_true", help="Process all themes that have media-src videos")
    ap.add_argument(
        "--states",
        default="",
        help="Comma-separated states (default: all standard states)",
    )
    args = ap.parse_args(argv)

    states = [s.strip() for s in args.states.split(",") if s.strip()] or None

    if args.all:
        for t in THEMES:
            vdir = MEDIA_SRC / t
            if not vdir.is_dir():
                print(f"skip {t}: no media-src/{t}/", flush=True)
                continue
            have = [s for s in (states or STATES) if (vdir / f"{s}.mp4").is_file()]
            if not have:
                print(f"skip {t}: no matching mp4s", flush=True)
                continue
            process_theme(t, have)
        return 0

    if not args.theme:
        ap.print_help()
        return 2
    process_theme(args.theme, states)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
