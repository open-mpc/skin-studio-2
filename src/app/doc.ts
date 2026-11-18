// doc.ts — the editable skin DOCUMENT behind the app: params + pages of controls, plus the operations
// the editor performs (all pure: each returns a new Doc). A Doc is exactly what uiBuilder's
// generateFromControls consumes, so edit → build → preview is one straight line.
//
// Sources: a parameter file (auto-layout), an existing skin's TUI.json (import), or a saved .skin2.json.
import { loadParamFile, packLayout, toControlSpecs, toParamsJson } from "../core/paramLayout.ts";
import type { ControlSpec, PageSpec } from "../core/uiBuilder.ts";
import { renderKit, THEMES as KIT_THEMES } from "../core/uiKit.ts";

export interface DocParam {
  name: string;
  kind: string; // float | choice | bool | int ... (as the SDK dumps them)
  choices?: string[];
  default?: number;
  display?: string; // text shown at the default value (drives bipolar auto-detection)
}
export interface DocAsset {
  png: string; // base64 PNG bytes
  frames: number; // 1 = still image; >1 = vertical filmstrip
  w: number; // frame width
  h: number; // frame height
}
export const assetFile = (name: string) => `asset_${name}.png`;
export interface DocStyle { background?: string; accent?: string; text?: string; muted?: string } // aarrggbb
export interface Doc {
  style?: DocStyle; // page colours; defaults are Akai's
  assets?: Record<string, DocAsset>; // user images/looks (strips, backgrounds, placed images)
  artDefs?: string; // shared <defs> (gradients, filters) of artwork imported from a layout SVG
  name: string;
  theme: string;
  params: DocParam[];
  pages: PageSpec[]; // slot i = row*4+col; trailing empties trimmed
}

const SLOT_X = [23, 343, 663, 983];
const SLOT_Y = [45, 196, 346, 497];
export const SLOTS_PER_PAGE = 16;

export function paramsJson(doc: Doc): unknown {
  return { params: doc.params.map((p, i) => ({ index: i, name: p.name, kind: p.kind, ...(p.choices ? { choices: p.choices } : {}), ...(p.default !== undefined ? { default: p.default } : {}), ...(p.display !== undefined ? { display: p.display } : {}) })) };
}

// ---- sources -----------------------------------------------------------------------------------
export function docFromParamFile(file: unknown, name = "Untitled", theme = "mpc-red"): Doc {
  const { params, sections } = loadParamFile(file);
  const pj = toParamsJson(params) as { params: Array<{ name: string; kind: DocParam["kind"]; choices?: string[]; default?: number; display?: string }> };
  return {
    name,
    theme,
    params: pj.params.map((p) => ({ name: p.name, kind: p.kind, choices: p.choices, default: p.default, display: p.display })),
    pages: toControlSpecs(packLayout(params, sections)),
  };
}

/**
 * Build a Doc from the SDK's own inputs: a host_sim params.json plus an optional ui.json (Akai's authoring
 * format). Control objects map 1:1 onto ControlSpec; the bare string "empty" is an empty slot. Without a
 * ui.json the SDK's auto-layout applies (16 sliders per page).
 */
export function docFromUiJson(paramsData: any, uiData: any | null, name = "Template", theme = "mpc-red"): Doc {
  const params: DocParam[] = (paramsData.params ?? []).map((p: any) => ({ name: p.name, kind: p.kind ?? "float", ...(p.choices?.length ? { choices: p.choices } : {}), ...(typeof p.default === "number" ? { default: p.default } : {}), ...(typeof p.display === "string" ? { display: p.display } : {}) }));
  let pages: PageSpec[];
  if (uiData?.pages) {
    pages = uiData.pages.map((pg: any, i: number) => ({
      name: pg.name || String(i + 1),
      controls: (pg.controls ?? []).map((c: any): ControlSpec => (c === "empty" || c?.widget === "empty" ? { empty: true } : c.text !== undefined && c.param === undefined ? { text: c.text } : { ...c })),
    }));
  } else {
    pages = [];
    for (let i = 0; i < params.length; i += 16)
      pages.push({ name: String(pages.length + 1), controls: params.slice(i, i + 16).map((p) => ({ param: p.name, widget: "slider" })) });
  }
  return { name, theme, params, pages };
}

const looksBool = (c: string[]) => c.length === 2 && ["off", "free", "no"].includes(c[0].toLowerCase());

/**
 * Import an existing skin (gen_ui / Studio-shaped TUI.json). Recognises the standard widget set, free-form
 * positions, explicit Q-Links (when Q-Links.json text is given) and — when `readFile` is given — custom art
 * (knob filmstrips, backgrounds, placed images). Anything else is reported in `warnings` and imported as an
 * empty slot. Limits (stated, not hidden): defaults are not stored in TUI.json (floats default to 0.5,
 * choices to 0). Page colours (background, accent, name/value text) ARE imported (see coloursFromTui); the
 * kit pictures are redrawn from the kit theme, which is detected when the accent is a kit theme's.
 */
