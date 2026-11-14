// meterArt.ts — the two pictures a Meter widget needs, drawn at the control's own size: an unlit track
// and a lit bar (Akai ui-reference §6.15: `inactiveImage` = the full meter unlit; `peakImage` is revealed up
// to the value). Plain rounded-corner rectangles in the page colours, so they look right with any kit.
import { writePngBytes } from "./uiKit.ts";

export const meterAssetNames = (w: number, h: number) => ({ off: `meter_${w}x${h}_off`, on: `meter_${w}x${h}_on` });

const rgba = (aarrggbb: string): [number, number, number, number] => {
  const h = aarrggbb.padStart(8, "f");
  return [parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16), parseInt(h.slice(0, 2), 16)];
};

function draw(w: number, h: number, fill: string, edge: string | null): Buffer {
  const r = Math.min(6, Math.floor(Math.min(w, h) / 2));
  const f = rgba(fill), e = edge ? rgba(edge) : null;
  const inside = (x: number, y: number, inset: number): boolean => {
    const cx = x < r ? r : x >= w - r ? w - r - 1 : x, cy = y < r ? r : y >= h - r ? h - r - 1 : y;
    const dx = x - cx, dy = y - cy;
    const rr = Math.max(0, r - inset);
    return x >= inset && y >= inset && x < w - inset && y < h - inset && dx * dx + dy * dy <= rr * rr + (rr === 0 ? 0 : 0.5);
  };
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(w * 4);
    for (let x = 0; x < w; x++) {
      let c: [number, number, number, number] | null = null;
      if (e && inside(x, y, 0) && !inside(x, y, 1)) c = e;
      else if (inside(x, y, e ? 1 : 0)) c = f;
      if (c) row.set(c, x * 4);
    }
    rows.push(row);
  }
  return writePngBytes(w, rows);
}

/** Unlit track (dark with a thin edge) and lit bar (the accent colour). Sizes are clamped to 8..1280 × 8..628. */
export function renderMeter(w: number, h: number, accent: string, edge: string): { off: Buffer; on: Buffer } {
  const cw = Math.max(8, Math.min(1280, Math.round(w))), ch = Math.max(8, Math.min(628, Math.round(h)));
  return { off: draw(cw, ch, "ff2a2a2c", edge), on: draw(cw, ch, accent, null) };
}
