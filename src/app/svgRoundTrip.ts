// svgRoundTrip.ts — edit a skin's LAYOUT in Inkscape/Penpot and bring it back (v1's layout.svg round trip,
// re-expressed on Akai's model). Export: one layer per page ("tab NAME"); each control is a group whose
// label is its spec ("knob "Cutoff" polarity=bipolar") containing the rectangle that IS its position/size.
// Edit in the drawing tool: move/resize a rectangle, duplicate or delete a group, retype a label. Import
// reads that back into a Doc (every page becomes free-form with explicit bounds + Q-Links).
//
// Label grammar:  <kind> "<parameter>" [polarity=unipolar|bipolar] [size=N] [strip=asset] [when="Param:index"]
//                 [count=N] [dir=Up|Down|Left|Right (meter)]   — kinds: knob fader slider slidermenu switch button readout stepper repeat meter
//                 text "<words>"
// Artwork — anything drawn in a layer that is not a control group (shapes, text, gradients, logos, groups
// with a label of your own) — is kept as the page's artwork: its SVG source stays in the project (so the
// next export puts it back as editable shapes) and the app renders it to a full-tab image that sits above
// the background and behind the controls. Gradients/filters in the file's top-level <defs> come along.
import type { ArtMode, ControlSpec, PageSpec } from "../core/uiBuilder.ts";
import { makeFree, type Doc } from "./doc.ts";

const SW = 1280, SH = 628;

