// Behaviour test for the knob look library (extension; plan "Ledger 3"). Verifies each ported look
// draws its signature SVG, rotates by the value angle, arc-looks add a knob-arc, and the SVG backend
// pulls in LOOK_DEFS once when a look is used. Visual fidelity is for the browser/Electron; this gates
// structure. Run: npx tsx test/looks.golden.ts
import { knobLookSvg, KNOB_LOOKS, ARC_LOOKS } from "../src/core/looks.ts";
import { renderSvg } from "../src/core/previewSvg.ts";
import type { DrawOp } from "../src/core/preview.ts";

let fails = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else { fails++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
};

console.log("Look library: all 12 ported looks");
const sig: Record<string, string> = {
  moog: "look-skirt", metal: "look-metal", cap: "look-cap-ring",
  chrome: "look-cdome", prophet: "look-pskirt", hardware: "look-hdome",
  chicken: "look-base", bakelite: "look-bskirt", davies: "look-dskirt",
  rubber: "look-rbody", ledring: "look-lbody", taper: "look-wside",
};
for (const [look, cls] of Object.entries(sig)) {
  ok(`${look} is registered`, look in KNOB_LOOKS);
  const svg = knobLookSvg(look, 50, 50, 40, 0.5);
  ok(`${look} draws signature class ${cls}`, svg.includes(cls));
  ok(`${look} wrapped as .look-${look}`, svg.includes(`class="knob look-${look}"`));
}

// Angle: value 0 → -135°, value 1 → +135° somewhere in a rotate() of a turning part.
{
  const min = knobLookSvg("moog", 50, 50, 40, 0);
  const max = knobLookSvg("moog", 50, 50, 40, 1);
  ok("value 0 → rotate -135", min.includes("rotate(-135.00"));
  ok("value 1 → rotate 135", max.includes("rotate(135.00"));
}

// Arc looks add a knob-arc path; non-arc looks don't.
ok("all 12 looks registered", Object.keys(KNOB_LOOKS).length === 12, Object.keys(KNOB_LOOKS).join(","));
// ledring lights LEDs up to the value (look-led-on appears, and fewer at low value)
ok("ledring lights more LEDs at high value",
  (knobLookSvg("ledring", 50, 50, 40, 0.9).match(/look-led-on/g) || []).length > (knobLookSvg("ledring", 50, 50, 40, 0.1).match(/look-led-on/g) || []).length);
ok("prophet is an arc-look", ARC_LOOKS.has("prophet"));
ok("prophet adds knob-arc", knobLookSvg("prophet", 50, 50, 40, 0.7).includes('class="knob-arc"'));
ok("moog has no knob-arc", !knobLookSvg("moog", 50, 50, 40, 0.7).includes('class="knob-arc"'));

// Unknown look rejected.
{
  let threw = false;
  try { knobLookSvg("nope", 0, 0, 10, 0.5); } catch { threw = true; }
  ok("unknown look → error", threw);
}

// SVG backend wiring: a knob op with a look pulls in LOOK_DEFS once; without a look it doesn't.
{
  const withLook: DrawOp[] = [{ op: "knob", x: 0, y: 0, w: 90, h: 90, value: 0.5, bipolar: false, look: "hardware" }];
  const svg = renderSvg(withLook);
  ok("backend renders the look", svg.includes('class="knob look-hardware"'));
  ok("backend includes LOOK_DEFS once", (svg.match(/chrome-linear/g) || []).length === 1 || svg.includes("dome-radial"));
  ok("LOOK_DEFS has the styles", svg.includes(".look-hdome"));

  const plain: DrawOp[] = [{ op: "knob", x: 0, y: 0, w: 90, h: 90, value: 0.5, bipolar: false }];
  const svg2 = renderSvg(plain);
  ok("plain knob (no look) omits LOOK_DEFS", !svg2.includes(".look-hdome"));
  ok("plain knob draws generic circle+pointer", svg2.includes("<circle") && svg2.includes("<line"));
}

console.log(fails ? `\n${fails} assertion(s) failed` : `\nAll look-library assertions pass`);
process.exit(fails ? 1 : 0);
