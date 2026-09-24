# Assets Directory

This directory contains app icons and other assets for WhisperWoof.

## Required Icons

For proper app packaging, you'll need the following icon files:

- `icon.icns` - macOS icon (1024x1024 recommended)
- `icon.ico` - Windows icon (16x16 to 256x256)
- `icon.png` - Linux icon and tray fallback (1024x1024)

## Icon Specifications

- **macOS (.icns)**: 1024x1024 pixels, PNG format converted to ICNS
- **Windows (.ico)**: seven sizes from 16x16 to 256x256, stored as PNG entries
- **Linux (.png)**: 1024x1024 pixels, PNG format

## Creating Icons

All three files are generated from `logo.svg` (Mando's head on its background,
drawn to Apple's 824-on-1024 icon grid):

```bash
node scripts/build-app-icon.js   # macOS only: needs Google Chrome, sips, iconutil
CHROME=/path/to/chrome node scripts/build-app-icon.js   # if Chrome isn't in /Applications
```

Edit `logo.svg`, then rerun the script. See `DESIGN.md` for the icon's design rules.

## Placeholder

Until you add your own icons, the app will use system default icons during development.