export function docFromTui(
  tuiText: string,
  name = "Imported",
  qlinksText?: string,
  readFile?: (rel: string) => Uint8Array | null // reads an image next to the TUI.json; enables custom-art import
): { doc: Doc; warnings: string[]; theme?: string } {
  const warnings: string[] = [];
  const assets: Record<string, DocAsset> = {};
  const defsByKey = new Map<string, any>();
  let kitFiles: Set<string> | null = null;
  const isKitFile = (f: string): boolean => {
    if (!kitFiles) kitFiles = new Set(Object.values((JSON.parse(renderKit("mpc-red").manifestJson) as any).assets as Record<string, { file: string }>).map((a) => a.file));
    return kitFiles.has(f);
  };
  const importImage = (file: string, frames: number, ctx: string): string | null => {
    if (!readFile) { warnings.push(`${ctx}: image "${file}" not imported (open the skin from its folder to bring images in)`); return null; }
    const buf = readFile(file);
    if (!buf) { warnings.push(`${ctx}: image "${file}" not found next to the TUI.json`); return null; }
    if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) { warnings.push(`${ctx}: "${file}" is not a PNG — not imported`); return null; }
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const w = dv.getUint32(16), h = dv.getUint32(20);
    let nm = file.replace(/\.png$/i, "").replace(/^asset_/, "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40) || "image";
    const b64 = Buffer.from(buf).toString("base64");
    if (assets[nm] && assets[nm].png !== b64) nm = `${nm}_${Object.keys(assets).length + 1}`;
    assets[nm] = { png: b64, frames, w, h: Math.floor(h / frames) };
    return nm;
  };

  const pd = JSON.parse(tuiText).pageData;
  for (const d of pd.componentDefinitions?.localComponentDefinitions ?? []) defsByKey.set(d.key, d.value);
  const repl = new Map<string, string[]>();
  for (const r of pd.replacementStrings ?? []) repl.set(r.key, r.value);
  const pnum = (v: string): number | null => {
    const m = /^Parameter (\d+)$/.exec(v);
    return m ? parseInt(m[1], 10) : null;
  };
  const names = new Map<number, string>();
  const nameOf = (idx: number, hint: string): string => {
    if (!names.has(idx)) names.set(idx, hint);
    return names.get(idx)!;
  };
  type Raw = { spec: ControlSpec; idx: number | null; vis: [number, number] | null };
  type XImage = { asset: string; x: number; y: number; w: number; h: number; pidx?: number; vis?: [number, number] };
  type Extras = { background?: string; images: XImage[] };
  const pageExtras: Extras[] = [];
  const pagesRaw: { name: string; raws: (Raw | null)[]; free: Raw[]; qb?: string[]; strip?: { idx: number; count: number } }[] = [];

  for (const tab of pd.tabs ?? []) {
    const root = tab.componentDefinition;
    const extras: Extras = { images: [] };
    pageExtras.push(extras);
    if (root.repeats && root.repeats > 1) {
      const rm = root.componentsData?.[0]?.["handle remapping"]?.map?.[0]?.value ?? "";
      const m = /\{Increment:Base=(\d+)\}/.exec(rm);
      pagesRaw.push({ name: tab.tabName, raws: [], free: [], strip: { idx: m ? parseInt(m[1], 10) : 0, count: root.repeats } });
      continue;
    }
    const raws: (Raw | null)[] = new Array(SLOTS_PER_PAGE).fill(null);
    const freeRaws: Raw[] = [];
    const ordered: Raw[] = []; // every control in file order (used when the page turns out to be free-form)
    for (const c of root.componentsData ?? []) {
      const cdn = c.componentData?.name as string;
      const type = c.componentData?.type as string;
      const bnums = String(c.bounds?.bounds ?? "0 0 0 0").split(" ").map(Number);
      const [bx, by] = bnums;
      const onSlot = SLOT_X.includes(bx) && SLOT_Y.includes(by) && bnums[2] === 278 && bnums[3] === 107;
      const place = (r: Raw) => {
        ordered.push({ ...r, spec: { ...r.spec, bounds: bnums as [number, number, number, number] } });
        if (onSlot) raws[SLOT_Y.indexOf(by) * 4 + SLOT_X.indexOf(bx)] = r;
        else { r.spec.bounds = bnums as [number, number, number, number]; freeRaws.push(r); }
      };
      if (type === "Image") {
        const dd = c.componentData.data ?? {};
        const rm = (c["handle remapping"]?.map ?? []).find((m: any) => m.key === "Data");
        const pidx = dd.imageType === "FilmStrip" && rm ? pnum(rm.value) : null;
        if ((dd.imageType === "FilmStrip" && pidx === null) || !dd.image) { warnings.push(`tab "${tab.tabName}": filmstrip/empty image "${cdn}" is not imported`); continue; }
        const an = importImage(dd.image, dd.imageType === "FilmStrip" ? Math.max(2, dd.numFrames ?? 2) : 1, `tab "${tab.tabName}"`);
        if (an) {
          let vis: [number, number] | undefined;
          for (const h of c.bounds?.additionalInvalidatingHandles ?? []) {
            const m = /^IndexedEnabling\/(\d+)\/\d+\/Parameter (\d+)$/.exec(h);
            if (m) vis = [parseInt(m[2], 10), parseInt(m[1], 10)];
          }
          if (bnums.join(" ") === "0 0 1280 628" && !extras.background && pidx === null && !vis) extras.background = an;
          else extras.images.push({ asset: an, x: bnums[0], y: bnums[1], w: bnums[2], h: bnums[3], ...(pidx !== null ? { pidx } : {}), ...(vis ? { vis } : {}) });
        }
        continue;
      }
      if (type === "Meter") {
        const md = c.componentData.data ?? {};
        const mi = pnum(String(md.peakHandle ?? ""));
        if (mi === null) { warnings.push(`tab "${tab.tabName}": meter "${cdn}" is not bound to a parameter — left empty`); continue; }
        let mvis: [number, number] | null = null;
        for (const h of c.bounds?.additionalInvalidatingHandles ?? []) {
          const m = /^IndexedEnabling\/(\d+)\/\d+\/Parameter (\d+)$/.exec(h);
          if (m) mvis = [parseInt(m[2], 10), parseInt(m[1], 10)];
        }
        nameOf(mi, cdn);
        const dir = ["Up", "Down", "Left", "Right"].includes(md.direction) ? md.direction : "Up";
        place({ spec: { full: "meter", ...(dir !== "Up" ? { meterDir: dir } : {}) }, idx: mi, vis: mvis });
        continue;
      }
      if (type === "Label" && / seg \d+$/.test(cdn)) continue; // radio segment captions belong to their control
      if (type === "Label") {
        place({ spec: { text: c.componentData.data?.text ?? "" }, idx: null, vis: null });
        continue;
      }
      const remap = (c["handle remapping"]?.map ?? []).find((m: any) => m.key === "Data");
      const idx = remap ? pnum(remap.value) : null;
      let spec: ControlSpec | null = null;
      const tmm = /~n(\d*)v(\d*)$/.exec(type);
      const type1 = tmm ? type.slice(0, -tmm[0].length) : type; // "~n<ns>v<vs>" = name/value text sizes
      const szm = /@(\d+)$/.exec(type1);
      const ctype = szm ? type1.slice(0, -szm[0].length) : type1; // "@N" = knob picture size
      if (ctype === "toggle" || /^radio\d+$/.test(ctype)) spec = { widget: "switch" };
      else if (ctype.startsWith("sliderWithFocus")) spec = { widget: "slider", ...(ctype.endsWith("Menu") ? { overlay: "menu" as const } : {}) };
      else if (/^knob(Uni|Bi)(Menu)?$/.test(ctype)) spec = { widget: "knob", ...(ctype.includes("Bi") ? { polarity: "bipolar" as const } : { polarity: "unipolar" as const }) };
      else if (/^fader(Uni|Bi)(Menu)?$/.test(ctype)) spec = { widget: "fader", ...(ctype.includes("Bi") ? { polarity: "bipolar" as const } : { polarity: "unipolar" as const }) };
      else if (ctype === "momentaryButton") spec = { full: "button" };
      else if (ctype === "readout") spec = { full: "readout" };
      else if (ctype === "stepper") spec = { full: "stepper" };
      else if (/^knobStrip:(Uni|Bi):/.test(ctype) || defsByKey.has(type)) {
        // custom knob: a user filmstrip (or any component whose child is a Knob) — structural recognition
        const def = defsByKey.get(type);
        const kn = def?.componentsData?.find((x: any) => x.componentData?.type === "Knob")?.componentData?.data;
        if (kn) {
          const bi = ctype.includes("Bi") || kn.polarity === "BiPolar";
          spec = { widget: "knob", polarity: bi ? "bipolar" : "unipolar" };
          if (kn.knobType === "FilmStrip" && kn.filmStrip && !isKitFile(kn.filmStrip)) {
            const an = importImage(kn.filmStrip, kn.numFrames ?? 1, `tab "${tab.tabName}" ${cdn}`);
            if (an) spec.strip = an;
          }
        }
      }
      if (spec && szm && spec.widget === "knob") spec.size = parseInt(szm[1], 10);
      if (spec && tmm) { if (tmm[1] !== "") spec.nameSize = parseInt(tmm[1], 10); if (tmm[2] !== "") spec.valueSize = parseInt(tmm[2], 10); }
      if (!spec || idx === null) {
        warnings.push(`tab "${tab.tabName}": "${cdn}" (${type}) is not a recognised widget — left empty`);
        continue;
      }
      let vis: [number, number] | null = null;
      for (const h of c.bounds?.additionalInvalidatingHandles ?? []) {
        const m = /^IndexedEnabling\/(\d+)\/\d+\/Parameter (\d+)$/.exec(h);
        if (m) vis = [parseInt(m[2], 10), parseInt(m[1], 10)];
      }
      nameOf(idx, cdn);
      place({ spec, idx, vis });
    }
    pagesRaw.push({ name: tab.tabName, raws: freeRaws.length ? [] : raws, free: freeRaws.length ? ordered : [], qb: freeRaws.length ? tab.qlinkBoundsData : undefined });
  }

  // Build the param table: sized to the highest referenced index; unreferenced indices get placeholders.
  let max = -1;
  for (const p of pagesRaw) {
    for (const r of [...p.raws, ...p.free]) {
      if (r?.idx != null) max = Math.max(max, r.idx);
      if (r?.vis) max = Math.max(max, r.vis[0]);
    }
    if (p.strip) max = Math.max(max, p.strip.idx + p.strip.count - 1);
  }
  for (const ex of pageExtras) for (const im of ex.images) { if (im.pidx !== undefined) max = Math.max(max, im.pidx); if (im.vis) max = Math.max(max, im.vis[0]); }
  const used = new Set<string>();
  const params: DocParam[] = [];
  for (let i = 0; i <= max; i++) {
    let nm = names.get(i) ?? `Param ${i + 1}`;
    if (used.has(nm)) nm = `${nm} (${i + 1})`;
    used.add(nm);
    const ch = repl.get(`Parameter ${i}`);
    params.push(ch ? { name: nm, kind: looksBool(ch) ? "bool" : "choice", choices: ch, default: 0 } : { name: nm, kind: "float", default: 0.5 });
  }
  const qmaps = new Map<number, number[]>();
  if (qlinksText) {
    try {
      const q = JSON.parse(qlinksText);
      for (const e of q["Screen Mode Q-Links"]?.map ?? []) {
        const m = e["Q-Links"]; if (!m) continue;
        qmaps.set(e.Tab - 1, Array.from({ length: 16 }, (_, k) => (typeof m["Q-Link " + (k + 1)] === "number" ? m["Q-Link " + (k + 1)] : -1)));
      }
    } catch { warnings.push("Q-Links.json could not be read — Q-Links derived from positions"); }
  }
  const pages: PageSpec[] = pagesRaw.map((p) => {
    if (p.strip) return { name: p.name, controls: [{ param: params[p.strip.idx].name, full: "repeat" as const, repeatCount: p.strip.count }] };
    const conv = (r: Raw | null): ControlSpec => {
      if (!r) return { empty: true };
      const s = { ...r.spec };
      if (r.idx !== null) s.param = params[r.idx].name;
      if (r.vis) s.visibleWhen = { param: params[r.vis[0]].name, index: r.vis[1] };
      return s;
    };
    const controls = p.raws.map(conv);
    while (controls.length && controls[controls.length - 1].empty) controls.pop();
    if (p.free.length) controls.push(...p.free.map(conv)); // free-form page: every control in file order, explicit bounds
    const page: PageSpec = { name: p.name, controls };
    const ex = pageExtras[pagesRaw.indexOf(p)];
    if (ex?.background) page.background = ex.background;
    if (ex?.images.length) page.images = ex.images.map(({ pidx, vis, ...im }) => ({ ...im, ...(pidx !== undefined ? { param: params[pidx].name } : {}), ...(vis ? { when: { param: params[vis[0]].name, index: vis[1] } } : {}) }));
    if (p.free.length) {
      if (p.qb) page.qlinkBounds = p.qb;
      const qm = qmaps.get(pagesRaw.indexOf(p));
      if (qm) page.qlinks = qm.map((i) => (i >= 0 && params[i] ? params[i].name : null));
    }
    return page;
  });
  const { style, theme } = coloursFromTui(pd);
  return { doc: { name, theme: theme ?? "mpc-red", params, pages, ...(Object.keys(assets).length ? { assets } : {}), ...(Object.keys(style).length ? { style } : {}) }, warnings, ...(theme ? { theme } : {}) };
}

