#!/usr/bin/env python3
"""Process individual pose JPGs into transparent theme frames + animations.json.

Usage:
  python3 scripts/process_theme_poses.py <theme-id> <src-dir>

src-dir should contain files named like idle_00.jpg, thinking_01.jpg, etc.
Writes to renderer/assets/<theme-id>/ and themes/<theme-id>/sprites/.
"""
from __future__ import annotations

import json
import math
import os
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
STATES = ["idle", "thinking", "working", "done", "alert", "sleep", "wake"]

FPS = {
    "idle": 3,
    "thinking": 2.5,
    "working": 4,
    "done": 6,
    "alert": 4,
    "sleep": 1.5,
    "wake": 5,
}


def chroma_key(im: Image.Image, thr: float = 68) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    samples = [
        px[2, 2],
        px[w - 3, 2],
        px[2, h - 3],
        px[w - 3, h - 3],
        px[w // 2, 2],
        px[w // 2, h - 3],
        px[2, h // 2],
        px[w - 3, h // 2],
    ]
    cr = sum(s[0] for s in samples) // len(samples)
    cg = sum(s[1] for s in samples) // len(samples)
    cb = sum(s[2] for s in samples) // len(samples)

    def dist(r, g, b):
        return ((r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2) ** 0.5

    visited = [[False] * w for _ in range(h)]
    q = deque()
    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    bg = set()
    while q:
        x, y = q.popleft()
        if not (0 <= x < w and 0 <= y < h) or visited[y][x]:
            continue
        visited[y][x] = True
        r, g, b, _ = px[x, y]
        if dist(r, g, b) > thr * 1.45:
            continue
        bg.add((x, y))
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx]:
                q.append((nx, ny))

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            d = dist(r, g, b)
            if (x, y) in bg or d < thr * 0.6:
                op[x, y] = (0, 0, 0, 0)
            elif d < thr:
                alpha = int(255 * (d - thr * 0.6) / (thr * 0.4))
                alpha = max(0, min(255, alpha))
                op[x, y] = (r, g, b, alpha)
            else:
                op[x, y] = (r, g, b, 255)
    return out


def normalize(im: Image.Image, size: int = 256) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pad = max(6, int(min(im.size) * 0.04))
    x0, y0, x1, y1 = bbox
    im = im.crop(
        (
            max(0, x0 - pad),
            max(0, y0 - pad),
            min(im.size[0], x1 + pad),
            min(im.size[1], y1 + pad),
        )
    )
    scale = min((size * 0.92) / im.size[0], (size * 0.92) / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - nw) // 2, (size - nh) // 2 + size // 40), im)
    return canvas


def synthesize_bob(base: Image.Image, n: int = 3) -> list[Image.Image]:
    frames = []
    for i in range(n):
        t = i / max(1, n - 1)
        dy = int(math.sin(t * math.pi * 2) * 5)
        sc = 1.0 + math.sin(t * math.pi * 2) * 0.018
        w, h = base.size
        nw, nh = max(1, int(w * sc)), max(1, int(h * sc))
        scaled = base.resize((nw, nh), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        canvas.paste(scaled, ((w - nw) // 2, (h - nh) // 2 + dy), scaled)
        frames.append(canvas)
    return frames


def collect_sources(src_dir: Path, state: str) -> list[Path]:
    files = sorted(src_dir.glob(f"{state}_*.jpg")) + sorted(src_dir.glob(f"{state}_*.png"))
    # also allow plain state.jpg
    for ext in (".jpg", ".jpeg", ".png"):
        p = src_dir / f"{state}{ext}"
        if p.is_file() and p not in files:
            files.append(p)
    return files


def process_theme(theme_id: str, src_dir: Path) -> None:
    out = ROOT / "renderer" / "assets" / theme_id
    theme_sprites = ROOT / "themes" / theme_id / "sprites"
    frames_dir = out / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    theme_sprites.mkdir(parents=True, exist_ok=True)

    meta = {"frameSize": 256, "animations": {}}

    for state in STATES:
        sources = collect_sources(src_dir, state)
        if not sources:
            print(f"  WARN: no sources for {state}")
            continue

        paths: list[str] = []
        bases: list[Image.Image] = []
        for src in sources:
            print(f"  process {state} <- {src.name}")
            keyed = chroma_key(Image.open(src))
            fr = normalize(keyed, 256)
            bases.append(fr)
            rel = f"frames/{state}_{len(paths):02d}.png"
            fr.save(out / rel, "PNG")
            paths.append(rel)

        # Synthesize subtle motion frames for smoother loops
        bob_n = 3 if state in ("idle", "sleep") else 2
        if bases:
            for fr in synthesize_bob(bases[0], bob_n):
                rel = f"frames/{state}_{len(paths):02d}.png"
                fr.save(out / rel, "PNG")
                paths.append(rel)

            if state in ("working", "alert", "done") and len(bases) > 1:
                for bi, b in enumerate(bases):
                    enh = ImageEnhance.Brightness(b).enhance(1.03 if bi % 2 == 0 else 0.98)
                    rel = f"frames/{state}_{len(paths):02d}.png"
                    enh.save(out / rel, "PNG")
                    paths.append(rel)

            # Hero sprites at 512 for dashboard / theme pack
            hero = normalize(chroma_key(Image.open(sources[0])), 512)
            hero.save(out / f"{state}.png", "PNG")
            hero.save(theme_sprites / f"{state}.png", "PNG")

        meta["animations"][state] = {
            "frames": paths,
            "fps": FPS.get(state, 6),
            "loop": state not in ("wake", "done"),
        }
        print(f"    {state}: {len(paths)} frames")

    # click reuses alert/wake/idle (renderer also synthesizes if missing)
    if "alert" in meta["animations"] and "wake" in meta["animations"] and "idle" in meta["animations"]:
        click_frames = []
        for key, idx in (("alert", 0), ("alert", 1), ("wake", 0), ("idle", 0)):
            frames = meta["animations"][key]["frames"]
            if frames:
                click_frames.append(frames[min(idx, len(frames) - 1)])
        meta["animations"]["click"] = {
            "frames": click_frames,
            "fps": 10,
            "loop": False,
        }

    # spritesheet
    present = [s for s in STATES if s in meta["animations"] and meta["animations"][s]["frames"]]
    if present:
        max_f = max(len(meta["animations"][s]["frames"]) for s in present)
        sheet = Image.new("RGBA", (max_f * 256, len(present) * 256), (0, 0, 0, 0))
        sheet_meta = {"frameWidth": 256, "frameHeight": 256, "rows": {}}
        for ri, state in enumerate(present):
            anim = meta["animations"][state]
            sheet_meta["rows"][state] = {
                "row": ri,
                "count": len(anim["frames"]),
                "fps": anim["fps"],
                "loop": anim["loop"],
            }
            for i, rel in enumerate(anim["frames"]):
                fr = Image.open(out / rel)
                sheet.paste(fr, (i * 256, ri * 256), fr)
        sheet.save(out / "spritesheet.png", "PNG")
        sheet.save(theme_sprites / "spritesheet.png", "PNG")
        with open(out / "spritesheet.json", "w", encoding="utf-8") as f:
            json.dump(sheet_meta, f, indent=2)

    with open(out / "animations.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"Wrote {out / 'animations.json'}")


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    theme_id = sys.argv[1]
    src_dir = Path(sys.argv[2])
    if not src_dir.is_dir():
        print(f"Source dir not found: {src_dir}")
        sys.exit(1)
    print(f"Processing theme {theme_id} from {src_dir}")
    process_theme(theme_id, src_dir)


if __name__ == "__main__":
    main()
