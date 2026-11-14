// SVG layout round trip: export → import reproduces the skin exactly; edits made in a drawing tool
// (moved/transformed rectangles, deleted/duplicated groups, retyped labels) come back as layout changes.
import * as fs from "fs";
import * as path from "path";
import { exportSvg, importSvg, specToLabel, labelToSpec } from "../src/app/svgRoundTrip.ts";
import { docFromUiJson, docFromTui, addStripPage, addAsset } from "../src/app/doc.ts";
import { buildDoc } from "../src/app/project.ts";
import { TEMPLATES } from "../src/app/templates.ts";
import { renderKit } from "../src/core/uiKit.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
let fails = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) console.log(`  PASS  ${n}`); else { fails++; console.log(`  FAIL  ${n}${d ? " — " + d : ""}`); } };

console.log("label grammar");
{
  const specs = [
    { param: "Cutoff", widget: "knob", polarity: "bipolar", size: 60 },
    { param: 'We"ird \\ name', widget: "fader" },
    { param: "Div", widget: "slider", overlay: "menu", visibleWhen: { param: "Sync", index: 1 } },
    { text: "SECTION A" }, { param: "P", full: "button" }, { param: "S", full: "repeat", repeatCount: 8 },
  ] as any[];
  for (const s of specs) {
    const back = labelToSpec(specToLabel(s));
    ok(`round-trips: ${specToLabel(s)}`, JSON.stringify(back) === JSON.stringify(s), JSON.stringify(back));
  }
  ok("junk label reported", typeof labelToSpec("wibble x") === "string");
  ok("bad option reported", typeof labelToSpec('knob "A" colour=red') === "string");
}

console.log("\nfull round trip on Akai templates");
for (const [k, t] of Object.entries(TEMPLATES)) {
  const doc = docFromUiJson({ params: t.params }, t.ui, t.plugin);
  const want = buildDoc(doc);
  const { doc: back, warnings } = importSvg(doc, exportSvg(doc));
  const got = buildDoc(back);
  ok(`${k}: no warnings`, warnings.length === 0, warnings.slice(0, 2).join("; "));
  ok(`${k}: TUI.json identical after export→import`, got.tui === want.tui);
  ok(`${k}: Q-Links.json identical`, got.qlinks === want.qlinks);
}

console.log("\nstrip pages, text, assets");
{
  const png = renderKit("mpc-red").pngs["knob_uni"].toString("base64");
  let doc = docFromUiJson({ params: Array.from({ length: 8 }, (_, i) => ({ name: `S${i + 1}`, kind: "float", default: 0.3 })) }, { pages: [{ name: "MAIN", controls: [{ param: "S1", widget: "knob", polarity: "unipolar" }, { text: "HELLO" }] }] }, "x");
  doc = addStripPage(doc, "SEQ", "S1", 8);
  doc = addAsset(doc, "pic", png, 1, 40, 40);
  doc = { ...doc, pages: doc.pages.map((p, i) => (i ? p : { ...p, images: [{ asset: "pic", x: 10, y: 10, w: 40, h: 40 }] })) };
  const { doc: back, warnings } = importSvg(doc, exportSvg(doc));
  ok("no warnings", warnings.length === 0, warnings.join("; "));
  ok("strip page survives", back.pages[1].controls[0].full === "repeat" && back.pages[1].controls[0].repeatCount === 8);
  ok("placed image meta survives", back.pages[0].images?.[0].asset === "pic");
  ok("identical TUI.json", buildDoc(back).tui === buildDoc(doc).tui);
}