const AKAI_STYLE: Required<DocStyle> = { background: "ff1e1d1e", accent: "ffd31145", text: "ffffffff", muted: "ff6a6a6c" };
/**
 * Read a skin's page colours back out of its TUI.json: background = the first tab's page colour, accent =
 * the focus outline, muted/text = the Name/Value label colours. Only colours that differ from Akai's
 * defaults are returned (so an Akai-default skin imports with no style and rebuilds byte-identically).
 * When the accent is one of the kit themes' accents, that theme is reported too.
 */
export function coloursFromTui(pageData: any): { style: DocStyle; theme?: string } {
  const found: DocStyle = {};
  const hex = (v: unknown): string | null => (typeof v === "string" && /^[0-9a-fA-F]{8}$/.test(v) ? v.toLowerCase() : null);
  for (const tab of pageData?.tabs ?? []) {
    const c = hex(tab.componentDefinition?.backgroundData?.unfocussed?.colour);
    if (c && c.slice(0, 2) !== "00") { found.background = c; break; }
  }
  const walk = (n: any): void => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const k of n) walk(k); return; }
    const cd = n.componentData;
    if (cd?.type === "Focus" && !found.accent) { const c = hex(cd.data?.outlineColour); if (c) found.accent = c; }
    if (cd?.type === "Label") {
      const c = hex(cd.data?.textStyle?.colour);
      const key = cd.data?.type === "Name" ? "muted" : cd.data?.type === "Value" ? "text" : null;
      if (c && key && !found[key]) found[key] = c;
    }
    for (const v of Object.values(n)) walk(v);
  };
  walk(pageData?.componentDefinitions);
  walk(pageData?.tabs);
  const style: DocStyle = {};
  for (const k of Object.keys(AKAI_STYLE) as (keyof DocStyle)[]) if (found[k] && found[k] !== AKAI_STYLE[k]) style[k] = found[k];
  const theme = found.accent ? Object.entries(KIT_THEMES).find(([, acc]) => acc === found.accent)?.[0] : undefined;
  return { style, ...(theme && theme !== "mpc-red" ? { theme } : {}) };
}

