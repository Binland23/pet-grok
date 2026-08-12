#!/usr/bin/env python3
"""Rebuild ~/Desktop/Pet Grok.app for the Pet Grok desktop pet."""
from __future__ import annotations

import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
ICON_PNG = PROJECT / "app" / "icons" / "pet-grok-icon.png"
if not ICON_PNG.is_file():
    ICON_PNG = PROJECT / "app" / "icons" / "play-pet-grok-icon.png"
DESKTOP_APP = Path.home() / "Desktop" / "Pet Grok.app"


def _build_icns(src_png: Path, dest_icns: Path) -> None:
    """Build multi-resolution .icns via sips + iconutil (no Pillow required)."""
    with tempfile.TemporaryDirectory(prefix="PetGrok-iconset-") as td:
        iconset = Path(td) / "AppIcon.iconset"
        iconset.mkdir()
        # Master square PNG for sips resizing
        master = Path(td) / "master.png"
        subprocess.check_call(
            [
                "sips",
                "-s",
                "format",
                "png",
                str(src_png),
                "--out",
                str(master),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        sizes = [
            ("icon_16x16.png", 16),
            ("diana.k@example.org", 32),
            ("icon_32x32.png", 32),
            ("ivan.p@example.net", 64),
            ("icon_128x128.png", 128),
            ("wendy.h@example.net", 256),
            ("icon_256x256.png", 256),
            ("wendy.h@example.net", 512),
            ("icon_512x512.png", 512),
            ("walt.e@example.net", 1024),
        ]
        for name, px in sizes:
            out = iconset / name
            subprocess.check_call(
                [
                    "sips",
                    "-z",
                    str(px),
                    str(px),
                    str(master),
                    "--out",
                    str(out),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        subprocess.check_call(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(dest_icns)]
        )


def main() -> int:
    if not (PROJECT / "app" / "package.json").is_file():
        print("Missing app/package.json", file=sys.stderr)
        return 1
    if not ICON_PNG.is_file():
        print(f"Missing icon: {ICON_PNG}", file=sys.stderr)
        return 1

    if DESKTOP_APP.exists():
        shutil.rmtree(DESKTOP_APP)

    with tempfile.TemporaryDirectory(prefix="PetGrok-build-") as td:
        icns = Path(td) / "AppIcon.icns"
        _build_icns(ICON_PNG, icns)

        macos = DESKTOP_APP / "Contents" / "MacOS"
        resources = DESKTOP_APP / "Contents" / "Resources"
        macos.mkdir(parents=True)
        resources.mkdir(parents=True)
        shutil.copy2(icns, resources / "AppIcon.icns")

    (DESKTOP_APP / "Contents" / "PkgInfo").write_bytes(b"APPL????")
    (DESKTOP_APP / "Contents" / "Info.plist").write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Pet Grok</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>com.findlaybrookman.pet-grok</string>
  <key>CFBundleName</key><string>Pet Grok</string>
  <key>CFBundleDisplayName</key><string>Pet Grok</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.1</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.entertainment</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
"""
    )
    template = Path(__file__).resolve().parent / "desktop-launcher.sh"
    if not template.is_file():
        print(f"Missing template: {template}", file=sys.stderr)
        return 1
    launcher = template.read_text().replace("__PROJECT__", str(PROJECT))
    exe = macos / "Pet Grok"
    exe.write_text(launcher)
    exe.chmod(exe.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    # Resource forks / Finder xattrs break codesign; strip before signing
    subprocess.run(["xattr", "-cr", str(DESKTOP_APP)], check=False)
    subprocess.run(
        ["codesign", "--force", "--deep", "--sign", "-", str(DESKTOP_APP)], check=False
    )
    lsregister = Path(
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
    )
    if lsregister.exists():
        subprocess.run([str(lsregister), "-f", str(DESKTOP_APP)], check=False)
    print(f"Installed: {DESKTOP_APP}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
