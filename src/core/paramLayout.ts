// paramLayout.ts — the auto-layout EXTENSION (v2), Akai-first.
//
// Capability: turn a bare parameter list (+ optional sections) into a sensible MPC layout. This is the
// one genuine delta v1 has over the SDK (see plan "Ledger 1 — auto-layout"): the SDK *describes*
// blocks-of-four authoring and supplies every widget, but does not *automate* laying out a param list.
//
// NOT gated byte-for-byte against v1. v1 is not the spec — Akai is the base, and v1's value here is only
// the automated packing + param-type recognition, re-expressed onto Akai widgets. Gate = behaviour:
// the chosen widget is the Akai-native construct for each param, and (later) the emitted ui.json/TUI
// builds via uiBuilder. This file: PART 1, the widget selector. Packing follows in a later unit.
//
// Every v1 widget type has a native Akai construct — several BETTER than v1's:
//   bool / 2–4 choices → switch (kit segments)        5+ choices → slider + menu overlay
//   levels/mix/sends/ADSR stages → fader              centre-zero → knob, bipolar (SDK auto-detects)
//   everything else continuous → knob                 value-text-is-the-point → slider
//   momentary/trigger → Button gestureBehaviour:Instant + ResetOnGestureEnd   (full TUI)
//   readout → Label type Value / NumericOverlay        stepper → NumericOverlay + replacementStrings
//   slot / result-rows → component repeats + {Increment} handle substitution   (full TUI)

// A parameter in v1's generic format (params.py). All fields optional except key.
export interface InputParam {
  key: string;
  name?: string;
  type?: string; // widget hint: readout | stepper | trigger | slot | float | ...
  options?: (string | number)[]; // choice/bool labels
  min?: number;
  max?: number;
  unit?: string;
  default?: number;
  momentary?: boolean; // a trigger that reports back to 0
  display?: string; // display text at the default value
  step_of?: number;
  step_delta?: number;
}

export interface Section {
  label: string;
  keys: string[];
}

// Which Akai construct a parameter maps to. `tui` says whether it lives in the simple ui.json widget
// set or needs the full TUI.json tier (Button/Value/NumericOverlay/repeats).
export interface WidgetChoice {
  widget: "knob" | "fader" | "switch" | "slider" | "button" | "readout" | "stepper" | "slot";
  tui: "simple" | "full";
  polarity?: "auto" | "unipolar" | "bipolar"; // knob/fader only
  overlay?: "knob" | "menu"; // slider with a menu for long choice lists
  momentary?: boolean; // button that resets on gesture end
  note?: string; // why this construct (for the UI's "extension" marker / debugging)
}

// Name tokens that pick fader (levels) or bipolar knob (centre-zero), per the SDK §"Which widget".
const LEVEL_TOKENS = [
  "level", "volume", "gain", "mix", "dry", "wet", "send", "amount", "amt",
  "attack", "decay", "sustain", "release", "hold", "depth",
];
const BIPOLAR_TOKENS = ["pan", "tune", "pitch", "detune", "offset", "balance", "bal", "width", "spread", "bend"];

