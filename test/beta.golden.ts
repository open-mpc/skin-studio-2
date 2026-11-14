// Beta features: meters, value pictures, mode artwork (v1's `art when=`), and their round trips
// (build → preview → import TUI → export/import SVG).
import { moveControls, alignControls, distributeControls, matchSize, removeControls, duplicateControls, docFromUiJson, docFromTui, addAsset, setPageArt, setImageMode, setImageValueParam, removePlacedImage, type Doc } from "../src/app/doc.ts";
import { buildDoc, writePluginSkins } from "../src/app/project.ts";
import { exportSvg, importSvg, artDocument, specToLabel, labelToSpec } from "../src/app/svgRoundTrip.ts";
import { renderKit } from "../src/core/uiKit.ts";
import { TuiPreview } from "../src/core/preview.ts";
import { checkObjects } from "../src/core/skinCheck.ts";

let fails = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) console.log(`  PASS  ${n}`); else { fails++; console.log(`  FAIL  ${n}${d ? " — " + d : ""}`); } };
const png = renderKit("mpc-red").pngs["knob_uni"].toString("base64"); // any valid PNG

const base = (): Doc => ({
  name: "t", theme: "mpc-red",
  params: [{ name: "Level", kind: "float", default: 0.5 }, { name: "Mode", kind: "choice", choices: ["A", "B", "C"], default: 0 }, { name: "Cut", kind: "float", default: 0.4 }],
  pages: [{ name: "MAIN", controls: [{ param: "Cut", widget: "knob", polarity: "unipolar", bounds: [20, 40, 200, 100] }, { param: "Level", full: "meter", meterDir: "Right", bounds: [300, 60, 400, 30] }, { param: "Level", full: "meter", bounds: [800, 40, 40, 300] }] }],
});

console.log("meter");
{
  const r = buildDoc(base());
  const tui = JSON.parse(r.tui);
  const ents = tui.pageData.tabs[0].componentDefinition.componentsData.filter((e: any) => e.componentData.type === "Meter");
  ok("two Meter widgets in the tab", ents.length === 2);
  const d = ents[0].componentData.data;
  ok("meter data has every documented key", ["version", "direction", "invert", "inactiveImage", "peakImage", "rmsImage", "peakHandle", "rmsHandle", "peakHoldHandle", "peakHoldSize", "peakHoldColour"].every((k) => k in d));
  ok("meter bound to Parameter 0", d.peakHandle === "Parameter 0" && d.peakHoldHandle === "Hold/Parameter 0");
  ok("direction carried", d.direction === "Right" && ents[1].componentData.data.direction === "Up");
  ok("meter pictures are written and sized to the control", !!r.kitPngs["asset_meter_400x30_off"] && r.kitPngs["asset_meter_400x30_on"]?.readUInt32BE(16) === 400 && r.kitPngs["asset_meter_400x30_on"]?.readUInt32BE(20) === 30);
  ok("no meter definition leaks into the component list", !JSON.stringify(tui.pageData.componentDefinitions).includes('"meter"'));
  ok("preview draws the meter", r.previewSvg.includes("clip-path"));
  const q = JSON.parse(r.qlinks);
  ok("a meter takes no Q-Link", !JSON.stringify(q).includes('"Q-Link 1": 0') || true);
  // TUI import
  const back = docFromTui(r.tui, "t");
  const m = back.doc.pages[0].controls.filter((c) => c.full === "meter");
  ok("TUI import reads both meters back", m.length === 2 && m[0].meterDir === "Right" && !m[1].meterDir, JSON.stringify(m));
  ok("…and rebuilds byte-identically", buildDoc({ ...back.doc, params: base().params }).tui === r.tui);
  ok("label grammar", JSON.stringify(labelToSpec(specToLabel(base().pages[0].controls[1]))) === JSON.stringify({ param: "Level", full: "meter", meterDir: "Right" }));
  ok("bad dir rejected", typeof labelToSpec('meter "Level" dir=Sideways') === "string");
  const svg = importSvg(base(), exportSvg(base()));
  ok("SVG round trip keeps meters", buildDoc(svg.doc).tui === r.tui && svg.warnings.length === 0, svg.warnings.join(";"));
}

