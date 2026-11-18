// Renderer — the editor window. Three panes: Add + page contents (left), the canvas you edit on (centre),
// tabbed panels that follow the selection (right). Pure DOM; every change is an op on the main process's
// Doc, which answers with fresh state (doc + a preview SVG per tab). No skin logic lives here that is not
// in the tested src/app modules.
import { lookStrip, stillImage, rotatedKnob, uploadedStrip, svgToPng, panelPicture, LOOK_NAMES, type Made } from "./assets.ts";
import { findPanelControls } from "../../src/core/panelDetect.ts";

type Spec = { nameSize?: number; valueSize?: number; size?: number; strip?: string; bounds?: number[]; empty?: boolean; text?: string; param?: string; widget?: string; overlay?: string; polarity?: string; full?: string; repeatCount?: number; meterDir?: string; visibleWhen?: { param: string; index?: number; choice?: string } };
type Param = { name: string; kind: string; choices?: string[]; default?: number };
type DocAsset = { frames: number; w: number; h: number; png: string };
type Page = { name: string; controls: Spec[]; qlinks?: (string | null)[]; qlinkBounds?: string[]; background?: string; images?: PlacedImage[]; art?: { svg: string; asset?: string; modes?: { param: string; index: number; svg: string; asset?: string }[] } };
type PlacedImage = { asset: string; x: number; y: number; w: number; h: number; when?: { param: string; index: number }; param?: string };
type Doc = { style?: Record<string, string>; assets?: Record<string, DocAsset>; name: string; theme: string; params: Param[]; pages: Page[] };
type State = { doc: Doc | null; previews?: string[]; warnings?: string[]; checks?: string[]; qrects?: string[][]; qeff?: number[][]; canUndo?: boolean; canRedo?: boolean; file?: string | null; dirty?: boolean; pvals?: Record<string, number> };
declare global { interface Window { studio: { call(op: string, args?: unknown): Promise<any>; onMenu(fn: (id: string) => void): void } } }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const W = 1280, H = 628, SW = 278, SH = 107;
const SX = [23, 343, 663, 983], SY = [45, 196, 346, 497];

let st: State = { doc: null };
let page = 0;
let sel = 0;
// Multi-select: `sel` is the primary control; `more` holds the others. Shift/Ctrl+click toggles, dragging on empty canvas
// draws a selection rectangle, Ctrl+A takes everything on the page.
let more = new Set<number>();
const group = (): number[] => {
  const pg = cur(); if (!pg) return [];
  return [...new Set([sel, ...more])].filter((i) => pg.controls[i] && !pg.controls[i].empty).sort((a, b) => a - b);
};
const isMulti = () => group().length > 1;
const V = { qlinks: false, outlines: true, zoom: "fit", panel: "inspect" };
try { Object.assign(V, JSON.parse(localStorage.getItem("view") ?? "{}")); } catch { /* defaults */ }
const saveV = () => { try { localStorage.setItem("view", JSON.stringify(V)); } catch { /* not fatal */ } };

// ---- feedback ------------------------------------------------------------------------------------
const msg = (m: string, err = false) => { $("msg").textContent = m; $("msg").className = err ? "err" : ""; };
const hint = (m: string) => { $("hint").textContent = m; };
let toastT = 0;
function toast(m: string): void {
  const t = $("toast"); t.textContent = m; t.hidden = false; msg(m, true);
  clearTimeout(toastT); toastT = window.setTimeout(() => (t.hidden = true), 7000);
}
$("toast").addEventListener("click", () => ($("toast").hidden = true));

async function call(op: string, args: any = {}, o: { quiet?: boolean; light?: boolean } = {}): Promise<any> {
  const r = await window.studio.call(op, args);
  if (r.error) { toast(r.error); return r; }
  if (r.cancelled) return r;
  if ("doc" in r) {
    st = r;
    if (page >= (st.doc?.pages.length ?? 0)) page = Math.max(0, (st.doc?.pages.length ?? 1) - 1);
    if (st.file) remember(st.file);
    if (o.light) { renderStage(); renderTop(); } else render();
  }
  if (!o.quiet) msg(r.built ? `Built: ${r.built}` : r.saved ? `Saved ${r.saved}` : "Ready.");
  return r;
}

// ---- model helpers -------------------------------------------------------------------------------
const KINDS: { k: string; label: string; gl: string; tip: string }[] = [
  { k: "knob", label: "Knob", gl: "◔", tip: "Rotary control with name and value" },
  { k: "fader", label: "Fader", gl: "▮", tip: "Vertical fader — levels, envelopes" },
  { k: "slider", label: "Slider", gl: "▬", tip: "Akai's standard slider bar" },
  { k: "slider+menu", label: "Menu", gl: "☰", tip: "Slider that opens a list — for 5 or more choices" },
  { k: "switch", label: "Switch", gl: "◐", tip: "On/off toggle, or 2–4 choice buttons" },
  { k: "button", label: "Button", gl: "◉", tip: "Momentary button (fires while pressed)" },
  { k: "readout", label: "Readout", gl: "#", tip: "Shows a value; not touchable, takes no Q-Link" },
  { k: "stepper", label: "Stepper", gl: "±", tip: "Value with a numeric keypad" },
  { k: "meter", label: "Meter", gl: "▯", tip: "A level bar the plugin fills (it writes its level into a parameter)" },
  { k: "text", label: "Text", gl: "T", tip: "A fixed label" },
];
const kindOf = (c: Spec | undefined): string => {
  if (!c || c.empty) return "empty";
  if (c.text !== undefined) return "text";
  if (c.full) return c.full; // button | readout | stepper | repeat
  if (c.widget === "slider" && c.overlay === "menu") return "slider+menu";
  return c.widget ?? "slider";
};
const kindInfo = (k: string) => KINDS.find((x) => x.k === k) ?? { k, label: k, gl: "•", tip: "" };
const cur = (): Page | undefined => st.doc?.pages[page];
const isStrip = (pg: Page | undefined) => !!pg?.controls.some((c) => c.full === "repeat");
const isFree = (pg: Page | undefined) => !!pg?.controls.some((c) => c.bounds);
const rectOf = (c: Spec, i: number): number[] => c.bounds ?? [SX[i % 4], SY[Math.floor(i / 4) % 4], SW, SH];
const selected = (): Spec | null => { const c = cur()?.controls[sel]; return c && !c.empty ? c : null; };
const pidx = (name: string | undefined) => st.doc?.params.findIndex((p) => p.name === name) ?? -1;
const title = (c: Spec) => (c.text !== undefined ? c.text || "(text)" : c.param ?? "?");
function whenIndex(c: Spec): number {
  const vw = c.visibleWhen; if (!vw) return 0;
  if (vw.index !== undefined) return vw.index;
  const ch = st.doc?.params[pidx(vw.param)]?.choices ?? [];
  return Math.max(0, ch.findIndex((x) => String(x).toLowerCase() === String(vw.choice).toLowerCase()));
}
function whenText(c: Spec): string {
  const vw = c.visibleWhen; if (!vw) return "";
  const p = st.doc?.params[pidx(vw.param)];
  return `${vw.param} = ${p?.choices?.[whenIndex(c)] ?? whenIndex(c)}`;
}
const pval = (i: number): number => st.pvals?.[String(i)] ?? st.doc?.params[i]?.default ?? 0;
const hiddenNow = (c: Spec) => !!c.visibleWhen && Math.round(pval(pidx(c.visibleWhen.param))) !== whenIndex(c);

function makeSpec(k: string, param: string, old: Spec = {}): Spec {
  let s: Spec;
  if (k === "text") s = { text: old.text ?? "TEXT" };
  else if (k === "button" || k === "readout" || k === "stepper" || k === "meter") s = { param, full: k };
  if (k === "meter" && old.meterDir) s.meterDir = old.meterDir;
  else if (k === "slider+menu") s = { param, widget: "slider", overlay: "menu" };
  else s = { param, widget: k };
  const knobLike = k === "knob" || k === "fader";
  if (knobLike && old.polarity && old.polarity !== "auto") s.polarity = old.polarity;
  if (k === "knob" && old.size) s.size = old.size;
  if (knobLike || k === "slider" || k === "slider+menu") {
    if (old.nameSize !== undefined) s.nameSize = old.nameSize;
    if (old.valueSize !== undefined) s.valueSize = old.valueSize;
  }
  if (knobLike && old.strip) s.strip = old.strip;
  if (old.visibleWhen) s.visibleWhen = old.visibleWhen;
  return s;
}
/** The parameter a new control of this kind should start on: an unused one of a fitting type if possible. */
function pickParam(k: string): string | null {
  const d = st.doc!; const used = new Set<string>();
  for (const pg of d.pages) for (const c of pg.controls) if (c.param) used.add(c.param);
  const n = (p: Param) => p.choices?.length ?? 0;
  const fits = (p: Param) => (k === "meter" ? n(p) === 0 && p.kind !== "bool" : k === "switch" ? p.kind === "bool" || (n(p) >= 2 && n(p) <= 4) : k === "slider+menu" ? n(p) >= 2 : k === "button" ? true : n(p) === 0 && p.kind !== "bool");
  const strict = k === "switch" || k === "slider+menu";
  const p = d.params.find((x) => fits(x) && !used.has(x.name)) ?? d.params.find(fits) ?? (strict ? undefined : d.params.find((x) => !used.has(x.name)) ?? d.params[0]);
  return p?.name ?? null;
}

