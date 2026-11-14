// Doc layer: import an existing skin (TUI.json) → rebuild → must reproduce the original TUI.json/Q-Links.json
// (round-trip on Akai's gen_ui goldens), plus the pure edit operations.  Run: npx tsx test/doc.golden.ts
import * as fs from "fs";
import * as path from "path";
import { makeFree, moveControl, addFreeControl, removeControl, setQlinks, docFromTui, docFromParamFile, setControl, swapSlots, renamePage, renameParam, addPage, removePage, serializeDoc, parseDoc } from "../src/app/doc.ts";
import { buildDoc, writePluginSkins } from "../src/app/project.ts";
import { setStyle, resizeControl, addAsset, removeAsset, setBackground, addPlacedImage, removePlacedImage, assetFile } from "../src/app/doc.ts";
import { docFromUiJson } from "../src/app/doc.ts";
import { TEMPLATES } from "../src/app/templates.ts";
import { renderKit } from "../src/core/uiKit.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
let fails = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) console.log(`  PASS  ${n}`); else { fails++; console.log(`  FAIL  ${n}${d ? " — " + d : ""}`); } };

console.log("import → rebuild round-trip on Akai gen_ui goldens");
for (const fx of ["knobs_switch_bipolar", "fader_menu_visiblewhen"]) {
  const dir = path.join(here, "golden/uigen", fx, "out/Plugin Skins");
  const tui = fs.readFileSync(path.join(dir, "TUI.json"), "utf8");
  const ql = fs.readFileSync(path.join(dir, "Q-Links.json"), "utf8");
  const { doc, warnings } = docFromTui(tui, fx);
  ok(`${fx}: no import warnings`, warnings.length === 0, warnings.join("; "));
  const r = buildDoc(doc);
  ok(`${fx}: TUI.json identical after round-trip`, r.tui === tui);
  ok(`${fx}: Q-Links.json identical after round-trip`, r.qlinks === ql);
  ok(`${fx}: one preview per tab`, r.previewSvgs.length === r.tabNames.length && r.tabNames.length > 0);
}

