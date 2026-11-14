// project.ts — the Studio 2 orchestration backbone (the full loop, minus device install).
//
// Ties every core module into one pipeline: a parameter file → a built SDK "Plugin Skins" folder +
// a live preview. This is the headless heart of the Electron shell; the UI (main/renderer) is a thin
// wrapper over these functions, so the whole loop is testable without a browser.
//
//   loadParamFile → packLayout → toControlSpecs → uiBuilder.generateFromControls → TUI.json/Q-Links.json
//   + uiKit.renderKit (byte-exact kit PNGs) + preview (TUI → draw-ops → SVG)

import * as fs from "fs";
import * as path from "path";
import { docFromParamFile, paramsJson, assetFile, type Doc } from "./doc.ts";
import { generateFromControls, type KitInfo, type KitAssets } from "../core/uiBuilder.ts";
import { renderKit } from "../core/uiKit.ts";
import { renderMeter, meterAssetNames } from "../core/meterArt.ts";
import { DEFAULT_STYLE } from "../core/uiBuilder.ts";
import { TuiPreview, type PreviewParam, type RenderState } from "../core/preview.ts";
import { renderSvg } from "../core/previewSvg.ts";

export interface BuildResult {
  tui: string; // TUI.json text
  qlinks: string; // Q-Links.json text
  kit: KitInfo | null;
  kitPngs: Record<string, Buffer>; // asset name -> PNG bytes (only those the skin references)
  previewSvg: string; // self-contained preview of tab 0
  previewSvgs: string[]; // one per tab
  params: PreviewParam[];
  tabNames: string[];
}

// Turn a uiKit manifest into the [file, frames, [w,h]] shape uiBuilder consumes.
function kitAssetsFor(theme: string): { assets: KitAssets; pngs: Record<string, Buffer> } {
  const kit = renderKit(theme);
  const man = JSON.parse(kit.manifestJson) as { assets: Record<string, { file: string; width: number; height: number; frames: number }> };
  const assets: KitAssets = {};
  for (const [name, a] of Object.entries(man.assets)) assets[name] = [a.file, a.frames, [a.width, a.height]];
  return { assets, pngs: kit.pngs };
}

export interface BuildOptions {
  theme?: string; // kit theme (default mpc-red)
  state?: RenderState; // live preview values; defaults used otherwise
}

/** Build a skin from an already-parsed parameter file (any supported shape). */
export function buildFromParams(paramFile: unknown, opts: BuildOptions = {}): BuildResult {
  return buildDoc(docFromParamFile(paramFile, "Untitled", opts.theme ?? "mpc-red"), opts);
}

/** Build + preview (every tab) from an editable Doc — the one path the editor, import and params all use. */
export function buildDoc(doc: Doc, opts: BuildOptions = {}): BuildResult {
  const theme = opts.theme ?? doc.theme ?? "mpc-red";
  let allPngs: Record<string, Buffer> = {};
  const resolveKit = (_: KitInfo): KitAssets => {
    const k = kitAssetsFor(theme);
    allPngs = k.pngs;
    return k.assets;
  };
  const pj = paramsJson(doc);
  const custom: KitAssets = {};
  const customPngs: Record<string, Buffer> = {}; // file name → bytes
  for (const [n, a] of Object.entries(doc.assets ?? {})) {
    custom[n] = [assetFile(n), a.frames, [a.w, a.h]];
    customPngs[assetFile(n)] = Buffer.from(a.png, "base64");
  }
  // Meters draw from two pictures sized to the control: make them here (they are derived, never stored in the doc).
  for (const pg of doc.pages)
    pg.controls.forEach((c, i) => {
      if (c.full !== "meter") return;
      const [w, h] = c.bounds ? [c.bounds[2], c.bounds[3]] : [278, 107];
      const nm = meterAssetNames(w, h);
      if (custom[nm.off]) return;
      const st = { ...DEFAULT_STYLE, ...(doc.style ?? {}) };
      const art = renderMeter(w, h, st.accent, st.muted);
      for (const [key, buf] of [[nm.off, art.off], [nm.on, art.on]] as const) {
        const dv = buf; const aw = dv.readUInt32BE(16), ah = dv.readUInt32BE(20);
        custom[key] = [assetFile(key), 1, [aw, ah]];
        customPngs[assetFile(key)] = buf;
      }
      void i;
    });
  const gen = generateFromControls(pj, doc.pages, resolveKit, custom, doc.style ?? {});
  const previewParams: PreviewParam[] = (pj as any).params;
  const tui = JSON.parse(gen.tui);
  const pv = new TuiPreview(tui, previewParams, opts.state);
  const referenced = referencedImages(gen.tui);
  const dataUri = (src: string) => {
    const name = src.replace(/\.png$/, "");
    const buf = customPngs[src] ?? allPngs[name];
    return buf ? "data:image/png;base64," + buf.toString("base64") : src;
  };
  const tabNames = pv.tabNames();
  const previewSvgs = tabNames.map((_, i) => renderSvg(pv.render(i), { background: "ff1e1d1e", imageHref: dataUri }));
  const kitPngs: Record<string, Buffer> = {};
  for (const name of Object.keys(allPngs)) if (referenced.has(name + ".png")) kitPngs[name] = allPngs[name];
  for (const [file, buf] of Object.entries(customPngs)) if (referenced.has(file)) kitPngs[file.replace(/\.png$/, "")] = buf;
  return { tui: gen.tui, qlinks: gen.qlinks, kit: gen.kit, kitPngs, previewSvg: previewSvgs[0] ?? "", previewSvgs, params: previewParams, tabNames };
}

function referencedImages(tuiText: string): Set<string> {
  const out = new Set<string>();
  for (const m of tuiText.matchAll(/"(?:filmStrip|onImage|offImage|image|inactiveImage|peakImage|rmsImage)":\s*"([^"]+\.png)"/g)) out.add(m[1]);
  return out;
}

/** Write the SDK plugin "Plugin Skins" folder (TUI.json, Q-Links.json, referenced kit PNGs). */
export function writePluginSkins(outDir: string, r: BuildResult): string {
  const skinDir = path.join(outDir, "Plugin Skins");
  fs.mkdirSync(skinDir, { recursive: true });
  fs.writeFileSync(path.join(skinDir, "TUI.json"), r.tui);
  fs.writeFileSync(path.join(skinDir, "Q-Links.json"), r.qlinks);
  for (const [name, buf] of Object.entries(r.kitPngs)) fs.writeFileSync(path.join(skinDir, name + ".png"), buf);
  return skinDir;
}
