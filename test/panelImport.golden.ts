// Panel picture import (extension): the circle finder on synthetic panels, and importPanel's page edit + build.
import { findPanelControls, detectCircles, classify, readingOrder } from "../src/core/panelDetect.ts";
import { importPanel, serializeDoc, parseDoc, type Doc } from "../src/app/doc.ts";
import { buildDoc } from "../src/app/project.ts";
import { checkObjects } from "../src/core/skinCheck.ts";
let fails = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) console.log(`  PASS  ${n}`); else { fails++; console.log(`  FAIL  ${n}${d ? " — " + d : ""}`); } };

const W = 1280, H = 628;
function plate(): Uint8Array { const a = new Uint8Array(W * H * 4); for (let i = 0; i < W * H; i++) a.set([40, 36, 30, 255], i * 4); return a; }
function disc(a: Uint8Array, cx: number, cy: number, r: number, rgb: [number, number, number], ring?: [number, number, number]) {
  for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++)
    for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) a.set(ring && d > r - 3 ? ring : rgb, (y * W + x) * 4);
    }
}
// a stroke of "text" (thin bars) that must not be found
function bars(a: Uint8Array) { for (let x = 20; x < 300; x += 9) for (let y = 20; y < 50; y++) for (let t = 0; t < 3; t++) a.set([220, 200, 150, 255], (y * W + x + t) * 4); }

console.log("finder");
{
  const a = plate(); bars(a);
  const knobs = [[200, 200], [420, 200], [640, 200], [860, 200]];
  const jacks = [[200, 480], [300, 480], [400, 480]];
  for (const [x, y] of knobs) disc(a, x, y, 45, [15, 15, 15], [170, 160, 140]);
  for (const [x, y] of jacks) { disc(a, x, y, 18, [120, 120, 120]); disc(a, x, y, 8, [0, 0, 0]); }
  const got = findPanelControls(a);
  const k = got.filter((c) => c.kind === "knob"), s = got.filter((c) => c.kind === "small");
  ok("4 knobs and 3 jacks, nothing else", k.length === 4 && s.length === 3, JSON.stringify(got.map((c) => [c.cx, c.cy, c.r, c.kind])));
  ok("knob centres within 4 px, radii within 4 px", k.every((c, i) => Math.abs(c.cx - knobs[i][0]) + Math.abs(c.cy - knobs[i][1]) <= 4 && Math.abs(c.r - 45) <= 4));
  ok("reading order: knob row first, left to right", got[0].kind === "knob" && got[0].cx < got[1].cx && got[4].kind === "small");
  ok("deterministic", JSON.stringify(findPanelControls(a)) === JSON.stringify(got));
  ok("blank picture: nothing", findPanelControls(plate()).length === 0);
}
{
  ok("classify: one size = all knobs", classify([{ cx: 0, cy: 0, r: 20, score: 1 }, { cx: 0, cy: 0, r: 22, score: 1 }]).every((c) => c.kind === "knob"));
  ok("readingOrder rows", JSON.stringify(readingOrder([{ cx: 50, cy: 105 }, { cx: 10, cy: 100 }, { cx: 0, cy: 300 }], 20)) === JSON.stringify([{ cx: 10, cy: 100 }, { cx: 50, cy: 105 }, { cx: 0, cy: 300 }]));
  ok("detectCircles on a tiny image does not throw", Array.isArray(detectCircles(new Uint8Array(16), 4, 4)));
}

console.log("importPanel");
{
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const knobs = [{ cx: 200, cy: 200, r: 45 }, { cx: 420, cy: 200, r: 30 }, { cx: 640, cy: 200, r: 10 }, { cx: 860, cy: 200, r: 45 }];
  const base: Doc = { name: "Panel", theme: "mpc-red", pages: [{ name: "PANEL", controls: [] }], params: [
    { name: "Mode", kind: "choice", choices: ["A", "B"] }, { name: "Cutoff", kind: "float", default: 0.5 }, { name: "Res", kind: "float", default: 0.5 }, { name: "Env", kind: "float", default: 0.5 },
  ] };
  const r = importPanel(base, 0, png, knobs);
  const pg = r.doc.pages[0];
  const placed = pg.controls.filter((c) => c.bounds);
  ok("background set to the panel asset", pg.background === "panel" && r.doc.assets?.panel?.w === 1280);
  ok("3 knobs bound to the ranged parameters, choice skipped", r.placed === 3 && r.unbound === 1 && placed.map((c) => c.param).join() === "Cutoff,Res,Env", JSON.stringify(placed));
  const c0 = placed[0];
  ok("knob size = diameter, picture centred on the control", c0.size === 90 && c0.bounds![0] + 8 + 45 === 200 && c0.bounds![1] + 8 + 45 === 200, JSON.stringify(c0));
  ok("small control clamps to 24 px", placed[2].size === 24);
  ok("labels hidden by default", c0.nameSize === 0 && c0.valueSize === 0 && c0.bounds![2] === 107);
  ok("labels kept with labels=true", importPanel(base, 0, png, knobs, true).doc.pages[0].controls.filter((c) => c.bounds)[0].nameSize === undefined);
  ok("Q-Links follow the knobs", pg.qlinks?.slice(0, 3).join() === "Cutoff,Res,Env");
  ok("second import gets its own asset", importPanel(r.doc, 0, png, knobs).asset === "panel_2");
  ok("survives save/load", JSON.stringify(parseDoc(serializeDoc(r.doc)).pages[0]) === JSON.stringify(pg));
  const b = buildDoc(r.doc);
  const tui = JSON.parse(b.tui);
  const comps = tui.pageData.tabs[0].componentDefinition?.componentsData ?? [];
  ok("builds; background image first", comps.length >= 4 && JSON.stringify(comps[0]).includes("asset_panel.png"), String(comps.length));
  const found = checkObjects(tui, JSON.parse(b.qlinks)).filter((f) => !/QLINK/.test(f));
  ok("skin check: no touch/edge findings", found.length === 0, found.join(" | "));
  let threw = false; try { importPanel(base, 5, png, knobs); } catch { threw = true; }
  ok("bad page rejected", threw);
}
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nall passed");