// ---- edit operations (pure) --------------------------------------------------------------------
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function padTo(page: PageSpec, n: number): void {
  while (page.controls.length < n) page.controls.push({ empty: true });
}
function trim(page: PageSpec): void {
  while (page.controls.length && page.controls[page.controls.length - 1].empty) page.controls.pop();
}

export function setControl(doc: Doc, page: number, slot: number, spec: ControlSpec): Doc {
  const d = clone(doc);
  const pg = d.pages[page];
  if (!pg || slot < 0 || (slot >= SLOTS_PER_PAGE && slot >= pg.controls.length)) throw new Error("no such slot");
  if (pg.controls.some((c) => c.full === "repeat")) throw new Error("a strip page holds only the strip — edit its parameters instead");
  padTo(pg, slot + 1);
  const old = pg.controls[slot];
  if (old?.bounds && !spec.bounds && !spec.empty) spec = { ...spec, bounds: old.bounds }; // keep a free control where it is
  pg.controls[slot] = spec;
  trim(pg);
  return d;
}
export function swapSlots(doc: Doc, page: number, a: number, b: number): Doc {
  const d = clone(doc);
  const pg = d.pages[page];
  padTo(pg, Math.max(a, b) + 1);
  [pg.controls[a], pg.controls[b]] = [pg.controls[b], pg.controls[a]];
  trim(pg);
  return d;
}
export function renamePage(doc: Doc, page: number, name: string): Doc {
  const d = clone(doc);
  d.pages[page].name = name;
  return d;
}
export function addPage(doc: Doc, name = String(doc.pages.length + 1)): Doc {
  const d = clone(doc);
  d.pages.push({ name, controls: [] });
  return d;
}
export function addStripPage(doc: Doc, name: string, firstParam: string, count: number): Doc {
  const d = clone(doc);
  d.pages.push({ name, controls: [{ param: firstParam, full: "repeat", repeatCount: count }] });
  return d;
}
export function removePage(doc: Doc, page: number): Doc {
  const d = clone(doc);
  d.pages.splice(page, 1);
  return d;
}
export function movePage(doc: Doc, from: number, to: number): Doc {
  const d = clone(doc);
  const [p] = d.pages.splice(from, 1);
  d.pages.splice(to, 0, p);
  return d;
}
/** Rename a parameter and every control/visibleWhen/Q-Link that references it. */
export function renameParam(doc: Doc, index: number, name: string): Doc {
  const d = clone(doc);
  const old = d.params[index].name;
  if (d.params.some((p, i) => i !== index && p.name === name)) throw new Error(`parameter name "${name}" is already used`);
  d.params[index].name = name;
  for (const pg of d.pages) {
    for (const c of pg.controls) {
      if (c.param === old) c.param = name;
      if (c.visibleWhen?.param === old) c.visibleWhen.param = name;
    }
    if (pg.qlinks) pg.qlinks = pg.qlinks.map((n) => (n === old ? name : n));
  }
  return d;
}
export function setStyle(doc: Doc, style: DocStyle): Doc {
  for (const [k, v] of Object.entries(style)) if (v !== undefined && !/^[0-9a-fA-F]{8}$/.test(v)) throw new Error(`colour ${k} must be 8 hex digits (aarrggbb)`);
  const d = clone(doc);
  const merged = { ...(d.style ?? {}), ...style };
  if (Object.keys(merged).length) d.style = merged; else delete d.style;
  return d;
}
export function setTheme(doc: Doc, theme: string): Doc {
  return { ...clone(doc), theme };
}

