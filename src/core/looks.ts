// looks.ts — the knob LOOK LIBRARY (extension; plan "Ledger 3").
//
// Akai-first: the SDK's make_knob/make_ui_kit style is the BASE knob look (uiKit). v1's html_art look
// LIBRARY (moog/prophet/hardware/chrome/… — a dozen distinct hardware styles) is the genuine delta the
// SDK lacks, carried over as OPT-IN looks. Faithful port of v1's SVG look functions, made self-contained
// (the default.css classes + gradient defs are bundled here, no external stylesheet).
//
// For the PREVIEW these draw live as SVG (no rasteriser). For the DEVICE a look becomes a knobImage film
// strip at build time (Electron rasterises each frame) — the SDK consumes it via knobImage/knobFrames.
//
// Ported this unit: moog, metal, cap, chrome, prophet, hardware (covers plain fills, gradients, knurl/rib
// dashes, arc-looks and the hardware hero). The rest (chicken/bakelite/davies/rubber/ledring/taper) slot
// into KNOB_LOOKS the same way.

const g = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""));
const f2 = (n: number) => n.toFixed(2);

function turn(a: number, cx: number, cy: number, body: string): string {
  return `<g transform="rotate(${f2(a)} ${g(cx)} ${g(cy)})">${body}</g>`;
}

export const ARC_LOOKS = new Set(["prophet", "taper"]);

