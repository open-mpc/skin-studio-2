// panelDetect.ts — find the round controls (knobs, buttons, jacks) in a picture of a hardware panel (EXTENSION).
//
// Pure and deterministic: takes a greyscale image (one byte per pixel) and returns circles. The renderer decodes the
// picture with a canvas; tests feed synthetic images. Same method as mpc-vst-plugins' tools/panel_import.py:
// Sobel edges → circle Hough transform along each edge's gradient (proposes centres) → rim check (keeps circles whose
// rim shows a radial edge in most directions) → overlap suppression. Idea from sunskiefer/BUSTEDXXL (reimplemented).

export interface Circle { cx: number; cy: number; r: number; score: number }
export interface PanelControl extends Circle { kind: "knob" | "small" }

export interface DetectOptions {
  rmin?: number; // smallest radius, image px (default 7)
  rmax?: number; // largest radius, image px (default 35)
  minScore?: number; // share of the rim that must show an edge, 0..1 (default 0.6)
}

/** Greyscale (Rec. 601 luma) from RGBA bytes, e.g. a canvas ImageData's data. */
export function toGray(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  return g;
}

/** Circles in a greyscale image, best first. Coordinates and radii in the image's pixels. */
export function detectCircles(gray: Uint8Array, w: number, h: number, o: DetectOptions = {}): Circle[] {
  const rmin = Math.max(3, Math.round(o.rmin ?? 7));
  const rmax = Math.max(rmin + 1, Math.round(o.rmax ?? 35));
  const minScore = o.minScore ?? 0.6;
  const n = w * h;
  const mag = new Float32Array(n), gxs = new Float32Array(n), gys = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (dx: number, dy: number) => gray[(y + dy) * w + x + dx];
      const gx = p(1, -1) + 2 * p(1, 0) + p(1, 1) - (p(-1, -1) + 2 * p(-1, 0) + p(-1, 1));
      const gy = p(-1, 1) + 2 * p(0, 1) + p(1, 1) - (p(-1, -1) + 2 * p(0, -1) + p(1, -1));
      const i = y * w + x;
      mag[i] = Math.hypot(gx, gy); gxs[i] = gx; gys[i] = gy;
    }
  }
  const nz = Array.from(mag).filter((m) => m > 0).sort((a, b) => a - b);
  if (!nz.length) return [];
  // the strongest 15% of edges, but never above a third of the very strongest: soft rims (jacks) next to hard ones count
  const thr = Math.max(40, Math.min(nz[Math.floor(nz.length * 0.85)], nz[Math.floor(nz.length * 0.99)] / 3));
  const nr = rmax - rmin + 1;
  const acc = new Uint16Array(n * nr);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, m = mag[i];
      if (m < thr) continue;
      const ux = gxs[i] / m, uy = gys[i] / m;
      for (let k = 0; k < nr; k++) {
        const r = rmin + k;
        for (const s of [1, -1]) { // the centre lies along the gradient, either way (dark or light control)
          const cx = Math.floor(x + s * ux * r + 0.5), cy = Math.floor(y + s * uy * r + 0.5);
          if (cx >= 0 && cx < w && cy >= 0 && cy < h) { const a = (cy * w + cx) * nr + k; if (acc[a] < 65535) acc[a]++; }
        }
      }
    }
  }
  const cands: [number, number, number, number][] = []; // score, x, y, r
  for (let c = 0; c < n; c++) {
    let best = 0, bk = 0;
    for (let k = 0; k < nr; k++) {
      const v = acc[c * nr + k];
      if (v) { const sc = v / (2 * Math.PI * (rmin + k)); if (sc > best) { best = sc; bk = k; } }
    }
    if (best >= 0.15) cands.push([best, c % w, Math.floor(c / w), rmin + bk]); // only proposes; ring() decides
  }
  cands.sort((a, b) => b[0] - a[0] || a[2] - b[2] || a[1] - b[1]);
  const ring = (x: number, y: number, r: number, steps = 72): number => {
    let hit = 0;
    for (let a = 0; a < steps; a++) {
      const ca = Math.cos((2 * Math.PI * a) / steps), sa = Math.sin((2 * Math.PI * a) / steps);
      for (const dr of [0, -1, 1]) {
        const ex = Math.floor(x + ca * (r + dr) + 0.5), ey = Math.floor(y + sa * (r + dr) + 0.5);
        if (ex < 0 || ex >= w || ey < 0 || ey >= h) continue;
        const i = ey * w + ex, m = mag[i];
        if (m >= thr * 0.5 && Math.abs(gxs[i] * ca + gys[i] * sa) >= 0.6 * m) { hit++; break; }
      }
    }
    return hit / steps;
  };
  const scored: [number, number, number, number][] = [];
  for (const [, x, y, r] of cands.slice(0, 4000)) {
    let best = -1, br = r;
    for (const rr of [r - 1, r, r + 1]) if (rr >= rmin) { const s = ring(x, y, rr); if (s > best) { best = s; br = rr; } }
    if (best >= minScore) scored.push([best, x, y, br]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[2] - b[2] || a[1] - b[1]);
  const found: Circle[] = [];
  for (const [score, x, y, r] of scored)
    if (found.every((f) => Math.hypot(x - f.cx, y - f.cy) > 0.8 * Math.max(r, f.r))) found.push({ cx: x, cy: y, r, score: Math.min(1, score) });
  return found;
}

/** knob for the large group, small (jacks, LEDs, screws) below the widest jump (at least 1.4x) in the sizes found. */
export function classify(circles: Circle[]): PanelControl[] {
  const rs = circles.map((c) => c.r).sort((a, b) => a - b);
  let cut = 0, gap = 1;
  for (let i = 1; i < rs.length; i++) if (rs[i] / rs[i - 1] > gap) { gap = rs[i] / rs[i - 1]; cut = rs[i]; }
  return circles.map((c) => ({ ...c, kind: gap < 1.4 || c.r >= cut ? "knob" : "small" }));
}

/** Rows (centres within `tol` px) top to bottom, left to right inside a row. */
export function readingOrder<T extends { cx: number; cy: number }>(items: T[], tol: number): T[] {
  const rows: T[][] = [];
  for (const it of [...items].sort((a, b) => a.cy - b.cy)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].cy - it.cy) <= tol) last.push(it); else rows.push([it]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.cx - b.cx));
}

/**
 * The whole step on a picture already fitted into the 1280×628 page: detection runs on a half-size copy (640 px wide)
 * and results come back in page pixels, in reading order. `rgba` is the page-size picture's bytes.
 */
export function findPanelControls(rgba: Uint8Array | Uint8ClampedArray, w = 1280, h = 628, o: { rmin?: number; rmax?: number; minScore?: number } = {}): PanelControl[] {
  const g = toGray(rgba, w, h);
  const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
  const half = new Uint8Array(hw * hh); // 2×2 box average
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < hw; x++) {
      const i = 2 * y * w + 2 * x;
      half[y * hw + x] = (g[i] + g[i + 1] + g[i + w] + g[i + w + 1] + 2) >> 2;
    }
  const found = detectCircles(half, hw, hh, { rmin: (o.rmin ?? 14) / 2, rmax: (o.rmax ?? 70) / 2, minScore: o.minScore });
  const ctl = classify(found).map((c) => ({ ...c, cx: c.cx * 2 + 1, cy: c.cy * 2 + 1, r: c.r * 2 }));
  return readingOrder(ctl, Math.max(20, ...ctl.map((c) => c.r)));
}
