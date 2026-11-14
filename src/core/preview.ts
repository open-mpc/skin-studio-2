// preview.ts — the Akai-accurate preview CORE (extension; see plan "Ledger 2").
//
// Interprets a TUI.json tab into a flat list of draw ops (rect / filmstrip image / text) — what the
// MPC actually shows, drawn with the byte-exact kit PNGs from uiKit. This is the BASE preview (the
// force-shadow look is retired; v1's look library rides on top later as opt-in). Pure and deterministic:
// a raster/HTML backend (Electron's Chromium) consumes these ops; this file has no pixels.
//
// Increment 1 handles: tab background, recursion with bounds-offset + handle remapping, Label
// (Name/Value/Text), and FilmStrip Knob (value → frame). Faders/switches/buttons/overlays follow.

export const SCREEN_W = 1280;
export const SCREEN_H = 628;

export type DrawOp =
  | { op: "rect"; x: number; y: number; w: number; h: number; colour: string }
  | { op: "image"; src: string; frame: number; frames: number; x: number; y: number; w: number; h: number }
  | { op: "text"; text: string; x: number; y: number; w: number; h: number; font: string; height: number; colour: string; justify: string; case: string }
  // Generic (non-kit) controls the firmware draws itself; the backend renders these, the interpreter
  // just captures geometry + value so looks stay in one place.
  | { op: "knob"; x: number; y: number; w: number; h: number; value: number; bipolar: boolean; look?: string }
  | { op: "meter"; off: string; on: string; x: number; y: number; w: number; h: number; value: number; direction: string }
  | { op: "bar"; x: number; y: number; w: number; h: number; value: number; vertical?: boolean };

// A parameter as the preview needs it (from the gen_ui params.json: index, name, choices, default, display).
export interface PreviewParam {
  index: number;
  name: string;
  choices?: string[] | null;
  default?: number | null;
  display?: string;
}
// Optional live values (normalised 0..1) keyed by parameter index; defaults used when absent.
export type RenderState = Map<number, number>;

function parseBounds(s: unknown): [number, number, number, number] {
  const parts = String(s ?? "").trim().split(/\s+/).map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts[3] || 0];
}
function clampFrame(v: number, frames: number): number {
  const f = Math.round(v * (frames - 1));
  return Math.max(0, Math.min(frames - 1, f));
}

type Resolver = (handle: string) => string; // child handle -> global handle (e.g. "Data" -> "Parameter 2")

export class TuiPreview {
  private defs = new Map<string, any>();
  private byIndex = new Map<number, PreviewParam>();

  constructor(private tui: any, params: PreviewParam[], private state: RenderState = new Map()) {
    const local = tui?.pageData?.componentDefinitions?.localComponentDefinitions ?? [];
    for (const d of local) this.defs.set(d.key, d.value);
    for (const p of params) this.byIndex.set(p.index, p);
  }

  tabNames(): string[] {
    return (this.tui?.pageData?.tabs ?? []).map((t: any) => t.tabName);
  }

  /** Draw ops for tab `ti` (0-based), in paint order. */
  render(ti = 0): DrawOp[] {
    const tab = this.tui?.pageData?.tabs?.[ti];
    if (!tab) throw new Error(`no tab ${ti}`);
    const ops: DrawOp[] = [];
    const root = tab.componentDefinition;
    const bg = root?.backgroundData?.unfocussed?.colour;
    if (bg && bg !== "00000000") ops.push({ op: "rect", x: 0, y: 0, w: SCREEN_W, h: SCREEN_H, colour: bg });
    const repeats = Number(root?.repeats ?? 1);
    if (repeats > 1) {
      // A repeat strip (tab root with `repeats`): the children are drawn N times side by side, each copy
      // offset by the child's width, with {Increment:Base=n} in handles counting up from n.
      const kids = root?.componentsData ?? [];
      const step = Math.max(...kids.map((k: any) => parseBounds(k?.bounds?.bounds)[2]), 1);
      for (let k = 0; k < repeats; k++)
        for (const entry of kids)
          this.walkEntry(entry, k * step, 0, (h) => h.replace(/\{Increment(?::Base=(\d+))?\}/, (_m, b) => String(Number(b ?? 0) + k)), ops);
      return ops;
    }
    for (const entry of root?.componentsData ?? []) this.walkEntry(entry, 0, 0, (h) => h, ops);
    return ops;
  }

  private paramOf(resolve: Resolver): PreviewParam | null {
    const g = resolve("Data"); // e.g. "Parameter 2"
    const m = /^Parameter (\d+)$/.exec(g);
    if (!m) return null;
    return this.byIndex.get(Number(m[1])) ?? null;
  }
  // Continuous value, normalised 0..1 (for filmstrip frame / bar fill).
  private valueOf(p: PreviewParam | null): number {
    if (!p) return 0;
    const v = this.state.get(p.index);
    if (typeof v === "number") return v;
    return typeof p.default === "number" ? p.default : 0;
  }
  // Discrete option index. For a choice/bool param the `default` (and state) is the INDEX, not a
  // 0..1 fraction (replacementStrings gives value range 0..N-1), e.g. Division default 1.0 = "1/8".
  private indexOf(p: PreviewParam | null): number {
    if (!p) return 0;
    const n = p.choices?.length ?? 2;
    const v = this.state.get(p.index);
    const raw = typeof v === "number" ? v : typeof p.default === "number" ? p.default : 0;
    return Math.max(0, Math.min(n - 1, Math.round(raw)));
  }