// --- the ported look functions (cx,cy = centre, r = radius, a = angle in degrees, 0 = up) ---------
function knobMoog(cx: number, cy: number, r: number, a: number): string {
  const R = r + 3;
  const n = Math.max(24, Math.floor(R * 1.2));
  const dash = (2 * Math.PI * (R - 2)) / n / 2;
  return (
    `<circle class="look-skirt" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}"/>` +
    turn(a, cx, cy, `<circle class="look-knurl" cx="${g(cx)}" cy="${g(cy)}" r="${g(R - 2)}" style="stroke-width:3.5;stroke-dasharray:${f2(dash)} ${f2(dash)}"/>`) +
    `<circle class="look-body" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.84)}"/>` +
    turn(a, cx, cy, `<line class="look-line" x1="${g(cx)}" y1="${g(cy - R * 0.55)}" x2="${g(cx)}" y2="${g(cy - R * 0.8)}" style="stroke-width:${g(Math.max(2, r / 11))}"/>`) +
    `<circle class="look-cap" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.5)}"/>` +
    `<circle class="knob-sheen" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.84)}"/>`
  );
}
function knobMetal(cx: number, cy: number, r: number, a: number): string {
  const R = r + 3;
  return (
    `<circle class="look-metal" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}"/>` +
    `<circle class="look-metal-top" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.82)}"/>` +
    turn(a, cx, cy, `<line class="look-notch" x1="${g(cx)}" y1="${g(cy - R * 0.3)}" x2="${g(cx)}" y2="${g(cy - R * 0.76)}" style="stroke-width:${g(Math.max(2, r / 10))}"/>`) +
    `<circle class="knob-sheen" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.82)}"/>`
  );
}
function knobCap(cx: number, cy: number, r: number, a: number): string {
  const R = r + 2;
  return (
    `<circle class="look-cap-ring" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}"/>` +
    `<circle class="look-cap-top" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.8)}"/>` +
    `<circle class="knob-sheen" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.8)}"/>` +
    turn(a, cx, cy, `<line class="look-line" x1="${g(cx)}" y1="${g(cy - R * 0.25)}" x2="${g(cx)}" y2="${g(cy - R * 0.7)}" style="stroke-width:${g(Math.max(2, r / 10))}"/>`)
  );
}
function knobChrome(cx: number, cy: number, r: number, a: number): string {
  const R = r * 0.86;
  return (
    hshadow(cx, cy, R) +
    `<circle class="look-crim" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}"/>` +
    `<circle class="look-cdome" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.86)}"/>` +
    turn(a, cx, cy, `<line class="look-cline" x1="${g(cx)}" y1="${g(cy - R * 0.1)}" x2="${g(cx)}" y2="${g(cy - R * 0.8)}" style="stroke-width:${g(Math.max(2.2, r / 9))}"/>`) +
    spec(cx, cy, R, -0.12, -0.5, 0.4, 0.12, false)
  );
}
function knobProphet(cx: number, cy: number, r: number, a: number): string {
  const R = r - 0.5;
  const n = 34;
  const dash = (2 * Math.PI * (R - 1.8)) / n / 2;
  let brush = "";
  for (let k = 0; k < 28; k++)
    brush += `<line x1="${g(cx + R * 0.1 * Math.sin((k * Math.PI) / 14))}" y1="${g(cy - R * 0.1 * Math.cos((k * Math.PI) / 14))}" x2="${g(cx + R * 0.7 * Math.sin((k * Math.PI) / 14))}" y2="${g(cy - R * 0.7 * Math.cos((k * Math.PI) / 14))}"/>`;
  return (
    `<circle class="look-pshadow" cx="${g(cx)}" cy="${g(cy + 1.5)}" r="${g(R)}"/>` +
    `<circle class="look-pskirt" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}"/>` +
    turn(a, cx, cy, `<circle class="look-prib" cx="${g(cx)}" cy="${g(cy)}" r="${g(R - 1.8)}" style="stroke-width:3.6;stroke-dasharray:${f2(dash)} ${f2(dash)}"/>`) +
    `<circle class="look-pring" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.83)}"/>` +
    `<circle class="look-pbevel" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.72)}"/>` +
    `<circle class="look-ptop" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.68)}"/>` +
    turn(a, cx, cy, `<g class="look-pbrush">${brush}</g>`) +
    turn(a, cx, cy, `<line class="look-pline" x1="${g(cx)}" y1="${g(cy - R * 0.1)}" x2="${g(cx)}" y2="${g(cy - R * 0.66)}" style="stroke-width:${g(Math.max(2.0, r / 10))}"/>`) +
    `<ellipse class="knob-sheen look-psheen" cx="${g(cx - R * 0.18)}" cy="${g(cy - R * 0.3)}" rx="${g(R * 0.45)}" ry="${g(R * 0.28)}"/>`
  );
}
function rimDashes(cx: number, cy: number, R: number, n: number, a: number, cls: string, sw: number): string {
  const dash = (2 * Math.PI * R) / n / 2;
  return turn(a, cx, cy, `<circle class="${cls}" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}" style="stroke-width:${g(sw)};stroke-dasharray:${f2(dash)} ${f2(dash)}"/>`);
}
function spec(cx: number, cy: number, R: number, dx: number, dy: number, rx: number, ry: number, rot = true): string {
  const ex = cx + R * dx, ey = cy + R * dy;
  return `<ellipse class="look-hspec" cx="${g(ex)}" cy="${g(ey)}" rx="${g(R * rx)}" ry="${g(R * ry)}"${rot ? ` transform="rotate(-30 ${g(ex)} ${g(ey)})"` : ""}/>`;
}
function hshadow(cx: number, cy: number, R: number, k = 0.06): string {
  return `<ellipse class="look-hshadow" cx="${g(cx + R * k)}" cy="${g(cy + R * 0.2)}" rx="${g(R * 1.02)}" ry="${g(R)}"/>`;
}
function knobHardware(cx: number, cy: number, r: number, a: number): string {
  const R = r * 0.84;
  let ticks = "";
  for (let k = 0; k < 31; k++) {
    const th = ((-135 + (270 * k) / 30) * Math.PI) / 180;
    const r0 = r * 0.93, r1 = r * (k % 5 === 0 ? 1.06 : 1.0);
    ticks += `<line x1="${f2(cx + r0 * Math.sin(th))}" y1="${f2(cy - r0 * Math.cos(th))}" x2="${f2(cx + r1 * Math.sin(th))}" y2="${f2(cy - r1 * Math.cos(th))}"/>`;
  }
  return (
    `<g class="look-hticks">${ticks}</g>` +
    hshadow(cx, cy, R, 0.08) +
    `<circle class="look-hskirt" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}"/>` +
    rimDashes(cx, cy, R - 1.5, 40, a, "look-hrib", 3) +
    `<circle class="look-hrim" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.86)}"/>` +
    `<circle class="look-hdome" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.8)}"/>` +
    turn(a, cx, cy, `<path class="look-hpointer" d="M${g(cx - R * 0.07)},${g(cy - R * 0.12)} L${g(cx)},${g(cy - R * 0.78)} L${g(cx + R * 0.07)},${g(cy - R * 0.12)} Z"/>`) +
    spec(cx, cy, R, -0.28, -0.38, 0.3, 0.14) +
    `<circle class="look-hglint" cx="${g(cx + R * 0.34)}" cy="${g(cy + R * 0.4)}" r="${g(R * 0.1)}"/>`
  );
}