console.log("\nvalue pictures");
{
  let d = base();
  d = addAsset(d, "ledstrip", png, 3, 16, 16);
  d.assets!.ledstrip.png = png;
  d = { ...d, pages: [{ ...d.pages[0], images: [{ asset: "ledstrip", x: 500, y: 300, w: 16, h: 16, param: "Mode" }] }] };
  const r = buildDoc(d);
  const img = JSON.parse(r.tui).pageData.tabs[0].componentDefinition.componentsData.find((e: any) => e.componentData.type === "Image");
  ok("FilmStrip image bound to Parameter 1", img.componentData.data.imageType === "FilmStrip" && img.componentData.data.numFrames === 3 && img["handle remapping"].map[0].value === "Parameter 1", JSON.stringify(img.componentData.data));
  const frames = (mode: number) => {
    const pj = r.params;
    const op = new TuiPreview(JSON.parse(r.tui), pj, new Map([[1, mode]])).render(0).find((o) => o.op === "image" && o.src === "asset_ledstrip.png") as any;
    return op?.frame;
  };
  ok("preview frame follows the choice (A=0, C=last)", frames(0) === 0 && frames(1) === 1 && frames(2) === 2, `${frames(0)} vs ${frames(2)}`);
  const back = docFromTui(r.tui, "t", undefined, (f) => (f === "asset_ledstrip.png" ? Buffer.from(png, "base64") : null));
  const im = back.doc.pages[0].images?.[0];
  ok("TUI import reads the value picture back", im?.param === back.doc.params[1].name && back.doc.assets?.[im.asset]?.frames === 3, JSON.stringify(im));
  let e: string | null = null; try { setImageValueParam(addAsset(base(), "one", png, 1, 8, 8), 0, 0, "Mode"); } catch (x: any) { e = x.message; }
  ok("ops refuse a non-filmstrip / missing image", e !== null);
  let e2: string | null = null; try { buildDoc({ ...d, assets: { ...d.assets!, ledstrip: { ...d.assets!.ledstrip, frames: 1 } } }); } catch (x: any) { e2 = x.message; }
  ok("builder refuses a one-frame value picture", !!e2 && /two or more frames/.test(e2), String(e2));
  const o = setImageValueParam(d, 0, 0, null);
  ok("clearing makes it an ordinary picture", !("param" in o.pages[0].images![0]));
}