// ---- free-form + Q-Link operations ----------------------------------------------------------------
const slotRect = (i: number): [number, number, number, number] => [SLOT_X[i % 4], SLOT_Y[Math.floor(i / 4)], 278, 107];

/** Switch a page to free positioning WITHOUT changing anything visible or any Q-Link: every control gets
 *  its slot rectangle as explicit bounds and the slot-derived Q-Link map is frozen as explicit qlinks. */
export function makeFree(doc: Doc, page: number): Doc {
  const d = clone(doc);
  const pg = d.pages[page];
  if (pg.controls.some((c) => c.bounds)) return d; // already free-form
  if (pg.controls.some((c) => c.full === "repeat")) throw new Error("a strip page cannot be free-form");
  const q: (string | null)[] = new Array(16).fill(null);
  pg.controls.forEach((c, i) => {
    if (c.empty) return;
    c.bounds = slotRect(i);
    if (c.param && c.full !== "readout" && c.text === undefined) q[13 + (i % 4) - 4 * Math.floor(i / 4) - 1] = c.param;
  });
  if (!pg.qlinks) pg.qlinks = q; // a Q-Link set chosen by hand on the grid page is kept
  if (!pg.qlinkBounds) pg.qlinkBounds = ["38 0 248 624", "358 0 248 624", "678 0 248 624", "998 0 248 624"];
  return d;
}
export function moveControl(doc: Doc, page: number, index: number, x: number, y: number): Doc {
  let d = makeFree(doc, page);
  d = clone(d);
  const c = d.pages[page].controls[index];
  if (!c || c.empty) throw new Error("no control there");
  const [, , w, h] = c.bounds ?? slotRect(index);
  c.bounds = [Math.round(x), Math.round(y), w, h];
  return d;
}
/** Set a control's touch box size (the box crops; a knob's picture size is a separate `size` field). */
export function resizeControl(doc: Doc, page: number, index: number, w: number, h: number): Doc {
  let d = makeFree(doc, page);
  d = clone(d);
  const c = d.pages[page].controls[index];
  if (!c || c.empty) throw new Error("no control there");
  if (!(w >= 20 && h >= 20 && w <= 1280 && h <= 628)) throw new Error("size must be between 20 and the screen size");
  const [x, y] = c.bounds ?? slotRect(index);
  c.bounds = [x, y, Math.round(w), Math.round(h)];
  return d;
}
export function addFreeControl(doc: Doc, page: number, spec: ControlSpec, x: number, y: number): Doc {
  const d = clone(makeFree(doc, page));
  const pg = d.pages[page];
  while (pg.controls.length < SLOTS_PER_PAGE) pg.controls.push({ empty: true });
  pg.controls.push({ ...spec, bounds: [Math.round(x), Math.round(y), 278, 107] });
  return d;
}
export function removeControl(doc: Doc, page: number, index: number): Doc {
  const d = clone(doc);
  const pg = d.pages[page];
  if (index >= SLOTS_PER_PAGE) pg.controls.splice(index, 1);
  else { pg.controls[index] = { empty: true }; trim(pg); }
  return d;
}
// ---- several controls at once (multi-select) ------------------------------------------------------
// Each is ONE edit (one undo step). They work on a free-form page, and switch a grid page to free-form first
// (an invisible change), except delete / duplicate which also work on the grid.
function group(d: Doc, page: number, indices: number[]): { c: ControlSpec; i: number }[] {
  const pg = d.pages[page];
  const out = [...new Set(indices)].sort((a, b) => a - b).map((i) => ({ c: pg?.controls[i], i })).filter((x) => x.c && !x.c.empty) as { c: ControlSpec; i: number }[];
  if (!out.length) throw new Error("no controls selected");
  return out;
}
export type AlignMode = "left" | "centre" | "right" | "top" | "middle" | "bottom";
/** Move controls together by (dx, dy), stopping when any of them would leave the screen. */
export function moveControls(doc: Doc, page: number, indices: number[], dx: number, dy: number): Doc {
  const d = clone(makeFree(doc, page));
  const g = group(d, page, indices);
  let mx = Math.round(dx), my = Math.round(dy);
  for (const { c } of g) { const [x, y, w, h] = c.bounds!; mx = Math.max(-x, Math.min(1280 - w - x, mx)); my = Math.max(-y, Math.min(628 - h - y, my)); }
  for (const { c } of g) { const [x, y, w, h] = c.bounds!; c.bounds = [x + mx, y + my, w, h]; }
  return d;
}
/** Line controls up on the group's left/right/top/bottom edge or centre line. */
export function alignControls(doc: Doc, page: number, indices: number[], mode: AlignMode): Doc {
  const d = clone(makeFree(doc, page));
  const g = group(d, page, indices);
  if (g.length < 2) throw new Error("select two or more controls to align");
  const L = Math.min(...g.map(({ c }) => c.bounds![0])), T = Math.min(...g.map(({ c }) => c.bounds![1]));
  const R = Math.max(...g.map(({ c }) => c.bounds![0] + c.bounds![2])), B = Math.max(...g.map(({ c }) => c.bounds![1] + c.bounds![3]));
  for (const { c } of g) {
    const [x, y, w, h] = c.bounds!;
    if (mode === "left") c.bounds = [L, y, w, h];
    else if (mode === "right") c.bounds = [R - w, y, w, h];
    else if (mode === "centre") c.bounds = [Math.round((L + R) / 2 - w / 2), y, w, h];
    else if (mode === "top") c.bounds = [x, T, w, h];
    else if (mode === "bottom") c.bounds = [x, B - h, w, h];
    else if (mode === "middle") c.bounds = [x, Math.round((T + B) / 2 - h / 2), w, h];
    else throw new Error(`unknown alignment "${mode}"`);
  }
  return d;
}
/** Spread controls so the gaps between them are equal; the two outermost stay where they are. */
export function distributeControls(doc: Doc, page: number, indices: number[], axis: "horizontal" | "vertical"): Doc {
  const d = clone(makeFree(doc, page));
  const g = group(d, page, indices);
  if (g.length < 3) throw new Error("select three or more controls to spread");
  const k = axis === "horizontal" ? 0 : 1, sz = axis === "horizontal" ? 2 : 3;
  const sorted = [...g].sort((a, b) => a.c.bounds![k] - b.c.bounds![k]);
  const first = sorted[0].c.bounds!, last = sorted[sorted.length - 1].c.bounds!;
  const total = last[k] + last[sz] - first[k];
  const gap = (total - sorted.reduce((n, { c }) => n + c.bounds![sz], 0)) / (sorted.length - 1);
  let at = first[k];
  for (const { c } of sorted) { const b = [...c.bounds!] as [number, number, number, number]; b[k] = Math.round(at); c.bounds = b; at += b[sz] + gap; }
  return d;
}
/** Give every selected control the width and/or height of the first one (the lowest-numbered). */
export function matchSize(doc: Doc, page: number, indices: number[], dims: "width" | "height" | "both"): Doc {
  const d = clone(makeFree(doc, page));
  const g = group(d, page, indices);
  if (g.length < 2) throw new Error("select two or more controls");
  const [, , w0, h0] = g[0].c.bounds!;
  for (const { c } of g.slice(1)) { const [x, y, w, h] = c.bounds!; c.bounds = [x, y, dims === "height" ? w : w0, dims === "width" ? h : h0]; }
  return d;
}
export function removeControls(doc: Doc, page: number, indices: number[]): Doc {
  const d = clone(doc);
  const g = group(d, page, indices);
  const pg = d.pages[page];
  for (const { i } of [...g].reverse()) { if (i >= SLOTS_PER_PAGE) pg.controls.splice(i, 1); else pg.controls[i] = { empty: true }; }
  trim(pg);
  return d;
}
/** Copy controls. Free-form pages: the copies sit (dx, dy) away. Grid pages: they fill the next empty slots. */
export function duplicateControls(doc: Doc, page: number, indices: number[], dx = 20, dy = 20): Doc {
  const d0 = clone(doc);
  const g = group(d0, page, indices);
  if (g.some(({ c }) => c.full === "repeat")) throw new Error("a strip cannot be duplicated");
  const pg = d0.pages[page];
  if (pg.controls.some((c) => c.bounds)) {
    while (pg.controls.length < SLOTS_PER_PAGE) pg.controls.push({ empty: true });
    for (const { c } of g) {
      const [x, y, w, h] = c.bounds!;
      pg.controls.push({ ...c, bounds: [Math.max(0, Math.min(1280 - w, x + dx)), Math.max(0, Math.min(628 - h, y + dy)), w, h] });
    }
    return d0;
  }
  const free: number[] = [];
  for (let i = 0; i < SLOTS_PER_PAGE; i++) if (!pg.controls[i] || pg.controls[i].empty) free.push(i);
  if (free.length < g.length) throw new Error(`only ${free.length} empty slot(s) on this page for ${g.length} copies`);
  g.forEach(({ c }, k) => { const { bounds: _b, ...spec } = c; while (pg.controls.length <= free[k]) pg.controls.push({ empty: true }); pg.controls[free[k]] = spec; });
  return d0;
}
/** Set the 16 Q-Links for a page (index k = Q-Link k+1); null clears back to position/order derivation. */
export function setQlinks(doc: Doc, page: number, qlinks: (string | null)[] | null): Doc {
  const d = clone(doc);
  if (qlinks === null) delete d.pages[page].qlinks;
  else {
    for (const n of qlinks) if (n && !d.params.some((p) => p.name === n)) throw new Error(`unknown parameter "${n}"`);
    d.pages[page].qlinks = qlinks.slice(0, 16);
    while (d.pages[page].qlinks!.length < 16) d.pages[page].qlinks!.push(null);
  }
  return d;
}
export function setQlinkBounds(doc: Doc, page: number, rects: string[] | null): Doc {
  const d = clone(doc);
  if (rects === null) delete d.pages[page].qlinkBounds; else d.pages[page].qlinkBounds = rects;
  return d;
}

