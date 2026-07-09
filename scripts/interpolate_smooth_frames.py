#!/usr/bin/env python3
"""Fallback: upsample an existing low-fps frame pack to 24fps via ffmpeg minterpolate.

Use when Imagine video is rate-limited or moderated for a theme/state.

  python3 scripts/interpolate_smooth_frames.py snorlax-buddy working
  python3 scripts/interpolate_smooth_frames.py snorlax-buddy --all-missing
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "renderer" / "assets"
FPS = 24
FRAME_SIZE = 256
STATES = ["idle", "thinking", "working", "done", "alert", "sleep", "wake"]
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


def has_video(theme: str, state: str) -> bool:
    return (ASSETS / theme / "videos" / f"{state}.mp4").is_file()


def existing_frames(theme: str, state: str) -> list[Path]:
    frames_dir = ASSETS / theme / "frames"
    # Prefer original low-fps pack if animations.json still lists them,
    # else any state_*.png currently present.
    meta_path = ASSETS / theme / "animations.json"
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            anim = (meta.get("animations") or {}).get(state) or {}
            # Skip if already smooth imagine pack with many frames
            if anim.get("smooth") and anim.get("source", "").startswith("videos/"):
                return []
            rels = anim.get("frames") or []
            paths = [ASSETS / theme / r for r in rels if (ASSETS / theme / r).is_file()]
            if paths:
                return paths
        except Exception:
            pass
    return sorted(frames_dir.glob(f"{state}_*.png"))


def interpolate_state(theme: str, state: str, target_count: int = 36) -> dict:
    srcs = existing_frames(theme, state)
    if len(srcs) < 2:
        # Try theme hero sprites as single frame hold — not useful for interp
        raise RuntimeError(f"{theme}/{state}: need ≥2 source frames to interpolate")

    frames_dir = ASSETS / theme / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix=f"interp_{theme}_{state}_") as tmp:
        tmp_path = Path(tmp)
        # Stage as sequential PNGs at low fps (~4)
        for i, src in enumerate(srcs):
            im = Image.open(src).convert("RGBA").resize((FRAME_SIZE, FRAME_SIZE), Image.Resampling.LANCZOS)
            im.save(tmp_path / f"in_{i:03d}.png")
            # ping-pong for seamless-ish loops when only a few keys
        # Reverse middle for smoother cycle when looping
        if LOOP.get(state, True) and len(srcs) >= 2:
            for j, src in enumerate(reversed(srcs[1:-1] if len(srcs) > 2 else srcs[1:])):
                im = Image.open(src).convert("RGBA").resize((FRAME_SIZE, FRAME_SIZE), Image.Resampling.LANCZOS)
                im.save(tmp_path / f"in_{len(srcs) + j:03d}.png")

        # Build a short video from keyframes, then minterpolate
        seq = tmp_path / "keys.mp4"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-framerate",
                "4",
                "-i",
                str(tmp_path / "in_%03d.png"),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(seq),
            ],
            check=True,
            capture_output=True,
        )
        out_pat = str(tmp_path / "out_%04d.png")
        # minterpolate to 24fps; then take first target_count frames
        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(seq),
                    "-vf",
                    f"minterpolate=fps={FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,scale={FRAME_SIZE}:{FRAME_SIZE}",
                    "-start_number",
                    "0",
                    out_pat,
                ],
                check=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError:
            # Softer fallback: fps upsample without motion estimation
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(seq),
                    "-vf",
                    f"fps={FPS},scale={FRAME_SIZE}:{FRAME_SIZE}",
                    "-start_number",
                    "0",
                    out_pat,
                ],
                check=True,
                capture_output=True,
            )

        outs = sorted(tmp_path.glob("out_*.png"))[:target_count]
        if not outs:
            raise RuntimeError("interpolation produced no frames")

        # Clear old state frames
        for old in frames_dir.glob(f"{state}_*.png"):
            old.unlink()

        rels = []
        for i, p in enumerate(outs):
            im = Image.open(p).convert("RGBA")
            # Ensure corners stay transparent-ish: if pure black, zero alpha
            px = im.load()
            w, h = im.size
            for y in range(h):
                for x in range(w):
                    r, g, b, a = px[x, y]
                    if r + g + b < 24:
                        px[x, y] = (0, 0, 0, 0)
            name = f"{state}_{i:02d}.png"
            im.save(frames_dir / name, optimize=True)
            rels.append(f"frames/{name}")

        return {
            "frames": rels,
            "fps": FPS,
            "loop": LOOP.get(state, True),
            "source": "interpolate",
            "smooth": True,
        }


def update_animations(theme: str, updates: dict[str, dict]) -> None:
    meta_path = ASSETS / theme / "animations.json"
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    else:
        meta = {"frameSize": FRAME_SIZE, "animations": {}}
    anims = dict(meta.get("animations") or {})
    anims.update(updates)

    # rebuild click
    frames = []
    for key, idxs in (("alert", [0, 4, 8]), ("wake", [0, 6]), ("idle", [0])):
        flist = (anims.get(key) or {}).get("frames") or []
        for i in idxs:
            if i < len(flist):
                frames.append(flist[i])
    seen = set()
    uniq = []
    for f in frames:
        if f not in seen:
            seen.add(f)
            uniq.append(f)
    if len(uniq) >= 2:
        anims["click"] = {"frames": uniq, "fps": 18, "loop": False, "smooth": True}

    meta["frameSize"] = FRAME_SIZE
    meta["fpsDefault"] = FPS
    meta["animations"] = anims
    if not meta.get("source"):
        meta["source"] = "mixed"
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {meta_path}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("theme")
    ap.add_argument("state", nargs="?")
    ap.add_argument("--all-missing", action="store_true", help="Fill states without videos/")
    args = ap.parse_args()

    updates = {}
    if args.all_missing:
        for st in STATES:
            if has_video(args.theme, st):
                print(f"skip {st}: has video")
                continue
            print(f"interpolate {args.theme}/{st} …")
            try:
                updates[st] = interpolate_state(args.theme, st)
                print(f"  → {len(updates[st]['frames'])} frames")
            except Exception as e:
                print(f"  FAIL: {e}")
    elif args.state:
        print(f"interpolate {args.theme}/{args.state} …")
        updates[args.state] = interpolate_state(args.theme, args.state)
        print(f"  → {len(updates[args.state]['frames'])} frames")
    else:
        ap.print_help()
        return 2

    if updates:
        update_animations(args.theme, updates)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
