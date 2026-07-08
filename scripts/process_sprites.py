"""Process AI sprite strips into per-frame PNGs + master sheet + animations.json."""
from __future__ import annotations

import json
import os
from collections import deque
from PIL import Image

SRC = r"C:\Users\finma\.grok\sessions\C%3A%5CGrokington%5CPet_Grok\019f42d7-71cc-77e3-8557-fca091aa9f35\images"
OUT_ROOT = r"C:\Grokington\Pet_Grok\renderer\assets\race-crab"
THEME_OUT = r"C:\Grokington\Pet_Grok\themes\race-crab\sprites"

# source file -> (state, expected frame count)
SHEETS = {
    "10.jpg": ("idle", 6),
    "8.jpg": ("thinking", 6),
    "9.jpg": ("working", 6),
    "12.jpg": ("done", 6),
    "14.jpg": ("alert", 6),
    "11.jpg": ("sleep", 6),
    "13.jpg": ("wake", 4),
}

STATES_ORDER = ["idle", "thinking", "working", "done", "alert", "sleep", "wake"]


def chroma_key(im: Image.Image, thr: float = 65) -> Image.Image:
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
        r, g, b, _a = px[x, y]
        if dist(r, g, b) > thr * 1.4:
            continue
        bg.add((x, y))
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx]:
                q.append((nx, ny))

    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    op = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _a = px[x, y]
            d = dist(r, g, b)
            if (x, y) in bg or d < thr * 0.65:
                op[x, y] = (0, 0, 0, 0)
            elif d < thr:
                alpha = int(255 * (d - thr * 0.65) / (thr * 0.35))
                alpha = max(0, min(255, alpha))
                op[x, y] = (r, g, b, alpha)
            else:
                if r > 160 and b > 160 and g < 140:
                    spill = min(r, b) - g
                    if spill > 30:
                        r = max(0, r - spill // 2)
                        b = max(0, b - spill // 2)
                        g = min(255, g + spill // 4)
                op[x, y] = (r, g, b, 255)
    return out


def content_runs(im: Image.Image):
    w, h = im.size
    px = im.load()
    cols = []
    for x in range(w):
        has = False
        for y in range(0, h, 2):
            if px[x, y][3] > 20:
                has = True
                break
        cols.append(has)
    runs = []
    i = 0
    while i < w:
        if cols[i]:
            j = i
            while j < w and cols[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    return runs


def split_frames(im: Image.Image, n_expected: int):
    """Equal-width slices across the content bbox (most reliable for AI strips)."""
    bbox = im.getbbox()
    if not bbox:
        return []
    x0, y0, x1, y1 = bbox
    pad_y = max(4, (y1 - y0) // 18)
    pad_x = max(4, (x1 - x0) // 80)
    y0 = max(0, y0 - pad_y)
    y1 = min(im.size[1], y1 + pad_y)
    x0 = max(0, x0 - pad_x)
    x1 = min(im.size[0], x1 + pad_x)
    strip = im.crop((x0, y0, x1, y1))

    # Prefer gap-based runs when count matches expected
    runs = content_runs(strip)
    gap_thr = max(6, strip.size[0] // 100)
    if runs:
        merged = [list(runs[0])]
        for a, b in runs[1:]:
            if a - merged[-1][1] <= gap_thr:
                merged[-1][1] = b
            else:
                merged.append([a, b])
        runs = [tuple(m) for m in merged]

    if runs and len(runs) == n_expected:
        frames = []
        for a, b in runs:
            pad = max(2, (b - a) // 20)
            aa = max(0, a - pad)
            bb = min(strip.size[0], b + pad)
            frames.append(strip.crop((aa, 0, bb, strip.size[1])))
        return frames

    # Equal N columns across full strip (stable for evenly spaced sheets)
    fw = strip.size[0] / n_expected
    frames = []
    for i in range(n_expected):
        a = int(round(i * fw))
        b = int(round((i + 1) * fw)) if i < n_expected - 1 else strip.size[0]
        frames.append(strip.crop((a, 0, b, strip.size[1])))
    return frames


def normalize_frame(fr: Image.Image, size: int = 256) -> Image.Image:
    bbox = fr.getbbox()
    if bbox:
        pad = max(4, int(min(fr.size) * 0.04))
        x0, y0, x1, y1 = bbox
        fr = fr.crop(
            (
                max(0, x0 - pad),
                max(0, y0 - pad),
                min(fr.size[0], x1 + pad),
                min(fr.size[1], y1 + pad),
            )
        )
    side = max(fr.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(fr, ((side - fr.size[0]) // 2, (side - fr.size[1]) // 2), fr)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def main():
    os.makedirs(os.path.join(OUT_ROOT, "frames"), exist_ok=True)
    os.makedirs(THEME_OUT, exist_ok=True)

    meta = {"frameSize": 256, "animations": {}}

    for fname, (state, n) in SHEETS.items():
        path = os.path.join(SRC, fname)
        print("Processing", fname, "->", state)
        im = Image.open(path)
        keyed = chroma_key(im)
        frames = split_frames(keyed, n)
        print("  frames:", len(frames))
        paths = []
        for i, fr in enumerate(frames):
            nf = normalize_frame(fr, 256)
            rel = f"frames/{state}_{i:02d}.png"
            nf.save(os.path.join(OUT_ROOT, rel), "PNG")
            paths.append(rel)
        if frames:
            normalize_frame(frames[0], 512).save(os.path.join(OUT_ROOT, f"{state}.png"), "PNG")
            normalize_frame(frames[0], 512).save(os.path.join(THEME_OUT, f"{state}.png"), "PNG")
        fps = 8 if state in ("idle", "sleep") else (12 if state in ("working", "alert", "done") else 10)
        meta["animations"][state] = {
            "frames": paths,
            "fps": fps,
            "loop": state != "wake",
        }

    max_frames = max(len(meta["animations"][s]["frames"]) for s in STATES_ORDER)
    sheet = Image.new("RGBA", (max_frames * 256, len(STATES_ORDER) * 256), (0, 0, 0, 0))
    sheet_meta = {"frameWidth": 256, "frameHeight": 256, "rows": {}}
    for ri, state in enumerate(STATES_ORDER):
        anim = meta["animations"][state]
        sheet_meta["rows"][state] = {
            "row": ri,
            "count": len(anim["frames"]),
            "fps": anim["fps"],
            "loop": anim["loop"],
        }
        for i, rel in enumerate(anim["frames"]):
            fr = Image.open(os.path.join(OUT_ROOT, rel))
            sheet.paste(fr, (i * 256, ri * 256), fr)

    sheet.save(os.path.join(OUT_ROOT, "spritesheet.png"), "PNG")
    sheet.save(os.path.join(THEME_OUT, "spritesheet.png"), "PNG")
    with open(os.path.join(OUT_ROOT, "animations.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    with open(os.path.join(OUT_ROOT, "spritesheet.json"), "w", encoding="utf-8") as f:
        json.dump(sheet_meta, f, indent=2)
    print("Master sheet", sheet.size)
    print("Wrote animations.json")


if __name__ == "__main__":
    main()
