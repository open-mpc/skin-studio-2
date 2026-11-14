# Skin Studio 2

Design the touchscreen skin of an MPC or Force plugin: lay it out, see it live, build the `Plugin Skins/` folder the
[Akai MPC Plugin SDK](https://github.com/inmusic-software/mpc-plugin-builder-sdk) expects, and install it to a connected
MPC or Force. One desktop app, no Python, no Docker.

**Beta.** Windows is the tested platform. See [what has been checked on devices](docs/HARDWARE.md) before you rely on
meters, value pictures or mode artwork.

## Get it

Download `Skin Studio 2-<version>-win.zip` from [Releases](../../releases), unzip, run `Skin Studio 2.exe`. The build is not
code-signed, so Windows SmartScreen will warn: *More info → Run anyway*.

**macOS and Linux (untested).** The release also has `…-mac.zip` (Intel), `…-arm64-mac.zip` (Apple silicon) and a Linux
`.tar.gz`. They are built but have never been run. The Mac apps are unsigned: right-click → Open the first time, or run
`xattr -cr "Skin Studio 2.app"`. On Linux, unpack and run `mpc-skin-studio-2`. Please report what happens.

## What you can do

- **Start from** one of Akai's three example plugins, an SDK build's `params.json` (+ `ui.json`), a plain parameter list,
  an existing `TUI.json` (layout, page colours and custom art are read back), or a saved project.
- **Lay out** on Akai's 4×4 grid or switch a page to free-form: drag, resize, arrow-key nudge. **Select several controls**
  (Shift/Ctrl-click, drag a rectangle on empty canvas, Ctrl+A) and move, align, spread, match size, duplicate or delete
  them together.
- **Controls:** knob, fader, slider, menu, switch, momentary button, value readout, numeric stepper, text, **meter**,
  and `{Increment}` strip pages. Per-control polarity, text sizes, knob size, and *show only when* another parameter is
  on a chosen option.
- **Pictures:** twelve knob looks, your own knob or filmstrip images, page background, placed images, **value pictures**
  (a filmstrip whose frame follows a parameter) and page artwork drawn in Inkscape/Penpot, including artwork that shows
  **only in one mode** of a choice parameter.
- **Q-Links:** pick what each of the 16 knobs turns on each page; focus rectangles are fitted for you.
- **Check** the built skin for touch targets, screen edges, Q-Link and option problems, and **preview** every tab with
  live values.
- **Build** a `Plugin Skins/` folder, or **install** straight to a device over the network (only a plugin's own
  `Plugin Skins` folder is ever replaced; restarting the MPC app is a separate, confirmed step).
- **Skin sets:** several interfaces in one plugin, per the SDK's variants note.

### Layout in Inkscape / Penpot

*Export ▸ Layout SVG* writes one layer per page; each control is a group labelled with its spec, for example
`knob "Cutoff" polarity=bipolar size=56` or `meter "Level" dir=Right`. Move and resize the rectangles, duplicate or delete
groups, retype labels, then *Import SVG*. Anything else you draw in the layer becomes page artwork. A group labelled
`art when="Mode:1"` becomes artwork that shows only while parameter *Mode* is on its second option.

## Build from source

```
npm i
npm test           # golden suites
npm run typecheck
npm run app        # bundle and launch (needs a desktop)
npx electron-builder --win zip --x64 -c.win.signAndEditExecutable=false
```

Design notes, what each module is gated against, and the smoke-test hook: [docs/ENGINEERING.md](docs/ENGINEERING.md).

## Licence

MIT. Parts are a TypeScript port of Akai's SDK tools (MIT, © inMusic Brands, Inc.); see [NOTICE.md](NOTICE.md). No Akai
firmware or stock skin art is in this repository.