// ---- assets (images / looks) -----------------------------------------------------------------
const ASSET_NAME = /^[A-Za-z0-9_-]{1,40}$/;
export function addAsset(doc: Doc, name: string, pngBase64: string, frames: number, w: number, h: number): Doc {
  if (!ASSET_NAME.test(name)) throw new Error("asset names use letters, digits, _ and - (max 40)");
  if (!(frames >= 1 && w > 0 && h > 0)) throw new Error("asset needs frames >= 1 and a positive frame size");
  if (!pngBase64.startsWith("iVBORw0KGgo")) throw new Error("asset is not a PNG");
  const d = clone(doc);
  d.assets = { ...(d.assets ?? {}), [name]: { png: pngBase64, frames: Math.round(frames), w: Math.round(w), h: Math.round(h) } };
  return d;
}
export function assetUsers(doc: Doc, name: string): string[] {
  const out: string[] = [];
  for (const pg of doc.pages) {
    if (pg.background === name) out.push(`page ${pg.name} background`);
    for (const im of pg.images ?? []) if (im.asset === name) out.push(`page ${pg.name} image`);
    for (const c of pg.controls) if (c.strip === name) out.push(`page ${pg.name} ${c.param ?? "control"}`);
  }
  return out;
}
export function removeAsset(doc: Doc, name: string): Doc {
  const u = assetUsers(doc, name);
  if (u.length) throw new Error(`asset "${name}" is still used by: ${u.join(", ")}`);
  const d = clone(doc);
  if (d.assets) delete d.assets[name];
  return d;
}
export function setBackground(doc: Doc, page: number, asset: string | null): Doc {
  if (asset && !doc.assets?.[asset]) throw new Error(`no asset "${asset}"`);
  const d = clone(doc);
  if (asset) d.pages[page].background = asset; else delete d.pages[page].background;
  return d;
}
export function addPlacedImage(doc: Doc, page: number, asset: string, x: number, y: number, w?: number, h?: number): Doc {
  const a = doc.assets?.[asset];
  if (!a) throw new Error(`no asset "${asset}"`);
  const d = clone(doc);
  (d.pages[page].images ??= []).push({ asset, x: Math.round(x), y: Math.round(y), w: Math.round(w ?? a.w), h: Math.round(h ?? a.h) });
  return d;
}
export function removePlacedImage(doc: Doc, page: number, index: number): Doc {
  const d = clone(doc);
  const rmAsset = d.pages[page].images?.[index]?.asset;
  const pa = d.pages[page].art;
  if (pa && rmAsset) {
    if (pa.asset === rmAsset) { delete pa.asset; pa.svg = ""; } // removing the artwork image drops the artwork
    const mi = pa.modes?.findIndex((m) => m.asset === rmAsset) ?? -1;
    if (mi >= 0) pa.modes!.splice(mi, 1);
    if (pa.modes && !pa.modes.length) delete pa.modes;
    if (!pa.svg && !pa.modes) delete d.pages[page].art;
  }
  d.pages[page].images?.splice(index, 1);
  if (d.pages[page].images && !d.pages[page].images!.length) delete d.pages[page].images;
  return d;
}
export function movePlacedImage(doc: Doc, page: number, index: number, x: number, y: number, w?: number, h?: number): Doc {
  const d = clone(doc);
  const im = d.pages[page].images?.[index];
  if (!im) throw new Error("no such image");
  im.x = Math.round(x); im.y = Math.round(y); if (w) im.w = Math.round(w); if (h) im.h = Math.round(h);
  return d;
}
/**
 * Store the rendered picture of a page's SVG artwork (see svgRoundTrip): a full-tab image asset drawn
 * first among the page's placed images, i.e. above the background and behind every control.
 */
