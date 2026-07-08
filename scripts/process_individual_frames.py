"""Process single full-body pose images into animation frame packs."""
from __future__ import annotations

import json
import os
from collections import deque
from shutil import copyfile

from PIL import Image, ImageEnhance

SRC = r"C:\Users\finma\.grok\sessions\C%3A%5CGrokington%5CPet_Grok\019f42d7-71cc-77e3-8557-fca091aa9f35\images"
OUT = r"C:\Grokington\Pet_Grok\renderer\assets\race-crab"
THEME = r"C:\Grokington\Pet_Grok\themes\race-crab\sprites"

# Individual full-body poses (not strips)
POSES = {
    "idle": ["17.jpg", "15.jpg", "2.jpg"],
    "thinking": ["16.jpg", "19.jpg", "5.jpg"],
    "working": ["20.jpg", "18.jpg", "4.jpg"],
    "done": ["21.jpg", "26.jpg", "7.jpg"],
    "alert": ["23.jpg", "3.jpg"],
    "sleep": ["25.jpg", "22.jpg", "6.jpg"],
    "wake": ["24.jpg", "17.jpg"],
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
                if r > 160 and b > 160 and g < 145:
                    spill = min(r, b) - g
                    if spill > 28:
                        r = max(0, r - spill // 2)
                        b = max(0, b - spill // 2)
                        g = min(255, g + spill // 4)
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
    # fit inside square keeping aspect
    scale = min((size * 0.92) / im.size[0], (size * 0.92) / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - nw) // 2, (size - nh) // 2 + size // 40), im)
    return canvas


def synthesize_bob(base: Image.Image, n: int = 4) -> list[Image.Image]:
    """Extra smooth idle frames via vertical bob + tiny scale."""
    frames = []
    for i in range(n):
        t = i / max(1, n - 1)
        # sine bob
        import math

        dy = int(math.sin(t * math.pi * 2) * 6)
        sc = 1.0 + math.sin(t * math.pi * 2) * 0.02
        w, h = base.size
        nw, nh = int(w * sc), int(h * sc)
        scaled = base.resize((nw, nh), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        canvas.paste(scaled, ((w - nw) // 2, (h - nh) // 2 + dy), scaled)
        frames.append(canvas)
    return frames


def main():
    frames_dir = os.path.join(OUT, "frames")
    os.makedirs(frames_dir, exist_ok=True)
    os.makedirs(THEME, exist_ok=True)

    meta = {"frameSize": 256, "animations": {}}

    for state, files in POSES.items():
        paths = []
        bases = []
        for i, fname in enumerate(files):
            path = os.path.join(SRC, fname)
            if not os.path.isfile(path):
                print("missing", path)
                continue
            print("process", state, fname)
            im = chroma_key(Image.open(path))
            fr = normalize(im, 256)
            bases.append(fr)
            rel = f"frames/{state}_{len(paths):02d}.png"
            fr.save(os.path.join(OUT, rel), "PNG")
            paths.append(rel)

        # Synthesize extra in-between frames for smoother loops
        if bases:
            extras = synthesize_bob(bases[0], 4 if state in ("idle", "sleep") else 2)
            for fr in extras:
                rel = f"frames/{state}_{len(paths):02d}.png"
                fr.save(os.path.join(OUT, rel), "PNG")
                paths.append(rel)
            # slight brightness pulse for working/alert
            if state in ("working", "alert", "done") and len(bases) > 1:
                for bi, b in enumerate(bases):
                    enh = ImageEnhance.Brightness(b).enhance(1.04 if bi % 2 == 0 else 0.98)
                    rel = f"frames/{state}_{len(paths):02d}.png"
                    enh.save(os.path.join(OUT, rel), "PNG")
                    paths.append(rel)

            # hero single sprite
            bases[0].resize((512, 512), Image.Resampling.LANCZOS).save(
                os.path.join(OUT, f"{state}.png"), "PNG"
            )
            bases[0].resize((512, 512), Image.Resampling.LANCZOS).save(
                os.path.join(THEME, f"{state}.png"), "PNG"
            )

        fps = {
            "idle": 8,
            "thinking": 7,
            "working": 10,
            "done": 10,
            "alert": 12,
            "sleep": 5,
            "wake": 8,
        }.get(state, 8)
        meta["animations"][state] = {
            "frames": paths,
            "fps": fps,
            "loop": state != "wake",
        }
        print(f"  {state}: {len(paths)} frames @ {fps}fps")

    # master sheet
    states = ["idle", "thinking", "working", "done", "alert", "sleep", "wake"]
    max_f = max(len(meta["animations"][s]["frames"]) for s in states)
    sheet = Image.new("RGBA", (max_f * 256, len(states) * 256), (0, 0, 0, 0))
    for ri, state in enumerate(states):
        for i, rel in enumerate(meta["animations"][state]["frames"]):
            fr = Image.open(os.path.join(OUT, rel))
            sheet.paste(fr, (i * 256, ri * 256), fr)
    sheet.save(os.path.join(OUT, "spritesheet.png"), "PNG")
    sheet.save(os.path.join(THEME, "spritesheet.png"), "PNG")
    with open(os.path.join(OUT, "animations.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print("wrote spritesheet", sheet.size)
    print("done")


if __name__ == "__main__":
    main()
