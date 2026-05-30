# Pi Token Image

`pi-token.svg` is the placeholder logo for $PIVERSE.

**ClawPump requires PNG, JPEG, GIF, or WebP** (not SVG). Before running `npm run launch-token`:

## Option 1 — convert online
- Open https://cloudconvert.com/svg-to-png or https://svgtopng.com
- Upload `pi-token.svg`, set 1024x1024, download as `pi-token.png`
- Drop it next to `pi-token.svg`

## Option 2 — use ImageMagick / rsvg-convert (CLI)
```bash
# macOS / Linux
brew install librsvg     # macOS
# or: apt install librsvg2-bin   # Ubuntu

rsvg-convert -w 1024 -h 1024 pi-token.svg -o pi-token.png
```

## Option 3 — use your own design
Drop any image named `pi-token.png` here. Max 5 MB. Recommended 512x512 or 1024x1024.

After it's in place, the launch script will pick it up automatically.