// ---- label <-> spec ------------------------------------------------------------------------------
const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
export function specToLabel(c: ControlSpec): string {
  if (c.text !== undefined) return `text ${q(c.text)}`;
  let kind = c.widget ?? "slider";
  if (c.full === "button") kind = "button";
  else if (c.full) kind = c.full;
  else if (c.widget === "slider" && c.overlay === "menu") kind = "slidermenu";
  const out = [kind, q(c.param ?? "")];
  if (c.polarity && c.polarity !== "auto") out.push(`polarity=${c.polarity}`);
  if (c.size) out.push(`size=${c.size}`);
  if (c.nameSize !== undefined) out.push(`ns=${c.nameSize}`);
  if (c.valueSize !== undefined) out.push(`vs=${c.valueSize}`);
  if (c.strip) out.push(`strip=${c.strip}`);
  if (c.visibleWhen) out.push(`when=${q(`${c.visibleWhen.param}:${c.visibleWhen.index ?? 0}`)}`);
  if (c.full === "repeat") out.push(`count=${c.repeatCount ?? 8}`);
  if (c.full === "meter" && c.meterDir && c.meterDir !== "Up") out.push(`dir=${c.meterDir}`);
  return out.join(" ");
}
const KINDS = new Set(["knob", "fader", "slider", "slidermenu", "switch", "button", "readout", "stepper", "repeat", "meter", "text"]);
export function labelToSpec(label: string): ControlSpec | string {
  const toks: string[] = [];
  for (const m of label.matchAll(/(?:[^\s"=]+=)?"((?:[^"\\]|\\.)*)"|(\S+)/g)) toks.push(m[0]);
  const unq = (t: string) => t.replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");
  const kind = toks[0];
  if (!kind || !KINDS.has(kind)) return `unrecognised control label "${label}"`;
  if (kind === "text") return { text: unq(toks[1] ?? '""') };
  const param = unq(toks[1] ?? '""');
  if (!param) return `label "${label}" needs a quoted parameter name`;
  const s: ControlSpec = { param };
  if (kind === "button") s.full = "button";
  else if (kind === "readout" || kind === "stepper" || kind === "repeat" || kind === "meter") s.full = kind;
  else if (kind === "slidermenu") { s.widget = "slider"; s.overlay = "menu"; }
  else s.widget = kind;
  for (const t of toks.slice(2)) {
    const eq = t.indexOf("=");
    if (eq < 0) return `label "${label}": unexpected "${t}"`;
    const k = t.slice(0, eq), v = unq(t.slice(eq + 1));
    if (k === "polarity") { if (v !== "unipolar" && v !== "bipolar" && v !== "auto") return `label "${label}": bad polarity`; s.polarity = v as any; }
    else if (k === "size") s.size = parseInt(v, 10);
    else if (k === "ns") s.nameSize = parseInt(v, 10);
    else if (k === "vs") s.valueSize = parseInt(v, 10);
    else if (k === "strip") s.strip = v;
    else if (k === "count") s.repeatCount = parseInt(v, 10);
    else if (k === "dir") { if (!["Up", "Down", "Left", "Right"].includes(v)) return `label "${label}": dir must be Up, Down, Left or Right`; s.meterDir = v as any; }
    else if (k === "when") { const i = v.lastIndexOf(":"); s.visibleWhen = { param: v.slice(0, i), index: parseInt(v.slice(i + 1), 10) || 0 }; }
    else return `label "${label}": unknown option "${k}"`;
  }
  return s;
}

// ---- minimal XML --------------------------------------------------------------------------------
interface XNode { tag: string; attrs: Record<string, string>; kids: XNode[]; start: number; end: number } // [start,end) in the source text
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function parseXml(text: string): XNode {
  const root: XNode = { tag: "#root", attrs: {}, kids: [], start: 0, end: text.length };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[2]) continue; // comment / pi / doctype / cdata
    if (m[1]) { if (stack.length > 1) stack.pop()!.end = re.lastIndex; continue; }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unesc(a[2] ?? a[3] ?? "");
    const node: XNode = { tag: m[2], attrs, kids: [], start: m.index, end: re.lastIndex };
    stack[stack.length - 1].kids.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}

// ---- transforms (translate / scale / matrix without rotation) ------------------------------------
type T = { sx: number; sy: number; tx: number; ty: number };
const ID: T = { sx: 1, sy: 1, tx: 0, ty: 0 };
const compose = (p: T, c: T): T => ({ sx: p.sx * c.sx, sy: p.sy * c.sy, tx: p.sx * c.tx + p.tx, ty: p.sy * c.ty + p.ty });
function parseTransform(s: string | undefined, warn: (m: string) => void): T {
  let t = ID;
  for (const m of (s ?? "").matchAll(/(translate|scale|matrix|rotate|skewX|skewY)\(([^)]*)\)/g)) {
    const n = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (m[1] === "translate") t = compose(t, { sx: 1, sy: 1, tx: n[0] ?? 0, ty: n[1] ?? 0 });
    else if (m[1] === "scale") t = compose(t, { sx: n[0] ?? 1, sy: n[1] ?? n[0] ?? 1, tx: 0, ty: 0 });
    else if (m[1] === "matrix" && n.length === 6 && n[1] === 0 && n[2] === 0) t = compose(t, { sx: n[0], sy: n[3], tx: n[4], ty: n[5] });
    else warn(`a ${m[1]} transform was ignored — controls are axis-aligned rectangles`);
  }
  return t;
}

// ---- export --------------------------------------------------------------------------------------
const COL: Record<string, string> = { knob: "#d31145", fader: "#e08a1e", slider: "#3a86d9", slidermenu: "#3a86d9", switch: "#2fa66a", button: "#a24fd0", readout: "#888", stepper: "#c9b02a", repeat: "#d31145", meter: "#19a7a0", text: "#666" };

/** Export every page as an Inkscape layer. Pages are made free-form first (an invisible change). */
export function exportSvg(doc: Doc): string {
  // A visibleWhen written with a choice label becomes its index (the label grammar carries indices).
  let d: Doc = { ...doc, pages: doc.pages.map((pg) => ({ ...pg, controls: pg.controls.map((c) => {
    const vw = c.visibleWhen;
    if (!vw || vw.choice === undefined) return c;
    const ch = doc.params.find((p) => p.name === vw.param)?.choices ?? [];
    const i = ch.findIndex((x) => String(x).toLowerCase() === String(vw.choice).toLowerCase());
    return { ...c, visibleWhen: { param: vw.param, index: i < 0 ? 0 : i } };
  }) })) };
  d.pages.forEach((pg, i) => { if (!pg.controls.some((c) => c.full === "repeat")) d = makeFree(d, i); });
  const layers = d.pages.map((pg, pi) => {
    const strip = pg.controls.find((c) => c.full === "repeat");
    const groups = strip
      ? [grp(`c${pi}_0`, strip, [0, 0, SW, SH])]
      : pg.controls.map((c, i) => (c.empty ? "" : grp(`c${pi}_${i}`, c, c.bounds ?? [0, 0, 278, 107])));
    const art = !strip && (pg.art?.svg || pg.art?.modes?.length) ? pg.art : null;
    const meta = JSON.stringify({ ...(pg.qlinks ? { qlinks: pg.qlinks } : {}), ...(pg.qlinkBounds ? { qlinkBounds: pg.qlinkBounds } : {}), ...(pg.background ? { background: pg.background } : {}), ...(pg.images ? { images: pg.images } : {}), ...(art?.asset ? { art: art.asset } : {}), ...(art?.modes?.some((m) => m.asset) ? { artModes: Object.fromEntries(art.modes.filter((m) => m.asset).map((m) => [`${m.param}:${m.index}`, m.asset])) } : {}) });
    return `  <g inkscape:groupmode="layer" inkscape:label="${esc("tab " + pg.name)}" id="layer${pi}" style="display:${pi === 0 ? "inline" : "none"}">\n    <desc>${esc(meta)}</desc>\n    <rect inkscape:label="screen" x="0" y="0" width="${SW}" height="${SH}" fill="#1e1d1e" stroke="#444" pointer-events="none" />\n${art?.svg ? art.svg + "\n" : ""}${art ? modeGroups(art.modes) : ""}${groups.join("\n")}\n  </g>`;
  });
  const hasArt = d.pages.some((pg) => pg.art?.svg || pg.art?.modes?.length);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Skin Studio 2 layout. Edit control rectangles/labels; see src/app/svgRoundTrip.ts for the label grammar. -->\n<svg ${SVG_NS} width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}">\n${hasArt && d.artDefs ? d.artDefs + "\n" : ""}${layers.join("\n")}\n</svg>\n`;
}
const modeGroups = (modes: ArtMode[] | undefined): string => (modes ?? []).map((m) => `    <g inkscape:label="${esc(`art when=${q(`${m.param}:${m.index}`)}`)}">\n${m.svg}\n    </g>\n`).join("");
const SVG_NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"';

/** A page's artwork as a standalone 1280×628 SVG document, ready to be rendered to its full-tab image. */
export function artDocument(doc: Doc, page: number, mode?: number): string | null {
  const art = doc.pages[page]?.art;
  const svg = mode === undefined ? art?.svg : art?.modes?.[mode]?.svg;
  if (!svg) return null;
  return `<svg ${SVG_NS} width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}">\n${doc.artDefs ?? ""}\n${svg}\n</svg>\n`;
}
function grp(id: string, c: ControlSpec, b: number[]): string {
  const label = specToLabel(c);
  const kind = label.split(" ")[0];
  const [x, y, w, h] = b;
  return `    <g id="${id}" inkscape:label="${esc(label)}">\n      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${COL[kind] ?? "#777"}" fill-opacity="0.35" stroke="${COL[kind] ?? "#777"}" />\n      <text x="${x + 8}" y="${y + 20}" font-family="sans-serif" font-size="16" fill="#fff">${esc(c.text ?? c.param ?? "")}</text>\n    </g>`;
}

// ---- import --------------------------------------------------------------------------------------
/**
 * Read an edited layout SVG back. `art` lists the pages (by index) whose artwork is new or changed and so
 * needs rendering: pass `artDocument(result.doc, page)` through a rasteriser and store it with setPageArt.
 */
export function importSvg(doc: Doc, svgText: string): { doc: Doc; warnings: string[]; art: number[]; artModes: { page: number; mode: number }[] } {
  const warnings: string[] = [];
  const root = parseXml(svgText);
  const svg = root.kids.find((k) => k.tag === "svg");
  if (!svg) throw new Error("not an SVG file");
  const names = new Set(doc.params.map((p) => p.name));
  const layers = svg.kids.filter((k) => k.tag === "g" && k.attrs["inkscape:groupmode"] === "layer");
  if (!layers.length) throw new Error("no layers found — export the layout from Skin Studio first, then edit that file");
  const pages: PageSpec[] = [];
  const artPages: number[] = [];
  const artModePages: { page: number; mode: number }[] = [];
  const dropAssets = new Set<string>();
  const raw = (n: XNode) => svgText.slice(n.start, n.end);
  const artDefs = svg.kids.filter((k) => k.tag === "defs" || k.tag === "svg:defs").map(raw).join("\n");
  const isCtl = (k: XNode) => k.tag === "g" && !!k.attrs["inkscape:label"] && k.kids.some((r) => r.tag === "rect") && KINDS.has(k.attrs["inkscape:label"].trim().split(/\s+/)[0]);
  const hasCtl = (k: XNode): boolean => isCtl(k) || k.kids.some(hasCtl);
  const NOT_ART = new Set(["desc", "title", "metadata", "sodipodi:namedview"]);
  for (const L of layers) {
    const label = L.attrs["inkscape:label"] ?? `${pages.length + 1}`;
    const name = label.replace(/^tab\s+/, "");
    const lt = parseTransform(L.attrs.transform, (m) => warnings.push(`layer "${name}": ${m}`));
    const page: PageSpec = { name, controls: [] };
    const desc = L.kids.find((k) => k.tag === "desc") as any;
    void desc;
    // <desc> text content: re-scan the raw text for this layer's desc (our parser drops text nodes)
    const meta = metaFor(svgText, L.attrs.id);
    if (meta) {
      if (meta.qlinks) page.qlinks = meta.qlinks;
      if (meta.qlinkBounds) page.qlinkBounds = meta.qlinkBounds;
      if (meta.background) page.background = meta.background;
      if (meta.images) page.images = meta.images;
    }
    const visit = (n: XNode, t: T) => {
      for (const k of n.kids) {
        if (k.tag !== "g") continue;
        const kt = compose(t, parseTransform(k.attrs.transform, (m) => warnings.push(`layer "${name}": ${m}`)));
        const lab = k.attrs["inkscape:label"];
        const rect = k.kids.find((r) => r.tag === "rect");
        if (!lab || !rect || !isCtl(k)) { visit(k, kt); continue; }
        const spec = labelToSpec(lab);
        if (typeof spec === "string") { warnings.push(`layer "${name}": ${spec} — skipped`); continue; }
        if (spec.param && !names.has(spec.param)) { warnings.push(`layer "${name}": unknown parameter "${spec.param}" — skipped`); continue; }
        const rt = compose(kt, parseTransform(rect.attrs.transform, (m) => warnings.push(`layer "${name}": ${m}`)));
        const x = Number(rect.attrs.x ?? 0), y = Number(rect.attrs.y ?? 0), w = Number(rect.attrs.width ?? 0), h = Number(rect.attrs.height ?? 0);
        const nx = Math.round(rt.sx * x + rt.tx), ny = Math.round(rt.sy * y + rt.ty), nw = Math.round(Math.abs(rt.sx * w)), nh = Math.round(Math.abs(rt.sy * h));
        if (spec.full !== "repeat") spec.bounds = [Math.max(0, nx), Math.max(0, ny), Math.max(20, nw), Math.max(20, nh)];
        if (spec.strip && !doc.assets?.[spec.strip]) { warnings.push(`layer "${name}": image "${spec.strip}" is not in the project — dropped`); delete spec.strip; }
        page.controls.push(spec);
      }
    };
    visit(L, lt);
    // Artwork: everything in the layer that is not a control group. A group that holds controls AND
    // drawings is opened up (its transform is kept around the drawings).
    const pieces: string[] = [];
    const modePieces = new Map<string, { param: string; index: number; parts: string[] }>(); // "art when=" groups
    const wrap = (chain: string[], inner: string) => chain.reduceRight((acc, t) => `<g transform="${esc(t)}">${acc}</g>`, inner);
    const collect = (n: XNode, chain: string[]) => {
      for (const k of n.kids) {
        if (NOT_ART.has(k.tag) || (k.tag === "rect" && k.attrs["inkscape:label"] === "screen") || isCtl(k)) continue;
        const wm = k.tag === "g" ? /^art\s+when="((?:[^"\\]|\\.)*)"\s*$/.exec(k.attrs["inkscape:label"] ?? "") : null;
        if (wm) {
          // artwork for one mode: its drawings become a separate full-tab picture shown only in that mode
          const spec = wm[1].replace(/\\(.)/g, "$1"); const ci = spec.lastIndexOf(":");
          const mp = spec.slice(0, ci), mi = parseInt(spec.slice(ci + 1), 10);
          const mparam = doc.params.find((p) => p.name === mp);
          if (!mparam || !(mparam.choices?.length) || !Number.isInteger(mi) || mi < 0 || mi >= mparam.choices.length) { warnings.push(`layer "${name}": "art when=${spec}" does not name a choice parameter and option — treated as ordinary artwork`); pieces.push(wrap(chain, raw(k))); continue; }
          const key = `${mp}:${mi}`;
          const e = modePieces.get(key) ?? { param: mp, index: mi, parts: [] };
          const inner = k.kids.map((kk) => raw(kk)).join("\n");
          e.parts.push(wrap(k.attrs.transform ? [...chain, k.attrs.transform] : chain, inner));
          modePieces.set(key, e);
          continue;
        }
        if (k.tag === "g" && hasCtl(k)) { collect(k, k.attrs.transform ? [...chain, k.attrs.transform] : chain); continue; }
        pieces.push(wrap(chain, raw(k)));
      }
    };
    collect(L, L.attrs.transform ? [L.attrs.transform] : []);
    const fragment = pieces.join("\n");
    const oldAsset: string | undefined = meta?.art && doc.assets?.[meta.art] ? meta.art : undefined;
    const isStripPage = page.controls.some((c) => c.full === "repeat");
    const oldPage = doc.pages.find((p) => (oldAsset && p.art?.asset === oldAsset) || (meta?.artModes && p.art?.modes?.some((m) => m.asset && Object.values(meta.artModes).includes(m.asset))));
    if ((fragment || modePieces.size) && isStripPage) warnings.push(`layer "${name}": a strip page cannot carry artwork — ${pieces.length + modePieces.size} drawing(s) were not imported`);
    else if (fragment || modePieces.size) {
      const modes: ArtMode[] = [];
      const keepAssets = new Set<string>(oldAsset && fragment ? [oldAsset] : []);
      const changedModes: number[] = [];
      for (const [key, e] of modePieces) {
        const svgFrag = e.parts.join("\n");
        const oa: string | undefined = meta?.artModes?.[key] && doc.assets?.[meta.artModes[key]] ? meta.artModes[key] : undefined;
        modes.push({ param: e.param, index: e.index, svg: svgFrag, ...(oa ? { asset: oa } : {}) });
        if (oa) keepAssets.add(oa);
        const was = oldPage?.art?.modes?.find((m) => m.asset === oa);
        if (!(was && was.svg === svgFrag && (doc.artDefs ?? "") === artDefs)) changedModes.push(modes.length - 1);
      }
      page.art = { svg: fragment, ...(oldAsset && fragment ? { asset: oldAsset } : {}), ...(modes.length ? { modes } : {}) };
      if (/<(?:svg:)?image\b[^>]*?href\s*=\s*["'](?!data:)/.test(fragment + modes.map((m) => m.svg).join(""))) warnings.push(`layer "${name}": the artwork links to an image file, which cannot be rendered — embed it in the drawing (Inkscape: Extensions ▸ Images ▸ Embed Images)`);
      if (fragment && !(oldPage?.art?.asset === oldAsset && oldPage?.art?.svg === fragment && (doc.artDefs ?? "") === artDefs)) artPages.push(pages.length);
      for (const mi of changedModes) artModePages.push({ page: pages.length, mode: mi });
      // pictures of artwork that was deleted in the drawing tool go with it
      const gone = [meta?.art, ...Object.values(meta?.artModes ?? {})].filter((a) => a && !keepAssets.has(a)) as string[];
      for (const a of gone) { dropAssets.add(a); if (page.images) page.images = page.images.filter((im) => im.asset !== a); }
      if (page.images && !page.images.length) delete page.images;
    } else if (meta?.art || meta?.artModes) {
      // the drawings were deleted in the drawing tool: drop the artwork images with them
      for (const a of [meta.art, ...Object.values(meta.artModes ?? {})] as string[]) {
        if (!a) continue;
        if (page.images) page.images = page.images.filter((im) => im.asset !== a);
        dropAssets.add(a);
      }
      if (page.images && !page.images.length) delete page.images;
    }
    if (page.controls.some((c) => c.full === "repeat")) page.controls = page.controls.filter((c) => c.full === "repeat").slice(0, 1);
    pages.push(page);
  }
  // Q-Links named in <desc> that no longer exist are dropped quietly by naming check below
  for (const p of pages) if (p.qlinks) p.qlinks = p.qlinks.map((n) => (n && names.has(n) ? n : null));
  const out: Doc = { ...doc, pages };
  if (pages.some((p) => p.art)) { if (artDefs) out.artDefs = artDefs; else delete out.artDefs; } else delete out.artDefs;
  if (dropAssets.size && out.assets) {
    const used = new Set<string>();
    for (const p of pages) { if (p.background) used.add(p.background); for (const im of p.images ?? []) used.add(im.asset); for (const c of p.controls) if (c.strip) used.add(c.strip); }
    out.assets = Object.fromEntries(Object.entries(out.assets).filter(([n]) => !dropAssets.has(n) || used.has(n)));
    if (!Object.keys(out.assets).length) delete out.assets;
  }
  return { doc: out, warnings, art: artPages, artModes: artModePages };
}

function metaFor(svgText: string, layerId: string | undefined): any | null {
  if (!layerId) return null;
  const i = svgText.indexOf(`id="${layerId}"`);
  if (i < 0) return null;
  const m = /<desc>([\s\S]*?)<\/desc>/.exec(svgText.slice(i, i + 4000));
  if (!m) return null;
  try { const o = JSON.parse(unesc(m[1])); return Object.keys(o).length ? o : null; } catch { return null; }
}