console.log("\nedits made in a drawing tool");
{
  const doc = docFromUiJson({ params: [{ name: "A", kind: "float", default: 0.3 }, { name: "B", kind: "float", default: 0.3 }, { name: "C", kind: "float", default: 0.3 }] },
    { pages: [{ name: "P", controls: [{ param: "A", widget: "knob", polarity: "unipolar" }, { param: "B", widget: "knob", polarity: "unipolar" }] }] }, "e");
  let svg = exportSvg(doc);
  // Inkscape-style move: a translate on the group instead of rewriting the rect
  svg = svg.replace(/<g id="c0_0" inkscape:label="([^"]*)">/, '<g id="c0_0" inkscape:label="$1" transform="translate(100,50)">');
  // retype the second control's label
  svg = svg.replace(/inkscape:label="knob &quot;B&quot; polarity=unipolar"/, 'inkscape:label="fader &quot;C&quot;"');
  const { doc: e1, warnings } = importSvg(doc, svg);
  ok("translate on a group moves the control", JSON.stringify(e1.pages[0].controls[0].bounds) === "[123,95,278,107]", JSON.stringify(e1.pages[0].controls[0].bounds));
  ok("retyped label changes widget + parameter", e1.pages[0].controls[1].widget === "fader" && e1.pages[0].controls[1].param === "C");
  ok("edited doc builds", buildDoc(e1).tui.includes("faderUni"), warnings.join(";"));
  // delete a group
  const gone = importSvg(doc, exportSvg(doc).replace(/<g id="c0_1"[\s\S]*?<\/g>/, "")).doc;
  ok("deleted group removes the control", gone.pages[0].controls.length === 1);
  // unknown parameter
  const bad = importSvg(doc, exportSvg(doc).replace('inkscape:label="knob &quot;A&quot; polarity=unipolar"', 'inkscape:label="knob &quot;Nope&quot;"'));
  ok("unknown parameter skipped with a warning", bad.warnings.some((w) => /unknown parameter "Nope"/.test(w)) && bad.doc.pages[0].controls.length === 1);
  ok("not-an-svg rejected", (() => { try { importSvg(doc, "hello"); return false; } catch { return true; } })());
  ok("file with no layers rejected", (() => { try { importSvg(doc, '<svg xmlns="http://www.w3.org/2000/svg"></svg>'); return false; } catch { return true; } })());
}
console.log("\nartwork drawn in the SVG");
{
  const { artDocument } = await import("../src/app/svgRoundTrip.ts");
  const { setPageArt, removePlacedImage, serializeDoc, parseDoc } = await import("../src/app/doc.ts");
  const png = renderKit("mpc-red").pngs["knob_uni"].toString("base64");
  const doc = docFromUiJson({ params: [{ name: "A", kind: "float", default: 0.3 }, { name: "B", kind: "float", default: 0.3 }] },
    { pages: [{ name: "P", controls: [{ param: "A", widget: "knob", polarity: "unipolar" }] }, { name: "Q", controls: [{ param: "B", widget: "knob", polarity: "unipolar" }] }] }, "art");
  const plain = buildDoc(doc);
  // Inkscape-style additions: root defs, a bare shape, a labelled art group, text, and a group mixing a control with a drawing
  let svg = exportSvg(doc);
  svg = svg.replace(/(<svg [^>]*>)/, '$1\n<defs id="defs1"><linearGradient id="lg"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>');
  svg = svg.replace(/(<rect inkscape:label="screen"[^>]*\/>)/, '$1\n<rect id="panel" x="20" y="20" width="400" height="200" fill="url(#lg)"/>\n<g id="logo" inkscape:label="logo"><circle cx="50" cy="50" r="30"/><text x="10" y="20">MY &amp; SYNTH</text></g>');
  svg = svg.replace(/(<g id="c0_0" [\s\S]*?<\/g>)/, '<g id="mix" transform="translate(5,7)">$1<path id="swoosh" d="M0 0 L10 10"/></g>');
  const r = importSvg(doc, svg);
  const pg = r.doc.pages[0];
  ok("drawings become the page's artwork (no warnings)", !!pg.art && r.warnings.length === 0, r.warnings.join("; "));
  ok("only the drawn page needs rendering", JSON.stringify(r.art) === "[0]" && !r.doc.pages[1].art);
  ok("artwork keeps shape, labelled group and text verbatim", pg.art!.svg.includes('id="panel"') && pg.art!.svg.includes('inkscape:label="logo"') && pg.art!.svg.includes("MY &amp; SYNTH"));
  ok("a drawing grouped with a control keeps the group's transform", pg.art!.svg.includes('<g transform="translate(5,7)"><path id="swoosh"'));
  ok("control rectangles are not artwork", !pg.art!.svg.includes("c0_0") && !pg.art!.svg.includes('inkscape:label="screen"'));
  ok("the control inside the mixed group is still read (and moved)", pg.controls.length === 1 && JSON.stringify(pg.controls[0].bounds) === "[28,52,278,107]", JSON.stringify(pg.controls[0]?.bounds));
  ok("top-level defs come along", r.doc.artDefs?.includes('id="lg"') === true);
  const ad = artDocument(r.doc, 0)!;
  ok("art document is a standalone 1280x628 SVG with defs", /^<svg [^>]*width="1280" height="628"/.test(ad) && ad.includes('id="lg"') && ad.includes('id="panel"') && artDocument(r.doc, 1) === null);
  ok("without a picture the skin builds as before", buildDoc(importSvg(doc, exportSvg(doc)).doc).tui === plain.tui && !buildDoc(r.doc).tui.includes("asset_art"));
  // the app renders the art document and stores the picture
  const d2 = setPageArt(r.doc, 0, png);
  const im = d2.pages[0].images?.[0];
  ok("picture stored as a full-tab image behind the controls", d2.pages[0].art!.asset === "art_1" && !!im && im.asset === "art_1" && im.w === 1280 && im.h === 628 && buildDoc(d2).tui.includes("asset_art_1.png"));
  ok("setPageArt refuses a page without artwork", (() => { try { setPageArt(r.doc, 1, png); return false; } catch { return true; } })());
  // round trip: the drawings go back out as editable shapes and nothing needs re-rendering
  const out = exportSvg(d2);
  ok("export puts the drawings back as shapes", out.includes('id="panel"') && out.includes('id="lg"') && out.includes('id="swoosh"'));
  const r2 = importSvg(d2, out);
  ok("unchanged artwork: no re-render, same project", r2.art.length === 0 && r2.warnings.length === 0 && r2.doc.pages[0].art!.svg === d2.pages[0].art!.svg && r2.doc.artDefs === d2.artDefs && buildDoc(r2.doc).tui === buildDoc(d2).tui, r2.warnings.join("; "));
  const r3 = importSvg(d2, out.replace('width="400" height="200"', 'width="500" height="200"'));
  ok("edited artwork is re-rendered into the same asset", JSON.stringify(r3.art) === "[0]" && r3.doc.pages[0].art!.asset === "art_1" && setPageArt(r3.doc, 0, png).pages[0].images!.length === 1);
  const r4 = importSvg(d2, out.replace(d2.pages[0].art!.svg, ""));
  ok("deleting the drawings removes the artwork, its image and asset", !r4.doc.pages[0].art && !r4.doc.pages[0].images && !r4.doc.assets?.art_1 && r4.doc.artDefs === undefined && buildDoc(r4.doc).tui === buildDoc(r.doc).tui);
  ok("removing the artwork image in the app drops the artwork", !removePlacedImage(d2, 0, 0).pages[0].art);
  ok("artwork survives save/load", (() => { const b = parseDoc(serializeDoc(d2)); return b.artDefs === d2.artDefs && JSON.stringify(b.pages) === JSON.stringify(d2.pages) && buildDoc(b).tui === buildDoc(d2).tui; })());
  const linked = importSvg(doc, exportSvg(doc).replace(/(<rect inkscape:label="screen"[^>]*\/>)/, '$1\n<image xlink:href="photo.png" x="0" y="0" width="10" height="10"/>'));
  ok("a linked (not embedded) image is flagged", linked.warnings.some((w) => /links to an image file/.test(w)));
  let sd = addStripPage(doc, "SEQ", "A", 2);
  const stripArt = importSvg(sd, exportSvg(sd).replace(/(id="layer2"[\s\S]*?<rect inkscape:label="screen"[^>]*\/>)/, '$1\n<circle cx="5" cy="5" r="3"/>'));
  ok("artwork on a strip page is refused with a note", !stripArt.doc.pages[2].art && stripArt.warnings.some((w) => /strip page cannot carry artwork/.test(w)));
  ok("a malformed control label still warns (is not taken as artwork)", (() => { const b = importSvg(doc, exportSvg(doc).replace('inkscape:label="knob &quot;A&quot; polarity=unipolar"', 'inkscape:label="knob &quot;A&quot; bogus=1"')); return b.warnings.some((w) => /unknown option/.test(w)) && !b.doc.pages[0].art; })());
}
void fs; void here; void docFromTui;
console.log(fails ? `\n${fails} failed` : "\nAll SVG round-trip assertions pass");
process.exit(fails ? 1 : 0);
