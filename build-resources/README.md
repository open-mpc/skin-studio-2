# build-resources

electron-builder reads app icons and installer assets from here. Drop in (optional — defaults are used
if absent):

- `icon.icns` (macOS), `icon.ico` (Windows), `icon.png` 512×512 (Linux) — the app icon
- `background.png` — the macOS DMG background (optional)

Without these, electron-builder packages with the default Electron icon. Add real icons before a public
release.
