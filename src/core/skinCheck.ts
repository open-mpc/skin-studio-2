// skinCheck.ts — faithful TypeScript port of mpc-vst-plugins tools/skin_check.py (v1).
//
// NO-REGRESSION CONTRACT: this module must reproduce v1's findings byte-for-byte, including message
// wording, number formatting and ordering. It is verified against frozen v1 output in
// test/golden/skin-check.goldens.json (see test/skinCheck.golden.ts). Do not "improve" the messages
// or formatting here — change v1 first, re-freeze the goldens, then mirror it.
//
// Checks a built skin (what MPC loads) for mistakes the layout checks can't see, per page:
//   TOUCH  two controls whose touch boxes overlap while both are visible
//   EDGE   a control's box past the 1280 x 628 plugin area
//   QLINK  a Q-Link on a parameter no control on that page is bound to
//   OPTS   a switch group missing some of its options on a page

import * as fs from "fs";
import * as path from "path";

export const W = 1280;
export const H = 628;
const MIN_OVERLAP = 6; // px each way: a hairline shared edge is fine

type Rect = [number, number, number, number];
type Vis = number[]; // sorted additionalInvalidatingHandles; [] == Python's empty tuple

// ---- Python-compatible formatting helpers -------------------------------------------------------

// Mirror Python's "%g": 6 significant figures, trailing zeros and dot stripped.
// Skin coordinates live in [0, 1280], so the exponential range is never reached; handle it anyway.
export function g(v: number): string {
  if (!isFinite(v)) return v > 0 ? "inf" : v < 0 ? "-inf" : "nan";
  if (v === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(v)));
  if (exp < -4 || exp >= 6) {
    let s = v.toExponential(5); // 6 sig figs
    let [m, e] = s.split("e");
    if (m.includes(".")) m = m.replace(/0+$/, "").replace(/\.$/, "");
    const en = parseInt(e, 10);
    return m + "e" + (en < 0 ? "-" : "+") + String(Math.abs(en)).padStart(2, "0");
  }
  let s = v.toPrecision(6);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

// Mirror Python's repr of a sorted list of ints, e.g. [0, 1, 3].
function reprIntList(xs: number[]): string {
  return "[" + xs.join(", ") + "]";
}

// ---- JSON accessors (mirror skin_check.py's shapes) ---------------------------------------------

function rect(b: string): Rect {
  const [x, y, w, h] = b.split(/\s+/).map((v) => parseFloat(v));
  return [x, y, w, h];
}

function paramOf(c: any): number | null {
  const map = c?.["handle remapping"]?.map ?? [];
  for (const m of map) {
    if (m?.key === "Data" && String(m?.value ?? "").startsWith("Parameter ")) {
      return parseInt(String(m.value).split(/\s+/)[1], 10);
    }
  }
  return null;
}

function* pages(tui: any): Generator<[any, any[], Record<string, any>]> {
  const pd = tui.pageData;
  const defs: Record<string, any> = {};
  for (const d of pd.componentDefinitions?.localComponentDefinitions ?? []) defs[d.key] = d.value;
  for (const t of pd.tabs) {
    const page = t.componentDefinition ?? defs[t.componentName] ?? {};
    yield [t, page.componentsData ?? [], defs];
  }
}

function visOf(c: any): Vis {
  return [...(c?.bounds?.additionalInvalidatingHandles ?? [])].sort((a: number, b: number) => a - b);
}

function visEqual(a: Vis, b: Vis): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function visNonEmpty(a: Vis): boolean {
  return a.length > 0;
}

// Compare two vis-tuples lexicographically (Python tuple ordering) for stable sorting.
function visCmp(a: Vis, b: Vis): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

// ---- the check ----------------------------------------------------------------------------------

