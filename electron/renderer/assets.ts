// Renderer-side image production (needs a canvas, which Chromium provides): turns a built-in look, a
// still image or a filmstrip into a PNG asset for the Doc. Pure browser code; the Doc ops that store and
// use the result are tested headlessly in src/app/doc.ts.
import { knobLookSvg, LOOK_DEFS, KNOB_LOOKS } from "../../src/core/looks.ts";

export interface Made { png: string; frames: number; w: number; h: number }
export const LOOK_NAMES = Object.keys(KNOB_LOOKS);

const loadImg = (src: string): Promise<HTMLImageElement> =>
  new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("could not read that image")); i.src = src; });
const b64 = (c: HTMLCanvasElement) => c.toDataURL("image/png").split(",")[1];
const fileUrl = (f: File) => URL.createObjectURL(f);

/** A built-in knob look rendered as a vertical filmstrip (minimum first), `frames` frames of size×size. */
export async function lookStrip(look: string, size = 96, frames = 64): Promise<Made> {
  const c = document.createElement("canvas"); c.width = size; c.height = size * frames;
  const ctx = c.getContext("2d")!;
  for (let f = 0; f < frames; f++) {
    const v = f / (frames - 1);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${LOOK_DEFS}${knobLookSvg(look, size / 2, size / 2, size / 2 - 3, v)}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    ctx.drawImage(await loadImg(url), 0, f * size, size, size);
    URL.revokeObjectURL(url);
  }
  return { png: b64(c), frames, w: size, h: size };
}

/** A still image (PNG/JPG/SVG/WebP) as-is. */
export async function stillImage(file: File): Promise<Made> {
  const img = await loadImg(fileUrl(file));
  const c = document.createElement("canvas"); c.width = img.naturalWidth || 256; c.height = img.naturalHeight || 256;
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return { png: b64(c), frames: 1, w: c.width, h: c.height };
}

/**
 * A panel picture fitted into the 1280×628 page (aspect kept, centred on black): the PNG for the background and the
 * page-size RGBA bytes for core/panelDetect.
 */
export async function panelPicture(file: File): Promise<{ png: string; rgba: Uint8ClampedArray }> {
  const img = await loadImg(fileUrl(file));
  const w0 = img.naturalWidth || 1280, h0 = img.naturalHeight || 628;
  const s = Math.min(1280 / w0, 628 / h0), w = Math.round(w0 * s), h = Math.round(h0 * s);
  const c = document.createElement("canvas"); c.width = 1280; c.height = 628;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1280, 628);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, Math.floor((1280 - w) / 2), Math.floor((628 - h) / 2), w, h);
  return { png: b64(c), rgba: ctx.getImageData(0, 0, 1280, 628).data };
}

/** A knob drawn pointing up, turned through 270° (v1 `img=`): `frames` rotated copies, minimum first. */
export async function rotatedKnob(file: File, size = 96, frames = 64): Promise<Made> {
  const img = await loadImg(fileUrl(file));
  const c = document.createElement("canvas"); c.width = size; c.height = size * frames;
  const ctx = c.getContext("2d")!;
  for (let f = 0; f < frames; f++) {
    ctx.save();
    ctx.translate(size / 2, f * size + size / 2);
    ctx.rotate(((-135 + (270 * f) / (frames - 1)) * Math.PI) / 180);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  return { png: b64(c), frames, w: size, h: size };
}

/** An uploaded filmstrip: `frames` frames stacked down (or across — detected from the shape). */
export async function uploadedStrip(file: File, frames: number): Promise<Made> {
  const img = await loadImg(fileUrl(file));
  const across = img.naturalWidth > img.naturalHeight && img.naturalWidth / frames >= img.naturalHeight * 0.5 && img.naturalWidth / img.naturalHeight > frames / 2;
  const fw = across ? Math.floor(img.naturalWidth / frames) : img.naturalWidth;
  const fh = across ? img.naturalHeight : Math.floor(img.naturalHeight / frames);
  const c = document.createElement("canvas"); c.width = fw; c.height = fh * frames;
  const ctx = c.getContext("2d")!;
  for (let f = 0; f < frames; f++)
    across ? ctx.drawImage(img, f * fw, 0, fw, fh, 0, f * fh, fw, fh) : ctx.drawImage(img, 0, f * fh, fw, fh, 0, f * fh, fw, fh);
  return { png: b64(c), frames, w: fw, h: fh };
}

/** SVG text (a page's artwork) rendered to a w×h PNG with a transparent background. */
export async function svgToPng(svg: string, w = 1280, h = 628): Promise<Made> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = await loadImg(url);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return { png: b64(c), frames: 1, w, h };
  } finally { URL.revokeObjectURL(url); }
}