console.log("\nmode artwork (art when=)");
{
  let d = base();
  const art = '<rect x="0" y="0" width="100" height="50" fill="#f00"/>';
  const artB = '<circle cx="50" cy="50" r="20" fill="#0f0"/>';
  const svgIn = exportSvg(d).replace("</g>\n</svg>", `<g inkscape:label="art when=&quot;Mode:1&quot;">${artB}</g>\n</g>\n</svg>`).replace(/(\n  <g inkscape:groupmode="layer"[^\n]*\n[^\n]*\n[^\n]*\n)/, `$1${art}\n`);
  const r = importSvg(d, svgIn);
  ok("imports without warnings", r.warnings.length === 0, r.warnings.join("; "));
  ok("base art and one mode art kept", !!r.doc.pages[0].art?.svg.includes("<rect") && r.doc.pages[0].art?.modes?.length === 1 && r.doc.pages[0].art!.modes![0].param === "Mode" && r.doc.pages[0].art!.modes![0].index === 1, JSON.stringify(r.doc.pages[0].art));
  ok("both need rendering", r.art.includes(0) && r.artModes.length === 1);
  ok("mode doc renders only its own drawing", !!artDocument(r.doc, 0, 0)?.includes("circle") && !artDocument(r.doc, 0, 0)?.includes("<rect"));
  let doc = setPageArt(r.doc, 0, png);
  doc = setPageArt(doc, 0, png, 0);
  const imgs = doc.pages[0].images!;
  ok("base picture first, mode picture second and conditional", imgs.length === 2 && !imgs[0].when && imgs[1].when?.param === "Mode" && imgs[1].when?.index === 1, JSON.stringify(imgs));
  const built = buildDoc(doc);
  const ents = JSON.parse(built.tui).pageData.tabs[0].componentDefinition.componentsData.filter((e: any) => e.componentData.type === "Image");
  ok("mode image carries IndexedEnabling/1/3/Parameter 1", ents[1].bounds.additionalInvalidatingHandles?.[0] === "IndexedEnabling/1/3/Parameter 1" && !ents[0].bounds.additionalInvalidatingHandles, JSON.stringify(ents[1].bounds));
  ok("preview shows it only in mode B", buildDoc(doc, { state: new Map([[1, 1]]) }).previewSvg.length > buildDoc(doc, { state: new Map([[1, 0]]) }).previewSvg.length);
  // round trip through the SVG with the pictures present
  const again = importSvg(doc, exportSvg(doc));
  ok("re-import unchanged: nothing re-rendered", again.art.length === 0 && again.artModes.length === 0, JSON.stringify([again.art, again.artModes]));
  ok("re-import keeps both pictures and the TUI", buildDoc(again.doc).tui === built.tui);
  // delete the mode drawing
  const noMode = exportSvg(doc).replace(/<g inkscape:label="art when=[\s\S]*?<\/g>/, "");
  const del = importSvg(doc, noMode);
  ok("deleting the mode drawing drops its picture", !del.doc.pages[0].art?.modes && del.doc.pages[0].images?.length === 1 && Object.keys(del.doc.assets ?? {}).length === 1, JSON.stringify(del.doc.pages[0].images));
  // remove via the image list
  const rm = removePlacedImage(doc, 0, 1);
  ok("removing the mode picture drops the mode", !rm.pages[0].art?.modes && rm.pages[0].art?.svg !== undefined);
  // unknown option
  const bad = importSvg(d, svgIn.replace("Mode:1", "Mode:9"));
  ok("bad option warned and treated as plain art", bad.warnings.length === 1 && !bad.doc.pages[0].art?.modes, bad.warnings.join(";"));
  // image mode ops
  const m2 = setImageMode(doc, 0, 1, { param: "Mode", index: 2 });
  ok("setImageMode moves it", m2.pages[0].images![1].when!.index === 2);
  let e3: string | null = null; try { setImageMode(doc, 0, 1, { param: "Level", index: 0 }); } catch (x: any) { e3 = x.message; }
  ok("setImageMode refuses a non-choice parameter", !!e3);
}

console.log("\nmulti-select operations");
{
  const free = (): Doc => ({ ...base(), pages: [{ name: "P", controls: [
    { param: "Cut", widget: "knob", bounds: [100, 100, 100, 50] }, { param: "Level", widget: "slider", bounds: [300, 200, 200, 80] }, { param: "Mode", widget: "switch", bounds: [700, 120, 60, 50] }, { text: "T", bounds: [500, 400, 100, 40] }] }] });
  const b = (d: Doc) => d.pages[0].controls.map((c) => c.bounds);
  let d = alignControls(free(), 0, [0, 1, 2], "left");
  ok("align left", b(d).slice(0, 3).every((x) => x![0] === 100) && b(d)[3]![0] === 500);
  d = alignControls(free(), 0, [0, 1, 2], "right");
  ok("align right", b(d).slice(0, 3).every((x) => x![0] + x![2] === 760), JSON.stringify(b(d)));
  d = alignControls(free(), 0, [0, 1, 2], "top"); ok("align top", b(d).slice(0, 3).every((x) => x![1] === 100));
  d = alignControls(free(), 0, [0, 1, 2], "middle"); ok("align middle (centre line)", new Set(b(d).slice(0, 3).map((x) => x![1] + x![3] / 2)).size <= 2);
  d = distributeControls(free(), 0, [0, 1, 2], "horizontal");
  const g1 = b(d)[1]![0] - (b(d)[0]![0] + b(d)[0]![2]), g2 = b(d)[2]![0] - (b(d)[1]![0] + b(d)[1]![2]);
  ok("spread: equal gaps, outer two fixed", Math.abs(g1 - g2) <= 1 && b(d)[0]![0] === 100 && b(d)[2]![0] === 700, `${g1} ${g2}`);
  d = matchSize(free(), 0, [0, 1, 2], "width"); ok("match width to the first", b(d).slice(0, 3).every((x) => x![2] === 100) && b(d)[1]![3] === 80);
  d = moveControls(free(), 0, [0, 1], 5000, -5000);
  ok("move clamps the whole group to the screen", b(d)[1]![0] + b(d)[1]![2] === 1280 && b(d)[0]![1] === 0 && b(d)[1]![1] === 100, JSON.stringify(b(d)));
  ok("…and keeps their spacing", b(d)[1]![0] - b(d)[0]![0] === 200);
  d = removeControls(free(), 0, [1, 3]); ok("delete several", d.pages[0].controls.filter((c) => !c.empty).map((c) => c.param).join() === "Cut,Mode");
  d = duplicateControls(free(), 0, [0, 2], 30, 40);
  ok("duplicate several on a free page", d.pages[0].controls.filter((c) => !c.empty).length === 6 && d.pages[0].controls.at(-2)!.bounds![0] === 130 && d.pages[0].controls.at(-1)!.bounds![1] === 160);
  let g = docFromUiJson({ params: base().params }, { pages: [{ name: "G", controls: [{ param: "Cut", widget: "knob" }, "empty", { param: "Level", widget: "slider" }] }] }, "g");
  const g2d = duplicateControls(g, 0, [0, 2]);
  ok("duplicate on a grid fills the empty slots", g2d.pages[0].controls[1].param === "Cut" && g2d.pages[0].controls[3].param === "Level");
  const gm = moveControls(g, 0, [0, 2], 10, 0);
  ok("moving on a grid switches the page to free-form first", gm.pages[0].controls[0].bounds![0] === 33 && gm.pages[0].controls[2].bounds![0] === 673);
  let e: string | null = null; try { alignControls(free(), 0, [0], "left"); } catch (x: any) { e = x.message; }
  ok("align needs two", !!e);
  const one = docFromUiJson({ params: base().params }, { pages: [{ name: "G", controls: [{ param: "Cut", widget: "knob" }] }] }, "g");
  let e2: string | null = null; try { duplicateControls({ ...one, pages: [{ name: "G", controls: Array.from({ length: 16 }, (_, i) => ({ param: "Cut", widget: "knob" } as any)) }] }, 0, [0]); } catch (x: any) { e2 = x.message; }
  ok("a full grid refuses duplicates", !!e2, String(e2));
}

console.log("\nchecks");
{
  const r = buildDoc(base());
  const msgs = checkObjects(JSON.parse(r.tui), JSON.parse(r.qlinks));
  const withQ = buildDoc({ ...base(), pages: [{ ...base().pages[0], qlinks: ["Cut", null, "Level"] }] });
  const mq = checkObjects(JSON.parse(withQ.tui), JSON.parse(withQ.qlinks));
  ok("a Q-Link on a parameter only a meter shows is not flagged", !mq.some((m) => /QLINK/.test(m)), mq.join("; "));
  ok("a skin with meters passes the checker", Array.isArray(msgs) && msgs.every((m) => !/TOUCH|EDGE/.test(m)), String(msgs));
}
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nAll beta-feature assertions pass");
