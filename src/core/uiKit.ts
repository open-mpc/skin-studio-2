// uiKit.ts — faithful TypeScript port of the SDK's tools/make_ui_kit.py (Akai's film-strip kit
// renderer: knobs, faders, toggles, buttons, segments → PNGs + kit.json manifest).
//
// ORACLE = make_ui_kit.py. PARITY NOTE (important): this port CANNOT be byte-for-byte hash-identical
// to Akai's PNGs. The raster feeds through libm transcendentals (hypot/sin/cos/atan2), and V8's
// fdlibm disagrees with CPython's system libm in the last ULP on ~half of inputs. zlib (the PNG
// compressor) IS identical (1.3.1 both sides), so any divergence is purely those last-bit raster
// differences surviving 8-bit quantization at anti-aliased edges. The gate is therefore PIXEL
// parity within a tight tolerance (see test/uiKit.golden.ts), not file hash. Everything else —
// geometry, colours, manifest bytes, compositing math — is a faithful port.
//
// `uiBuilder` consumes only the kit MANIFEST (sizes/frames), so TUI.json parity never depended on
// this module; this is the pixel generator.

import * as zlib from "zlib";

export const KIT_VERSION = 1;

type RGBA = [number, number, number, number]; // r,g,b,a  (a: 0..255)
type ColourFn = (px: number, py: number) => RGBA;
type Colour = RGBA | ColourFn;

const GREYS: Record<string, string> = {
  bg: "ff1e1d1e",
  body: "ff2a2a2d",
  bodyLight: "ff3c3c40",
  bodyDark: "ff171718",
  track: "ff434347",
  outline: "ff0e0e0f",
  pointer: "fff2f2f2",
  thumb: "ffb9b9bd",
  thumbLight: "ffe6e6e8",
  thumbDark: "ff8a8a8e",
  ledOff: "ff3a2b2e",
  textOn: "ffffffff",
};

export const THEMES: Record<string, string> = {
  "mpc-red": "ffd31145",
  amber: "ffffa21a",
  cyan: "ff19c6e0",
  lime: "ff8fd21f",
  violet: "ff9b63ff",
  mono: "ffe4e4e6",
};

