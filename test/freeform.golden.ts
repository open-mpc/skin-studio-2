// Free-form layout + Q-Link groups (extension; the format allows any bounds — ui-reference §1.4).
// Legacy grid pages stay byte-identical (uiBuilder.golden); these gate the new path on behaviour.
import { generateFromControls, type KitInfo, type KitAssets } from "../src/core/uiBuilder.ts";
import * as fs from "fs";
import * as path from "path";
const here = path.dirname(new URL(import.meta.url).pathname);
const mpcRed = JSON.parse(fs.readFileSync(path.join(here, "golden/uigen/kit-manifest.mpc-red.json"), "utf8")) as { assets: Record<string, [string, number, [number, number]]> };
const resolveKit = (_: KitInfo): KitAssets => mpcRed.assets;
let fails = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) console.log(`  PASS  ${n}`); else { fails++; console.log(`  FAIL  ${n}${d ? " — " + d : ""}`); } };

const params = { params: ["A", "B", "C", "D", "E"].map((n, i) => ({ index: i, name: n, kind: "float", default: 0.5 })) };
const gen = (pages: any[]) => { const r = generateFromControls(params, pages, resolveKit); return { tui: JSON.parse(r.tui), ql: JSON.parse(r.qlinks) }; };
const entries = (t: any) => t.pageData.tabs[0].componentDefinition.componentsData;
const q = (ql: any, tab = 0) => ql["Screen Mode Q-Links"].map[tab]["Q-Links"];

console.log("free positions");
{
  const { tui, ql } = gen([{ name: "FREE", controls: [
    { param: "A", widget: "knob", bounds: [100, 60, 278, 107] },
    { param: "B", widget: "knob", bounds: [100, 200, 278, 107] },
    { param: "C", widget: "fader", bounds: [700, 300, 278, 107] },
  ] }]);
  const e = entries(tui);
  ok("entry uses the free bounds", e[0].bounds.bounds === "100 60 278 107" && e[2].bounds.bounds === "700 300 278 107");
  const m = q(ql);
  ok("default Q-Links: column-major from 13,9,5", m["Q-Link 13"] === 0 && m["Q-Link 9"] === 1 && m["Q-Link 5"] === 2, JSON.stringify(m));
  const rects = tui.pageData.tabs[0].qlinkBoundsData;
  ok("focus rect auto-fits the bank (bank0 = A,B,C), padded 12", rects.length === 1 && rects[0] === "88 48 902 371", JSON.stringify(rects));
}
console.log("explicit Q-Link sets");
{
  const { tui, ql } = gen([{ name: "X", controls: [{ param: "A", widget: "knob", bounds: [40, 40, 278, 107] }, { param: "B", widget: "knob", bounds: [340, 40, 278, 107] }],
    qlinks: ["B", null, null, "A"] }]);
  const m = q(ql);
  ok("explicit mapping honoured", m["Q-Link 1"] === 1 && m["Q-Link 4"] === 0 && m["Q-Link 13"] === -1, JSON.stringify(m));
  let threw = false; try { gen([{ name: "X", controls: [{ param: "A", widget: "knob", bounds: [0, 0, 278, 107] }], qlinks: ["Nope"] }]); } catch { threw = true; }
  ok("unknown qlink parameter rejected", threw);
  void tui;
}
console.log("explicit focus rectangles + validation");
{
  const { tui } = gen([{ name: "X", controls: [{ param: "A", widget: "knob", bounds: [0, 0, 278, 107] }], qlinkBounds: ["10 10 300 300"] }]);
  ok("explicit qlinkBounds emitted verbatim", JSON.stringify(tui.pageData.tabs[0].qlinkBoundsData) === '["10 10 300 300"]');
  let threw = false; try { gen([{ name: "X", controls: [{ param: "A", widget: "knob", bounds: [0, 0, 5] as any }] }]); } catch { threw = true; }
  ok("malformed bounds rejected", threw);
}
console.log("grid pages unchanged");
{
  const { tui, ql } = gen([{ name: "G", controls: [{ param: "A", widget: "knob" }, { param: "B", widget: "knob" }] }]);
  ok("legacy qlinkBoundsData kept", tui.pageData.tabs[0].qlinkBoundsData.length === 4);
  ok("legacy slot Q-Link (slot0 → 13)", q(ql)["Q-Link 13"] === 0);
}
console.log("knob picture size");
{
  const { tui } = gen([{ name: "S", controls: [{ param: "A", widget: "knob", size: 60, polarity: "unipolar" }, { param: "B", widget: "knob", polarity: "unipolar" }] }]);
  const defs = tui.pageData.componentDefinitions.localComponentDefinitions;
  const small = defs.find((d: any) => String(d.key).endsWith("@60"));
  const kn = small?.value.componentsData.find((c: any) => c.componentData.type === "Knob");
  ok("sized knob gets its own definition", !!small && small.key === "knobUni@60");
  ok("knob picture is 60x60 (centred in the 107px box)", kn?.bounds.bounds === "23 23 60 60", kn?.bounds.bounds);
  ok("unsized knob keeps the kit size", defs.some((d: any) => d.key === "knobUni"));
  let threw = false; try { gen([{ name: "S", controls: [{ param: "A", widget: "knob", size: 200 }] }]); } catch { threw = true; }
  ok("out-of-range size rejected", threw);
  threw = false; try { gen([{ name: "S", controls: [{ param: "A", widget: "fader", size: 50 }] }]); } catch { threw = true; }
  ok("size on a non-knob rejected", threw);
}
console.log("per-control text size");
{
  const { tui } = gen([{ name: "T", controls: [
    { param: "A", widget: "knob", polarity: "unipolar", nameSize: 18, valueSize: 0 },
    { param: "B", widget: "knob", polarity: "unipolar" },
    { param: "C", widget: "fader", polarity: "unipolar", valueSize: 40 },
  ] }]);
  const defs = tui.pageData.componentDefinitions.localComponentDefinitions;
  const small = defs.find((d: any) => d.key === "knobUni~n18v0");
  const labels = (d: any) => d.value.componentsData.filter((c: any) => c.componentData.type === "Label").map((c: any) => [c.componentData.data.type, c.componentData.data.textStyle.font.height]);
  ok("sized knob keeps the Name label at 18 and drops Value", JSON.stringify(labels(small)) === '[["Name",18]]', JSON.stringify(labels(small)));
  ok("plain knob keeps both labels at default sizes", JSON.stringify(labels(defs.find((d: any) => d.key === "knobUni"))) === '[["Name",26],["Value",30]]');
  ok("fader value 40, name default", JSON.stringify(labels(defs.find((d: any) => String(d.key).startsWith("faderUni~")))) === '[["Name",24],["Value",40]]', JSON.stringify(labels(defs.find((d: any) => String(d.key).startsWith("faderUni~")))));
  let threw = false; try { gen([{ name: "T", controls: [{ param: "A", widget: "knob", nameSize: 3 }] }]); } catch { threw = true; }
  ok("out-of-range text size rejected", threw);
  threw = false; try { gen([{ name: "T", controls: [{ param: "A", widget: "switch", nameSize: 20 }] }]); } catch { threw = true; }
  ok("text size on a switch rejected", threw);
}
console.log(fails ? `\n${fails} failed` : "\nAll free-form assertions pass");
process.exit(fails ? 1 : 0);