function knobChicken(cx: number, cy: number, r: number, a: number): string {
  const R = r + 3;
  const head =
    '<path class="look-head" d="M0,-0.98 C0.12,-0.98 0.44,0.02 0.44,0.3 A0.44,0.44 0 0 1 -0.44,0.3 ' +
    'C-0.44,0.02 -0.12,-0.98 0,-0.98 Z"/><path class="look-line" d="M0,-0.86 L0,-0.32" style="stroke-width:0.07"/>' +
    '<circle class="knob-sheen" cx="0" cy="0.25" r="0.4"/>';
  return (
    `<circle class="look-base" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.9)}"/>` +
    `<g transform="translate(${g(cx)} ${g(cy)}) rotate(${f2(a)}) scale(${g(R)})">${head}</g>`
  );
}
function knobBakelite(cx: number, cy: number, r: number, a: number): string {
  const R = r * 0.86;
  return (
    hshadow(cx, cy, R) +
    `<circle class="look-bskirt" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}"/>` +
    rimDashes(cx, cy, R - 1.5, 36, a, "look-brib", 3) +
    `<circle class="look-btop" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.78)}"/>` +
    turn(a, cx, cy, `<line class="look-bline" x1="${g(cx)}" y1="${g(cy - R * 0.18)}" x2="${g(cx)}" y2="${g(cy - R * 0.74)}" style="stroke-width:${g(Math.max(2.2, r / 9))}"/>`) +
    spec(cx, cy, R, -0.3, -0.4, 0.28, 0.12)
  );
}
function knobDavies(cx: number, cy: number, r: number, a: number): string {
  const R = r * 0.9;
  return (
    hshadow(cx, cy, R) +
    `<circle class="look-dskirt" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}"/>` +
    `<circle class="look-dstep" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.66)}"/>` +
    `<circle class="look-dcap" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.6)}"/>` +
    turn(a, cx, cy, `<line class="look-dline" x1="${g(cx)}" y1="${g(cy - R * 0.62)}" x2="${g(cx)}" y2="${g(cy - R * 0.97)}" style="stroke-width:${g(Math.max(3, r / 7))}"/>`) +
    spec(cx, cy, R, -0.2, -0.28, 0.22, 0.1)
  );
}
function knobRubber(cx: number, cy: number, r: number, a: number): string {
  const R = r * 0.88;
  return (
    hshadow(cx, cy, R, 0.05) +
    `<circle class="look-rbody" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}"/>` +
    rimDashes(cx, cy, R - 2.5, 28, a, "look-rgrip", 4) +
    `<circle class="look-rtop" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.74)}"/>` +
    turn(a, cx, cy, `<circle class="look-rdot" cx="${g(cx)}" cy="${g(cy - R * 0.55)}" r="${g(Math.max(2.4, r / 9))}"/>`)
  );
}
function knobLedring(cx: number, cy: number, r: number, a: number): string {
  const R = r * 0.66;
  let leds = "";
  for (let k = 0; k < 21; k++) {
    const ang = -135 + (270 * k) / 20;
    const th = (ang * Math.PI) / 180;
    const x = cx + r * 0.88 * Math.sin(th), y = cy - r * 0.88 * Math.cos(th);
    leds += `<circle class="look-led${ang <= a + 0.01 ? "-on" : "-off"}" cx="${f2(x)}" cy="${f2(y)}" r="${g(Math.max(1.8, r / 14))}"/>`;
  }
  return (
    leds +
    hshadow(cx, cy, R, 0.05) +
    `<circle class="look-lbody" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}"/>` +
    turn(a, cx, cy, `<line class="look-lline" x1="${g(cx)}" y1="${g(cy - R * 0.3)}" x2="${g(cx)}" y2="${g(cy - R * 0.85)}" style="stroke-width:${g(Math.max(2.2, r / 10))}"/>`) +
    spec(cx, cy, R, -0.25, -0.4, 0.3, 0.12, false)
  );
}
function knobTaper(cx: number, cy: number, r: number, a: number): string {
  const R = r * 0.92;
  const dr = Math.round(r);
  return (
    `<ellipse class="look-hshadow" cx="${g(cx + R * 0.06)}" cy="${g(cy + R * 0.14)}" rx="${g(R * 1.02)}" ry="${g(R)}"/>` +
    `<circle class="look-wside" data-r="${dr}" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}"/>` +
    `<circle class="look-wshade" cx="${g(cx)}" cy="${g(cy)}" r="${g(R)}"/>` +
    `<circle class="look-wtop" data-r="${dr}" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.78)}"/>` +
    `<circle class="look-wbevel" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.66)}"/>` +
    `<circle class="look-winset" data-r="${dr}" cx="${g(cx)}" cy="${g(cy)}" r="${g(R * 0.6)}"/>` +
    turn(a, cx, cy, `<line class="look-wnotch" x1="${g(cx)}" y1="${g(cy - R * 0.22)}" x2="${g(cx)}" y2="${g(cy - R * 0.5)}" style="stroke-width:${g(Math.max(2.0, r / 10))}"/>`) +
    `<ellipse class="look-hspec" cx="${g(cx - R * 0.22)}" cy="${g(cy - R * 0.3)}" rx="${g(R * 0.26)}" ry="${g(R * 0.1)}" transform="rotate(-35 ${g(cx - R * 0.22)} ${g(cy - R * 0.3)})"/>`
  );
}