// Python round(): banker's rounding (half to even). Used wherever make_ui_kit calls int(round(...)).
function pyRound(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function parseArgb(text: string): RGBA {
  let t = String(text).trim().replace(/^#/, "");
  if (t.length === 6) t = "ff" + t;
  if (t.length !== 8 || !/^[0-9a-fA-F]{8}$/.test(t))
    throw new Error(`colour must be 8-digit ARGB hex like "ffd31145", got ${JSON.stringify(text)}`);
  const v = parseInt(t, 16);
  return [(v >>> 16) & 255, (v >>> 8) & 255, v & 255, (v >>> 24) & 255];
}
function argbText(c: RGBA): string {
  const h = (n: number) => (n & 255).toString(16).padStart(2, "0");
  return h(c[3]) + h(c[0]) + h(c[1]) + h(c[2]);
}
function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [0, 1, 2, 3].map((i) => pyRound(a[i] + (b[i] - a[i]) * t)) as RGBA;
}
function withAlpha(c: RGBA, alpha: number): RGBA {
  return [c[0], c[1], c[2], pyRound(alpha)];
}

type Theme = Record<string, RGBA>;
function makeTheme(name: string, accent?: string | null): Theme {
  if (!(name in THEMES)) throw new Error(`unknown theme ${JSON.stringify(name)}`);
  const acc = accent ? parseArgb(accent) : parseArgb(THEMES[name]);
  const th: Theme = {};
  for (const [k, v] of Object.entries(GREYS)) th[k] = parseArgb(v);
  th.accent = acc;
  th.accentDark = mix(acc, th.outline, 0.35);
  th.accentGlow = withAlpha(acc, 70);
  th.ledOff = mix(acc, th.body, 0.78);
  return th;
}

// ---- Tiny raster library (float RGBA, source-over, analytic anti-aliasing) ----------------------
class Canvas {
  w: number;
  h: number;
  px: Float64Array; // [r,g,b,a] per pixel; a in 0..1
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Float64Array(w * h * 4); // all zero == (0,0,0,0)
  }
  copy(): Canvas {
    const c = new Canvas(this.w, this.h);
    c.px.set(this.px);
    return c;
  }
  blend(i: number, colour: RGBA, cov: number): void {
    if (cov <= 0.0) return;
    const sa = (colour[3] / 255.0) * (cov >= 1.0 ? 1.0 : cov);
    if (sa <= 0.0) return;
    const b = i * 4;
    const dr = this.px[b], dg = this.px[b + 1], db = this.px[b + 2], da = this.px[b + 3];
    const oa = sa + da * (1.0 - sa);
    const k = da * (1.0 - sa);
    this.px[b] = (colour[0] * sa + dr * k) / oa;
    this.px[b + 1] = (colour[1] * sa + dg * k) / oa;
    this.px[b + 2] = (colour[2] * sa + db * k) / oa;
    this.px[b + 3] = oa;
  }
  blit(other: Canvas, ox: number, oy: number): void {
    for (let y = 0; y < other.h; y++) {
      const ty = y + oy;
      if (ty < 0 || ty >= this.h) continue;
      for (let x = 0; x < other.w; x++) {
        const tx = x + ox;
        if (tx < 0 || tx >= this.w) continue;
        const ob = (y * other.w + x) * 4;
        const a = other.px[ob + 3];
        if (a > 0.0) this.blend(ty * this.w + tx, [other.px[ob], other.px[ob + 1], other.px[ob + 2], 255], a);
      }
    }
  }
  rows(): Buffer[] {
    const out: Buffer[] = [];
    for (let y = 0; y < this.h; y++) {
      const row = Buffer.allocUnsafe(this.w * 4);
      for (let x = 0; x < this.w; x++) {
        const b = (y * this.w + x) * 4;
        row[x * 4] = Math.floor(this.px[b] + 0.5);
        row[x * 4 + 1] = Math.floor(this.px[b + 1] + 0.5);
        row[x * 4 + 2] = Math.floor(this.px[b + 2] + 0.5);
        row[x * 4 + 3] = Math.floor(this.px[b + 3] * 255.0 + 0.5);
      }
      out.push(row);
    }
    return out;
  }
}

