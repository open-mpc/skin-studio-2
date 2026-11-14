# Skin Studio 2 — engineering notes

Engineering notes for Skin Studio 2: how it is built, what each module is gated against, and how the editor works.
For what it is and how to use it, see the [README](../README.md).

## The no-regression contract

v1's value is the **device knowledge** baked into its Python modules, not their code. Every module
ported here must reproduce v1's behaviour exactly. The method, proven first on `skin_check`:

1. **v1 is the oracle.** Freeze v1's output over a corpus of real + synthetic fixtures
   (`scripts/freeze-goldens.sh` → `test/golden/*.goldens.json`).
2. **Port faithfully** to TypeScript, mirroring wording, number formatting and ordering — not just
   logic. See the header of `src/core/skinCheck.ts`.
3. **Gate on exact parity.** `npm run test:golden` fails on any byte difference from v1.
4. **To change behaviour:** change the oracle first, re-freeze, then mirror here. Never diverge silently.

## Two oracles, by design

The **basis and all starting defaults are Akai's**, not force-shadow's (see the plan's "Defaults and basis"
decision). So modules split by which oracle they are gated against:

- **Base builder + defaults → oracle is the SDK's `gen_ui.py`.** The canonical `ui.json → TUI.json/Q-Links.json`
  path and the new-plugin templates/kits (cyan, mpc-red) are Akai's. Its own output is, by definition, correct.
- **Extensions → Akai-first, judged capability diff (not "reproduce v1").** "No regression" means *lose no
  capability*, and where the SDK provides an equivalent **Akai is the base and wins ties**; v1 survives only
  as a genuine delta the SDK lacks, re-expressed on Akai's widgets/model. Per extension, a recorded ledger
  (BASE / KEEP / DROP + why) makes "nothing lost" auditable — see the plan's "extensions method" + "Ledger 1".
  Gate = behaviour (the emitted ui.json/TUI builds correctly), not byte-match against v1.

## Status