export function setPageArt(doc: Doc, page: number, pngBase64: string, mode?: number): Doc {
  const art = doc.pages[page]?.art;
  if (!art) throw new Error("that page has no artwork");
  if (mode !== undefined && !art.modes?.[mode]) throw new Error("that page has no such mode artwork");
  if (!pngBase64.startsWith("iVBORw0KGgo")) throw new Error("artwork picture is not a PNG");
  const d = clone(doc);
  const pg = d.pages[page];
  const target = mode === undefined ? pg.art! : pg.art!.modes![mode];
  let name = target.asset;
  if (!name) { let i = 1; while (d.assets?.[`art_${i}`]) i++; name = `art_${i}`; }
  d.assets = { ...(d.assets ?? {}), [name]: { png: pngBase64, frames: 1, w: 1280, h: 628 } };
  target.asset = name;
  if (!(pg.images ?? []).some((im) => im.asset === name)) {
    const img = { asset: name, x: 0, y: 0, w: 1280, h: 628, ...(mode === undefined ? {} : { when: { param: pg.art!.modes![mode].param, index: pg.art!.modes![mode].index } }) };
    const imgs = (pg.images ??= []);
    if (mode === undefined) imgs.unshift(img); // base artwork first: behind everything
    else { // mode artwork sits after the base artwork (and earlier mode artwork), still behind the controls
      let at = 0; while (at < imgs.length && [pg.art!.asset, ...(pg.art!.modes ?? []).map((m) => m.asset)].includes(imgs[at].asset)) at++;
      imgs.splice(at, 0, img);
    }
  }
  return d;
}
/** Point a placed image at a choice parameter's option (shown only then), or clear it. */
export function setImageMode(doc: Doc, page: number, index: number, when: { param: string; index: number } | null): Doc {
  const d = clone(doc);
  const im = d.pages[page]?.images?.[index];
  if (!im) throw new Error("no such image");
  if (when) {
    const p = d.params.find((q) => q.name === when.param);
    if (!p?.choices?.length) throw new Error(`"${when.param}" is not a choice parameter`);
    if (!Number.isInteger(when.index) || when.index < 0 || when.index >= p.choices.length) throw new Error(`"${when.param}" has no option ${when.index}`);
    im.when = { param: when.param, index: when.index };
  } else delete im.when;
  return d;
}
/** Make a placed image a value picture (its filmstrip frame follows `param`), or an ordinary picture (param = null). */
export function setImageValueParam(doc: Doc, page: number, index: number, param: string | null): Doc {
  const d = clone(doc);
  const im = d.pages[page]?.images?.[index];
  if (!im) throw new Error("no such image");
  if (param === null) { delete im.param; return d; }
  if (!d.params.some((q) => q.name === param)) throw new Error(`unknown parameter "${param}"`);
  const a = d.assets?.[im.asset];
  if (!a || a.frames < 2) throw new Error("a value picture needs an image made of two or more stacked frames (a filmstrip)");
  im.param = param;
  return d;
}
/** Apply (or clear, asset=null) a filmstrip to every knob (or fader) control — v1's "Use for every …". */
export function setStripForAll(doc: Doc, widget: "knob" | "fader", asset: string | null): Doc {
  if (asset && !doc.assets?.[asset]) throw new Error(`no asset "${asset}"`);
  const d = clone(doc);
  for (const pg of d.pages)
    for (const c of pg.controls)
      if (!c.empty && !c.full && c.widget === widget) { if (asset) c.strip = asset; else delete c.strip; }
  return d;
}