function tokens(p: InputParam): string[] {
  return `${p.name ?? ""} ${p.key}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
function hasToken(p: InputParam, list: string[]): boolean {
  const t = new Set(tokens(p));
  return list.some((w) => t.has(w));
}

function looksBoolean(options: string[]): boolean {
  if (options.length !== 2) return false;
  const a = options[0].toLowerCase();
  return a === "off" || a === "free" || a === "no";
}

/**
 * Choose the Akai-native construct for one parameter. SDK rules are the base; v1's explicit param
 * `type`/`momentary` hints are recognised and mapped to their native Akai construct (never dropped).
 */
export function widgetFor(p: InputParam): WidgetChoice {
  // 1) Explicit v1 param-type hints → their native Akai construct (full-TUI tier).
  const t = (p.type ?? "").toLowerCase();
  if (t === "slot") return { widget: "slot", tui: "full", note: "result row — TUI repeats + {Increment}" };
  if (t === "readout") return { widget: "readout", tui: "full", note: "value display — Label type Value / NumericOverlay" };
  if (t === "stepper") return { widget: "stepper", tui: "full", note: "NumericOverlay + replacementStrings" };
  if (t === "trigger" || p.momentary)
    return { widget: "button", tui: "full", momentary: true, note: "Button gestureBehaviour:Instant + ResetOnGestureEnd" };

  // 2) Discrete (choice/bool) → switch or slider+menu (SDK rule 1; switch is a hard ≤4 constraint).
  const options = p.options?.map((o) => String(o));
  if (options && options.length >= 1) {
    if (looksBoolean(options)) return { widget: "switch", tui: "simple", note: "bool → switch" };
    if (options.length <= 4) return { widget: "switch", tui: "simple", note: `${options.length}-choice → switch segments` };
    return { widget: "slider", tui: "simple", overlay: "menu", note: "5+ choices → slider + menu overlay" };
  }

  // 3) Continuous. SDK rules 2–4.
  if (hasToken(p, LEVEL_TOKENS)) return { widget: "fader", tui: "simple", polarity: "auto", note: "level/mix/env stage → fader" };
  if (hasToken(p, BIPOLAR_TOKENS)) return { widget: "knob", tui: "simple", polarity: "bipolar", note: "signed/centre → bipolar knob" };
  // else: a plain knob; polarity "auto" lets gen_ui auto-detect a centre-zero default.
  return { widget: "knob", tui: "simple", polarity: "auto", note: "continuous → knob" };
}

// =================================================================================================
// PART 1b — the param loader/importer (KEEP, port of v1 params.py + the schwung adapter).
//
// Normalises non-SDK parameter sources into InputParam[] (+ optional sections) for the packer. The
// SDK's own params.json (host_sim dump) is handled by uiBuilder.loadParams; this is the importer for
// the other formats v1 supported, so no input source regresses.
//   - a bare array              → params, no sections
//   - {params, sections?}       → params + sections [(label, keys)]
//   - a Schwung module.json      → chain_params (access:"write" → momentary); ui_hierarchy → sections
// =================================================================================================

function isModule(d: Record<string, unknown>): boolean {
  if ("chain_params" in d) return true;
  const caps = d.capabilities;
  return isPlainObject(caps) && "chain_params" in caps;
}

function loadModule(d: Record<string, unknown>): { params: InputParam[]; sections?: Section[] } {
  const caps = (isPlainObject(d.capabilities) ? d.capabilities : d) as Record<string, unknown>;
  const raw = (caps.chain_params ?? d.chain_params) as unknown;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("module: no chain_params");
  const params: InputParam[] = raw.map((p) => {
    const src = p as Record<string, unknown>;
    const q: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) if (k !== "access") q[k] = v;
    if (src.access === "write") q.momentary = true;
    return q as unknown as InputParam;
  });
  const keys = new Set(params.map((p) => p.key));
  const levels = (isPlainObject(caps.ui_hierarchy) ? (caps.ui_hierarchy as Record<string, unknown>).levels : undefined) as
    | Record<string, unknown>
    | undefined;
  const sections: Section[] = [];
  const seen = new Set<string>();
  if (levels && isPlainObject(levels)) {
    const order = ["root", ...Object.keys(levels).filter((k) => k !== "root")];
    for (const lv of order) {
      const lvl = levels[lv];
      if (!isPlainObject(lvl)) continue;
      const pks = (lvl.params as unknown[]) ?? [];
      const ks = pks.filter((k): k is string => typeof k === "string" && keys.has(k) && !seen.has(k));
      ks.forEach((k) => seen.add(k));
      if (ks.length) sections.push({ label: (lvl.label as string) ?? lv, keys: ks });
    }
  }
  return { params, sections: sections.length ? sections : undefined };
}

/** Load a parameter file (already-parsed JSON) into the packer's input shape. */
export function loadParamFile(data: unknown): { params: InputParam[]; sections?: Section[] } {
  if (Array.isArray(data)) return { params: data as InputParam[] };
  if (!isPlainObject(data)) throw new Error("parameter file: expected a list or an object");
  if (Array.isArray(data.params)) {
    const sections = Array.isArray(data.sections)
      ? (data.sections as Record<string, unknown>[]).map((s) => ({ label: String(s.label), keys: (s.keys as string[]) ?? [] }))
      : undefined;
    return { params: data.params as InputParam[], sections: sections && sections.length ? sections : undefined };
  }
  if (isModule(data)) return loadModule(data);
  throw new Error("parameter file: no parameter list");
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// =================================================================================================
// PART 2 — the packer (v1's kept knowledge, re-expressed on Akai's grid).
//
// Akai's grid: a page is 4×4 (16 slots), laid out in reading order (control i → row i//4, col i%4);
// the 4 COLUMNS are the Q-Link banks ("Bank Direction": "Column"). So a "block of four" is a column.
// The packer makes each column one coherent section-chunk, packs ≤4 columns per page without splitting
// a section across pages, and names each tab from its sections — the knowledge from v1's auto_layout,
// but on Akai widgets and Akai's column/bank geometry. Q-Link mapping is left to uiBuilder (it derives
// it from control positions), exactly as the SDK does.
// =================================================================================================

export interface PlacedControl {
  param: InputParam;
  choice: WidgetChoice;
}
export interface PageLayout {
  name: string;
  slots: (PlacedControl | null)[]; // length 16, row-major (index = row*4 + col)
  // A dedicated {Increment} strip page (all slots null): `count` consecutive params from `param`.
  // Hardware-verified: `repeats` only expands on a tab root, so a strip owns its whole page.
  strip?: { param: InputParam; count: number };
}
export interface Layout {
  pages: PageLayout[];
}

const COLS_PER_PAGE = 4;
const ROWS_PER_COL = 4;

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// v1 skipped a `<base>_prev` / `<base>_next` stepper-arrow when its base key exists (the arrows belong
// to the stepper widget, not a slot of their own). Keep that recognition.
function isArrow(key: string, byKey: Map<string, InputParam>): boolean {
  if (key.endsWith("_prev") || key.endsWith("_next")) return byKey.has(key.slice(0, -5));
  return false;
}

/**
 * Pack params (+ optional sections) into Akai pages. Without sections, everything is one section in
 * key order. A section ≤4 columns is never split across pages; a larger one flows across pages.
 */
export function packLayout(params: InputParam[], sections?: Section[]): Layout {
  const byKey = new Map(params.map((p) => [p.key, p]));
  const secs: Section[] = sections && sections.length ? sections : [{ label: "", keys: params.map((p) => p.key) }];

  // Each column carries its section label (for tab naming). Build columns section by section.
  type Col = { label: string; controls: PlacedControl[] };
  const pagesCols: Col[][] = [[]];
  const curPage = () => pagesCols[pagesCols.length - 1];
  const stripPages: { afterPages: number; strip: { param: InputParam; count: number }; name: string }[] = [];
  const paramIndex = new Map(params.map((p, i) => [p.key, i]));

  for (const sec of secs) {
    const controls: PlacedControl[] = [];
    const keys = sec.keys.filter((k) => byKey.has(k) && !isArrow(k, byKey));
    for (let ki = 0; ki < keys.length; ki++) {
      const p = byKey.get(keys[ki])!;
      if (widgetFor(p).widget === "slot") {
        // run of slot params with consecutive indices → one dedicated strip page
        let run = 1;
        while (ki + run < keys.length && widgetFor(byKey.get(keys[ki + run])!).widget === "slot" &&
               paramIndex.get(keys[ki + run]) === paramIndex.get(keys[ki])! + run) run++;
        if (run >= 2) {
          stripPages.push({ afterPages: pagesCols.filter((c) => c.length).length, strip: { param: p, count: run }, name: (sec.label || p.name || p.key).toUpperCase() });
          ki += run - 1;
          continue;
        }
        controls.push({ param: p, choice: widgetFor({ ...p, type: "float" }) }); // lone slot → plain slider/knob
        continue;
      }
      controls.push({ param: p, choice: widgetFor(p) });
    }
    if (controls.length === 0) continue;
    const cols = chunk(controls, ROWS_PER_COL).map((c) => ({ label: sec.label, controls: c }));
    // Keep a page-sized-or-smaller section whole: start a new page if it won't fit in what's left.
    const remaining = COLS_PER_PAGE - curPage().length;
    if (cols.length <= COLS_PER_PAGE && cols.length > remaining && curPage().length > 0) pagesCols.push([]);
    for (const col of cols) {
      if (curPage().length === COLS_PER_PAGE) pagesCols.push([]);
      curPage().push(col);
    }
  }

  const pages: PageLayout[] = [];
  for (const cols of pagesCols) {
    if (cols.length === 0) continue;
    const slots: (PlacedControl | null)[] = new Array(16).fill(null);
    cols.forEach((col, c) => col.controls.forEach((pc, r) => (slots[r * COLS_PER_PAGE + c] = pc)));
    pages.push({ name: tabName(cols.map((c) => c.label)) || String(pages.length + 1), slots });
  }
  // Interleave strip pages at the position they were met (after N normal pages).
  for (let i = stripPages.length - 1; i >= 0; i--) {
    const sp = stripPages[i];
    pages.splice(sp.afterPages, 0, { name: sp.name, slots: new Array(16).fill(null), strip: sp.strip });
  }
  return { pages };
}

// Tab name from the page's section labels (v1's rule): unique labels, " / "-joined, uppercased; if
// that is too long, the first label plus "+N". Unlabelled sections fall back to the page number later.
function tabName(labels: string[]): string {
  const uniq: string[] = [];
  for (const l of labels) if (l && !uniq.includes(l)) uniq.push(l);
  if (uniq.length === 0) return "";
  const joined = uniq.join(" / ").toUpperCase();
  if (joined.length > 28) return uniq[0].toUpperCase() + " +" + (uniq.length - 1);
  return joined;
}

// -------------------------------------------------------------------------------------------------
// Emitters: turn a packed Layout into the SDK inputs (params.json + ui.json) that uiBuilder consumes.
// Full-TUI-tier controls (tui: "full") are placed by the packer but have no simple ui.json widget yet;
// toUiJson rejects a page that contains one until the full-TUI emitter unit lands. toParamsJson always
// works (it describes every parameter regardless of widget tier).
// -------------------------------------------------------------------------------------------------

/** Build the gen_ui params.json object (index/name/kind/choices/default) from the input params. */
export function toParamsJson(params: InputParam[]): unknown {
  return {
    params: params.map((p, i) => {
      const options = p.options?.map((o) => String(o));
      const kind = options ? (looksBoolean(options) ? "bool" : "choice") : "float";
      const out: Record<string, unknown> = { index: i, name: p.name ?? p.key, kind };
      if (options) out.choices = options;
      if (typeof p.default === "number") out.default = p.default;
      if (p.display !== undefined) out.display = p.display;
      return out;
    }),
  };
}

/**
 * Build the full control specs (simple + full-TUI) from a packed Layout, for uiBuilder's
 * generateFromControls. Unlike toUiJson, this carries the full-TUI widgets (button/readout).
 */
export function toControlSpecs(layout: Layout): import("./uiBuilder.ts").PageSpec[] {
  return layout.pages.map((pg) => {
    if (pg.strip) return { name: pg.name, controls: [{ param: pg.strip.param.name ?? pg.strip.param.key, full: "repeat", repeatCount: pg.strip.count }] };
    const controls = pg.slots.map((slot): import("./uiBuilder.ts").ControlSpec => {
      if (slot === null) return { empty: true };
      const { param, choice } = slot;
      const name = param.name ?? param.key;
      if (choice.widget === "button") return { param: name, full: "button" };
      if (choice.widget === "readout") return { param: name, full: "readout" };
      if (choice.widget === "stepper") return { param: name, full: "stepper" };
      if (choice.tui === "full")
        throw new Error(`control "${param.key}" (${choice.widget}) is full-TUI but has no emitter yet (held for hardware verification)`);
      const c: import("./uiBuilder.ts").ControlSpec = { param: name, widget: choice.widget };
      if (choice.overlay === "menu") c.overlay = "menu";
      if (choice.polarity && choice.polarity !== "auto" && (choice.widget === "knob" || choice.widget === "fader"))
        c.polarity = choice.polarity;
      return c;
    });
    while (controls.length && controls[controls.length - 1].empty) controls.pop();
    return { name: pg.name, controls };
  });
}

/** Build the simple ui.json object from a packed Layout. Throws if any placed control needs full TUI. */
export function toUiJson(layout: Layout): unknown {
  const pages = layout.pages.map((pg) => {
    const controls = pg.slots.map((slot) => {
      if (slot === null) return "empty";
      const { param, choice } = slot;
      if (choice.tui !== "simple")
        throw new Error(`control "${param.key}" needs the full-TUI tier (${choice.widget}); not emittable to simple ui.json yet`);
      const c: Record<string, unknown> = { param: param.name ?? param.key, widget: choice.widget };
      if (choice.overlay === "menu") c.overlay = "menu";
      if (choice.polarity && choice.polarity !== "auto" && (choice.widget === "knob" || choice.widget === "fader"))
        c.polarity = choice.polarity;
      return c;
    });
    // trim trailing "empty" slots (tidy, and harmless to uiBuilder)
    while (controls.length && controls[controls.length - 1] === "empty") controls.pop();
    return { name: pg.name, controls };
  });
  return { pages };
}