| Module | Oracle / source | Ported | Golden parity |
|---|---|---|---|
| `skinCheck` (TOUCH/EDGE/QLINK/OPTS) | v1 `tools/skin_check.py` | ✅ `src/core/skinCheck.ts` | ✅ 7 fixtures (incl. cratedigger, 239 findings) |
| `skinCompat` (2.x/3.x shape) | v1 `tools/skin_compat.py` | ✅ `src/core/skinCompat.ts` | ✅ 7 fixtures |
| **`uiBuilder`** (ui.json → TUI.json/Q-Links.json) | **SDK `gen_ui.py`** | ✅ `src/core/uiBuilder.ts` | ✅ 3 fixtures byte-for-byte: knob/switch/bipolar, fader/slider-menu/visibleWhen, auto no-ui |
| `uiKit` (kit PNG assets + kit.json) | SDK `make_ui_kit.py` | ✅ `src/core/uiKit.ts` | ✅ 18 PNGs + manifest byte-for-byte (`uikit/mpc-red.sha256.json`); verified exact across all 6 themes + custom accent |
| auto-layout — widget selector (extension) | Akai-first (plan Ledger 1) | ✅ `src/core/paramLayout.ts` `widgetFor` | ✅ 16 cases |
| auto-layout — packer + ui.json emit (extension) | v1 packer knowledge, Akai widgets | ✅ `paramLayout.ts` `packLayout`/`toUiJson`/`toParamsJson` | ✅ chain builds TUI.json via uiBuilder (5 cases) |
| auto-layout — full-TUI button + readout (extension) | Akai full TUI (ui-reference) | ✅ `uiBuilder.generateFromControls` + `paramLayout.toControlSpecs` | ✅ `fullTui.golden.ts` + **HARDWARE-VERIFIED on MPC Live III (3.10.1, aarch64)**: tabs load (no silent fail), button renders + focuses on touch, readout non-interactive. (Via a standalone test plugin — bypasses the device's Plugin-Manager sync.) |
| auto-layout — param loader/importer (extension) | v1 `params.py` + schwung adapter | ✅ `paramLayout.loadParamFile` | ✅ 4 cases (array / {params,sections} / module.json) |
| full-TUI stepper (NumericOverlay) | Akai full TUI | ✅ `uiBuilder` stepper + `numeric overlay` (conditional) | ✅ `fullTui.golden.ts` + **HARDWARE-VERIFIED (Live III 3.10.1)**: renders as a value field, double-tap opens the numeric keypad |
| full-TUI {Increment} result-rows | Akai full TUI §4.6 | ✅ `uiBuilder` `repeat` emitted as the **tab root** (v3 `repeats` + `{Increment:Base}`) | ✅ `fullTui.golden.ts` + **HARDWARE-VERIFIED on MPC Force 3.9.1**: 7 live bars render as tab root; the referenced-sub-component form renders nothing. A repeat strip must be the only control on its page. **Packer wired:** a run of ≥2 consecutive `type:"slot"` params becomes a dedicated strip page; a lone slot falls back to a plain control |
| preview core — TUI→draw-ops interpreter (extension) | Akai-first (plan Ledger 2) | ✅ `src/core/preview.ts` | ✅ 17 cases: bg, filmstrip knob/fader frame math, toggle/seg buttons, generic knob/slider, Name/Value labels via handle remapping, `visibleWhen` (incl. live state) |
| preview — SVG backend (Electron Chromium rasterises) | KEEP (html_art technique) | ✅ `src/core/previewSvg.ts` | ✅ 11 cases: filmstrip frame slicing (clip+offset), text anchoring, generic knob/bar vectors, embeddable hrefs |
| look library — all 12 knob looks | KEEP as opt-in looks (plan Ledger 3) | ✅ `src/core/looks.ts` | ✅ moog/chicken/metal/cap/prophet/hardware/chrome/bakelite/davies/rubber/ledring/taper |
| **full loop backbone** (params → built folder + preview) | all core modules | ✅ `src/app/project.ts` | ✅ `project.golden.ts` end-to-end |
| Electron shell (open · preview · build · install) | plan architecture | ✅ `electron/` (bundles; **unverified — needs display**) | — |
| packaging (Win/Mac/Linux installers) | electron-builder | ✅ `package.json` "build" + `npm run dist*` | `npm run dist:dir` **builds on Linux x64** (app.asar holds main/preload/renderer). Fixed a launch-crash found here (`import.meta` in CJS bundle). Runtime launch + Win/Mac installers still need a desktop/host (headless WSL lacks libnss3/display) |
| device install service — commands, tar pipeline, safety rails | SDK `tools/mpc_remote.py` (BASE) | ✅ `src/app/device.ts` | ✅ 30 cases; **SSH I/O HARDWARE-VERIFIED**: info/drives/list/add/remove/restart ran live on both an MPC Force (3.9.1) and Live III (3.10.1). Fixed a real `pipeIn` EPIPE crash the hardware surfaced. |
| looks / assets / hardware (extension) | v1 `skin_assets.py`, `shadow_skin.py` | ☐ | |
| device install | SDK `tools/mpc_remote.py` | ☐ | |

**Base path complete.** `uiBuilder` + `uiKit` together reproduce the entire Akai-default output
(TUI.json, Q-Links.json, every kit PNG, kit.json) byte-for-byte, in pure TypeScript — no Python, no
Docker. NB: the kit raster passes through libm transcendentals and V8's fdlibm disagrees with CPython's
libm in the last ULP on ~half of inputs; it was verified that this never survives 8-bit quantization
here, so the gate is exact PNG hash. zlib is identical (1.3.1) both sides.

**Next unit:** the extensions layer, gated against v1: params/auto-layout (`params.py`, `studio.py auto`),
the `html_art` renderer, then looks/assets/hardware (`skin_assets.py`, `shadow_skin.py`). These are opt-in
on the Akai base, never defaults.

## The editor (Electron app)

Open **parameters**, an existing **skin (TUI.json)** or a saved **project**; edit on Akai's 4×4 grid
(widget type, parameter, text, polarity, show-when, drag to swap, rename/add/move/delete pages, `{Increment}`
strip pages, rename parameters, kit theme); live per-tab preview; built-skin **Checks** (TOUCH/EDGE/QLINK/OPTS);
undo/redo (Ctrl+Z / Ctrl+Y); **Save** (`.skin2.json`); **Build** (writes `Plugin Skins/`); **Install** (device IP →
scan → pick an installed plugin → replaces only its `Plugin Skins`, via `DeviceService`; restart is a separate,
confirmed step). Logic is in tested `src/app/{doc,project,installSkin}.ts` (`doc`/`installSkin` golden suites);
the Electron UI itself is thin and verified only by a launch on Windows.
**Free-form layout.** *Make free-form* on a page, then drag controls on the preview (10 px snap, Alt = free, arrow
keys nudge, Shift = 10) — the format allows any bounds (ui-reference §1.4); the 4×4 grid is only gen_ui's default.
Converting is invisible (same TUI/Q-Links). **Q-Links:** a 4×4 knob-layout editor (explicit set per page, or auto);
focus rectangles auto-fit each bank of four, drawn dashed on the preview. **Images & looks:** the 12 knob looks, an
image turned through 270°, or an uploaded filmstrip as a knob/fader (per control or "use for every knob"); page
background; placed images (logo/panel). Looks/images are rendered to PNG filmstrips in the app (canvas) and stored in the
project (`assets`); headless-tested: strips, backgrounds, placed images, asset lifecycle, free-form round trip.
**Starting points.** *New from template…* gives Akai's three example plugins (Simple Synth, Stereo Delay, Drum Synth:
their own `ui.json` + host_sim parameter tables); *Open SDK params.json…* takes any SDK build's `params.json` (plus
the `ui.json` beside it) — the ui.json → TUI.json path is byte-identical to `gen_ui.py` on the Akai fixtures.
**Colours:** background/accent/text/label pickers (reset = Akai defaults). **Size:** per-control touch box (free-form)
and knob picture size. **Custom art import:** opening a skin from its folder brings in knob filmstrips, backgrounds and
placed images.
**SVG round trip.** *Export SVG…* writes one Inkscape layer per page; each control is a group labelled with its spec
(`knob "Cutoff" polarity=bipolar size=56`) around the rectangle that is its position/size. Move/resize rectangles,
duplicate/delete groups, retype labels, then *Import SVG…*. Export→import is byte-identical on the Akai templates;
translate/scale transforms from the drawing tool are honoured, rotations of a control are ignored with a note.
**Artwork:** anything else drawn in a layer (shapes, text, gradients, logos, groups with your own label) becomes that
page's artwork — rendered to a full-tab image above the background and behind the controls, with its SVG source kept in
the project so the next export puts it back as editable shapes (edit → re-rendered into the same image; delete the
drawings → image removed). Top-level `<defs>` come along; linked (not embedded) images are flagged; strip pages take
no artwork. **Devices:** Install handles both layouts — `VST2 Plugins` (MPC OS 3.10+) and `Synths`
(3.9.x Force) — replacing only a plugin's `Plugin Skins` (staged swap; refuses non-SDK folders; read-only partitions
skipped). Hardware-checked on the Force: replaced a skin, left other files alone, refused a non-SDK folder.
**Skin sets.** *Skin set…* combines two or more saved projects (one per interface; all must share the same parameter
list) into one `Plugin Skins` folder per `SKIN_VARIANTS.md`: a subfolder per interface, the active one's
`TUI.json`/`Q-Links.json` at the top level with image paths rewritten into its folder, and `ui.txt`. The plugin's engine
does the switching (MPC binds a skin at insert; contract in SKIN_VARIANTS.md). **Text size:** per-control name/value text
size (0 hides) for knobs, faders and sliders.
**Page-colour import:** opening a skin reads its background, accent and name/value text colours back (only those that
differ from Akai's defaults), and selects the kit theme when the accent is a kit theme's.
Import limits (stated): TUI.json holds no defaults (floats→0.5, choices→0); kit pictures are redrawn from the kit
theme; non-standard widgets import as empty slots with a warning.

## Running the app (Electron shell)

```
npm i
npm run app          # bundles electron/ then launches (needs a desktop; not possible in WSL without libnss3)
```

The window (`electron/renderer/`) is a thin layer over the tested backbone (`src/app/`):

- **Start screen** — Akai example templates, the four ways to open something, recent projects.
- **Top bar / menu** — New, Open, Save, undo/redo, view toggles (Q-Links, Outlines), zoom, Export (layout SVG, skin
  set), Build, Install. The native File/Edit/View menu carries the same commands with shortcuts (Ctrl+O/S/B/I/Z/D/L/H/0/1).
- **Left** — *Add control* palette (goes into the selected empty slot, or onto a free-form page) and the list of the
  page's controls.
- **Centre** — page tabs (double-click renames, right-click for move/delete, ＋ adds a page or strip page) and the
  canvas. Grid pages: drag a control onto another slot to move/swap. Free-form pages (explicit switch, top right):
  drag anywhere, corner handle resizes, arrows nudge. Right-click for Duplicate/Delete; Del and Ctrl+D work too.
  A control with *Show when* is tagged on the canvas, and selecting a hidden one switches the preview to its mode.
- **Right** — Inspect (fields apply as you change them; *Preview value* moves the skin without saving anything),
  Q-Links, Colours (kit + page colours), Images, Params, Checks (badge = problems + import notes).

**Checking the window without a person:** `--smoke=<dir>` runs `<dir>/steps.json` (`[{ "js": "...", "shot": "name" }]`;
a step may return `{ input: [...] }` for real mouse/key events), writes `<name>.png` per step and `log.txt` (console
output), then quits. From WSL: copy `dist/win-unpacked` to the Windows `%TEMP%`, replace `resources/app.asar` with a
`resources/app/` folder holding `package.json` + the bundled `electron/` files, and run the `.exe` with that flag.

### Packaging (electron-builder)

Build distributable installers (needs a desktop + the dev deps installed):

```
npm i                 # installs electron, electron-builder, esbuild
npm run dist:dir      # quick unpacked build (sanity check, no installer)
npm run dist          # installer(s) for the current OS → dist/
npm run dist:all      # macOS .dmg/.zip, Windows NSIS, Linux AppImage/.deb (needs the right hosts)
```

Config lives in `package.json` `"build"`. `main.cjs` is a self-contained bundle (only `electron` is
external), so the packaged app ships just the bundled files — no `node_modules` tree. Icons go in
`build-resources/` (defaults used if absent). **Unverified here** — no desktop/toolchain in this
environment; the config is complete and the bundle step is proven.

## Commands

```
npm install
npm test                # all parity gates against v1
npm run typecheck       # tsc --noEmit
npm run freeze:goldens  # re-freeze from v1 (only when v1 intentionally changes)
```

Golden fixtures are real built skins (`dexed-clean`, `mpc-vst-acid`, `mpc-vst-welle`, `mpc-vst-dx7`,
`mpc-vst-cratedigger`) plus synthetic ones that exercise finding types the real corpus didn't
(`synthetic-edge`, `synthetic-opts`).
