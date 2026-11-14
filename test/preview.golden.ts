// Behaviour test for the TUI→draw-op preview core (Akai-accurate base; see plan "Ledger 2").
// Uses a real uiBuilder-generated TUI fixture; asserts background, filmstrip knob frame math, and
// Name/Value labels resolve through the component tree + handle remapping.
// Run: npx tsx test/preview.golden.ts
import * as fs from "fs";
import * as path from "path";
import { TuiPreview, type PreviewParam, type DrawOp } from "../src/core/preview.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const fix = path.join(here, "golden/uigen/knobs_switch_bipolar");
const tui = JSON.parse(fs.readFileSync(path.join(fix, "out/Plugin Skins/TUI.json"), "utf8"));
const params: PreviewParam[] = JSON.parse(fs.readFileSync(path.join(fix, "params.json"), "utf8")).params;

let fails = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else { fails++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
};

const pv = new TuiPreview(tui, params);
const ops = pv.render(0);
const imgs = ops.filter((o): o is Extract<DrawOp, { op: "image" }> => o.op === "image");
const texts = ops.filter((o): o is Extract<DrawOp, { op: "text" }> => o.op === "text");

console.log("Preview core: knobs_switch_bipolar tab 0");
ok("one background rect first", ops[0].op === "rect" && ops[0].colour === "ff1e1d1e");
ok("tab name is FILTER", JSON.stringify(pv.tabNames()) === JSON.stringify(["FILTER"]));

// Cutoff (param 0) default 0.6, knob_uni has 127 frames → frame round(0.6*126)=76, at slot (23,45)+(knob inset)
{
  // Cutoff's knob: the Name label text "Cutoff" locates its slot; find the image near it.
  const cutoffImg = imgs.find((i) => i.src === "knob_uni.png" && i.frame === 76);
  ok("Cutoff knob_uni frame 76 (0.6·126)", !!cutoffImg, `frames seen: ${imgs.map((i) => i.frame).join(",")}`);
}
// Resonance (param 1) default 0.2 → frame round(0.2*126)=25
ok("Resonance frame 25 (0.2·126)", imgs.some((i) => i.frame === 25));
// Env Amount (param 2) default 0.5, bipolar knob_bi → frame 63
ok("Env Amount knob_bi frame 63 (centre)", imgs.some((i) => i.src === "knob_bi.png" && i.frame === 63));

// Labels resolve through remapping: a "Cutoff" Name and its Value "6.0 kHz"
ok("Name label 'Cutoff' present", texts.some((t) => t.text === "Cutoff"), texts.map((t) => t.text).join(" | "));
ok("Value label '6.0 kHz' present", texts.some((t) => t.text === "6.0 kHz"));
ok("Resonance value '20 %'", texts.some((t) => t.text === "20 %"));

// Positioning: Cutoff knob at slot col0,row0 (23,45); film-strip knob inset makes x≈23+? just assert on-screen
ok("all image ops on-screen", imgs.every((i) => i.x >= 0 && i.y >= 0 && i.x + i.w <= 1280 && i.y + i.h <= 628));

// ---- Case 2: fader_menu_visiblewhen — toggle button, fader, slider bar, visibleWhen -------------
console.log("\nPreview core: fader_menu_visiblewhen (visibleWhen + toggle + fader + bar)");
{
  const fix2 = path.join(here, "golden/uigen/fader_menu_visiblewhen");
  const tui2 = JSON.parse(fs.readFileSync(path.join(fix2, "out/Plugin Skins/TUI.json"), "utf8"));
  const params2: PreviewParam[] = JSON.parse(fs.readFileSync(path.join(fix2, "params.json"), "utf8")).params;

  // Default state: Sync = Off (index 0) → Time (visibleWhen Sync Off) shown, Division (Sync On) hidden.
  const ops2 = new TuiPreview(tui2, params2).render(0);
  const t2 = ops2.filter((o): o is Extract<DrawOp, { op: "text" }> => o.op === "text").map((o) => o.text);
  const imgs2 = ops2.filter((o): o is Extract<DrawOp, { op: "image" }> => o.op === "image");
  ok("Sync toggle shows toggle_off.png (Off)", imgs2.some((i) => i.src === "toggle_off.png"));
  ok("Mix fader fader_h_uni frame 63 (0.5)", imgs2.some((i) => i.src === "fader_h_uni.png" && i.frame === 63));
  ok("Feedback knob_uni frame 50 (0.4)", imgs2.some((i) => i.src === "knob_uni.png" && i.frame === 50));
  ok("Time visible (name shown)", t2.includes("Time"));
  ok("Division hidden by visibleWhen (no bar; slider has no name label)", !ops2.some((o) => o.op === "bar"));

  // Override: Sync = On (index 1) → Division (a slider/bar) shown, Time hidden.
  const on = new Map<number, number>([[0, 1]]); // param 0 = Sync → index 1 (On)
  const ops2b = new TuiPreview(tui2, params2, on).render(0);
  const t2b = ops2b.filter((o): o is Extract<DrawOp, { op: "text" }> => o.op === "text").map((o) => o.text);
  const imgs2b = ops2b.filter((o): o is Extract<DrawOp, { op: "image" }> => o.op === "image");
  ok("Sync On → toggle_on.png", imgs2b.some((i) => i.src === "toggle_on.png"));
  ok("Division now visible (bar appears)", ops2b.some((o) => o.op === "bar"));
  ok("Time now hidden", !t2b.includes("Time"));
}

// A repeat strip (tab root with `repeats`) is drawn as N bars, each bound to the next parameter.
{
  const { buildDoc } = await import("../src/app/project.ts");
  const { docFromUiJson, addStripPage } = await import("../src/app/doc.ts");
  let d = docFromUiJson({ params: Array.from({ length: 8 }, (_, i) => ({ name: `S${i + 1}`, kind: "float", default: i / 8 })) }, { pages: [{ name: "MAIN", controls: [{ param: "S1", widget: "slider" }] }] }, "x");
  d = addStripPage(d, "SEQ", "S1", 8);
  const b = buildDoc(d);
  const bars = new TuiPreview(JSON.parse(b.tui), b.params).render(1).filter((o): o is Extract<DrawOp, { op: "bar" }> => o.op === "bar");
  ok("strip page draws one bar per repeat", bars.length === 8, String(bars.length));
  ok("bars sit side by side, vertical", bars.every((o, i) => o.vertical === true && o.x === i * bars[0].w));
  ok("each bar follows its own parameter ({Increment})", bars.every((o, i) => Math.abs(o.value - i / 8) < 1e-9), bars.map((o) => o.value).join(","));
  ok("strip preview SVG has the 8 bars", (b.previewSvgs[1].match(/stroke="#6a6a6c"/g) ?? []).length === 8);
}

console.log(fails ? `\n${fails} assertion(s) failed` : `\nAll preview-core assertions pass`);
process.exit(fails ? 1 : 0);
