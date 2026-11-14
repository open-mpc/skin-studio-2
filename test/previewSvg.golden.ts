// Structural test for the SVG preview backend. Verifies draw ops → SVG markup: background, filmstrip
// frame slicing (image offset + clip), text anchoring, and generic knob/bar vectors. Pure strings;
// pixels come from Chromium/resvg (Electron shell). Run: npx tsx test/previewSvg.golden.ts
import * as fs from "fs";
import * as path from "path";
import { TuiPreview, type PreviewParam } from "../src/core/preview.ts";
import { renderSvg } from "../src/core/previewSvg.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const fix = path.join(here, "golden/uigen/knobs_switch_bipolar");
const tui = JSON.parse(fs.readFileSync(path.join(fix, "out/Plugin Skins/TUI.json"), "utf8"));
const params: PreviewParam[] = JSON.parse(fs.readFileSync(path.join(fix, "params.json"), "utf8")).params;

let fails = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else { fails++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
};

const ops = new TuiPreview(tui, params).render(0);
const svg = renderSvg(ops, { background: "ff1e1d1e" });

console.log("SVG backend: knobs_switch_bipolar");
ok("valid-ish svg root", svg.startsWith("<svg") && svg.includes('viewBox="0 0 1280 628"') && svg.endsWith("</svg>"));
ok("background rect", svg.includes('fill="#1e1d1e"'));

// Cutoff knob: 90-tall frame, frame 76 → image y offset = cellY - 76*90, strip height = 90*127 = 11430
{
  // cutoff cell is at col0,row0 slot (23,45); kit knob inset 8 → image x=31,y=... find the knob_uni image
  const m = svg.match(/<image href="knob_uni\.png"[^>]*height="11430"[^>]*clip-path/g) || [];
  ok("knob_uni strip height 90·127=11430", m.length >= 1, `${m.length} matches`);
  // verify a clip path exists and the frame-76 offset appears for some knob_uni image
  const any76 = /<image href="knob_uni\.png" x="\d+" y="(-?\d+)"/.test(svg);
  ok("knob_uni image has an offset y (frame slicing)", any76);
}
// filmstrip clip paths present
ok("clip paths defined", svg.includes("<clipPath id=") && svg.includes("clip-path=\"url(#c0)\""));
// seg buttons → seg3 on/off images (Filter Mode switch, 3 options)
ok("seg3 button image present", /<image href="seg3_(on|off)\.png"/.test(svg));
// text: Cutoff name, right-anchored value nowhere mislabeled
ok("Cutoff text present", svg.includes(">Cutoff</text>"));
ok("value text 6.0 kHz", svg.includes(">6.0 kHz</text>"));

// imageHref hook embeds/rewrites hrefs
{
  const svg2 = renderSvg(ops, { imageHref: (s) => "data:image/png;base64,FAKE/" + s });
  ok("imageHref rewrites hrefs", svg2.includes('href="data:image/png;base64,FAKE/knob_uni.png"'));
}

// bar + knob vector ops (from a generic fixture: build one quickly via a slider + generic knob)
{
  const genOps = [
    { op: "bar", x: 10, y: 20, w: 100, h: 40, value: 0.5 } as const,
    { op: "knob", x: 0, y: 0, w: 80, h: 80, value: 0.5, bipolar: false } as const,
  ];
  const gsvg = renderSvg(genOps);
  ok("bar fill = 50% width", gsvg.includes('width="50.00"'));
  ok("knob draws circle + pointer", gsvg.includes("<circle") && gsvg.includes("<line"));
}

console.log(fails ? `\n${fails} assertion(s) failed` : `\nAll SVG-backend assertions pass`);
process.exit(fails ? 1 : 0);