  // visibleWhen: an entry carries IndexedEnabling/idx/n/Parameter X; it is shown only when that
  // discrete parameter's current index == idx. (ResetOnGestureEnd and other handles are ignored.)
  private visible(entry: any): boolean {
    for (const h of entry?.bounds?.additionalInvalidatingHandles ?? []) {
      const m = /^IndexedEnabling\/(\d+)\/(\d+)\/Parameter (\d+)$/.exec(h);
      if (m) {
        const idx = Number(m[1]);
        const ctrl = this.byIndex.get(Number(m[3])) ?? null;
        if (this.indexOf(ctrl) !== idx) return false;
      }
    }
    return true;
  }

  private walkEntry(entry: any, ox: number, oy: number, resolve: Resolver, ops: DrawOp[]): void {
    const cd = entry?.componentData;
    if (!cd) return;
    if (!this.visible(entry)) return; // hidden by visibleWhen
    const [bx, by] = parseBounds(entry?.bounds?.bounds);
    const [, , bw, bh] = parseBounds(entry?.bounds?.bounds);
    const x = ox + bx;
    const y = oy + by;

    // Compose a resolver for this entry's scope from its handle remapping.
    const map = new Map<string, string>();
    for (const m of entry?.["handle remapping"]?.map ?? []) map.set(m.key, m.value);
    const childResolve: Resolver = (h) => resolve(map.get(h) ?? h);

    const type: string = cd.type;
    const data = cd.data ?? {};

    // Custom component → recurse into its children with accumulated origin + handle scope.
    const def = this.defs.get(type);
    if (def) {
      for (const child of def.componentsData ?? []) this.walkEntry(child, x, y, childResolve, ops);
      return;
    }

    // Built-in leaf widgets.
    if (type === "Label") {
      const ts = data.textStyle ?? {};
      const p = this.paramOf(childResolve);
      let text = data.text;
      if (text === undefined) {
        if (data.type === "Name") text = p?.name ?? "";
        else if (data.type === "Value") text = p?.display ?? "";
        else text = "";
      }
      ops.push({
        op: "text", text: String(text), x, y, w: bw, h: bh,
        font: ts.font?.name ?? "Titillium Web", height: ts.font?.height ?? 30,
        colour: ts.colour ?? "ffffffff", justify: ts.justification ?? "left", case: ts.case ?? "Original",
      });
      return;
    }
    if (type === "Knob") {
      const p = this.paramOf(childResolve);
      if (data.knobType === "FilmStrip") {
        const frames = data.numFrames ?? 2;
        ops.push({ op: "image", src: data.filmStrip, frame: clampFrame(this.valueOf(p), frames), frames, x, y, w: bw, h: bh });
      } else {
        // generic (GenericLegacy) knob: the firmware draws it; capture value + polarity.
        ops.push({ op: "knob", x, y, w: bw, h: bh, value: this.valueOf(p), bipolar: data.polarity === "BiPolar" });
      }
      return;
    }
    if (type === "Button") {
      // Lit when the bound discrete param's current option index == this button's id.
      const p = this.paramOf(childResolve);
      const on = this.indexOf(p) === (data.buttonId ?? 0);
      const src = on ? data.onImage : data.offImage;
      if (src) ops.push({ op: "image", src, frame: 0, frames: 1, x, y, w: bw, h: bh });
      return;
    }
    if (type === "Slider") {
      const p = this.paramOf(childResolve);
      ops.push({ op: "bar", x, y, w: bw, h: bh, value: this.valueOf(p), ...(data.direction === "Vertical" ? { vertical: true } : {}) });
      return;
    }
    if (type === "Image") {
      if (data.imageType === "FilmStrip" && data.image) {
        // value picture: the frame follows the bound parameter (a choice's option index spans the strip)
        const p = this.paramOf(childResolve);
        const frames = Math.max(1, Number(data.numFrames ?? 1));
        const n = p?.choices?.length;
        const v = n && n > 1 ? this.indexOf(p) / (n - 1) : this.valueOf(p);
        ops.push({ op: "image", src: data.image, frame: clampFrame(v, frames), frames, x, y, w: bw, h: bh });
      } else if (data.image) ops.push({ op: "image", src: data.image, frame: 0, frames: 1, x, y, w: bw, h: bh });
      return;
    }
    if (type === "Meter") {
      const m = /^Parameter (\d+)$/.exec(resolve(String(data.peakHandle ?? "")));
      const p = m ? this.byIndex.get(Number(m[1])) ?? null : null;
      ops.push({ op: "meter", off: data.inactiveImage, on: data.peakImage, x, y, w: bw, h: bh, value: this.valueOf(p), direction: data.direction ?? "Up" });
      return;
    }
    // Focus is a selection ring and is not drawn.
  }
}