export const KNOB_LOOKS: Record<string, (cx: number, cy: number, r: number, a: number) => string> = {
  moog: knobMoog,
  chicken: knobChicken,
  metal: knobMetal,
  cap: knobCap,
  prophet: knobProphet,
  hardware: knobHardware,
  chrome: knobChrome,
  bakelite: knobBakelite,
  davies: knobDavies,
  rubber: knobRubber,
  ledring: knobLedring,
  taper: knobTaper,
};

// Value arc for ARC_LOOKS (prophet/taper): a stroke along the 270° sweep up to the value.
function knobArc(cx: number, cy: number, r: number, value: number): string {
  const R = r + 2;
  const a0 = -135, a1 = -135 + 270 * Math.max(0, Math.min(1, value));
  const pt = (deg: number) => [cx + R * Math.sin((deg * Math.PI) / 180), cy - R * Math.cos((deg * Math.PI) / 180)];
  const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  if (a1 - a0 < 0.5) return "";
  return `<path class="knob-arc" d="M${f2(x0)},${f2(y0)} A${g(R)},${g(R)} 0 ${large} 1 ${f2(x1)},${f2(y1)}" style="stroke-width:${g(Math.max(2, r * 0.12))}"/>`;
}

/** SVG for one knob drawn with a look, at a normalised value (0..1). */
export function knobLookSvg(look: string, cx: number, cy: number, r: number, value: number): string {
  const fn = KNOB_LOOKS[look];
  if (!fn) throw new Error(`unknown knob look "${look}" (have: ${Object.keys(KNOB_LOOKS).join(", ")})`);
  const a = -135 + 270 * Math.max(0, Math.min(1, value));
  const arc = ARC_LOOKS.has(look) ? knobArc(cx, cy, r, value) : "";
  return `<g class="knob look-${look}">${arc}${fn(cx, cy, r, a)}</g>`;
}