// ---- edits ---------------------------------------------------------------------------------------
function toggleSel(i: number): void {
  const pg = cur(); if (!pg?.controls[i] || pg.controls[i].empty) return;
  const g = new Set(group());
  if (g.has(i)) { g.delete(i); if (!g.size) g.add(i); } else g.add(i);
  const arr = [...g]; sel = g.has(sel) ? sel : arr[arr.length - 1]; more = new Set(arr.filter((x) => x !== sel));
  render();
}
async function select(i: number): Promise<void> {
  more.clear();
  sel = i;
  const c = selected();
  // a control that only shows in one mode: switch the preview to that mode so it can be seen and edited
  if (c?.visibleWhen && hiddenNow(c)) { await call("setPreview", { index: pidx(c.visibleWhen.param), value: whenIndex(c) }, { quiet: true }); msg(`Preview switched to ${whenText(c)} to show this control.`); }
  else render();
}
async function addKind(k: string, slot?: number): Promise<void> {
  const pg = cur(); if (!pg) return;
  if (isStrip(pg)) return toast("A strip page holds only its strip. Add a new page for other controls.");
  let spec: Spec;
  if (k === "text") spec = { text: "TEXT" };
  else {
    const p = pickParam(k);
    if (!p) return toast(k === "switch" ? "A switch needs an on/off parameter or one with 2–4 choices — this plugin has none." : "A menu needs a parameter with a list of choices — this plugin has none.");
    spec = makeSpec(k, p);
  }
  if (isFree(pg)) {
    const n = pg.controls.filter((c) => !c.empty).length;
    const r = await call("addFreeControl", { page, spec, x: 40 + (n % 6) * 24, y: 40 + (n % 6) * 24 });
    if (!r.error) { sel = st.doc!.pages[page].controls.length - 1; render(); }
    return;
  }
  const empty = (i: number) => !pg.controls[i] || pg.controls[i].empty;
  let t = slot ?? (sel < 16 && empty(sel) ? sel : -1);
  if (t < 0) t = Array.from({ length: 16 }, (_, i) => i).find(empty) ?? -1;
  if (t < 0) return toast("This page is full (16 slots). Add a page, or switch the page to free-form.");
  const r = await call("setControl", { page, slot: t, spec });
  if (!r.error) { sel = t; render(); }
}
async function deleteSel(): Promise<void> {
  if (!selected()) return;
  if (isMulti()) { const r = await call("removeControls", { page, indices: group() }); more.clear(); if (!r.error) { sel = Math.min(sel, 15); render(); } return; }
  await call("removeControl", { page, index: sel });
  if (!cur()?.controls[sel]) sel = Math.max(0, Math.min(sel, 15));
  render();
}
async function duplicateSel(): Promise<void> {
  const c = selected(); const pg = cur(); if (!c || !pg || isStrip(pg)) return;
  if (isMulti()) {
    const before = pg.controls.length;
    const r = await call("duplicateControls", { page, indices: group(), dx: 20, dy: 20 });
    if (r.error) return;
    const after = st.doc!.pages[page].controls;
    // select the copies: appended controls on a free page, or the slots that were filled on the grid
    const fresh = isFree(pg) ? after.map((_, i) => i).filter((i) => i >= Math.max(before, 16)) : after.map((_, i) => i).filter((i) => !pg.controls[i] || pg.controls[i].empty).filter((i) => !after[i].empty);
    if (fresh.length) { sel = fresh[0]; more = new Set(fresh.slice(1)); }
    render(); return;
  }
  const { bounds, ...spec } = c;
  if (isFree(pg)) {
    const [x, y, w, h] = rectOf(c, sel);
    const r = await call("addFreeControl", { page, spec, x: Math.min(W - w, x + 20), y: Math.min(H - h, y + 20) });
    if (r.error) return;
    sel = st.doc!.pages[page].controls.length - 1;
    if (w !== SW || h !== SH) await call("resizeControl", { page, index: sel, w, h }); else render();
    return;
  }
  const t = Array.from({ length: 16 }, (_, i) => i).find((i) => !pg.controls[i] || pg.controls[i].empty);
  if (t === undefined) return toast("This page is full (16 slots).");
  const r = await call("setControl", { page, slot: t, spec });
  if (!r.error) { sel = t; render(); }
}

// ---- popup menu + dialogs ------------------------------------------------------------------------
type MI = { label: string; hint?: string; act?: () => unknown; disabled?: boolean } | "-";
function showMenu(at: HTMLElement | { x: number; y: number }, items: MI[]): void {
  const m = $("menu");
  m.innerHTML = items.map((it, i) => (it === "-" ? "<hr>" : `<div class="mi ${it.disabled ? "dis" : ""}" data-i="${i}">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ""}</div>`)).join("");
  m.hidden = false;
  const r = at instanceof HTMLElement ? at.getBoundingClientRect() : null;
  let x = r ? r.left : (at as any).x, y = r ? r.bottom + 4 : (at as any).y;
  x = Math.min(x, window.innerWidth - m.offsetWidth - 8); y = Math.min(y, window.innerHeight - m.offsetHeight - 8);
  m.style.left = x + "px"; m.style.top = y + "px";
  m.querySelectorAll(".mi").forEach((el) => el.addEventListener("click", () => { m.hidden = true; const it = items[+(el as HTMLElement).dataset.i!]; if (it !== "-") void it.act?.(); }));
}
document.addEventListener("pointerdown", (e) => { if (!$("menu").hidden && !$("menu").contains(e.target as Node)) $("menu").hidden = true; }, true);
window.addEventListener("blur", () => ($("menu").hidden = true));

