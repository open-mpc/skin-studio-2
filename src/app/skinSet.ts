// skinSet.ts — several interfaces in one plugin (v1 make_skinset.py; the SKIN_VARIANTS.md contract).
// MPC binds a skin at insert and cannot reload it, and `when=` hides widgets but never tabs, so interfaces with
// different navigation live in separate subfolders and the plugin copies the chosen one's TUI.json/Q-Links.json to
// the top level (engine contract in SKIN_VARIANTS.md). Layout produced:
//   Plugin Skins/ TUI.json  Q-Links.json  ui.txt          <- the ACTIVE interface (image paths point into its folder)
//                 <name>/ TUI.json  Q-Links.json  <images>  one per interface
import * as fs from "fs";
import * as path from "path";
import { buildDoc } from "./project.ts";
import type { Doc } from "./doc.ts";

export interface SkinSetInput { name: string; doc: Doc }
export interface SkinSetResult { files: Map<string, Buffer | string>; active: string; names: string[] }

const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9_-]{0,30}$/;

/** Prefix every bare image reference with `<name>/` (absolute imports and already-nested paths stay as they are). */
export function rewriteImagePaths(tuiText: string, name: string): string {
  // Text-level on purpose: the builder writes Python-style floats (30.0) and key order the MPC may care about,
  // so nothing but the image names may change.
  return tuiText.replace(/("(?:filmStrip|onImage|offImage|image)"\s*:\s*")([^"\/]+\.(?:png|jpe?g))(")/gi, `$1${name}/$2$3`);
}

export function buildSkinSet(inputs: SkinSetInput[], active: string): SkinSetResult {
  if (inputs.length < 2) throw new Error("a skin set needs at least two interfaces");
  const seen = new Set<string>();
  for (const i of inputs) {
    if (!NAME_OK.test(i.name)) throw new Error(`interface name "${i.name}" must be letters, digits, _ or - (starts with a letter or digit)`);
    if (seen.has(i.name)) throw new Error(`two interfaces are called "${i.name}"`);
    seen.add(i.name);
  }
  if (!seen.has(active)) throw new Error(`active interface "${active}" is not one of: ${[...seen].join(", ")}`);
  // The engine has one parameter list, so every interface must describe the same parameters in the same order.
  const sig = (d: Doc) => d.params.map((p) => p.name).join("\u0000");
  const first = sig(inputs[0].doc);
  for (const i of inputs) if (sig(i.doc) !== first) throw new Error(`interface "${i.name}" has different parameters from "${inputs[0].name}" — all interfaces of one plugin share one parameter list`);

  const files = new Map<string, Buffer | string>();
  let activeTui = "", activeQl = "";
  for (const { name, doc } of inputs) {
    const r = buildDoc(doc);
    const tui = rewriteImagePaths(r.tui, name);
    files.set(`${name}/TUI.json`, tui);
    files.set(`${name}/Q-Links.json`, r.qlinks);
    for (const [n, buf] of Object.entries(r.kitPngs)) files.set(`${name}/${n}.png`, buf);
    if (name === active) { activeTui = tui; activeQl = r.qlinks; }
  }
  files.set("TUI.json", activeTui);
  files.set("Q-Links.json", activeQl);
  files.set("ui.txt", active + "\n");
  return { files, active, names: inputs.map((i) => i.name) };
}

export function writeSkinSet(outDir: string, r: SkinSetResult): string {
  const skinDir = path.join(outDir, "Plugin Skins");
  fs.rmSync(skinDir, { recursive: true, force: true }); // idempotent: a rebuild replaces the previous set
  for (const [rel, data] of r.files) {
    const dest = path.join(skinDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  return skinDir;
}
