// previewSvg.ts — the preview raster BACKEND (extension; plan "Ledger 2").
//
// Turns the backend-agnostic draw ops from preview.ts into an SVG document. SVG is what Electron's
// Chromium rasterises for the headless preview capture, and the same markup drives the live editor
// canvas — so there is one renderer, two uses (the plan's key win over v1's Docker+Chromium). This
// file is pure string-building and fully testable without a browser; pixels come from Chromium/resvg.
//
// Filmstrip frames: a kit PNG is a vertical strip of N frames, each `h` tall (the control cell height).
// Frame f is shown by drawing the whole strip offset up by f·h and clipping to the cell — exactly how
// the MPC samples a film strip. Generic (non-kit) knob/bar ops are drawn as simple vectors.

import type { DrawOp } from "./preview.ts";
import { SCREEN_W, SCREEN_H } from "./preview.ts";
import { knobLookSvg, LOOK_DEFS, KNOB_LOOKS } from "./looks.ts";

export interface SvgOptions {
  width?: number;
  height?: number;
  // Map a kit image filename → its data: URI (or any href). Without an entry, the bare filename is
  // used as the href (resolved relative to the SVG). Lets a caller embed the real kit PNGs.
  imageHref?: (src: string) => string;
  background?: string; // ARGB; drawn under everything (defaults to transparent)
}

// ARGB "aarrggbb" → { hex: "#rrggbb", alpha: 0..1 }.
function argb(c: string): { hex: string; alpha: number } {
  const s = (c || "").padStart(8, "0");
  const a = parseInt(s.slice(0, 2), 16);
  return { hex: "#" + s.slice(2), alpha: (isNaN(a) ? 255 : a) / 255 };
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function anchor(justify: string): string {
  if (/right/i.test(justify)) return "end";
  if (/centred|center|centre/i.test(justify)) return "middle";
  return "start";
}

export function renderSvg(ops: DrawOp[], opts: SvgOptions = {}): string {
  const W = opts.width ?? SCREEN_W;
  const H = opts.height ?? SCREEN_H;
  const href = opts.imageHref ?? ((s: string) => s);
  const body: string[] = [];
  const clips: string[] = [];
  let clipId = 0;
  let usesLook = false;

  if (opts.background) {
    const { hex, alpha } = argb(opts.background);
    body.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${hex}" fill-opacity="${alpha}"/>`);
  }

  for (const o of ops) {
    if (o.op === "rect") {
      const { hex, alpha } = argb(o.colour);
      body.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="${hex}" fill-opacity="${alpha}"/>`);
    } else if (o.op === "image") {
      const id = `c${clipId++}`;
      clips.push(`<clipPath id="${id}"><rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}"/></clipPath>`);
      const stripH = o.h * o.frames;
      const iy = o.y - o.frame * o.h;
      body.push(
        `<image href="${esc(href(o.src))}" x="${o.x}" y="${iy}" width="${o.w}" height="${stripH}" preserveAspectRatio="none" clip-path="url(#${id})"/>`
      );
    } else if (o.op === "meter") {
      // the unlit track, then the lit picture revealed from the low end of its direction up to the value
      const v = Math.max(0, Math.min(1, o.value));
      const id = `c${clipId++}`;
      const fw = o.w * v, fh = o.h * v;
      const box = o.direction === "Right" ? [o.x, o.y, fw, o.h] : o.direction === "Left" ? [o.x + o.w - fw, o.y, fw, o.h] : o.direction === "Down" ? [o.x, o.y, o.w, fh] : [o.x, o.y + o.h - fh, o.w, fh];
      clips.push(`<clipPath id="${id}"><rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}"/></clipPath>`);
      body.push(`<image href="${esc(href(o.off))}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" preserveAspectRatio="none"/>` +
        `<image href="${esc(href(o.on))}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" preserveAspectRatio="none" clip-path="url(#${id})"/>`);
    } else if (o.op === "text") {
      const { hex, alpha } = argb(o.colour);
      const an = anchor(o.justify);
      const tx = an === "end" ? o.x + o.w : an === "middle" ? o.x + o.w / 2 : o.x;
      const vcentred = /verticallyCentred/i.test(o.justify);
      const ty = vcentred ? o.y + o.h / 2 : o.y + o.height; // baseline
      body.push(
        `<text x="${tx}" y="${ty}" font-family="${esc(o.font)}, Roboto, sans-serif" font-size="${o.height}" ` +
          `fill="${hex}" fill-opacity="${alpha}" text-anchor="${an}"${vcentred ? ' dominant-baseline="central"' : ""}>${esc(o.text)}</text>`
      );
    } else if (o.op === "knob") {
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = Math.min(o.w, o.h) / 2 - 2;
      // An opt-in LOOK draws a styled hardware knob; otherwise the plain generic knob.
      if (o.look && o.look in KNOB_LOOKS) {
        usesLook = true;
        body.push(knobLookSvg(o.look, cx, cy, r, o.value));
        continue;
      }
      // generic knob: body circle + a pointer at the value angle (270° sweep, 0 at min).
      const sweep = (270 * Math.PI) / 180;
      const a = -sweep / 2 + sweep * o.value;
      const px = cx + Math.sin(a) * r * 0.85, py = cy - Math.cos(a) * r * 0.85;
      body.push(
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#2a2a2d" stroke="#0e0e0f"/>` +
          `<line x1="${cx.toFixed(2)}" y1="${cy.toFixed(2)}" x2="${px.toFixed(2)}" y2="${py.toFixed(2)}" stroke="#f2f2f2" stroke-width="${Math.max(2, r * 0.12).toFixed(2)}" stroke-linecap="round"/>`
      );
    } else if (o.op === "bar" && o.vertical) {
      // vertical colour bar (repeat strips): fills from the bottom, outlined so neighbours stay distinct
      const fh = Math.max(0, Math.min(1, o.value)) * o.h;
      body.push(
        `<rect x="${o.x + 0.5}" y="${o.y + 0.5}" width="${o.w - 1}" height="${o.h - 1}" fill="#3a3a3d" stroke="#6a6a6c"/>` +
          `<rect x="${o.x + 1}" y="${(o.y + o.h - fh).toFixed(2)}" width="${o.w - 2}" height="${fh.toFixed(2)}" fill="#d31145"/>`
      );
    } else if (o.op === "bar") {
      const fill = Math.max(0, Math.min(1, o.value)) * o.w;
      body.push(
        `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="#434347"/>` +
          `<rect x="${o.x}" y="${o.y}" width="${fill.toFixed(2)}" height="${o.h}" fill="#d31145"/>`
      );
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    (usesLook ? LOOK_DEFS : "") +
    (clips.length ? `<defs>${clips.join("")}</defs>` : "") +
    body.join("") +
    `</svg>`
  );
}