function cov(sdf: number): number {
  return sdf >= 0.5 ? 0.0 : sdf <= -0.5 ? 1.0 : 0.5 - sdf;
}
function sdRrect(px: number, py: number, x: number, y: number, w: number, h: number, r: number): number {
  const cx = x + w / 2.0, cy = y + h / 2.0;
  const qx = Math.abs(px - cx) - (w / 2.0 - r), qy = Math.abs(py - cy) - (h / 2.0 - r);
  const ox = Math.max(qx, 0.0), oy = Math.max(qy, 0.0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0.0) - r;
}
function sdCircle(px: number, py: number, cx: number, cy: number, r: number): number {
  return Math.hypot(px - cx, py - cy) - r;
}
function fillCanvas(canvas: Canvas, bbox: [number, number, number, number], sdf: (px: number, py: number) => number, colour: Colour): void {
  const x0 = Math.max(0, Math.floor(bbox[0]));
  const y0 = Math.max(0, Math.floor(bbox[1]));
  const x1 = Math.min(canvas.w, Math.ceil(bbox[2]) + 1);
  const y1 = Math.min(canvas.h, Math.ceil(bbox[3]) + 1);
  const call = typeof colour === "function";
  for (let y = y0; y < y1; y++) {
    const py = y + 0.5;
    const base = y * canvas.w;
    for (let x = x0; x < x1; x++) {
      const px = x + 0.5;
      const c = cov(sdf(px, py));
      if (c > 0.0) canvas.blend(base + x, call ? (colour as ColourFn)(px, py) : (colour as RGBA), c);
    }
  }
}
function rrect(canvas: Canvas, x: number, y: number, w: number, h: number, r: number, colour: Colour): void {
  fillCanvas(canvas, [x - 1, y - 1, x + w + 1, y + h + 1], (px, py) => sdRrect(px, py, x, y, w, h, r), colour);
}
function rrectOutline(canvas: Canvas, x: number, y: number, w: number, h: number, r: number, thickness: number, colour: Colour): void {
  fillCanvas(canvas, [x - 1, y - 1, x + w + 1, y + h + 1], (px, py) => Math.abs(sdRrect(px, py, x, y, w, h, r) + thickness / 2.0) - thickness / 2.0, colour);
}
function circle(canvas: Canvas, cx: number, cy: number, r: number, colour: Colour): void {
  fillCanvas(canvas, [cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1], (px, py) => sdCircle(px, py, cx, cy, r), colour);
}
function vgrad(y0: number, y1: number, c0: RGBA, c1: RGBA): ColourFn {
  const span = (y1 - y0) || 1.0;
  return (_px, py) => mix(c0, c1, Math.max(0.0, Math.min(1.0, (py - y0) / span)));
}
function lightRim(cx: number, cy: number, cLight: RGBA, cDark: RGBA, lightAngle = -0.75 * Math.PI): ColourFn {
  return (px, py) => {
    const a = Math.atan2(py - cy, px - cx);
    const t = 0.5 - 0.5 * Math.cos(a - lightAngle);
    return mix(cLight, cDark, t);
  };
}
function arc(canvas: Canvas, cx: number, cy: number, rIn: number, rOut: number, aFromIn: number, aToIn: number, colour: Colour, cap = true): void {
  let aFrom = aFromIn, aTo = aToIn;
  if (aTo < aFrom) { const t = aFrom; aFrom = aTo; aTo = t; }
  if (aTo - aFrom < 1e-4) return;
  const rMid = (rIn + rOut) / 2.0;
  const capR = (rOut - rIn) / 2.0;
  const sdf = (px: number, py: number): number => {
    const dx = px - cx, dy = py - cy;
    const d = Math.hypot(dx, dy);
    const ang = Math.atan2(dx, -dy);
    const sRing = Math.max(d - rOut, rIn - d);
    if ((aFrom <= ang && ang <= aTo) || (aTo > Math.PI && ang < aTo - 2.0 * Math.PI) || (aFrom < -Math.PI && ang > aFrom + 2.0 * Math.PI))
      return sRing;
    if (!cap) return 1.0;
    let best = 1e9;
    for (const a of [aFrom, aTo]) {
      const ex = cx + rMid * Math.sin(a), ey = cy - rMid * Math.cos(a);
      best = Math.min(best, Math.hypot(px - ex, py - ey) - capR);
    }
    return best;
  };
  fillCanvas(canvas, [cx - rOut - 1, cy - rOut - 1, cx + rOut + 1, cy + rOut + 1], sdf, colour);
}
function capsule(canvas: Canvas, x0: number, y0: number, x1: number, y1: number, width: number, colour: Colour): void {
  const sdf = (px: number, py: number): number => {
    const vx = x1 - x0, vy = y1 - y0;
    const ll = vx * vx + vy * vy || 1.0;
    const t = Math.max(0.0, Math.min(1.0, ((px - x0) * vx + (py - y0) * vy) / ll));
    return Math.hypot(px - (x0 + vx * t), py - (y0 + vy * t)) - width / 2.0;
  };
  const pad = width + 1;
  fillCanvas(canvas, [Math.min(x0, x1) - pad, Math.min(y0, y1) - pad, Math.max(x0, x1) + pad, Math.max(y0, y1) + pad], sdf, colour);
}