// ---- panel picture import (EXTENSION; finder in core/panelDetect) --------------------------------
/**
 * A picture of a hardware panel (already fitted into 1280×628) as the page background, and a knob on each knob found:
 * the knob picture sized and centred on the panel's control, bound to the next parameters not yet on the page (ranged
 * ones: choice and text parameters are skipped). Names and values are hidden unless `labels` (the panel prints its
 * own). Knobs beyond the free parameters are left out and counted. One edit (one undo step).
 */
export function importPanel(doc: Doc, page: number, pngBase64: string, knobs: { cx: number; cy: number; r: number }[], labels = false):
  { doc: Doc; placed: number; unbound: number; asset: string } {
  if (!doc.pages[page]) throw new Error("no such page");
  if (doc.pages[page].controls.some((c) => c.full === "repeat")) throw new Error("a strip page cannot take a panel picture");
  let name = "panel", i = 2;
  while (doc.assets?.[name]) name = `panel_${i++}`;
  let d = addAsset(doc, name, pngBase64, 1, 1280, 628);
  d = setBackground(d, page, name);
  d = clone(makeFree(d, page));
  const pg = d.pages[page];
  const used = new Set(pg.controls.map((c) => c.param).filter(Boolean));
  const free = d.params.filter((p) => !used.has(p.name) && !p.choices?.length && p.kind !== "string" && p.kind !== "bool");
  while (pg.controls.length < SLOTS_PER_PAGE) pg.controls.push({ empty: true });
  let placed = 0;
  for (const k of knobs) {
    const p = free[placed];
    if (!p) break;
    const size = Math.max(24, Math.min(107, Math.round(2 * k.r)));
    const off = Math.floor((107 - size) / 2); // where knobComponent puts the picture inside its 107 px box
    const x = Math.max(0, Math.min(1280 - 107, Math.round(k.cx - size / 2 - off)));
    const y = Math.max(0, Math.min(628 - 107, Math.round(k.cy - size / 2 - off)));
    pg.controls.push({ param: p.name, widget: "knob", size, bounds: [x, y, labels ? 278 : 107, 107], ...(labels ? {} : { nameSize: 0, valueSize: 0 }) });
    placed++;
  }
  const qs = pg.controls.filter((c) => c.bounds && c.param).map((c) => c.param!).slice(0, 16);
  pg.qlinks = [...qs, ...new Array(16 - qs.length).fill(null)];
  return { doc: d, placed, unbound: knobs.length - placed, asset: name };
}

// ---- persistence -------------------------------------------------------------------------------
export function serializeDoc(doc: Doc): string {
  return JSON.stringify({ skinStudio2: 1, ...doc }, null, 2);
}
export function parseDoc(text: string): Doc {
  const o = JSON.parse(text);
  if (o.skinStudio2 !== 1 || !Array.isArray(o.params) || !Array.isArray(o.pages)) throw new Error("not a Skin Studio 2 project file");
  return { name: o.name ?? "Untitled", theme: o.theme ?? "mpc-red", params: o.params, pages: o.pages, ...(o.assets ? { assets: o.assets } : {}), ...(o.style ? { style: o.style } : {}), ...(typeof o.artDefs === "string" ? { artDefs: o.artDefs } : {}) };
}
