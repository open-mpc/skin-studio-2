// Electron main process — owns the editable Doc and exposes ops to the renderer over one IPC channel.
// All logic lives in the tested src/app modules; this file is dialogs + dispatch only.
import { app, BrowserWindow, ipcMain, dialog, Menu, type MenuItemConstructorOptions } from "electron";
import * as fs from "fs";
import * as path from "path";
import { buildDoc, writePluginSkins, type BuildResult } from "../src/app/project.ts";
import * as D from "../src/app/doc.ts";
import { DeviceService, SshTransport } from "../src/app/device.ts";
import { TEMPLATES } from "../src/app/templates.ts";
import { exportSvg, importSvg, artDocument } from "../src/app/svgRoundTrip.ts";
import { buildSkinSet, writeSkinSet, type SkinSetInput } from "../src/app/skinSet.ts";
import { installSkin } from "../src/app/installSkin.ts";
import { checkObjects } from "../src/core/skinCheck.ts";

const here = __dirname; // bundled to CJS by esbuild
let doc: D.Doc | null = null;
let warnings: string[] = [];
let file: string | null = null; // current .skin2.json path
let last: BuildResult | null = null;
let pendingSet: SkinSetInput[] = [];
let savedDoc: D.Doc | null = null; // the Doc as last opened/saved — `doc !== savedDoc` means unsaved changes
let pstate = new Map<number, number>(); // preview-only parameter values (never saved, never built)
let win: BrowserWindow | null = null;
const opened = () => { savedDoc = doc; pstate = new Map(); };
const dirty = () => !!doc && doc !== savedDoc;
const undo: D.Doc[] = [];
const redo: D.Doc[] = [];
const EDITS = new Set(["setControl", "swapSlots", "renamePage", "addPage", "addStrip", "removePage", "movePage", "renameParam", "setTheme", "makeFree", "moveControl", "addFreeControl", "removeControl", "setQlinks", "setQlinkBounds", "addAsset", "removeAsset", "setBackground", "addPlacedImage", "removePlacedImage", "movePlacedImage", "setStripForAll", "resizeControl", "setStyle", "importSvg", "moveControls", "alignControls", "distributeControls", "matchSize", "removeControls", "duplicateControls", "setImageMode", "setImageValueParam", "importPanel"]);

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1100, minHeight: 640, backgroundColor: "#111214", title: "Skin Studio 2",
    webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(here, "renderer", "index.html"));
  win.on("page-title-updated", (e) => e.preventDefault());
  win.on("close", (e) => {
    if (!dirty() || smokeDir) return;
    const r = dialog.showMessageBoxSync(win!, { type: "warning", buttons: ["Discard changes", "Cancel"], defaultId: 1, cancelId: 1, message: "This skin has unsaved changes.", detail: "Close without saving?" });
    if (r === 1) e.preventDefault();
  });
  win.on("closed", () => { win = null; });
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()));
  if (smokeDir) win.webContents.once("did-finish-load", () => void runSmoke(smokeDir));
}
// The native menu only names commands; the renderer runs them (same code path as its own buttons).
function menuTemplate(): MenuItemConstructorOptions[] {
  const cmd = (label: string, id: string, accelerator?: string, extra: MenuItemConstructorOptions = {}): MenuItemConstructorOptions => ({ label, accelerator, click: () => win?.webContents.send("studio:menu", id), ...extra });
  return [
    { label: "&File", submenu: [
      { label: "New from Akai template", submenu: Object.entries(TEMPLATES).map(([id, t]) => cmd(`${t.plugin} — ${t.label}`, "new:" + id)) },
      { type: "separator" },
      cmd("Open project…", "openProject", "CmdOrCtrl+O"),
      cmd("Open existing skin (TUI.json)…", "openSkin"),
      cmd("Open parameter file…", "openParams"),
      cmd("Open SDK params.json…", "openSdk"),
      { type: "separator" },
      cmd("Save", "save", "CmdOrCtrl+S"),
      cmd("Save as…", "saveAs", "CmdOrCtrl+Shift+S"),
      { type: "separator" },
      cmd("Export layout SVG…", "exportSvg"),
      cmd("Import layout SVG…", "importSvg"),
      cmd("Import panel picture…", "importPanel"),
      cmd("Build skin set…", "skinSet"),
      { type: "separator" },
      cmd("Build Plugin Skins…", "build", "CmdOrCtrl+B"),
      cmd("Install to MPC…", "install", "CmdOrCtrl+I"),
      { type: "separator" },
      { role: "quit" },
    ] },
    { label: "&Edit", submenu: [
      cmd("Undo", "undo", "CmdOrCtrl+Z"),
      cmd("Redo", "redo", "CmdOrCtrl+Shift+Z"),
      { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      { type: "separator" },
      cmd("Duplicate control", "duplicate", "CmdOrCtrl+D"),
      cmd("Delete control", "delete", "Delete", { registerAccelerator: false }),
    ] },
    { label: "&View", submenu: [
      cmd("Zoom to fit", "zoom:fit", "CmdOrCtrl+0"),
      cmd("Zoom 100%", "zoom:1", "CmdOrCtrl+1"),
      cmd("Show Q-Links", "toggle:qlinks", "CmdOrCtrl+L"),
      cmd("Show outlines", "toggle:outlines", "CmdOrCtrl+H"),
      { type: "separator" },
      { role: "togglefullscreen" }, { role: "toggleDevTools" },
    ] },
  ];
}

// Screenshot hook for checking the window without a person: `--smoke=<dir>` runs <dir>/steps.json
// ([{ js, shot }]) in the page, saves a PNG per step and the page's console output, then quits.
const smokeDir = (process.argv.find((a) => a.startsWith("--smoke=")) ?? "").slice(8);
async function runSmoke(dir: string): Promise<void> {
  const log: string[] = [];
  const wc = win!.webContents;
  wc.on("console-message", (_e, level, message) => { log.push(`[console ${level}] ${message}`); });
  try {
    try { smokePicks = JSON.parse(fs.readFileSync(path.join(dir, "picks.json"), "utf8")); } catch { /* none */ }
    // steps may also say { picks: [...] } to queue more answers mid-run
    const steps = JSON.parse(fs.readFileSync(path.join(dir, "steps.json"), "utf8")) as { js?: string; shot?: string; picks?: string[]; menu?: string }[];
    void 0;
    for (const st of steps) {
      if (st.picks) smokePicks.push(...st.picks);
      if (st.menu) wc.send("studio:menu", st.menu); // as if the menu item was chosen
      if (st.js) { try { const r = await wc.executeJavaScript(st.js, true); if (r !== undefined) log.push(`[result] ${JSON.stringify(r)}`);
        // a step may return { input: [...] } — real mouse/key events, sent one by one
        for (const ev of r?.input ?? []) { wc.sendInputEvent(ev); await new Promise((res) => setTimeout(res, 60)); } } catch (e) { log.push(`[step failed] ${st.js.slice(0, 80)} — ${String(e)}`); } }
      await new Promise((r) => setTimeout(r, 350));
      if (st.shot) fs.writeFileSync(path.join(dir, st.shot + ".png"), (await wc.capturePage()).toPNG());
    }
  } catch (e) { log.push("[smoke failed] " + String(e)); }
  fs.writeFileSync(path.join(dir, "log.txt"), log.join("\n"));
  app.exit(0);
}

function state(extra: Record<string, unknown> = {}) {
  win?.setTitle(`${doc ? (file ? path.basename(file) : doc.name || "Untitled") + (dirty() ? " •" : "") + " — " : ""}Skin Studio 2`);
  if (!doc) return { doc: null, ...extra };
  last = buildDoc(doc, { state: pstate });
  let checks: string[] = [];
  try { checks = checkObjects(JSON.parse(last.tui), JSON.parse(last.qlinks)); } catch (e) { checks = ["check failed: " + String((e as Error).message ?? e)]; }
  let qrects: string[][] = [], qeff: number[][] = [];
  try {
    qrects = JSON.parse(last.tui).pageData.tabs.map((t: any) => t.qlinkBoundsData ?? []);
    qeff = (JSON.parse(last.qlinks)["Screen Mode Q-Links"].map as any[]).map((e) => Array.from({ length: 16 }, (_, k) => e["Q-Links"]["Q-Link " + (k + 1)]));
  } catch { /* shown via checks */ }
  return { doc, qrects, qeff, previews: last.previewSvgs, tabNames: last.tabNames, warnings, checks, file, dirty: dirty(), pvals: Object.fromEntries(pstate), canUndo: undo.length > 0, canRedo: redo.length > 0, ...extra };
}
const svc = (host: string) => new DeviceService(new SshTransport(host));
// Smoke runs only: `<dir>/picks.json` is a queue of paths answering the native file dialogs, in order.
let smokePicks: string[] = [];
const pick = async (title: string, filters: Electron.FileFilter[]) => {
  if (smokeDir && smokePicks.length) return smokePicks.shift()!;
  const r = await dialog.showOpenDialog({ title, properties: ["openFile"], filters });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
};

ipcMain.handle("studio:call", async (_e, op: string, a: any = {}) => {
  const before = doc;
  const edit = EDITS.has(op) && !!doc;
  try {
    if (edit) { undo.push(doc!); redo.length = 0; if (undo.length > 200) undo.shift(); }
    switch (op) {
      case "setPreview": { if (a.value === null || a.value === undefined) pstate.delete(a.index); else pstate.set(a.index, Number(a.value)); return state(); }
      case "resetPreview": pstate = new Map(); return state();
      case "state": return state();
      case "undo": { const p = undo.pop(); if (p && doc) { redo.push(doc); doc = p; } return state(); }
      case "redo": { const n = redo.pop(); if (n && doc) { undo.push(doc); doc = n; } return state(); }
      case "openParams": {
        const f = await pick("Open a parameter file", [{ name: "Parameters", extensions: ["json"] }]);
        if (!f) return { cancelled: true };
        doc = D.docFromParamFile(JSON.parse(fs.readFileSync(f, "utf8")), path.basename(f, ".json"), a.theme); undo.length = 0; redo.length = 0;
        warnings = []; file = null; opened(); return state();
      }
      case "openSkin": {
        const f = await pick("Open an existing skin (TUI.json)", [{ name: "TUI.json", extensions: ["json"] }]);
        if (!f) return { cancelled: true };
        const ql = path.join(path.dirname(f), "Q-Links.json");
        const r = D.docFromTui(fs.readFileSync(f, "utf8"), path.basename(path.dirname(path.dirname(f))), fs.existsSync(ql) ? fs.readFileSync(ql, "utf8") : undefined,
          (rel) => { const p2 = path.join(path.dirname(f), rel); return path.dirname(p2) === path.dirname(f) && fs.existsSync(p2) ? new Uint8Array(fs.readFileSync(p2)) : null; });
        doc = { ...r.doc, theme: r.theme ?? a.theme ?? r.doc.theme }; undo.length = 0; redo.length = 0; warnings = r.warnings; file = null; opened(); return state();
      }
      case "openProject": {
        const f = a.path ?? await pick("Open a Skin Studio project", [{ name: "Skin Studio project", extensions: ["skin2.json", "json"] }]);
        if (!f) return { cancelled: true };
        if (!fs.existsSync(f)) throw new Error(`That project file is no longer there: ${f}`);
        doc = D.parseDoc(fs.readFileSync(f, "utf8")); undo.length = 0; redo.length = 0; warnings = []; file = f; opened(); return state();
      }
      case "saveProject": {
        if (!doc) throw new Error("Nothing to save.");
        let f = file;
        if (!f || a.as) {
          const r = await dialog.showSaveDialog({ defaultPath: (doc.name || "skin") + ".skin2.json", filters: [{ name: "Skin Studio project", extensions: ["json"] }] });
          if (r.canceled || !r.filePath) return { cancelled: true };
          f = r.filePath;
        }
        fs.writeFileSync(f, D.serializeDoc(doc)); file = f; savedDoc = doc; return state({ saved: f });
      }
      case "build": {
        if (!doc) throw new Error("Open something first.");
        const r = await dialog.showOpenDialog({ title: "Choose the plugin folder (its Plugin Skins subfolder is written)", properties: ["openDirectory", "createDirectory"] });
        if (r.canceled || !r.filePaths[0]) return { cancelled: true };
        return state({ built: writePluginSkins(r.filePaths[0], buildDoc(doc)) });
      }
      // ---- edits (each returns the fresh state) ----
      case "setControl": doc = D.setControl(doc!, a.page, a.slot, a.spec); return state();
      case "swapSlots": doc = D.swapSlots(doc!, a.page, a.a, a.b); return state();
      case "renamePage": doc = D.renamePage(doc!, a.page, a.name); return state();
      case "addPage": doc = D.addPage(doc!, a.name); return state();
      case "addStrip": doc = D.addStripPage(doc!, a.name, a.param, a.count); return state();
      case "removePage": doc = D.removePage(doc!, a.page); return state();
      case "movePage": doc = D.movePage(doc!, a.from, a.to); return state();
      case "renameParam": doc = D.renameParam(doc!, a.index, a.name); return state();
      case "makeFree": doc = D.makeFree(doc!, a.page); return state();
      case "moveControl": doc = D.moveControl(doc!, a.page, a.index, a.x, a.y); return state();
      case "addFreeControl": doc = D.addFreeControl(doc!, a.page, a.spec, a.x, a.y); return state();
      case "removeControl": doc = D.removeControl(doc!, a.page, a.index); return state();
      case "setQlinks": doc = D.setQlinks(doc!, a.page, a.qlinks); return state();
      case "setQlinkBounds": doc = D.setQlinkBounds(doc!, a.page, a.rects); return state();
      case "addAsset": doc = D.addAsset(doc!, a.name, a.png, a.frames, a.w, a.h); return state();
      case "removeAsset": doc = D.removeAsset(doc!, a.name); return state();
      case "setBackground": doc = D.setBackground(doc!, a.page, a.asset); return state();
      case "addPlacedImage": doc = D.addPlacedImage(doc!, a.page, a.asset, a.x, a.y, a.w, a.h); return state();
      case "removePlacedImage": doc = D.removePlacedImage(doc!, a.page, a.index); return state();
      case "movePlacedImage": doc = D.movePlacedImage(doc!, a.page, a.index, a.x, a.y, a.w, a.h); return state();
      case "setStripForAll": doc = D.setStripForAll(doc!, a.widget, a.asset); return state();
      case "resizeControl": doc = D.resizeControl(doc!, a.page, a.index, a.w, a.h); return state();
      case "moveControls": doc = D.moveControls(doc!, a.page, a.indices, a.dx, a.dy); return state();
      case "alignControls": doc = D.alignControls(doc!, a.page, a.indices, a.mode); return state();
      case "distributeControls": doc = D.distributeControls(doc!, a.page, a.indices, a.axis); return state();
      case "matchSize": doc = D.matchSize(doc!, a.page, a.indices, a.dims); return state();
      case "removeControls": doc = D.removeControls(doc!, a.page, a.indices); return state();
      case "duplicateControls": doc = D.duplicateControls(doc!, a.page, a.indices, a.dx, a.dy); return state();
      case "setImageMode": doc = D.setImageMode(doc!, a.page, a.index, a.when ?? null); return state();
      case "setImageValueParam": doc = D.setImageValueParam(doc!, a.page, a.index, a.param ?? null); return state();
      case "setStyle": doc = D.setStyle(doc!, a.style); return state();
      case "importPanel": { const r = D.importPanel(doc!, a.page, a.png, a.knobs, !!a.labels); doc = r.doc; return state({ placed: r.placed, unbound: r.unbound }); }
      case "newTemplate": {
        const t = TEMPLATES[a.id]; if (!t) throw new Error("unknown template");
        doc = D.docFromUiJson({ params: t.params }, t.ui, t.plugin, a.theme); warnings = []; file = null; undo.length = 0; redo.length = 0; opened(); return state();
      }
      case "openSdk": {
        const f = await pick("Open the SDK's params.json (ui.json beside it is used if present)", [{ name: "params.json", extensions: ["json"] }]);
        if (!f) return { cancelled: true };
        const uip = path.join(path.dirname(f), "ui.json");
        doc = D.docFromUiJson(JSON.parse(fs.readFileSync(f, "utf8")), fs.existsSync(uip) ? JSON.parse(fs.readFileSync(uip, "utf8")) : null, path.basename(path.dirname(f)), a.theme);
        warnings = []; file = null; undo.length = 0; redo.length = 0; opened(); return state();
      }
      case "templates": return { templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label, description: t.description, plugin: t.plugin })) };
      case "exportSvg": {
        if (!doc) throw new Error("Open something first.");
        const target = smokeDir && smokePicks.length ? smokePicks.shift()! : null;
        const r = target ? { canceled: false, filePath: target } : await dialog.showSaveDialog({ defaultPath: (doc.name || "layout") + ".layout.svg", filters: [{ name: "SVG", extensions: ["svg"] }] });
        if (r.canceled || !r.filePath) return { cancelled: true };
        fs.writeFileSync(r.filePath, exportSvg(doc)); return state({ saved: r.filePath });
      }
      case "importSvg": {
        const f = await pick("Open an edited layout SVG", [{ name: "SVG", extensions: ["svg"] }]);
        if (!f) { undo.pop(); return { cancelled: true }; }
        const r = importSvg(doc!, fs.readFileSync(f, "utf8"));
        doc = r.doc; warnings = r.warnings;
        return state({ art: [...r.art.map((page) => ({ page, svg: artDocument(r.doc, page) })), ...r.artModes.map(({ page, mode }) => ({ page, mode, svg: artDocument(r.doc, page, mode) }))] });
      }
      // the renderer's picture of a page's artwork; part of the importSvg step (no undo entry of its own)
      case "setPageArt": doc = D.setPageArt(doc!, a.page, a.png, a.mode); return state();
      case "skinSetPick": {
        const r = await dialog.showOpenDialog({ title: "Pick two or more project files — one per interface", properties: ["openFile", "multiSelections"], filters: [{ name: "Skin Studio project", extensions: ["json"] }] });
        if (r.canceled || r.filePaths.length < 2) return r.canceled ? { cancelled: true } : { error: "Pick at least two project files (one per interface)." };
        pendingSet = r.filePaths.map((f) => ({ name: path.basename(f).replace(/\.skin2\.json$|\.json$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_"), doc: D.parseDoc(fs.readFileSync(f, "utf8")) }));
        return { names: pendingSet.map((i) => i.name) };
      }
      case "skinSetBuild": {
        const set = buildSkinSet(pendingSet, a.active); // validates names, parameters and the active choice first
        const r = await dialog.showOpenDialog({ title: "Choose the plugin folder (its Plugin Skins subfolder is replaced)", properties: ["openDirectory", "createDirectory"] });
        if (r.canceled || !r.filePaths[0]) return { cancelled: true };
        return { built: writeSkinSet(r.filePaths[0], set), names: set.names };
      }
      case "setTheme": doc = D.setTheme(doc!, a.theme); return state();
      // ---- device (all writes confined to "VST2 Plugins" by DeviceService) ----
      case "deviceScan": {
        const s = svc(a.host);
        const drives = await s.drives();
        const out: { mount: string; name: string; dir: string; plugins: string[] }[] = [];
        for (const d of drives.filter((x) => x.writable))
          for (const dir of await s.pluginDirs(d.mount)) {
            const pl = await s.list(d.mount, dir);
            if (pl.length) out.push({ mount: d.mount, name: d.name, dir, plugins: pl.map((p) => p.folder) });
          }
        return { drives: out };
      }
      case "install": {
        if (!doc) throw new Error("Open something first.");
        const r = await installSkin(svc(a.host), a.mount, a.folder, buildDoc(doc), { dir: a.dir === "Synths" ? "Synths" : "VST2 Plugins" });
        return { installed: r };
      }
      case "restart": return { restarted: await svc(a.host).restart({ confirm: a.confirm === true }) };
      default: throw new Error("unknown op " + op);
    }
  } catch (e) {
    // an edit that does not build (e.g. a switch on a 9-choice parameter) is rolled back, not left half-applied
    if (edit) { if (undo[undo.length - 1] === before) undo.pop(); doc = before; }
    return { error: String((e as Error).message ?? e) };
  }
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