// Self-contained defs + styles the looks need (ported from html_art DEFS + default.css, with sensible
// CSS-var defaults baked in). Emit once per document that uses any look.
export const LOOK_DEFS = `<defs>
<radialGradient id="sheen-radial" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="metal-radial" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#f6f6f4"/><stop offset="0.55" stop-color="#b9b9b6"/><stop offset="1" stop-color="#6c6c69"/></radialGradient>
<linearGradient id="metal-linear" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8e8e6"/><stop offset="0.5" stop-color="#8e8e8b"/><stop offset="1" stop-color="#d6d6d3"/></linearGradient>
<linearGradient id="chrome-linear" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f8"/><stop offset="0.42" stop-color="#9aa0a8"/><stop offset="0.5" stop-color="#2a2d33"/><stop offset="0.62" stop-color="#6c727a"/><stop offset="1" stop-color="#eceef0"/></linearGradient>
<radialGradient id="dome-radial" cx="0.38" cy="0.32" r="0.8"><stop offset="0" stop-color="#6a6c70"/><stop offset="0.35" stop-color="#2c2d30"/><stop offset="1" stop-color="#050506"/></radialGradient>
<linearGradient id="rim-linear" x1="0.2" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#d8dadd"/><stop offset="0.45" stop-color="#3a3b3e"/><stop offset="1" stop-color="#9a9ca0"/></linearGradient>
<radialGradient id="bake-radial" cx="0.38" cy="0.32" r="0.8"><stop offset="0" stop-color="#7a4a2e"/><stop offset="0.4" stop-color="#3a1e10"/><stop offset="1" stop-color="#140803"/></radialGradient>
<radialGradient id="wside-radial" cx="0.38" cy="0.32" r="0.85"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
</defs>
<style>
.knob-arc{fill:none;stroke:#d31145;stroke-linecap:round}.knob-sheen{fill:url(#sheen-radial)}
.look-base{fill:#2a2a2d;stroke:#0e0e0f}.look-head{fill:#121212;stroke:#000;stroke-width:0.02}
.look-bskirt{fill:#1c0d05}.look-brib{fill:none;stroke:#5a3420}.look-btop{fill:url(#bake-radial);stroke:#0d0502;stroke-width:0.8}.look-bline{stroke:#f1e6c8;stroke-linecap:round}
.look-dskirt{fill:#121214;stroke:#000;stroke-width:0.8}.look-dstep{fill:#4b4d52}.look-dcap{fill:url(#dome-radial)}.look-dline{stroke:#f2f2ee;stroke-linecap:butt}
.look-rbody{fill:#26272a;stroke:#0c0c0d;stroke-width:1}.look-rgrip{fill:none;stroke:#3a3b3f}.look-rtop{fill:#2e2f33;stroke:#1a1b1d;stroke-width:1}.look-rdot{fill:#d31145}
.look-led-on{fill:#ff3d6e;filter:drop-shadow(0 0 2.5px #ff3d6e)}.look-led-off{fill:#3a3a38}.look-lbody{fill:#1d1e20;stroke:#070708;stroke-width:1}.look-lline{stroke:#f4f4f1;stroke-linecap:round}
.look-wside{fill:#34343a}.look-wshade{fill:url(#wside-radial)}.look-wtop{fill:#2a2a2e;stroke:#141416;stroke-width:0.8}.look-wbevel{fill:none;stroke:#5a5a60;stroke-width:1.4;opacity:0.8}.look-winset{fill:#86868b;stroke:#444448;stroke-width:0.8}.look-wnotch{stroke:#1f1f23;stroke-linecap:round}
.look-skirt{fill:#0d0d0d}.look-knurl{fill:none;stroke:#343434}.look-body{fill:#171717;stroke:#050505;stroke-width:1.5}
.look-cap{fill:url(#metal-radial);stroke:#2a2a2a;stroke-width:1}.look-line{stroke:#f4f4f2;stroke-linecap:round;fill:none}
.look-metal{fill:url(#metal-linear);stroke:#3b3b3a;stroke-width:1.5}.look-metal-top{fill:url(#metal-radial)}.look-notch{stroke:#1a1a1a;stroke-linecap:round}
.look-cap-ring{fill:#2a2a2d}.look-cap-top{fill:#d31145}
.look-pshadow{fill:rgba(0,0,0,0.55)}.look-pskirt{fill:#0b0b0c}.look-prib{fill:none;stroke:#4a4b4f}.look-pring{fill:url(#metal-linear);stroke:#8a8c90;stroke-width:0.6}
.look-pbevel{fill:#55575b}.look-ptop{fill:#1a1b1d;stroke:#08090a;stroke-width:0.8}.look-pbrush line{stroke:#34363a;stroke-width:0.5;opacity:0.8}.look-pline{stroke:#f7f7f5;stroke-linecap:round;fill:none}.look-psheen{opacity:0.18}
.look-hticks line{stroke:#14110a;stroke-width:1.6;stroke-linecap:round;opacity:0.9}.look-hshadow{fill:rgba(0,0,0,0.6)}.look-hskirt{fill:#08080a}.look-hrib{fill:none;stroke:#3b3c40}
.look-hrim{fill:url(#rim-linear)}.look-hdome{fill:url(#dome-radial)}.look-hpointer{fill:#f4f4f1;stroke:#d0d0cc;stroke-width:0.4;stroke-linejoin:round}.look-hspec{fill:#fff;opacity:0.5}.look-hglint{fill:#fff;opacity:0.16}
.look-crim{fill:url(#rim-linear);stroke:#55585d;stroke-width:0.8}.look-cdome{fill:url(#chrome-linear)}.look-cline{stroke:#15161a;stroke-linecap:round}
</style>`;