type Field = { id: string; label: string; type?: "text" | "number" | "select"; value?: string; options?: string[]; min?: number };
/** A small modal form (Electron has no prompt()). Resolves to the field values, or null when cancelled. */
function ask(titleText: string, note: string, fields: Field[] = [], okLabel = "OK"): Promise<Record<string, string> | null> {
  return new Promise((res) => {
    const d = $<HTMLDialogElement>("ask");
    $("askTitle").textContent = titleText;
    $("askBody").innerHTML = (note ? `<p class="note">${esc(note)}</p>` : "") + fields.map((f) => `<div class="row"><label>${esc(f.label)}</label>${f.type === "select"
      ? `<select data-f="${f.id}">${(f.options ?? []).map((o) => `<option ${o === f.value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
      : `<input data-f="${f.id}" type="${f.type ?? "text"}" ${f.min !== undefined ? `min="${f.min}"` : ""} value="${esc(f.value ?? "")}" />`}</div>`).join("");
    $("askOk").textContent = okLabel;
    const done = (ok: boolean) => {
      const out: Record<string, string> = {};
      d.querySelectorAll("[data-f]").forEach((el) => (out[(el as HTMLElement).dataset.f!] = (el as HTMLInputElement).value));
      d.close(); res(ok ? out : null);
    };
    $("askOk").onclick = () => done(true);
    $("askCancel").onclick = () => done(false);
    d.oncancel = (e) => { e.preventDefault(); done(false); };
    d.onkeydown = (e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") { e.preventDefault(); done(true); } };
    d.showModal();
    (d.querySelector("[data-f]") as HTMLElement | null)?.focus();
  });
}
const confirmDlg = async (t: string, note: string, ok: string) => (await ask(t, note, [], ok)) !== null;

// ---- files ---------------------------------------------------------------------------------------
function remember(f: string): void {
  try { const l: string[] = JSON.parse(localStorage.getItem("recent") ?? "[]"); localStorage.setItem("recent", JSON.stringify([f, ...l.filter((x) => x !== f)].slice(0, 8))); } catch { /* not fatal */ }
}
const recent = (): string[] => { try { return JSON.parse(localStorage.getItem("recent") ?? "[]"); } catch { return []; } };
async function leaveOk(): Promise<boolean> {
  return !st.dirty || confirmDlg("Unsaved changes", "The current skin has changes that are not saved. Continue and lose them?", "Discard changes");
}
async function openVia(op: string, args: any = {}): Promise<void> {
  if (!(await leaveOk())) return;
  const r = await call(op, args);
  if (r.error || r.cancelled) return;
  page = 0; sel = 0; render();
  if (st.warnings?.length) { V.panel = "checks"; render(); msg(`Opened with ${st.warnings.length} note(s) — see Checks.`); }
}
let templates: { id: string; label: string; description: string; plugin: string }[] = [];
const OPENERS: { op: string; label: string; what: string }[] = [
  { op: "openProject", label: "Open project…", what: "A Skin Studio project you saved earlier (.skin2.json)." },
  { op: "openSkin", label: "Open existing skin…", what: "A plugin's Plugin Skins/TUI.json — layout, colours and custom art are read back." },
  { op: "openParams", label: "Open parameter file…", what: "A parameter list (JSON); controls are laid out automatically." },
  { op: "openSdk", label: "Open SDK params.json…", what: "An MPC Plugin SDK build's params.json, with the ui.json beside it if present." },
];
async function importSvgFlow(): Promise<void> {
  if (!st.doc) return;
  const r = await call("importSvg"); if (!r || r.error || r.cancelled) return;
  let fail = "";
  for (const a of (r.art ?? []) as { page: number; mode?: number; svg: string | null }[]) {
    if (!a.svg) continue;
    try { msg("Rendering artwork…"); const m = await svgToPng(a.svg); const rr = await call("setPageArt", { page: a.page, mode: a.mode, png: m.png }, { quiet: true }); if (rr.error) fail = rr.error; }
    catch { fail = `The artwork on page ${a.page + 1} could not be rendered (is the SVG valid?) — its drawings are kept in the project but not shown.`; }
  }
  if (fail) toast(fail);
  else if (st.warnings?.length) { V.panel = "checks"; render(); msg(`Imported with ${st.warnings.length} note(s) — see Checks.`); }
  else msg(r.art?.length ? `Imported, with artwork on ${r.art.length} page(s).` : "Layout imported.");
}
async function importPanelFlow(): Promise<void> {
  if (!st.doc) return;
  const f = await pickFile("image/*"); if (!f) return;
  msg("Finding the controls…");
  const pic = await panelPicture(f);
  const found = findPanelControls(pic.rgba);
  const knobs = found.filter((c) => c.kind === "knob");
  if (!knobs.length) { msg("Ready."); return toast("No round controls found in that picture. Set it as the background (Images panel) and place knobs by hand."); }
  const a = await ask("Import panel picture", `Found ${knobs.length} knob(s)${found.length > knobs.length ? ` and ${found.length - knobs.length} smaller round part(s) (jacks, LEDs: not placed)` : ""}. The picture becomes this page's background and each knob gets a control on the next parameter not yet on the page. Move or rebind them afterwards.`,
    [{ id: "labels", label: "Names and values", type: "select", options: ["Hidden (the panel has its own)", "Shown"], value: "Hidden (the panel has its own)" }], "Import");
  if (!a) { msg("Ready."); return; }
  const r = await call("importPanel", { page, png: pic.png, knobs: knobs.map(({ cx, cy, r }) => ({ cx, cy, r })), labels: a.labels === "Shown" });
  if (r.error) return;
  sel = 0; render();
  msg(`Panel imported: ${r.placed} knob(s) placed${r.unbound ? `, ${r.unbound} left out (no free parameter)` : ""}.`);
}
async function skinSetFlow(): Promise<void> {
  const r = await window.studio.call("skinSetPick");
  if (r.error) return toast(r.error);
  if (r.cancelled) return;
  const a = await ask("Build skin set", `Interfaces: ${r.names.join(", ")}. The active one is shown when the plugin is first inserted.`, [{ id: "active", label: "Active", type: "select", options: r.names, value: r.names[0] }], "Choose folder…");
  if (!a) return;
  const b = await window.studio.call("skinSetBuild", { active: a.active });
  if (b.error) toast(b.error); else if (!b.cancelled) msg(`Skin set built (${b.names.join(", ")}): ${b.built}`);
}
async function addStripFlow(): Promise<void> {
  const d = st.doc; if (!d) return;
  const a = await ask("New strip page", "A strip page repeats one bar across the whole tab for a run of consecutive parameters (steps, partials…).", [
    { id: "first", label: "First parameter", type: "select", options: d.params.map((p) => p.name), value: d.params[0]?.name },
    { id: "count", label: "How many", type: "number", value: "8", min: 2 },
  ], "Add page");
  if (!a) return;
  const count = parseInt(a.count, 10);
  if (!(count >= 2)) return toast("A strip needs at least 2 parameters.");
  const r = await call("addStrip", { name: a.first.toUpperCase().slice(0, 12), param: a.first, count });
  if (!r.error) { page = st.doc!.pages.length - 1; sel = 0; render(); }
}

function run(id: string): unknown {
  if (id.startsWith("new:")) return openVia("newTemplate", { id: id.slice(4) });
  if (OPENERS.some((o) => o.op === id)) return openVia(id);
  if (id.startsWith("zoom:")) { V.zoom = id.slice(5); saveV(); return render(); }
  if (id === "toggle:qlinks") { V.qlinks = !V.qlinks; saveV(); return render(); }
  if (id === "toggle:outlines") { V.outlines = !V.outlines; saveV(); return render(); }
  if (!st.doc) return msg("Open or create a skin first.");
  switch (id) {
    case "save": return call("saveProject");
    case "saveAs": return call("saveProject", { as: true });
    case "exportSvg": return call("exportSvg");
    case "importSvg": return importSvgFlow();
    case "importPanel": return importPanelFlow();
    case "skinSet": return skinSetFlow();
    case "build": return call("build");
    case "install": return openInstall();
    case "undo": return call("undo");
    case "redo": return call("redo");
    case "duplicate": return duplicateSel();
    case "delete": return deleteSel();
  }
}
window.studio.onMenu((id) => void run(id));

// ---- top bar -------------------------------------------------------------------------------------
$("mNew").addEventListener("click", () => showMenu($("mNew"), templates.map((t) => ({ label: `${t.plugin} — ${t.label}`, act: () => run("new:" + t.id) }))));
$("mOpen").addEventListener("click", () => showMenu($("mOpen"), [
  ...OPENERS.map((o, i) => ({ label: o.label, hint: i === 0 ? "Ctrl+O" : undefined, act: () => run(o.op) })),
  ...(recent().length ? ["-" as const, ...recent().map((f) => ({ label: f.split(/[\\/]/).pop()!, act: () => openVia("openProject", { path: f }) }))] : []),
]));
$("mShare").addEventListener("click", () => showMenu($("mShare"), [
  { label: "Export layout SVG…", hint: "Inkscape", act: () => run("exportSvg"), disabled: !st.doc },
  { label: "Import layout SVG…", act: () => run("importSvg"), disabled: !st.doc },
  { label: "Import panel picture…", hint: "hardware photo", act: () => run("importPanel"), disabled: !st.doc },
  "-",
  { label: "Save project as…", hint: "Ctrl+Shift+S", act: () => run("saveAs"), disabled: !st.doc },
  { label: "Build skin set…", act: () => run("skinSet") },
]));
for (const [id, cmd] of [["save", "save"], ["undo", "undo"], ["redo", "redo"], ["build", "build"], ["install", "install"], ["dup", "duplicate"], ["del", "delete"]]) $(id).addEventListener("click", () => void run(cmd));
$<HTMLInputElement>("vQ").addEventListener("change", () => run("toggle:qlinks"));
$<HTMLInputElement>("vO").addEventListener("change", () => run("toggle:outlines"));
$<HTMLSelectElement>("zoom").addEventListener("change", () => run("zoom:" + $<HTMLSelectElement>("zoom").value));
window.addEventListener("resize", () => { if (V.zoom === "fit") renderStage(); });

function renderTop(): void {
  const d = st.doc;
  $("fileName").textContent = d ? (st.file ? st.file.split(/[\\/]/).pop()! : `${d.name || "Untitled"} — not saved yet`) : "";
  $("fileName").title = st.file ?? "";
  $("dirty").hidden = !st.dirty;
  for (const id of ["save", "build", "install"]) $<HTMLButtonElement>(id).disabled = !d;
  $<HTMLButtonElement>("undo").disabled = !st.canUndo;
  $<HTMLButtonElement>("redo").disabled = !st.canRedo;
  $<HTMLInputElement>("vQ").checked = V.qlinks;
  $<HTMLInputElement>("vO").checked = V.outlines;
  $<HTMLSelectElement>("zoom").value = V.zoom;
}

// ---- tabs ----------------------------------------------------------------------------------------
function renderTabs(): void {
  const d = st.doc!; const pg = cur(); const bar = $("tabbar");
  const mode = isStrip(pg) ? `<span>Strip page</span>` : `<span>Layout</span><span class="seg"><button id="mGrid" class="${isFree(pg) ? "" : "on"}" ${isFree(pg) ? 'disabled title="A free-form page stays free-form — use Undo to go back"' : 'title="Controls sit in the 4×4 slot grid"'}>Grid</button><button id="mFree" class="${isFree(pg) ? "on" : ""}" title="Place and size controls anywhere">Free-form</button></span>`;
  bar.innerHTML = d.pages.map((p, i) => `<span class="tab ${i === page ? "on" : ""}" data-i="${i}" title="Double-click to rename, right-click for more">${esc(p.name)}</span>`).join("") +
    `<button class="add ghost" id="tabAdd" title="Add a page">＋</button><span class="mode">${mode}</span>`;
  bar.querySelectorAll(".tab").forEach((t) => {
    const i = +(t as HTMLElement).dataset.i!;
    t.addEventListener("click", () => { if (i !== page) { page = i; sel = 0; more.clear(); render(); } });
    t.addEventListener("dblclick", () => renameTab(t as HTMLElement, i));
    t.addEventListener("contextmenu", (e) => { e.preventDefault(); page = i; render(); showMenu({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY }, pageMenu(i)); });
  });
  $("tabAdd").addEventListener("click", () => showMenu($("tabAdd"), [
    { label: "New page", act: async () => { await call("addPage", {}); page = st.doc!.pages.length - 1; sel = 0; render(); } },
    { label: "New strip page…", act: addStripFlow },
  ]));
  document.getElementById("mFree")?.addEventListener("click", async () => {
    if (isFree(cur())) return;
    if (await confirmDlg("Switch this page to free-form?", "Controls keep their places and Q-Links, and you can then drag and resize them anywhere. A free-form page cannot go back to the grid except with Undo.", "Make free-form")) await call("makeFree", { page });
  });
}
function pageMenu(i: number): MI[] {
  const n = st.doc!.pages.length;
  return [
    { label: "Rename…", act: () => { const t = $("tabbar").querySelector(`.tab[data-i="${i}"]`) as HTMLElement | null; if (t) renameTab(t, i); } },
    { label: "Move left", disabled: i === 0, act: async () => { await call("movePage", { from: i, to: i - 1 }); page = i - 1; render(); } },
    { label: "Move right", disabled: i >= n - 1, act: async () => { await call("movePage", { from: i, to: i + 1 }); page = i + 1; render(); } },
    "-",
    { label: "Delete page", disabled: n <= 1, act: async () => { if (await confirmDlg(`Delete page "${st.doc!.pages[i].name}"?`, "Its controls are removed from the skin. Undo brings it back.", "Delete page")) { await call("removePage", { page: i }); sel = 0; render(); } } },
  ];
}
function renameTab(t: HTMLElement, i: number): void {
  const old = st.doc!.pages[i].name;
  t.innerHTML = `<input value="${esc(old)}" maxlength="24" />`;
  const inp = t.querySelector("input")!; inp.focus(); inp.select();
  let done = false;
  const finish = (ok: boolean) => { if (done) return; done = true; const v = inp.value.trim(); if (ok && v && v !== old) void call("renamePage", { page: i, name: v }); else render(); };
  inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
  inp.addEventListener("blur", () => finish(true));
  inp.addEventListener("click", (e) => e.stopPropagation()); inp.addEventListener("dblclick", (e) => e.stopPropagation());
}

// ---- canvas --------------------------------------------------------------------------------------
function canvasWidth(): number {
  const s = $("stage");
  if (V.zoom !== "fit") return Math.round(W * (+V.zoom || 1));
  return Math.round(Math.max(360, Math.min(s.clientWidth - 48, ((s.clientHeight - 48) * W) / H, W * 1.5)));
}
const pct = (v: number, t: number) => ((v / t) * 100).toFixed(3) + "%";
const boxStyle = ([x, y, w, h]: number[]) => `left:${pct(x, W)};top:${pct(y, H)};width:${pct(w, W)};height:${pct(h, H)}`;

function renderStage(): void {
  const pg = cur(); const s = $("stage");
  if (!st.doc || !pg) { s.innerHTML = ""; return; }
  const sl = s.scrollLeft, stp = s.scrollTop;
  s.innerHTML = `<div id="canvas" class="${V.outlines ? "outlines" : ""}" style="width:${canvasWidth()}px">${st.previews?.[page] ?? ""}<div id="overlay"></div></div>`;
  s.scrollLeft = sl; s.scrollTop = stp;
  const ov = $("overlay");
  const free = isFree(pg), strip = isStrip(pg);
  const showQ = V.qlinks || V.panel === "qlinks";
  let html = "";
  if (showQ) for (const r of st.qrects?.[page] ?? []) html += `<div class="qrect" style="${boxStyle(r.split(" ").map(Number))}"></div>`;
  if (!strip) {
    if (!free) for (let i = 0; i < 16; i++) if (!pg.controls[i] || pg.controls[i].empty) html += `<div class="slot ${i === sel ? "sel" : ""}" data-i="${i}" style="${boxStyle(rectOf({}, i))}"></div>`;
    const eff = st.qeff?.[page] ?? [];
    pg.controls.forEach((c, i) => {
      if (c.empty) return;
      const q = c.param && showQ ? eff.indexOf(pidx(c.param)) : -1;
      html += `<div class="box ${i === sel || more.has(i) ? "sel" : ""} ${more.has(i) ? "msel" : ""} ${hiddenNow(c) ? "hiddenctl" : ""}" data-i="${i}" style="${boxStyle(rectOf(c, i))}">` +
        (i === sel && !isMulti() ? `<span class="tag">${esc(title(c))} · ${esc(kindInfo(kindOf(c)).label)}</span>` : "") +
        (q >= 0 ? `<span class="qtag">Q${q + 1}</span>` : "") +
        (c.visibleWhen ? `<span class="condtag">${hiddenNow(c) ? "hidden — shows " : ""}when ${esc(whenText(c))}</span>` : "") +
        (i === sel && free && !isMulti() ? `<span class="handle"></span>` : "") + `</div>`;
    });
  }
  ov.innerHTML = html;
  ov.addEventListener("pointerdown", startBand);
  ov.querySelectorAll<HTMLElement>(".slot").forEach((el) => {
    const i = +el.dataset.i!;
    el.addEventListener("pointerdown", (e) => { if (e.button === 0) void select(i); });
    el.addEventListener("contextmenu", (e) => { e.preventDefault(); sel = i; render(); showMenu({ x: e.clientX, y: e.clientY }, KINDS.map((k) => ({ label: `Add ${k.label.toLowerCase()}`, act: () => addKind(k.k, i) }))); });
  });
  ov.querySelectorAll<HTMLElement>(".box").forEach((el) => {
    const i = +el.dataset.i!;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.shiftKey || e.ctrlKey || e.metaKey) { e.preventDefault(); toggleSel(i); return; }
      startDrag(e, el, i, free);
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault(); if (!group().includes(i)) { sel = i; more.clear(); } render();
      showMenu({ x: e.clientX, y: e.clientY }, [
        { label: "Duplicate", hint: "Ctrl+D", act: duplicateSel },
        { label: "Delete", hint: "Del", act: deleteSel },
        ...(free ? [] : ["-" as const, { label: "Switch page to free-form…", act: () => document.getElementById("mFree")?.click() }]),
      ]);
    });
  });
}

