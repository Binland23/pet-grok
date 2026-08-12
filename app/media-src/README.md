# Local source media

Place optional animation source videos at `<theme-id>/<state>.mp4`, then run
`python3 scripts/video_to_smooth_frames.py <theme-id>` to regenerate the
runtime PNG frames and manifest.

MP4 files in this folder are intentionally ignored. They are development
inputs, not runtime assets, and must not be bundled with Pet Grok.
