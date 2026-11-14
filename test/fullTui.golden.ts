// Structural test for the full-TUI EXTENSION widgets (momentary button + readout) via
// uiBuilder.generateFromControls and the packer's toControlSpecs bridge.
//
// NOT hardware-verified: Akai ships no example TUI.json and a bad version/handle fails the whole skin
// silently on-device. This gate checks the shapes against ui-reference (version keys, Button Instant,
// ResetOnGestureEnd handle, Value label, Q-Link only for focusable controls). The full-TUI tier is not
// "done" until it loads on a real Force.  Run: npx tsx test/fullTui.golden.ts
import { packLayout, toControlSpecs, toParamsJson, type InputParam } from "../src/core/paramLayout.ts";
import { generateFromControls, type KitInfo, type KitAssets } from "../src/core/uiBuilder.ts";
import * as fs from "fs";
import * as path from "path";

const here = path.dirname(new URL(import.meta.url).pathname);
const mpcRed = JSON.parse(fs.readFileSync(path.join(here, "golden/uigen/kit-manifest.mpc-red.json"), "utf8")) as {
  assets: Record<string, [string, number, [number, number]]>;
};
const resolveKit = (_: KitInfo): KitAssets => mpcRed.assets;

let fails = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else { fails++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
};

// One page: a knob (simple), a momentary trigger, a readout, a stepper.
const params: InputParam[] = [
  { key: "cutoff", name: "Cutoff" },
  { key: "panic", name: "Panic", type: "trigger" },
  { key: "outlvl", name: "Out Level", type: "readout" },
  { key: "octave", name: "Octave", type: "stepper" },
];
const layout = packLayout(params);
const specs = toControlSpecs(layout);
const res = generateFromControls(toParamsJson(params), specs, resolveKit);
const tui = JSON.parse(res.tui) as any;
const defs: any[] = tui.pageData.componentDefinitions.localComponentDefinitions;
const comps: any[] = tui.pageData.tabs[0].componentDefinition.componentsData;
const byName = (n: string) => comps.find((c) => c.componentData.name === n);
const defByKey = (k: string) => defs.find((d) => d.key === k);

console.log("Full-TUI extension: knob + momentary button + readout on one page");

// momentary button
ok("momentaryButton definition present", !!defByKey("momentaryButton"));
{
  const d = defByKey("momentaryButton");
  const btn = d?.value.componentsData.find((c: any) => c.componentData.type === "Button");
  ok("button uses Instant gesture", btn?.componentData.data.gestureBehaviour === "Instant", JSON.stringify(btn?.componentData.data.gestureBehaviour));
  ok("button uses kit button art", btn?.componentData.data.onImage === "button_on.png");
  const e = byName("Panic");
  ok("button entry is focusable", e?.bounds.acceptsHWFocus === "Yes");
  ok("button has ResetOnGestureEnd handle", (e?.bounds.additionalInvalidatingHandles ?? []).includes("ResetOnGestureEnd/Parameter 1"),
    JSON.stringify(e?.bounds.additionalInvalidatingHandles));
  ok("button remaps Data → its parameter", e?.["handle remapping"].map.some((m: any) => m.key === "Data" && m.value === "Parameter 1"));
}

// readout
ok("readout definition present", !!defByKey("readout"));
{
  const d = defByKey("readout");
  const val = d?.value.componentsData.find((c: any) => c.componentData.name === "value");
  ok("readout shows a Value label", val?.componentData.data.type === "Value");
  ok("readout has no Button/Knob (non-interactive)", !d?.value.componentsData.some((c: any) => ["Button", "Knob", "Slider"].includes(c.componentData.type)));
  const e = byName("Out Level");
  ok("readout entry is NOT focusable", e?.bounds.acceptsHWFocus === "No");
}

// stepper: opens a NumericOverlay, focusable, Q-Link bound
ok("stepper definition present", !!defByKey("stepper"));
{
  const d = defByKey("stepper");
  ok("stepper has no Button/Knob (opens overlay)", !d?.value.componentsData.some((c: any) => ["Button", "Knob", "Slider"].includes(c.componentData.type)));
  ok("stepper action shows numeric overlay", d?.value.actions.some((a: any) => a.additionalData === "numeric overlay"));
  ok("numeric overlay definition present (NumericOverlay)", defByKey("numeric overlay")?.value.componentsData[0].componentData.type === "NumericOverlay");
  const e = byName("Octave");
  ok("stepper entry is focusable", e?.bounds.acceptsHWFocus === "Yes");
}