/** Drag on empty canvas (free-form pages): draw a rectangle and select the controls it touches. */
function startBand(e: PointerEvent): void {
  const pg = cur(); if (!pg || !isFree(pg) || e.button !== 0 || e.target !== $("overlay")) return;
  const ov = $("overlay"); const cv = $("canvas").getBoundingClientRect(); const k = W / cv.width;
  const add = e.shiftKey || e.ctrlKey || e.metaKey;
  const band = document.createElement("div"); band.className = "rband"; ov.appendChild(band);
  const x0 = (e.clientX - cv.left) * k, y0 = (e.clientY - cv.top) * k;
  let rect = [x0, y0, x0, y0]; let moved = false;
  const move = (m: PointerEvent) => {
    const x1 = (m.clientX - cv.left) * k, y1 = (m.clientY - cv.top) * k;
    if (!moved && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < 4) return;
    moved = true; rect = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
    band.style.cssText = boxStyle([rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]]);
  };
  const up = () => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
    band.remove();
    if (!moved) { if (!add) { more.clear(); sel = 0; render(); } return; }
    const hit = pg.controls.map((c, i) => ({ c, i })).filter(({ c, i }) => { if (c.empty) return false; const [x, y, w, h] = rectOf(c, i); return x < rect[2] && x + w > rect[0] && y < rect[3] && y + h > rect[1]; }).map((x) => x.i);
    const all = add ? [...new Set([...group(), ...hit])] : hit;
    if (all.length) { sel = all[all.length - 1]; more = new Set(all.filter((x) => x !== sel)); }
    else if (!add) { more.clear(); }
    render();
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
}

function startDrag(e: PointerEvent, el: HTMLElement, i: number, free: boolean): void {
  const pg = cur()!; const c = pg.controls[i];
  // a drag that starts on one of several selected controls moves them all
  const groupMove = free && isMulti() && group().includes(i) && !(e.target as HTMLElement).classList.contains("handle");
  if (groupMove) return startGroupDrag(e, i);
  more.clear();
  const [x0, y0, w0, h0] = rectOf(c, i);
  const cv = $("canvas").getBoundingClientRect(); const k = W / cv.width;
  const resizing = (e.target as HTMLElement).classList.contains("handle");
  const ov = $("overlay");
  let moved = false, target = i, out: number[] | null = null;
  ov.querySelectorAll(".sel").forEach((n) => n.classList.remove("sel")); el.classList.add("sel");
  const wasSel = sel === i; sel = i;
  // listeners sit on the window, so the drag ends properly wherever the pointer is released
  const move = (m: PointerEvent) => {
    const dx = (m.clientX - e.clientX) * k, dy = (m.clientY - e.clientY) * k;
    if (!moved && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < 4) return;
    moved = true; el.classList.add("dragging");
    const snap = (v: number) => (m.altKey ? Math.round(v) : Math.round(v / 10) * 10);
    if (resizing) {
      const w = Math.max(20, Math.min(W - x0, snap(w0 + dx))), h = Math.max(20, Math.min(H - y0, snap(h0 + dy)));
      el.style.width = pct(w, W); el.style.height = pct(h, H); out = [w, h]; hint(`${w} × ${h}`);
    } else if (free) {
      const nx = Math.max(0, Math.min(W - w0, snap(x0 + dx))), ny = Math.max(0, Math.min(H - h0, snap(y0 + dy)));
      el.style.left = pct(nx, W); el.style.top = pct(ny, H); out = [nx, ny]; hint(`x ${nx}  y ${ny}${m.altKey ? "" : "   (Alt = no snap)"}`);
    } else {
      el.style.transform = `translate(${m.clientX - e.clientX}px, ${m.clientY - e.clientY}px)`;
      const px = (m.clientX - cv.left) * k, py = (m.clientY - cv.top) * k;
      const col = Math.max(0, Math.min(3, Math.round((px - SX[0] - SW / 2) / (SX[1] - SX[0]))));
      const row = SY.reduce((b, y, r) => (Math.abs(y + SH / 2 - py) < Math.abs(SY[b] + SH / 2 - py) ? r : b), 0);
      target = row * 4 + col;
      ov.querySelectorAll(".target").forEach((n) => n.classList.remove("target"));
      if (target !== i) ov.querySelector(`[data-i="${target}"]`)?.classList.add("target");
      hint(target === i ? "" : pg.controls[target] && !pg.controls[target].empty ? `Swap with ${title(pg.controls[target])}` : `Move to row ${row + 1}, column ${col + 1}`);
    }
  };
  const up = async () => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
    hint("");
    if (!moved) { if (wasSel) return; return select(i); }
    if (resizing && out) await call("resizeControl", { page, index: i, w: out[0], h: out[1] });
    else if (free && out) await call("moveControl", { page, index: i, x: out[0], y: out[1] });
    else if (!free && target !== i) { sel = target; await call("swapSlots", { page, a: i, b: target }); }
    else render();
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
}

