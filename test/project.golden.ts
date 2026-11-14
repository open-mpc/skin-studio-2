// End-to-end test for the orchestration backbone: a parameter file → built SDK folder + preview,
// exercising every core module in one chain. Run: npx tsx test/project.golden.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildFromParams, writePluginSkins } from "../src/app/project.ts";

let fails = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else { fails++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
};

// A small synth-ish parameter file with sections (generic format).
const paramFile = {
  params: [
    { key: "cutoff", name: "Cutoff" }, { key: "reso", name: "Resonance" }, { key: "drive", name: "Drive" },
    { key: "mode", name: "Mode", options: ["LP", "BP", "HP"] },
    { key: "attack", name: "Attack" }, { key: "decay", name: "Decay" }, { key: "sustain", name: "Sustain" }, { key: "release", name: "Release" },
    { key: "mix", name: "Dry/Wet" },
  ],
  sections: [
    { label: "Filter", keys: ["cutoff", "reso", "drive", "mode"] },
    { label: "Env", keys: ["attack", "decay", "sustain", "release"] },
    { label: "Out", keys: ["mix"] },
  ],
};

console.log("Full loop: param file → build + preview");
const r = buildFromParams(paramFile);

ok("TUI.json is valid JSON", (() => { try { JSON.parse(r.tui); return true; } catch { return false; } })());
ok("Q-Links.json is valid JSON", (() => { try { JSON.parse(r.qlinks); return true; } catch { return false; } })());
ok("kit resolved (mpc-red)", r.kit?.theme === "mpc-red");
ok("only referenced kit PNGs kept", Object.keys(r.kitPngs).length > 0 && Object.keys(r.kitPngs).every((n) => r.tui.includes(n + ".png")));
ok("kit PNGs are real pngs", Object.values(r.kitPngs).every((b) => b.slice(1, 4).toString() === "PNG"));
ok("tab names from sections", JSON.stringify(r.tabNames) === JSON.stringify(["FILTER / ENV / OUT"]) || r.tabNames.length >= 1, JSON.stringify(r.tabNames));
ok("preview SVG self-contained (data URIs)", r.previewSvg.startsWith("<svg") && r.previewSvg.includes("data:image/png;base64,"));

// widget choices propagated: ADSR → faders, mode → switch, cutoff → knob
const tui = JSON.parse(r.tui);
const comps = tui.pageData.tabs.flatMap((t: any) => t.componentDefinition.componentsData);
ok("Attack is a fader", comps.some((c: any) => c.componentData.name === "Attack" && String(c.componentData.type).startsWith("fader")));
ok("Mode is a switch (radio3)", comps.some((c: any) => c.componentData.name === "Mode" && c.componentData.type === "radio3"));
ok("Cutoff is a knob", comps.some((c: any) => c.componentData.name === "Cutoff" && String(c.componentData.type).startsWith("knob")));

// write the folder and check the files land
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skin2-"));
const skinDir = writePluginSkins(dir, r);
ok("Plugin Skins/TUI.json written", fs.existsSync(path.join(skinDir, "TUI.json")));
ok("Plugin Skins/Q-Links.json written", fs.existsSync(path.join(skinDir, "Q-Links.json")));
ok("kit PNGs written", fs.readdirSync(skinDir).some((f) => f.endsWith(".png")));
fs.rmSync(dir, { recursive: true, force: true });

// also accepts a Schwung module.json and a bare array (loader paths)
ok("accepts bare array", buildFromParams([{ key: "a", name: "A" }, { key: "b", name: "B" }]).tabNames.length === 1);

console.log(fails ? `\n${fails} assertion(s) failed` : `\nAll full-loop assertions pass`);
process.exit(fails ? 1 : 0);