// Q-Links: knob + button + stepper get slots, readout does not
{
  const q = JSON.parse(res.qlinks) as any;
  const map0 = q["Screen Mode Q-Links"].map[0]["Q-Links"];
  const assigned = Object.values(map0).filter((v) => v !== -1);
  ok("three Q-Links assigned (knob+button+stepper, not readout)", assigned.length === 3, `got ${assigned.length}: ${JSON.stringify(assigned)}`);
  ok("readout param (index 2) not in Q-Links", !assigned.includes(2));
  ok("stepper param (index 3) in Q-Links", assigned.includes(3));
}

// ---- {Increment} repeat strip (HARDWARE-VERIFIED as TAB ROOT on Force 3.9.1; referenced form renders nothing) ----
console.log("\n{Increment} repeat strip (version-3 repeats, tab root)");
{
  const sparams = Array.from({ length: 8 }, (_, i) => ({ index: i, name: `Step ${i + 1}`, kind: "float", default: 0.5 }));
  const r2 = generateFromControls({ params: sparams }, [{ name: "SEQ", controls: [{ param: "Step 1", full: "repeat", repeatCount: 8 }] }], resolveKit);
  const tui2 = JSON.parse(r2.tui) as any;
  const root = tui2.pageData.tabs[0].componentDefinition;
  ok("tab root is version 3 with repeats:8", root.version === 3 && root.repeats === 8, JSON.stringify([root.version, root.repeats]));
  const child = root.componentsData[0];
  ok("child is a ColourBar Slider", child?.componentData.data.sliderType === "ColourBar");
  ok("child binds Parameter {Increment:Base=0}", child?.["handle remapping"].map[0].value === "Parameter {Increment:Base=0}");
  ok("child fits the tab (8 x childW <= 1280)", Number(child.bounds.bounds.split(" ")[2]) * 8 <= 1280, child.bounds.bounds);
  ok("no referenced repeat definition emitted", !tui2.pageData.componentDefinitions.localComponentDefinitions.some((d: any) => String(d.key).startsWith("repeat ")));
  let threw = false;
  try { generateFromControls({ params: sparams }, [{ name: "x", controls: [{ param: "Step 1", full: "repeat", repeatCount: 1 }] }], resolveKit); } catch { threw = true; }
  ok("repeatCount < 2 rejected", threw);
  threw = false;
  try { generateFromControls({ params: sparams }, [{ name: "x", controls: [{ param: "Step 1", full: "repeat", repeatCount: 8 }, { param: "Step 2", widget: "knob" }] }], resolveKit); } catch { threw = true; }
  ok("repeat strip mixed with other controls rejected", threw);
}

// ---- packer: consecutive slot params become a dedicated strip page ----
console.log("\npacker → {Increment} strip page");
{
  const ps: InputParam[] = [
    { key: "lone", name: "Lone", type: "slot" },
    { key: "cutoff", name: "Cutoff" },
    ...Array.from({ length: 8 }, (_, i) => ({ key: `step${i + 1}`, name: `Step ${i + 1}`, type: "slot" })),
  ];
  const lay = packLayout(ps);
  const strip = lay.pages.find((p) => p.strip);
  ok("strip page created for 8 consecutive slots", strip?.strip?.count === 8 && strip.strip.param.key === "step1");
  ok("lone slot falls back to a plain control", lay.pages.some((p) => p.slots.some((s) => s?.param.key === "lone" && s.choice.widget !== "slot")));
  const r3 = generateFromControls(toParamsJson(ps), toControlSpecs(lay), resolveKit);
  const t3 = JSON.parse(r3.tui) as any;
  const roots = t3.pageData.tabs.map((t: any) => t.componentDefinition);
  ok("strip tab root repeats 8 bound to {Increment:Base=2}", roots.some((r: any) => r.repeats === 8 && r.componentsData[0]["handle remapping"].map[0].value === "Parameter {Increment:Base=2}"));
}

console.log(fails ? `\n${fails} assertion(s) failed` : `\nAll full-TUI extension assertions pass (structural; NOT hardware-verified)`);
process.exit(fails ? 1 : 0);