function startGroupDrag(e: PointerEvent, i: number): void {
  const pg = cur()!; const g = group(); const ov = $("overlay");
  const cv = $("canvas").getBoundingClientRect(); const k = W / cv.width;
  const rects = new Map(g.map((n) => [n, rectOf(pg.controls[n], n)]));
  const minX = Math.min(...[...rects.values()].map((r) => r[0])), minY = Math.min(...[...rects.values()].map((r) => r[1]));
  const maxX = Math.max(...[...rects.values()].map((r) => r[0] + r[2])), maxY = Math.max(...[...rects.values()].map((r) => r[1] + r[3]));
  let moved = false, mx = 0, my = 0;
  const els = g.map((n) => ov.querySelector<HTMLElement>(`.box[data-i="${n}"]`)).filter(Boolean) as HTMLElement[];
  const move = (m: PointerEvent) => {
    if (!moved && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < 4) return;
    moved = true;
    const snap = (v: number) => (m.altKey ? Math.round(v) : Math.round(v / 10) * 10);
    mx = Math.max(-minX, Math.min(W - maxX, snap((m.clientX - e.clientX) * k))); my = Math.max(-minY, Math.min(H - maxY, snap((m.clientY - e.clientY) * k)));
    for (const el of els) { const r = rects.get(+el.dataset.i!)!; el.style.left = pct(r[0] + mx, W); el.style.top = pct(r[1] + my, H); el.classList.add("dragging"); }
    hint(`${g.length} controls  Δx ${mx}  Δy ${my}${m.altKey ? "" : "   (Alt = no snap)"}`);
  };
  const up = async () => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
    hint("");
    if (!moved) { await select(i); return; } // a click on one of several: just that one
    if (mx || my) await call("moveControls", { page, indices: g, dx: mx, dy: my }); else render();
  };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
}

window.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (e.key === "Escape") { $("menu").hidden = true; return; }
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || document.querySelector("dialog[open]")) return;
  const pg = cur(); if (!pg || isStrip(pg)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    const all = pg.controls.map((c, i) => (c.empty ? -1 : i)).filter((i) => i >= 0);
    if (all.length) { sel = all[all.length - 1]; more = new Set(all.slice(0, -1)); render(); }
    return;
  }
  if (e.key === "Escape" && isMulti()) { more.clear(); render(); return; }
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); void deleteSel(); return; }
  const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
  if (!d) return;
  e.preventDefault();
  if (isFree(pg) && isMulti()) {
    const n = e.shiftKey ? 10 : 1;
    void call("moveControls", { page, indices: group(), dx: d[0] * n, dy: d[1] * n }, { quiet: true });
  } else if (isFree(pg)) {
    const c = selected(); if (!c) return;
    const n = e.shiftKey ? 10 : 1; const [x, y, w, h] = rectOf(c, sel);
    void call("moveControl", { page, index: sel, x: Math.max(0, Math.min(W - w, x + d[0] * n)), y: Math.max(0, Math.min(H - h, y + d[1] * n)) }, { quiet: true });
  } else {
    const s = Math.min(sel, 15); const col = Math.max(0, Math.min(3, (s % 4) + d[0])), row = Math.max(0, Math.min(3, Math.floor(s / 4) + d[1]));
    void select(row * 4 + col);
  }
});

// ---- left pane -----------------------------------------------------------------------------------
$("palette").innerHTML = KINDS.map((k) => `<button data-k="${k.k}" title="${esc(k.tip)}"><span class="gl">${k.gl}</span>${k.label}</button>`).join("");
$("palette").querySelectorAll<HTMLElement>("button").forEach((b) => b.addEventListener("click", () => void addKind(b.dataset.k!)));
$("bgSet").addEventListener("click", () => guard(async () => { const f = await pickFile("image/*"); if (!f) return; const nm = uniqueName(safeName(f.name)); if (await storeAsset(nm, await stillImage(f))) await call("setBackground", { page, asset: nm }); }));
$("placeImg").addEventListener("click", () => guard(async () => { const f = await pickFile("image/*"); if (!f) return; const nm = uniqueName(safeName(f.name)); if (await storeAsset(nm, await stillImage(f))) { await call("addPlacedImage", { page, asset: nm, x: 40, y: 40 }); V.panel = "images"; render(); } }));

function renderLeft(): void {
  const pg = cur(); const strip = isStrip(pg);
  document.querySelectorAll<HTMLButtonElement>("#palette button, #bgSet, #placeImg").forEach((b) => (b.disabled = !pg || strip));
  const rows = (pg?.controls ?? []).map((c, i) => ({ c, i })).filter((x) => !x.c.empty);
  $("layers").innerHTML = strip
    ? `<li class="none">One strip of ${pg!.controls[0].repeatCount} bars starting at “${esc(pg!.controls[0].param)}”.</li>`
    : rows.length
    ? rows.map(({ c, i }) => `<li class="${i === sel || more.has(i) ? "sel" : ""}" data-i="${i}"><span class="gl">${kindInfo(kindOf(c)).gl}</span><span class="nm">${esc(title(c))}</span>${c.visibleWhen ? `<span class="cond" title="Shown only when ${esc(whenText(c))}">◑</span>` : ""}<small>${esc(kindInfo(kindOf(c)).label)}</small></li>`).join("")
    : `<li class="none">Nothing here yet. Pick a control above to add it${pg && !isFree(pg) ? " to the selected slot" : ""}.</li>`;
  $("layers").querySelectorAll<HTMLElement>("li[data-i]").forEach((li) => li.addEventListener("click", (e) => { const i = +li.dataset.i!; if (e.shiftKey || e.ctrlKey || e.metaKey) toggleSel(i); else void select(i); }));
  $<HTMLButtonElement>("dup").disabled = $<HTMLButtonElement>("del").disabled = !selected() || strip;
  $<HTMLButtonElement>("dup").textContent = isMulti() ? `Duplicate ${group().length}` : "Duplicate"; $<HTMLButtonElement>("del").textContent = isMulti() ? `Delete ${group().length}` : "Delete";
}

// ---- right panels --------------------------------------------------------------------------------
document.querySelectorAll<HTMLElement>("#paneltabs button").forEach((b) => b.addEventListener("click", () => { V.panel = b.dataset.p!; saveV(); render(); }));
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

function renderPanel(): void {
  document.querySelectorAll<HTMLElement>("#paneltabs button").forEach((b) => b.classList.toggle("on", b.dataset.p === V.panel));
  const n = (st.checks?.length ?? 0) + (st.warnings?.length ?? 0);
  $("checkCount").hidden = !n; $("checkCount").textContent = String(n);
  const box = $("panel"); const pg = cur();
  if (!st.doc || !pg) { box.innerHTML = ""; return; }
  ({ inspect: panelInspect, qlinks: panelQlinks, colours: panelColours, images: panelImages, params: panelParams, checks: panelChecks } as Record<string, (b: HTMLElement, p: Page) => void>)[V.panel]?.(box, pg);
}

