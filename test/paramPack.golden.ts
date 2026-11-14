// Behaviour test for the auto-layout packer (Akai-first). Asserts section→column packing, page split
// (a ≤4-column section is never split across pages), tab naming, and — the real gate — that the whole
// chain (packLayout → toUiJson + toParamsJson → uiBuilder.generate) produces a valid TUI.json.
// Run: npx tsx test/paramPack.golden.ts
import { packLayout, toUiJson, toParamsJson, type InputParam, type Section } from "../src/core/paramLayout.ts";
import { generate, type KitInfo, type KitAssets } from "../src/core/uiBuilder.ts";
import * as fs from "fs";
import * as path from "path";

const here = path.dirname(new URL(import.meta.url).pathname);
const mpcRed = JSON.parse(fs.readFileSync(path.join(here, "golden/uigen/kit-manifest.mpc-red.json"), "utf8")) as {
  assets: Record<string, [string, number, [number, number]]>;
};
const resolveKit = (_: KitInfo): KitAssets => mpcRed.assets;

let fails = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    fails++;
    console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`);
  }
}

// Build a chain and return the parsed TUI, or record a failure.
function buildTui(params: InputParam[], sections?: Section[]) {
  const layout = packLayout(params, sections);
  const ui = toUiJson(layout);
  const pj = toParamsJson(params);
  const res = generate(pj, ui, resolveKit);
  return { layout, tui: JSON.parse(res.tui) as any };
}
function col(layout: any, pageIdx: number, c: number): string[] {
  // keys of controls in column c (slots r*4+c), top to bottom
  const out: string[] = [];
  for (let r = 0; r < 4; r++) {
    const s = layout.pages[pageIdx].slots[r * 4 + c];
    if (s) out.push(s.param.key);
  }
  return out;
}

// --- Case 1: two sections on one page, each its own column, tab named from both -------------------
console.log("Case 1: FILTER(3) + ENV(4) → one page, two columns");
{
  const params: InputParam[] = [
    { key: "cutoff", name: "Cutoff" }, { key: "reso", name: "Resonance" }, { key: "drive", name: "Drive" },
    { key: "attack", name: "Attack" }, { key: "decay", name: "Decay" }, { key: "sustain", name: "Sustain" }, { key: "release", name: "Release" },
  ];
  const sections: Section[] = [
    { label: "Filter", keys: ["cutoff", "reso", "drive"] },
    { label: "Env", keys: ["attack", "decay", "sustain", "release"] },
  ];
  const { layout, tui } = buildTui(params, sections);
  check("one page", layout.pages.length === 1, `got ${layout.pages.length}`);
  check("col0 = Filter chunk", JSON.stringify(col(layout, 0, 0)) === JSON.stringify(["cutoff", "reso", "drive"]));
  check("col1 = Env chunk", JSON.stringify(col(layout, 0, 1)) === JSON.stringify(["attack", "decay", "sustain", "release"]));
  check("tab name FILTER / ENV", layout.pages[0].name === "FILTER / ENV", layout.pages[0].name);
  check("TUI has 1 tab", tui.pageData.tabs.length === 1);
  check("ENV stages → faders", tui.pageData.tabs[0].componentDefinition.componentsData.some((c: any) => c.componentData.name === "Attack" && c.componentData.type === "faderUni"));
}

// --- Case 2: a 6-control section → two columns on one page ----------------------------------------
console.log("Case 2: OSC(6) → two columns, one page");
{
  const params: InputParam[] = Array.from({ length: 6 }, (_, i) => ({ key: `o${i}`, name: `Osc ${i}` }));
  const sections: Section[] = [{ label: "Osc", keys: params.map((p) => p.key) }];
  const { layout } = buildTui(params, sections);
  check("one page", layout.pages.length === 1);
  check("col0 = first 4", JSON.stringify(col(layout, 0, 0)) === JSON.stringify(["o0", "o1", "o2", "o3"]));
  check("col1 = last 2", JSON.stringify(col(layout, 0, 1)) === JSON.stringify(["o4", "o5"]));
}

// --- Case 3: five 4-control sections → 5 columns → page split without splitting a section ----------
console.log("Case 3: five sections of 4 → 2 pages (4 cols + 1 col)");
{
  const labels = ["A", "B", "C", "D", "E"];
  const params: InputParam[] = [];
  const sections: Section[] = labels.map((L) => {
    const keys = Array.from({ length: 4 }, (_, i) => `${L}${i}`);
    keys.forEach((k) => params.push({ key: k, name: k }));
    return { label: L, keys };
  });
  const { layout, tui } = buildTui(params, sections);
  check("two pages", layout.pages.length === 2, `got ${layout.pages.length}`);
  check("page0 has A..D", layout.pages[0].name === "A / B / C / D", layout.pages[0].name);
  check("page1 has E only", layout.pages[1].name === "E", layout.pages[1].name);
  check("section E intact in page1 col0", JSON.stringify(col(layout, 1, 0)) === JSON.stringify(["E0", "E1", "E2", "E3"]));
  check("TUI has 2 tabs", tui.pageData.tabs.length === 2);
}

// --- Case 4: no sections → single implicit section, key order, page numbers -----------------------
console.log("Case 4: no sections → flat, numbered tabs");
{
  const params: InputParam[] = Array.from({ length: 5 }, (_, i) => ({ key: `p${i}`, name: `P${i}` }));
  const { layout } = buildTui(params);
  check("one page", layout.pages.length === 1);
  check("col0 = first 4", JSON.stringify(col(layout, 0, 0)) === JSON.stringify(["p0", "p1", "p2", "p3"]));
  check("col1 = p4", JSON.stringify(col(layout, 0, 1)) === JSON.stringify(["p4"]));
  check("tab name is '1' (no labels)", layout.pages[0].name === "1", layout.pages[0].name);
}

// --- Case 5: full-TUI control is placed but toUiJson refuses it (no silent drop) -------------------
console.log("Case 5: a momentary control is placed, but not yet simple-emittable");
{
  const params: InputParam[] = [{ key: "cutoff", name: "Cutoff" }, { key: "panic", name: "Panic", type: "trigger" }];
  const layout = packLayout(params);
  check("both placed", layout.pages[0].slots.filter((s: any) => s).length === 2);
  let threw = false;
  try { toUiJson(layout); } catch { threw = true; }
  check("toUiJson refuses full-TUI (placed, not dropped)", threw);
}

console.log(fails ? `\n${fails} assertion(s) failed` : `\nAll packer assertions pass (chain builds TUI.json via uiBuilder)`);
process.exit(fails ? 1 : 0);