export function checkObjects(tui: any, ql: any): string[] {
  const qpages = new Map<string, Record<string, any>>();
  for (const q of ql?.["Screen Mode Q-Links"]?.map ?? []) {
    qpages.set(`${q.Tab}\u0000${q.SubTab}`, q["Q-Links"]);
  }
  const out: string[] = [];

  for (const [t, kids, defs] of pages(tui)) {
    const where = t.tabName;
    const controls: Array<[string, number, Rect, Vis]> = [];

    for (const c of kids) {
      const cd = c.componentData;
      const p = paramOf(c);
      if (p === null || cd.type === "Image" || cd.type === "Label") continue;
      const acts = defs[cd.type]?.actions ?? [];
      if (!acts.length) continue; // display-only: no touch
      const [x, y, w, h] = rect(c.bounds.bounds);
      const vis = visOf(c);
      controls.push([cd.name, p, [x, y, w, h], vis]);
      if (x < 0 || y < 0 || x + w > W || y + h > H) {
        out.push(`${where}: EDGE  ${cd.name} (${g(x)} ${g(y)} ${g(w)} ${g(h)}) is past the ${W}x${H} plugin area`);
      }
    }

    for (let i = 0; i < controls.length; i++) {
      const [n1, p1, r1, v1] = controls[i];
      for (let j = i + 1; j < controls.length; j++) {
        const [n2, p2, r2, v2] = controls[j];
        if (!visEqual(v1, v2) && visNonEmpty(v1) && visNonEmpty(v2)) continue; // different modes
        const ox = Math.min(r1[0] + r1[2], r2[0] + r2[2]) - Math.max(r1[0], r2[0]);
        const oy = Math.min(r1[1] + r1[3], r2[1] + r2[3]) - Math.max(r1[1], r2[1]);
        if (ox > MIN_OVERLAP && oy > MIN_OVERLAP && p1 !== p2) {
          out.push(`${where}: TOUCH ${n1} and ${n2} overlap by ${g(ox)}x${g(oy)} px`);
        }
      }
    }

    // OPTS: a switch group missing some of its options on this page.
    const groups = new Map<string, { n: number; ids: Set<number>; p: number; vis: Vis }>();
    for (const c of kids) {
      const p = paramOf(c);
      for (const sub of defs[c.componentData.type]?.componentsData ?? []) {
        const d = sub.componentData;
        if (p !== null && d.type === "Button" && (d.data?.numButtonsInGroup ?? 1) > 1) {
          const vis = visOf(c);
          const key = `${p}\u0000${vis.join(",")}`;
          let gy = groups.get(key);
          if (!gy) {
            gy = { n: d.data.numButtonsInGroup, ids: new Set<number>(), p, vis };
            groups.set(key, gy);
          }
          gy.ids.add(d.data.buttonId);
        }
      }
    }
    const sortedGroups = [...groups.values()].sort((a, b) => a.p - b.p || visCmp(a.vis, b.vis));
    for (const grp of sortedGroups) {
      const full = new Set<number>();
      for (let k = 0; k < grp.n; k++) full.add(k);
      const same = grp.ids.size === full.size && [...grp.ids].every((v) => full.has(v));
      if (!same) {
        const shown = [...grp.ids].sort((a, b) => a - b);
        out.push(`${where}: OPTS  parameter ${grp.p} shows options ${reprIntList(shown)} of 0..${grp.n - 1}`);
      }
    }

    // QLINK: a Q-Link on a parameter no control on this page is bound to.
    const bound = new Set<number>();
    for (const [, p] of controls) bound.add(p);
    for (const c of kids) {
      const p = paramOf(c);
      if (p !== null) bound.add(p);
      // EXTENSION: a Meter names its parameters directly (peak/rms handles) rather than through a remap
      if (c?.componentData?.type === "Meter")
        for (const h of [c.componentData.data?.peakHandle, c.componentData.data?.rmsHandle]) {
          const m = /^Parameter (\d+)$/.exec(String(h ?? ""));
          if (m) bound.add(parseInt(m[1], 10));
        }
    }
    const key = `${(t.fnKeyIndex ?? 0) + 1}\u0000${(t.fnKeySubIndex ?? 0) + 1}`;
    const q = qpages.get(key) ?? {};
    for (const slot of Object.keys(q).sort()) {
      const p = q[slot];
      if (typeof p === "number" && Number.isInteger(p) && p >= 0 && !bound.has(p)) {
        out.push(`${where}: QLINK ${slot} is on parameter ${p}, which no control on this page shows`);
      }
    }
  }
  return out;
}

export function check(skinDir: string): string[] {
  let dir = skinDir;
  if (!fs.existsSync(path.join(dir, "TUI.json"))) dir = path.join(dir, "Plugin Skins");
  const tui = JSON.parse(fs.readFileSync(path.join(dir, "TUI.json"), "utf8"));
  const ql = JSON.parse(fs.readFileSync(path.join(dir, "Q-Links.json"), "utf8"));
  return checkObjects(tui, ql);
}