function panelInspect(box: HTMLElement, pg: Page): void {
  const d = st.doc!; const c = selected(); const free = isFree(pg); const strip = isStrip(pg);
  let h = "";
  if (strip) h += `<h2>Strip</h2><p class="note">This page is one strip: ${pg.controls[0].repeatCount} bars for the parameters starting at <b>${esc(pg.controls[0].param)}</b>. A strip owns its whole tab. To change it, delete the page and add a new strip page.</p>`;
  else if (isMulti()) {
    const n = group().length;
    const al = (id: string, label: string, tip: string) => `<button id="${id}" title="${tip}" ${free ? "" : "disabled"}>${label}</button>`;
    h += `<h2>${n} controls selected</h2>
      ${free ? "" : `<p class="note">Aligning and spreading need a free-form page. Moving or aligning these switches this page to free-form (Undo reverses it).</p>`}
      <div class="row fill">${al("alL", "⇤ Left", "Line up left edges")}${al("alC", "↔ Centre", "Line up horizontal centres")}${al("alR", "Right ⇥", "Line up right edges")}</div>
      <div class="row fill">${al("alT", "⤒ Top", "Line up top edges")}${al("alM", "↕ Middle", "Line up vertical centres")}${al("alB", "Bottom ⤓", "Line up bottom edges")}</div>
      <div class="row fill">${al("spH", "Spread ↔", "Equal gaps left to right (3 or more)")}${al("spV", "Spread ↕", "Equal gaps top to bottom (3 or more)")}</div>
      <div class="row fill">${al("szW", "Same width", "Every control as wide as the first")}${al("szH", "Same height", "Every control as tall as the first")}</div>
      <p class="note">Drag any selected control to move them all; arrow keys nudge (Shift = 10 px). Esc or a click on one control goes back to a single selection.</p>`;
  }
  else if (!c) h += `<h2>${free ? "Nothing selected" : `Slot ${Math.min(sel, 15) + 1} — empty`}</h2><div class="empty">${free ? "Click a control on the canvas to edit it," : "Choose a control under <b>Add control</b> to put it here,"}<br>or right-click ${free ? "it" : "the slot"} for more.</div>`;
  else {
    const k = kindOf(c); const knobLike = k === "knob" || k === "fader"; const hasText = knobLike || k === "slider" || k === "slider+menu";
    const vw = c.visibleWhen; const disc = d.params.filter((p) => (p.choices?.length ?? 0) > 0);
    const vwP = d.params[pidx(vw?.param)]; const [x, y, w, hh] = rectOf(c, sel);
    h += `<h2>${esc(kindInfo(k).label)} <small>${free ? "" : `slot ${sel + 1}`}</small></h2>
      <div class="row"><label>Type</label><select id="k">${KINDS.map((x) => `<option value="${x.k}" ${x.k === k ? "selected" : ""}>${x.label}</option>`).join("")}</select></div>
      ${k === "text" ? `<div class="row"><label>Text</label><input id="t" value="${esc(c.text ?? "")}" /></div>`
        : `<div class="row"><label>Parameter</label><select id="p">${d.params.map((p) => `<option ${p.name === c.param ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>`}
      ${knobLike ? `<div class="row"><label title="Bipolar draws from the centre (pan, detune)">Polarity</label><select id="pol">${["auto", "unipolar", "bipolar"].map((x) => `<option ${x === (c.polarity ?? "auto") ? "selected" : ""}>${x}</option>`).join("")}</select></div>` : ""}
      ${k === "meter" ? `<div class="row"><label title="The way the bar fills">Fills</label><select id="md">${["Up", "Down", "Left", "Right"].map((x) => `<option ${x === (c.meterDir ?? "Up") ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <p class="note">The plugin must write its level into <b>${esc(c.param ?? "")}</b> for the bar to move on the device. Meters are not yet verified on hardware.</p>` : ""}
      ${k === "knob" ? `<div class="row"><label>Knob size</label><input id="sz" type="number" min="24" max="107" value="${c.size ?? ""}" placeholder="default" /><span class="note" style="margin:0">px</span></div>` : ""}
      ${hasText ? `<div class="row"><label title="0 hides the text">Text size</label><input id="ns" type="number" min="0" max="60" value="${c.nameSize ?? ""}" placeholder="name" /><input id="vs" type="number" min="0" max="60" value="${c.valueSize ?? ""}" placeholder="value" /></div>` : ""}
      ${free ? `<div class="row"><label>Position</label><input id="bx" type="number" value="${x}" title="x" /><input id="by" type="number" value="${y}" title="y" /></div>
        <div class="row"><label>Size</label><input id="bw" type="number" min="20" value="${w}" title="width" /><input id="bh" type="number" min="20" value="${hh}" title="height" /></div>` : ""}
      <div class="row"><label title="Show this control only in one mode of another parameter">Show when</label><select id="vp"><option value="">always</option>${disc.map((p) => `<option ${p.name === vw?.param ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        ${vw ? `<select id="vi">${(vwP?.choices ?? []).map((ch, i) => `<option value="${i}" ${i === whenIndex(c) ? "selected" : ""}>${esc(ch)}</option>`).join("")}</select>` : ""}</div>
      ${c.strip ? `<p class="note">Picture: <b>${esc(c.strip)}</b> — change it under Images.</p>` : ""}`;
    const pi = pidx(c.param); const p = d.params[pi];
    if (p) h += `<h2>Preview value <small>not saved — just to see the skin move</small></h2><div class="row"><label>${esc(p.name)}</label>${p.choices?.length
      ? `<select id="pv">${p.choices.map((ch, i) => `<option value="${i}" ${i === Math.round(pval(pi)) ? "selected" : ""}>${esc(ch)}</option>`).join("")}</select>`
      : `<input id="pv" type="range" min="0" max="1" step="0.01" value="${pval(pi)}" />`}<button id="pvReset" title="Back to the default values">Reset</button></div>`;
  }
  h += `<h2>Page</h2><div class="row"><label>Name</label><input id="pageName" value="${esc(pg.name)}" maxlength="24" /></div>
    <div class="row"><label>Order</label><button id="pgL" ${page === 0 ? "disabled" : ""}>◀ Move left</button><button id="pgR" ${page >= d.pages.length - 1 ? "disabled" : ""}>Move right ▶</button></div>
    <p class="note">${strip ? "Strip page." : free ? "Free-form page: drag controls anywhere, drag the corner handle to resize, arrow keys nudge (Shift = 10 px)." : "Grid page: drag a control onto another slot to move or swap it. Switch to Free-form (top right of the canvas) to place controls anywhere."}</p>`;
  box.innerHTML = h;

  const on = (id: string, ev: string, fn: () => unknown) => document.getElementById(id)?.addEventListener(ev, () => void fn());
  if (isMulti() && !strip) {
    const idx = group();
    for (const [id, mode] of [["alL", "left"], ["alC", "centre"], ["alR", "right"], ["alT", "top"], ["alM", "middle"], ["alB", "bottom"]]) on(id, "click", () => call("alignControls", { page, indices: idx, mode }));
    on("spH", "click", () => call("distributeControls", { page, indices: idx, axis: "horizontal" }));
    on("spV", "click", () => call("distributeControls", { page, indices: idx, axis: "vertical" }));
    on("szW", "click", () => call("matchSize", { page, indices: idx, dims: "width" }));
    on("szH", "click", () => call("matchSize", { page, indices: idx, dims: "height" }));
  } else if (c && !strip) {
    const apply = async (resetWhen = false) => {
      const k = val("k"); const num = (id: string) => (val(id) === "" ? undefined : +val(id));
      const param = val("p") || c.param || pickParam(k) || d.params[0]?.name || "";
      const spec = makeSpec(k, k === kindOf(c) ? param : (k === "switch" || k === "slider+menu") && !fitsKind(k, param) ? pickParam(k) ?? param : param,
        { text: document.getElementById("t") ? val("t") : c.text, polarity: document.getElementById("pol") ? val("pol") : c.polarity, size: document.getElementById("sz") ? num("sz") : c.size,
          nameSize: document.getElementById("ns") ? num("ns") : c.nameSize, valueSize: document.getElementById("vs") ? num("vs") : c.valueSize, strip: c.strip, meterDir: document.getElementById("md") ? val("md") : c.meterDir });
      const vp = val("vp");
      if (vp) spec.visibleWhen = { param: vp, index: resetWhen ? 0 : +val("vi") || 0 };
      const r = await call("setControl", { page, slot: sel, spec });
      if (r.error) render();
    };
    for (const id of ["k", "p", "t", "pol", "sz", "ns", "vs", "vi", "md"]) on(id, "change", () => apply());
    on("vp", "change", () => apply(true));
    on("bx", "change", () => call("moveControl", { page, index: sel, x: +val("bx") || 0, y: +val("by") || 0 }));
    on("by", "change", () => call("moveControl", { page, index: sel, x: +val("bx") || 0, y: +val("by") || 0 }));
    on("bw", "change", () => call("resizeControl", { page, index: sel, w: +val("bw"), h: +val("bh") }));
    on("bh", "change", () => call("resizeControl", { page, index: sel, w: +val("bw"), h: +val("bh") }));
    const pi = pidx(c.param);
    on("pv", "input", () => call("setPreview", { index: pi, value: +val("pv") }, { quiet: true, light: true }));
    on("pvReset", "click", () => call("resetPreview", {}, { quiet: true }));
  }
  on("pageName", "change", () => { const v = val("pageName").trim(); return v && v !== pg.name ? call("renamePage", { page, name: v }) : render(); });
  on("pgL", "click", async () => { await call("movePage", { from: page, to: page - 1 }); page--; render(); });
  on("pgR", "click", async () => { await call("movePage", { from: page, to: page + 1 }); page++; render(); });
}
function fitsKind(k: string, param: string): boolean {
  const p = st.doc?.params[pidx(param)]; const n = p?.choices?.length ?? 0;
  return k === "switch" ? p?.kind === "bool" || (n >= 2 && n <= 4) : n >= 2;
}

const QROWS = [[13, 14, 15, 16], [9, 10, 11, 12], [5, 6, 7, 8], [1, 2, 3, 4]];
function panelQlinks(box: HTMLElement, pg: Page): void {
  const d = st.doc!;
  if (isStrip(pg)) { box.innerHTML = `<h2>Q-Links</h2><p class="note">A strip page maps its bars to the Q-Links in order.</p>`; return; }
  const eff = st.qeff?.[page] ?? [];
  const curName = (q: number) => { const i = eff[q - 1]; return i !== undefined && i >= 0 ? d.params[i]?.name ?? "" : ""; };
  box.innerHTML = `<h2>Q-Links <small>${pg.qlinks ? "set by hand" : "automatic, from the layout"}</small></h2>
    <p class="note">The 16 knobs as they sit on the hardware (Q13–16 on the top row). Pick what each one turns on this page; the canvas shows the same numbers.</p>
    <div class="qgrid">${QROWS.flat().map((q) => `<div><small>Q${q}</small><select data-q="${q}"><option value="">—</option>${d.params.map((p) => `<option ${p.name === curName(q) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>`).join("")}</div>
    <div class="row"><button id="qAuto" ${pg.qlinks ? "" : "disabled"}>Back to automatic</button></div>`;
  box.querySelectorAll<HTMLSelectElement>("select[data-q]").forEach((s) => s.addEventListener("change", () => {
    const arr: (string | null)[] = new Array(16).fill(null);
    box.querySelectorAll<HTMLSelectElement>("select[data-q]").forEach((el) => (arr[+el.dataset.q! - 1] = el.value || null));
    void call("setQlinks", { page, qlinks: arr });
  }));
  $("qAuto").addEventListener("click", () => void call("setQlinks", { page, qlinks: null }));
}

const COLOURS: [string, string, string, string][] = [["background", "Background", "ff1e1d1e", "The page behind the controls"], ["accent", "Accent", "ffd31145", "Focus outline and slider fill"], ["text", "Values", "ffffffff", "Value text"], ["muted", "Names", "ff6a6a6c", "Parameter names"]];
const THEMES = ["mpc-red", "amber", "cyan", "lime", "violet", "mono"];
function panelColours(box: HTMLElement): void {
  const d = st.doc!;
  box.innerHTML = `<h2>Kit</h2><div class="row"><label>Kit colour</label><select id="theme">${THEMES.map((t) => `<option ${t === d.theme ? "selected" : ""}>${t}</option>`).join("")}</select></div>
    <p class="note">Akai's knob, fader and switch pictures, drawn in this colour.</p>
    <h2>Page colours</h2>${COLOURS.map(([k, label, def, tip]) => `<div class="row" title="${tip}"><label>${label}</label><input type="color" data-c="${k}" value="#${(d.style?.[k] ?? def).slice(2)}" /><span class="note" style="margin:0">${d.style?.[k] && d.style[k] !== def ? "custom" : "Akai default"}</span></div>`).join("")}
    <div class="row"><button id="colReset">Reset to Akai defaults</button></div>`;
  $("theme").addEventListener("change", () => void call("setTheme", { theme: val("theme") }));
  box.querySelectorAll<HTMLInputElement>("input[data-c]").forEach((el) => el.addEventListener("change", () => void call("setStyle", { style: { [el.dataset.c!]: "ff" + el.value.slice(1) } })));
  $("colReset").addEventListener("click", () => void call("setStyle", { style: Object.fromEntries(COLOURS.map(([k, , def]) => [k, def])) }));
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const inp = $<HTMLInputElement>("fileIn"); inp.accept = accept; inp.value = "";
    inp.onchange = () => res(inp.files?.[0] ?? null);
    inp.click();
  });
}
const safeName = (base: string) => base.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 32) || "image";
function uniqueName(base: string): string {
  const have = st.doc?.assets ?? {}; let n = base, i = 2;
  while (have[n]) n = `${base}_${i++}`;
  return n;
}
async function storeAsset(name: string, m: Made): Promise<string | null> {
  const r = await call("addAsset", { name, png: m.png, frames: m.frames, w: m.w, h: m.h }, { quiet: true });
  return r.error ? null : name;
}
async function guard(fn: () => Promise<unknown>): Promise<void> {
  try { msg("Working…"); await fn(); if ($("msg").className !== "err") msg("Ready."); } catch (e) { toast(String((e as Error).message ?? e)); }
}
const knobSel = (): Spec | null => { const c = selected(); return c && !c.full && (c.widget === "knob" || c.widget === "fader") ? c : null; };

function panelImages(box: HTMLElement, pg: Page): void {
  const d = st.doc!; const assets = Object.entries(d.assets ?? {}); const c = knobSel(); const strip = isStrip(pg);
  box.innerHTML = `<h2>Knob pictures</h2>
    <p class="note">${c ? `Selected: <b>${esc(c.param)}</b> — ${c.strip ? "picture “" + esc(c.strip) + "”" : "Akai kit picture"}` : "Select a knob or fader on the canvas to give it its own picture."}</p>
    <div class="row"><label>Built-in look</label><select id="lookSel">${LOOK_NAMES.map((l) => `<option>${l}</option>`).join("")}</select></div>
    <div class="row fill"><button id="lookSel1" ${c ? "" : "disabled"}>Apply to selected</button><button id="lookAll">Use for every knob</button></div>
    <div class="row fill"><button id="imgKnob" ${c ? "" : "disabled"} title="A picture of a knob pointing up; it is turned for you">Picture as knob…</button><button id="stripUp" ${c ? "" : "disabled"} title="A ready-made strip of frames">Filmstrip…</button></div>
    <div class="row fill"><button id="clearStrip" ${c?.strip ? "" : "disabled"}>Back to kit: selected</button><button id="clearAll">Back to kit: all</button></div>
    ${strip ? "" : `<h2>This page</h2>
      <div class="item"><span class="nm">Background${pg.background ? `: <b>${esc(pg.background)}</b>` : " <small>none</small>"}</span><button id="bgSet2">Choose…</button>${pg.background ? `<button id="bgClear">Clear</button>` : ""}</div>
      ${(pg.images ?? []).map((im, i) => {
        const a = d.assets?.[im.asset]; const filmstrip = (a?.frames ?? 1) > 1;
        const modeArt = pg.art?.modes?.some((m) => m.asset === im.asset);
        const choiceParams = d.params.filter((p) => (p.choices?.length ?? 0) > 0);
        const wp = d.params.find((p) => p.name === im.when?.param);
        const label = im.asset === pg.art?.asset ? "Artwork (from SVG)" : modeArt ? `Artwork for ${esc(im.when?.param ?? "")} = ${esc(wp?.choices?.[im.when?.index ?? 0] ?? im.when?.index)}` : esc(im.asset);
        return `<div class="item"><span class="nm" title="${esc(im.asset)}">${label}</span>${(["x", "y", "w", "h"] as const).map((k) => `<input class="xy" type="number" data-im="${i}" data-k="${k}" value="${im[k]}" title="${k}" />`).join("")}<button class="icon" data-delim="${i}" title="Remove from the page">✕</button></div>
        <div class="item sub"><small title="Show this picture only in one mode of a choice parameter">Shows</small><select data-imwhen="${i}"><option value="">always</option>${choiceParams.map((p) => `<option ${p.name === im.when?.param ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>${wp ? `<select data-imopt="${i}">${(wp.choices ?? []).map((ch, k) => `<option value="${k}" ${k === im.when?.index ? "selected" : ""}>${esc(ch)}</option>`).join("")}</select><button data-impv="${i}" title="Show the preview in this mode">See</button>` : ""}
          ${filmstrip ? `<small title="The frame follows this parameter">Frame from</small><select data-imval="${i}"><option value="">—</option>${d.params.map((p) => `<option ${p.name === im.param ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>` : ""}</div>`;
      }).join("")}
      <div class="row fill"><button id="placeImg2">Place an image…</button><button id="valPic" title="A filmstrip whose frame follows a parameter — an LED ladder, a waveform picture, a mode light">Value picture…</button></div>`}
    <h2>Project images</h2>${assets.length ? assets.map(([n, a]) => `<div class="item"><span class="nm">${esc(n)}</span><small>${a.frames > 1 ? a.frames + " frames · " : ""}${a.w}×${a.h}</small><button class="icon" data-delasset="${esc(n)}" title="Delete from the project">✕</button></div>`).join("") : `<p class="note">No images yet.</p>`}`;
  const setStrip = (asset: string | null) => {
    const cc = knobSel(); if (!cc) return toast("Select a knob or fader first.");
    const { bounds, ...spec } = { ...cc } as Spec; if (asset) spec.strip = asset; else delete spec.strip;
    return call("setControl", { page, slot: sel, spec });
  };
  const lookAsset = async () => {
    const look = val("lookSel"); const nm = `look_${look}`;
    if (!st.doc?.assets?.[nm]) { msg(`Rendering ${look}…`); if (!(await storeAsset(nm, await lookStrip(look)))) throw new Error("could not store the look"); }
    return nm;
  };
  const on = (id: string, fn: () => Promise<unknown> | unknown) => document.getElementById(id)?.addEventListener("click", () => void guard(async () => fn()));
  on("lookSel1", async () => setStrip(await lookAsset()));
  on("lookAll", async () => call("setStripForAll", { widget: "knob", asset: await lookAsset() }));
  on("imgKnob", async () => { const f = await pickFile("image/*"); if (!f) return; const nm = uniqueName(safeName(f.name)); if (await storeAsset(nm, await rotatedKnob(f))) await setStrip(nm); });
  on("stripUp", async () => {
    const f = await pickFile("image/*"); if (!f) return;
    const a = await ask("Filmstrip", "How many frames does the strip hold (stacked down or across)?", [{ id: "n", label: "Frames", type: "number", value: "64", min: 2 }]);
    const fr = parseInt(a?.n ?? "", 10); if (!(fr >= 2)) return;
    const nm = uniqueName(safeName(f.name)); if (await storeAsset(nm, await uploadedStrip(f, fr))) await setStrip(nm);
  });
  on("clearStrip", () => setStrip(null));
  on("clearAll", () => call("setStripForAll", { widget: "knob", asset: null }));
  on("valPic", async () => {
    const f = await pickFile("image/*"); if (!f) return;
    const a = await ask("Value picture", "A strip of stacked frames: the frame shown follows the parameter. A choice parameter with N options wants N frames, one per option.", [{ id: "n", label: "Frames", type: "number", value: String(Math.max(2, d.params.find((p) => (p.choices?.length ?? 0) > 1)?.choices?.length ?? 8)), min: 2 }, { id: "p", label: "Parameter", type: "select", options: d.params.map((p) => p.name), value: d.params[0]?.name }]);
    const fr = parseInt(a?.n ?? "", 10); if (!a || !(fr >= 2)) return;
    const nm = uniqueName(safeName(f.name)); if (!(await storeAsset(nm, await uploadedStrip(f, fr)))) return;
    const r = await call("addPlacedImage", { page, asset: nm, x: 40, y: 40 }, { quiet: true }); if (r.error) return;
    await call("setImageValueParam", { page, index: (st.doc!.pages[page].images?.length ?? 1) - 1, param: a.p });
  });
  on("bgSet2", () => $("bgSet").click());
  on("placeImg2", () => $("placeImg").click());
  on("bgClear", () => call("setBackground", { page, asset: null }));
  box.querySelectorAll<HTMLInputElement>("input[data-im]").forEach((el) => el.addEventListener("change", () => {
    const i = +el.dataset.im!; const im = { ...pg.images![i] } as any; im[el.dataset.k!] = Math.round(+el.value || 0);
    void call("movePlacedImage", { page, index: i, x: im.x, y: im.y, w: im.w, h: im.h });
  }));
  box.querySelectorAll<HTMLSelectElement>("select[data-imwhen]").forEach((el) => el.addEventListener("change", () => { const i = +el.dataset.imwhen!; void call("setImageMode", { page, index: i, when: el.value ? { param: el.value, index: 0 } : null }); }));
  box.querySelectorAll<HTMLSelectElement>("select[data-imopt]").forEach((el) => el.addEventListener("change", () => { const i = +el.dataset.imopt!; void call("setImageMode", { page, index: i, when: { param: pg.images![i].when!.param, index: +el.value } }); }));
  box.querySelectorAll<HTMLSelectElement>("select[data-imval]").forEach((el) => el.addEventListener("change", () => void call("setImageValueParam", { page, index: +el.dataset.imval!, param: el.value || null })));
  box.querySelectorAll<HTMLElement>("[data-impv]").forEach((el) => el.addEventListener("click", () => { const im = pg.images![+el.dataset.impv!]; if (im.when) void call("setPreview", { index: pidx(im.when.param), value: im.when.index }, { quiet: true }); }));
  box.querySelectorAll<HTMLElement>("[data-delim]").forEach((el) => el.addEventListener("click", () => void call("removePlacedImage", { page, index: +el.dataset.delim! })));
  box.querySelectorAll<HTMLElement>("[data-delasset]").forEach((el) => el.addEventListener("click", () => void call("removeAsset", { name: el.dataset.delasset })));
}

function panelParams(box: HTMLElement): void {
  const d = st.doc!; const where = new Map<string, string[]>();
  for (const pg of d.pages) for (const c of pg.controls) if (c.param) where.set(c.param, [...(where.get(c.param) ?? []), pg.name]);
  box.innerHTML = `<h2>Parameters <small>${d.params.length} — names shown on the skin</small></h2>` + d.params.map((p, i) => {
    const w = [...new Set(where.get(p.name) ?? [])];
    return `<div class="item"><small style="width:20px">${i}</small><input data-i="${i}" value="${esc(p.name)}" style="flex:1" /><small title="${w.length ? "On: " + esc(w.join(", ")) : "Not on any page"}">${p.choices?.length ? p.choices.length + " choices" : esc(p.kind)}${w.length ? "" : " · unused"}</small></div>`;
  }).join("");
  box.querySelectorAll<HTMLInputElement>("input[data-i]").forEach((inp) => inp.addEventListener("change", async () => { const r = await call("renameParam", { index: +inp.dataset.i!, name: inp.value.trim() }); if (r.error) render(); }));
}

function panelChecks(box: HTMLElement): void {
  const ch = st.checks ?? [], wn = st.warnings ?? [];
  box.innerHTML = `<h2>Checks <small>touch size, screen edges, Q-Links</small></h2>` +
    (ch.length ? ch.map((c) => `<div class="issue">⚠ <span>${esc(c)}</span></div>`).join("") : `<p class="note ok">✓ No touch, edge or Q-Link problems.</p>`) +
    (wn.length ? `<h2>Import notes</h2>` + wn.map((w) => `<div class="issue">ℹ <span>${esc(w)}</span></div>`).join("") : "");
}

// ---- start screen --------------------------------------------------------------------------------
function renderStart(): void {
  const s = $("start"); s.hidden = !!st.doc;
  if (st.doc) return;
  const rec = recent();
  s.innerHTML = `<div class="startbox"><h1>Skin Studio <i>2</i></h1><p class="lead">Design the touchscreen skin of an MPC or Force plugin — lay it out, preview it, build it, install it.</p>
    <div class="cols"><div><h2>Start from an Akai example</h2>${templates.map((t) => `<button class="card" data-new="${t.id}"><b>${esc(t.plugin)} — ${esc(t.label)}</b><span>${esc(t.description)}</span></button>`).join("")}</div>
    <div><h2>Open</h2>${OPENERS.map((o) => `<button class="card" data-open="${o.op}"><b>${esc(o.label)}</b><span>${esc(o.what)}</span></button>`).join("")}
    ${rec.length ? `<h2 style="margin-top:16px">Recent projects</h2>${rec.map((f) => `<div class="recent" data-recent="${esc(f)}" title="${esc(f)}">&lrm;${esc(f)}</div>`).join("")}` : ""}</div></div></div>`;
  s.querySelectorAll<HTMLElement>("[data-new]").forEach((b) => b.addEventListener("click", () => void run("new:" + b.dataset.new)));
  s.querySelectorAll<HTMLElement>("[data-open]").forEach((b) => b.addEventListener("click", () => void run(b.dataset.open!)));
  s.querySelectorAll<HTMLElement>("[data-recent]").forEach((b) => b.addEventListener("click", () => void openVia("openProject", { path: b.dataset.recent })));
}

// ---- render --------------------------------------------------------------------------------------
function render(): void {
  renderTop(); renderStart();
  if (!st.doc) { $("tabbar").innerHTML = ""; $("stage").innerHTML = ""; $("panel").innerHTML = ""; renderLeft(); return; }
  renderTabs(); renderStage(); renderLeft(); renderPanel();
}

// ---- install dialog ------------------------------------------------------------------------------
const dlg = $<HTMLDialogElement>("dlg");
const dmsg = (m: string) => ($("dlgMsg").textContent = m);
function openInstall(): void { try { $<HTMLInputElement>("host").value = localStorage.getItem("host") ?? ""; } catch { /* empty */ } dmsg(""); dlg.showModal(); }
$("closeDlg").addEventListener("click", () => dlg.close());
$("scan").addEventListener("click", async () => {
  const host = val("host").trim(); if (!host) return dmsg("Enter the MPC's IP address.");
  try { localStorage.setItem("host", host); } catch { /* not fatal */ }
  dmsg("Scanning…");
  const r = await window.studio.call("deviceScan", { host });
  if (r.error) return dmsg(r.error);
  const s2 = $<HTMLSelectElement>("plugin");
  s2.innerHTML = r.drives.flatMap((d: any) => d.plugins.map((p: string) => `<option value="${esc(d.mount)}|${esc(d.dir)}|${esc(p)}">${esc(p)}  (${esc(d.dir)} on ${esc(d.name)})</option>`)).join("");
  dmsg(s2.options.length ? `${s2.options.length} plugin(s) found.` : "No plugins found on the device.");
});
$("doInstall").addEventListener("click", async () => {
  const host = val("host").trim(); const v = val("plugin"); if (!v) return dmsg("Scan and pick a plugin first.");
  const [mount, dir, folder] = v.split("|");
  if (!confirm(`Replace the Plugin Skins of "${folder}" on the MPC?`)) return;
  dmsg("Installing…");
  const r = await window.studio.call("install", { host, mount, dir, folder });
  dmsg(r.error ? r.error : `Installed ${r.installed.files} file(s) into ${folder}. Restart the MPC app to load it.`);
});
$("doRestart").addEventListener("click", async () => {
  if (!confirm("Restarting the MPC app LOSES any unsaved project on the device. Restart now?")) return;
  const r = await window.studio.call("restart", { host: val("host").trim(), confirm: true });
  dmsg(r.error ? r.error : "MPC app restarting…");
});

// ---- boot ----------------------------------------------------------------------------------------
Promise.all([window.studio.call("templates"), window.studio.call("state")]).then(([t, s]) => { templates = t.templates ?? []; st = s; render(); });
export {};