console.log("\nedit operations");
{
  const d0 = docFromParamFile([{ key: "cutoff", name: "Cutoff" }, { key: "res", name: "Resonance" }, { key: "mix", name: "Mix" }]);
  const d1 = swapSlots(d0, 0, 0, 4);
  ok("swap exchanges controls, input untouched", d1.pages[0].controls[0].param === "Resonance" && d1.pages[0].controls[4].param === "Cutoff" && d0.pages[0].controls[0].param === "Cutoff");
  const d2 = setControl(d0, 0, 8, { param: "Mix", widget: "fader" });
  ok("setControl changes widget", d2.pages[0].controls[8].widget === "fader");
  const d3 = renameParam(d0, 0, "Freq");
  ok("renameParam updates params + controls", d3.params[0].name === "Freq" && d3.pages[0].controls[0].param === "Freq");
  ok("renameParam rejects duplicates", (() => { try { renameParam(d0, 0, "Mix"); return false; } catch { return true; } })());
  const d4 = removePage(addPage(renamePage(d0, 0, "MAIN")), 1);
  ok("rename/add/remove page", d4.pages.length === 1 && d4.pages[0].name === "MAIN");
  ok("save/load round-trips", JSON.stringify(parseDoc(serializeDoc(d2))) === JSON.stringify(d2));
  ok("edited doc builds", buildDoc(d2).tui.includes("faderUni"));
  ok("project file rejects foreign JSON", (() => { try { parseDoc("{}"); return false; } catch { return true; } })());
}
console.log("\nfree-form + Q-Link operations");
{
  const dir = path.join(here, "golden/uigen/fader_menu_visiblewhen/out/Plugin Skins");
  const tui = fs.readFileSync(path.join(dir, "TUI.json"), "utf8");
  const ql = fs.readFileSync(path.join(dir, "Q-Links.json"), "utf8");
  const base = docFromTui(tui, "x").doc;
  const fr = makeFree(base, 0);
  const r = buildDoc(fr);
  ok("makeFree is invisible: TUI.json unchanged", r.tui === tui);
  ok("makeFree is invisible: Q-Links.json unchanged", r.qlinks === ql);
  const moved = moveControl(fr, 0, 0, 500, 300);
  ok("move sets bounds, keeps size", JSON.stringify(moved.pages[0].controls[0].bounds) === "[500,300,278,107]");
  const added = addFreeControl(moved, 0, { param: "Mix", widget: "knob" }, 10, 10);
  ok("add free control past grid slots", added.pages[0].controls.length > 16 && added.pages[0].controls[16].bounds![0] === 10);
  ok("remove free control", removeControl(added, 0, 16).pages[0].controls.length === added.pages[0].controls.length - 1);
  const q = setQlinks(moved, 0, ["Mix", ...Array(15).fill(null)]);
  ok("setQlinks changes the Q-Links map", JSON.parse(buildDoc(q).qlinks)["Screen Mode Q-Links"].map[0]["Q-Links"]["Q-Link 1"] === 4);
  ok("setQlinks rejects unknown param", (() => { try { setQlinks(moved, 0, ["Nope"]); return false; } catch { return true; } })());
  // free-form round trip through TUI.json + Q-Links.json
  const built = buildDoc(addFreeControl(q, 0, { param: "Feedback", widget: "fader" }, 700, 420));
  const back = docFromTui(built.tui, "rt", built.qlinks).doc;
  const again = buildDoc(back);
  ok("free-form skin round-trips (TUI.json)", again.tui === built.tui);
  ok("free-form skin round-trips (Q-Links.json)", again.qlinks === built.qlinks);
}
console.log("\nassets: knob strips, backgrounds, placed images");
{
  const png = renderKit("mpc-red").pngs["knob_uni"].toString("base64"); // any valid PNG
  let d = docFromParamFile([{ key: "cutoff", name: "Cutoff" }, { key: "res", name: "Resonance" }]);
  const ihdr = Buffer.from(png, "base64"); const pw = ihdr.readUInt32BE(16), ph = ihdr.readUInt32BE(20);
  d = addAsset(d, "mine", png, 64, pw, Math.floor(ph / 64));
  d = { ...d, pages: d.pages.map((p, i) => (i ? p : { ...p, controls: p.controls.map((c, k) => (k === 0 ? { ...c, strip: "mine" } : c)) })) };
  d = setBackground(d, 0, "mine");
  d = addPlacedImage(d, 0, "mine", 900, 20);
  const r = buildDoc(d);
  const tui = JSON.parse(r.tui);
  const defs = tui.pageData.componentDefinitions.localComponentDefinitions;
  const sd = defs.find((x: any) => String(x.key).startsWith("knobStrip:"));
  ok("strip knob definition keyed by asset", !!sd && sd.key === "knobStrip:Uni:mine");
  const knob = sd?.value.componentsData.find((c: any) => c.componentData.type === "Knob")?.componentData.data;
  ok("strip knob is a FilmStrip with the asset file + frames", knob?.knobType === "FilmStrip" && knob.filmStrip === assetFile("mine") && knob.numFrames === 64, JSON.stringify(knob));
  const ents = tui.pageData.tabs[0].componentDefinition.componentsData;
  ok("background is the first entry, full tab, unfocusable", ents[0].componentData.type === "Image" && ents[0].bounds.bounds === "0 0 1280 628" && ents[0].bounds.acceptsHWFocus === "No");
  ok("placed image at its position/size", ents[1].bounds.bounds === `900 20 ${pw} ${Math.floor(ph / 64)}`);
  ok("asset PNG is written with the skin", !!r.kitPngs["asset_mine"]);
  ok("preview embeds the asset (data URI)", r.previewSvg.includes("data:image/png;base64"));
  ok("remove blocked while used", (() => { try { removeAsset(d, "mine"); return false; } catch (e) { return /still used/.test(String(e)); } })());
  let free = setBackground(d, 0, null); free = removePlacedImage(free, 0, 0);
  free = { ...free, pages: free.pages.map((p) => ({ ...p, controls: p.controls.map((c) => ({ ...c, strip: undefined })) })) };
  ok("remove allowed once unused", !removeAsset(free, "mine").assets?.mine);
  ok("bad asset name rejected", (() => { try { addAsset(d, "a b", png, 1, 1, 1); return false; } catch { return true; } })());
  ok("non-PNG rejected", (() => { try { addAsset(d, "x", "AAAA", 1, 1, 1); return false; } catch { return true; } })());
  ok("assets survive save/load", !!parseDoc(serializeDoc(d)).assets?.mine);
  const os = await import("os"); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-")); const sk = writePluginSkins(tmp, r);
  ok("writePluginSkins writes asset_mine.png", fs.existsSync(path.join(sk, "asset_mine.png")));
  fs.rmSync(tmp, { recursive: true, force: true });
  // import custom art from a skin folder → rebuild identical
  {
    const os2 = await import("os"); const t2 = fs.mkdtempSync(path.join(os2.tmpdir(), "ss2-")); const sk2 = writePluginSkins(t2, buildDoc(d));
    const tuiText = fs.readFileSync(path.join(sk2, "TUI.json"), "utf8");
    const rd = (f: string) => { const p = path.join(sk2, f); return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null; };
    const imp = docFromTui(tuiText, "art", fs.readFileSync(path.join(sk2, "Q-Links.json"), "utf8"), rd);
    ok("custom-art import: no warnings", imp.warnings.length === 0, imp.warnings.join("; "));
    ok("custom-art import: asset recovered (name, frames, frame size)", imp.doc.assets?.mine?.frames === 64 && imp.doc.assets.mine.w === pw && imp.doc.assets.mine.h === Math.floor(ph / 64));
    ok("custom-art import: background + placed image recovered", imp.doc.pages[0].background === "mine" && imp.doc.pages[0].images?.[0]?.x === 900);
    ok("custom-art skin round-trips (TUI.json)", buildDoc(imp.doc).tui === tuiText);
    const noFiles = docFromTui(tuiText, "art");
    ok("without file access: warns, still imports controls", noFiles.warnings.length > 0 && noFiles.doc.pages.length > 0);
    fs.rmSync(t2, { recursive: true, force: true });
  }
  ok("strip on a non-knob/fader is rejected", (() => { try { buildDoc({ ...d, pages: [{ name: "x", controls: [{ param: "Cutoff", widget: "slider", strip: "mine" }] }] }); return false; } catch { return true; } })());
  ok("unknown asset rejected at build", (() => { try { buildDoc({ ...d, assets: {} }); return false; } catch { return true; } })());
}
console.log("\nresize + knob size round trip");
{
  let d = docFromParamFile([{ key: "cutoff", name: "Cutoff", default: 0.3 }, { key: "res", name: "Resonance", default: 0.3 }]);
  d = resizeControl(d, 0, 0, 200, 90);
  ok("resize sets the touch box, keeps position", JSON.stringify(d.pages[0].controls[0].bounds) === "[23,45,200,90]");
  ok("resize rejects tiny/huge", (() => { try { resizeControl(d, 0, 0, 5, 5); return false; } catch { return true; } })());
  d = { ...d, pages: d.pages.map((p) => ({ ...p, controls: p.controls.map((c, i) => (i === 0 ? { ...c, size: 56, polarity: "unipolar" as const } : c)) })) };
  const b = buildDoc(d);
  const back = docFromTui(b.tui, "r", b.qlinks).doc;
  ok("knob size + box survive TUI round-trip", buildDoc(back).tui === b.tui);
}
console.log("\nSDK inputs (params.json + ui.json) and Akai example templates");
{
  for (const fx of ["fader_menu_visiblewhen", "knobs_switch_bipolar", "auto_no_ui"]) {
    const dir = path.join(here, "golden/uigen", fx);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, "params.json"), "utf8"));
    const uip = path.join(dir, "ui.json");
    const ui = fs.existsSync(uip) ? JSON.parse(fs.readFileSync(uip, "utf8")) : null;
    const want = fs.readFileSync(path.join(dir, "out/Plugin Skins/TUI.json"), "utf8");
    const wantQ = fs.readFileSync(path.join(dir, "out/Plugin Skins/Q-Links.json"), "utf8");
    const r = buildDoc(docFromUiJson(pj, ui, fx));
    ok(`${fx}: ui.json → Doc → TUI.json byte-identical to gen_ui`, r.tui === want);
    ok(`${fx}: Q-Links.json byte-identical to gen_ui`, r.qlinks === wantQ);
  }
  for (const [k, t] of Object.entries(TEMPLATES)) {
    const doc = docFromUiJson({ params: t.params }, t.ui, t.plugin);
    let built = true, why = "";
    try { buildDoc(doc); } catch (e) { built = false; why = String((e as Error).message); }
    ok(`template ${k}: ${t.params.length} params, ${doc.pages.length} page(s), builds`, built && doc.pages.length > 0, why);
  }
}
console.log("\npage colours");
{
  const d0 = docFromParamFile([{ key: "cutoff", name: "Cutoff" }]);
  const d1 = setStyle(d0, { background: "ff102030", accent: "ff00ff88" });
  const t = buildDoc(d1).tui;
  ok("custom background + accent reach the TUI.json", t.includes("ff102030") && t.includes("ff00ff88"));
  ok("default build keeps Akai colours", buildDoc(d0).tui.includes("ff1e1d1e") && !buildDoc(d0).tui.includes("ff102030"));
  ok("bad colour rejected", (() => { try { setStyle(d0, { text: "red" }); return false; } catch { return true; } })());
  ok("style survives save/load", parseDoc(serializeDoc(d1)).style?.accent === "ff00ff88");
  // page-colour import: a built skin's colours come back, defaults stay unset, kit theme is detected
  const full = setStyle(d0, { background: "ff102030", accent: "ff00ff88", text: "ffeeeedd", muted: "ff556677" });
  const bf = buildDoc(full);
  const imp = docFromTui(bf.tui, "c", bf.qlinks);
  ok("import reads all four page colours", JSON.stringify(imp.doc.style) === JSON.stringify(full.style), JSON.stringify(imp.doc.style));
  ok("imported colours rebuild byte-identically", buildDoc(imp.doc).tui === bf.tui);
  const b0 = buildDoc(d0);
  ok("Akai-default skin imports with no style", docFromTui(b0.tui, "c", b0.qlinks).doc.style === undefined);
  const bc = buildDoc(setStyle(d0, { accent: "ff19c6e0" }));
  const ic = docFromTui(bc.tui, "c", bc.qlinks);
  ok("a kit theme's accent selects that theme", ic.theme === "cyan" && ic.doc.theme === "cyan" && ic.doc.style?.accent === "ff19c6e0");
  ok("a non-kit accent reports no theme", imp.theme === undefined && imp.doc.theme === "mpc-red");
}
console.log("\ntext size round trips (TUI import + SVG)");
{
  let d = docFromParamFile([{ key: "cutoff", name: "Cutoff", default: 0.3 }, { key: "res", name: "Resonance", default: 0.3 }]);
  d = { ...d, pages: d.pages.map((p) => ({ ...p, controls: p.controls.map((c, i) => (i === 0 ? { ...c, polarity: "unipolar" as const, nameSize: 20, valueSize: 0, size: 64 } : c)) })) };
  const b = buildDoc(d);
  ok("TUI import restores text + picture sizes", buildDoc(docFromTui(b.tui, "r", b.qlinks).doc).tui === b.tui);
  const { importSvg, exportSvg } = await import("../src/app/svgRoundTrip.ts");
  ok("SVG round trip keeps ns/vs/size", buildDoc(importSvg(d, exportSvg(d)).doc).tui === b.tui);
}
console.log(fails ? `\n${fails} failed` : "\nAll doc-layer assertions pass");
process.exit(fails ? 1 : 0);