// ---- PNG output ---------------------------------------------------------------------------------
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function pngChunk(tag: string, data: Buffer): Buffer {
  const tagBuf = Buffer.from(tag, "latin1");
  const body = Buffer.concat([tagBuf, data]);
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
export function writePngBytes(width: number, rows: Buffer[]): Buffer {
  const raw = Buffer.concat(rows.flatMap((r) => [Buffer.from([0]), r]));
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.allocUnsafe(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(rows.length, 4);
  ihdrData[8] = 8; ihdrData[9] = 6; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk("IHDR", ihdrData), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

// ---- Knob ---------------------------------------------------------------------------------------
const SWEEP = (270.0 * Math.PI) / 180.0;

function knobStatic(size: number, th: Theme): [Canvas, number[]] {
  const c = new Canvas(size, size);
  const cx = size / 2.0, cy = size / 2.0, r = size / 2.0;
  const ringOut = r - 1.0, ringIn = r - Math.max(4.0, size * 0.1);
  const bodyR = ringIn - Math.max(3.0, size * 0.07);
  arc(c, cx, cy, ringIn, ringOut, -SWEEP / 2.0, SWEEP / 2.0, th.track);
  circle(c, cx, cy + 1.5, bodyR + 1.0, withAlpha(th.outline, 150));
  circle(c, cx, cy, bodyR, lightRim(cx, cy, th.bodyLight, th.bodyDark));
  const faceR = bodyR - Math.max(1.5, size * 0.035);
  circle(c, cx, cy, faceR, vgrad(cy - faceR, cy + faceR, mix(th.body, th.bodyLight, 0.35), th.body));
  return [c, [cx, cy, ringIn, ringOut, bodyR, faceR]];
}
function knobFrame(staticC: Canvas, geo: number[], t: number, th: Theme, bipolar: boolean): Canvas {
  const c = staticC.copy();
  const [cx, cy, ringIn, ringOut, , faceR] = geo;
  const a = -SWEEP / 2.0 + SWEEP * t;
  if (bipolar) {
    capsule(c, cx, cy - ringOut - 0.5, cx, cy - ringIn + 0.5, 2.0, th.thumbDark);
    if (Math.abs(t - 0.5) > 0.002) arc(c, cx, cy, ringIn, ringOut, Math.min(0.0, a), Math.max(0.0, a), th.accent);
  } else {
    if (t > 0.002) arc(c, cx, cy, ringIn, ringOut, -SWEEP / 2.0, a, th.accent);
  }
  const px0 = cx + Math.sin(a) * faceR * 0.38;
  const py0 = cy - Math.cos(a) * faceR * 0.38;
  const px1 = cx + Math.sin(a) * (faceR - 2.0);
  const py1 = cy - Math.cos(a) * (faceR - 2.0);
  const w = Math.max(2.5, faceR * 0.11);
  capsule(c, px0, py0, px1, py1, w + 1.5, withAlpha(th.outline, 120));
  capsule(c, px0, py0, px1, py1, w, th.pointer);
  return c;
}
function renderKnob(size: number, frames: number, th: Theme, bipolar: boolean): Buffer[] {
  const [staticC, geo] = knobStatic(size, th);
  const rows: Buffer[] = [];
  for (let i = 0; i < frames; i++) rows.push(...knobFrame(staticC, geo, i / (frames - 1.0), th, bipolar).rows());
  return rows;
}

// ---- Fader --------------------------------------------------------------------------------------
type FGeo = { len: number; th: number; cap_len: number; cap_th: number; from: number; to: number; track_h: number; mid: number };
function faderGeometry(length: number, thickness: number): FGeo {
  const capLen = 22, capTh = thickness - 6;
  return { len: length, th: thickness, cap_len: capLen, cap_th: capTh, from: capLen / 2.0, to: length - capLen / 2.0, track_h: 8, mid: thickness / 2.0 };
}
function faderStatic(g: FGeo, th: Theme): Canvas {
  const c = new Canvas(g.len, g.th);
  const x0 = g.from, x1 = g.to;
  const y = g.mid - g.track_h / 2.0;
  rrect(c, x0 - 4, y + 1, x1 - x0 + 8, g.track_h, 4.0, withAlpha(th.outline, 160));
  rrect(c, x0 - 4, y, x1 - x0 + 8, g.track_h, 4.0, vgrad(y, y + g.track_h, th.bodyDark, th.track));
  return c;
}
function faderCap(g: FGeo, th: Theme): Canvas {
  const w = g.cap_len, h = g.cap_th;
  const c = new Canvas(w + 2, h + 4);
  rrect(c, 1, 3, w, h, 5.0, withAlpha(th.outline, 170));
  rrect(c, 1, 1, w, h, 5.0, vgrad(1, 1 + h, th.thumbLight, th.thumbDark));
  rrectOutline(c, 1, 1, w, h, 5.0, 1.0, withAlpha(th.outline, 180));
  const cx = 1 + w / 2.0;
  capsule(c, cx, 1 + h * 0.28, cx, 1 + h * 0.72, 2.0, th.accentDark);
  capsule(c, cx, 1 + h * 0.28, cx, 1 + h * 0.72, 1.4, th.accent);
  return c;
}
function faderFrame(staticC: Canvas, cap: Canvas, g: FGeo, t: number, th: Theme, bipolar: boolean): Canvas {
  const c = staticC.copy();
  const x = g.from + (g.to - g.from) * t;
  const y = g.mid - g.track_h / 2.0 + 2;
  const fh = g.track_h - 4;
  if (bipolar) {
    const mid = (g.from + g.to) / 2.0;
    capsule(c, mid, y - 4, mid, y + fh + 4, 2.0, th.thumbDark);
    const lo = Math.min(mid, x), hi = Math.max(mid, x);
    if (hi - lo > 0.5) rrect(c, lo, y, hi - lo, fh, 2.0, th.accent);
  } else {
    if (x - g.from > 0.5) rrect(c, g.from - 2, y, x - g.from + 2, fh, 2.0, th.accent);
  }
  c.blit(cap, pyRound(x - cap.w / 2.0), pyRound(g.mid - cap.h / 2.0));
  return c;
}
function transpose(canvas: Canvas): Canvas {
  const out = new Canvas(canvas.h, canvas.w);
  for (let y = 0; y < canvas.h; y++)
    for (let x = 0; x < canvas.w; x++) {
      const dst = ((canvas.w - 1 - x) * out.w + y) * 4;
      const src = (y * canvas.w + x) * 4;
      out.px[dst] = canvas.px[src];
      out.px[dst + 1] = canvas.px[src + 1];
      out.px[dst + 2] = canvas.px[src + 2];
      out.px[dst + 3] = canvas.px[src + 3];
    }
  return out;
}
function renderFader(length: number, thickness: number, frames: number, th: Theme, bipolar: boolean, vertical: boolean): Buffer[] {
  const g = faderGeometry(length, thickness);
  const staticC = faderStatic(g, th), cap = faderCap(g, th);
  const rows: Buffer[] = [];
  for (let i = 0; i < frames; i++) {
    const frame = faderFrame(staticC, cap, g, i / (frames - 1.0), th, bipolar);
    rows.push(...(vertical ? transpose(frame) : frame).rows());
  }
  return rows;
}

// ---- Switches and buttons -----------------------------------------------------------------------
function renderToggle(th: Theme, on: boolean): [Buffer[], number] {
  const w = 64, h = 32;
  const c = new Canvas(w, h);
  rrect(c, 1, 2, w - 2, h - 3, (h - 3) / 2.0, withAlpha(th.outline, 150));
  const track = on ? th.accent : th.track;
  rrect(c, 1, 1, w - 2, h - 3, (h - 3) / 2.0, vgrad(1, h - 2, mix(track, th.outline, 0.25), track));
  rrectOutline(c, 1, 1, w - 2, h - 3, (h - 3) / 2.0, 1.0, withAlpha(th.outline, 200));
  const r = (h - 3) / 2.0 - 3.0;
  const cx = on ? w - 1 - r - 4.0 : 1 + r + 4.0;
  const cy = 1 + (h - 3) / 2.0;
  circle(c, cx, cy + 1.0, r, withAlpha(th.outline, 150));
  circle(c, cx, cy, r, vgrad(cy - r, cy + r, th.thumbLight, on ? th.thumb : th.thumbDark));
  return [c.rows(), w];
}
function renderButton(th: Theme, on: boolean, w = 120, h = 44, led = true): [Buffer[], number] {
  const c = new Canvas(w, h);
  const rad = 8.0;
  rrect(c, 1, 3, w - 2, h - 4, rad, withAlpha(th.outline, 150));
  if (on && !led) rrect(c, 1, 1, w - 2, h - 4, rad, vgrad(1, h - 3, th.accent, th.accentDark));
  else rrect(c, 1, 1, w - 2, h - 4, rad, vgrad(1, h - 3, th.bodyLight, th.body));
  rrectOutline(c, 1, 1, w - 2, h - 4, rad, 1.0, on ? th.accent : withAlpha(th.outline, 220));
  if (led) {
    const lx = 11, ly = (h - 4) / 2.0 + 1 - 9, lw = 6, lh = 18;
    if (on) rrect(c, lx - 3, ly - 3, lw + 6, lh + 6, 6.0, th.accentGlow);
    rrect(c, lx, ly, lw, lh, 3.0, on ? th.accent : th.ledOff);
  }
  return [c.rows(), w];
}

// ---- Kit assembly -------------------------------------------------------------------------------
const FRAMES = 127;
type AssetEntry = { render: (th: Theme) => Buffer[]; size: [number, number]; frames: number };

export function assetTable(): Record<string, AssetEntry> {
  const t: Record<string, AssetEntry> = {};
  t.knob_uni = { render: (th) => renderKnob(90, FRAMES, th, false), size: [90, 90], frames: FRAMES };
  t.knob_bi = { render: (th) => renderKnob(90, FRAMES, th, true), size: [90, 90], frames: FRAMES };
  t.knob_small_uni = { render: (th) => renderKnob(56, FRAMES, th, false), size: [56, 56], frames: FRAMES };
  t.knob_small_bi = { render: (th) => renderKnob(56, FRAMES, th, true), size: [56, 56], frames: FRAMES };
  t.fader_h_uni = { render: (th) => renderFader(248, 36, FRAMES, th, false, false), size: [248, 36], frames: FRAMES };
  t.fader_h_bi = { render: (th) => renderFader(248, 36, FRAMES, th, true, false), size: [248, 36], frames: FRAMES };
  t.fader_v_uni = { render: (th) => renderFader(160, 36, FRAMES, th, false, true), size: [36, 160], frames: FRAMES };
  t.fader_v_bi = { render: (th) => renderFader(160, 36, FRAMES, th, true, true), size: [36, 160], frames: FRAMES };
  t.toggle_on = { render: (th) => renderToggle(th, true)[0], size: [64, 32], frames: 1 };
  t.toggle_off = { render: (th) => renderToggle(th, false)[0], size: [64, 32], frames: 1 };
  t.button_on = { render: (th) => renderButton(th, true)[0], size: [120, 44], frames: 1 };
  t.button_off = { render: (th) => renderButton(th, false)[0], size: [120, 44], frames: 1 };
  for (const [n, w] of [[2, 122], [3, 80], [4, 58]] as [number, number][]) {
    t[`seg${n}_on`] = { render: (th) => renderButton(th, true, w, 40, false)[0], size: [w, 40], frames: 1 };
    t[`seg${n}_off`] = { render: (th) => renderButton(th, false, w, 40, false)[0], size: [w, 40], frames: 1 };
  }
  return t;
}

export function manifest(themeName: string, th: Theme, assets: Record<string, AssetEntry>): string {
  const colours: Record<string, string> = {};
  for (const [k, v] of Object.entries(th)) colours[k] = argbText(v);
  const assetMap: Record<string, { file: string; width: number; height: number; frames: number }> = {};
  for (const [name, a] of Object.entries(assets))
    assetMap[name] = { file: name + ".png", width: a.size[0], height: a.size[1], frames: a.frames };
  const obj = {
    kitVersion: KIT_VERSION,
    theme: themeName,
    colours,
    assets: assetMap,
    notes: "Film strips are vertical, frame 0 = minimum at the top. Draw each asset at its native size: the MPC does not scale film-strip frames or button images.",
  };
  return JSON.stringify(obj, null, 2) + "\n";
}

export type RenderedKit = {
  theme: Theme;
  pngs: Record<string, Buffer>; // name -> PNG file bytes
  manifestJson: string;
};

/** Faithful port of make_ui_kit.render_kit: returns every asset's PNG bytes and the kit.json text. */
export function renderKit(themeName = "mpc-red", accent?: string | null, only?: string[] | null): RenderedKit {
  const th = makeTheme(themeName, accent);
  const assets = assetTable();
  let names = Object.keys(assets);
  if (only) {
    const bad = only.filter((n) => !(n in assets));
    if (bad.length) throw new Error(`unknown asset(s): ${bad.join(", ")}`);
    names = only.slice();
  }
  const pngs: Record<string, Buffer> = {};
  for (const name of names) {
    const { render, size } = assets[name];
    pngs[name] = writePngBytes(size[0], render(th));
  }
  return { theme: th, pngs, manifestJson: manifest(themeName, th, assets) };
}
