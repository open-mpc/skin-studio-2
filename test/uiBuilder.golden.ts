// Golden test: the TS uiBuilder port must reproduce the SDK gen_ui.py output BYTE FOR BYTE
// (TUI.json + Q-Links.json) for each frozen fixture. Oracle = Akai's own gen_ui.py.
// Run: npx tsx test/uiBuilder.golden.ts
import * as fs from "fs";
import * as path from "path";
import { generate, type KitInfo, type KitAssets } from "../src/core/uiBuilder.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const uigen = path.join(here, "golden/uigen");

// The kit-asset manifest the uiBuilder consumes (produced separately by make_ui_kit/uiKit). The
// three fixtures all auto-apply the mpc-red kit; resolveKitAssets stands in for gen_ui's kit_dir_for.
const mpcRed: { theme: string; assets: Record<string, [string, number, [number, number]]> } = JSON.parse(
  fs.readFileSync(path.join(uigen, "kit-manifest.mpc-red.json"), "utf8")
);
const resolveKit = (kit: KitInfo): KitAssets => {
  if (kit.theme !== "mpc-red") throw new Error(`no manifest for kit theme "${kit.theme}"`);
  return mpcRed.assets;
};

const fixtures = ["knobs_switch_bipolar", "fader_menu_visiblewhen", "auto_no_ui"];

function firstDiff(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) {
    if (al[i] !== bl[i]) {
      return `   @line ${i + 1}\n   oracle: ${JSON.stringify(al[i] ?? "(eof)")}\n   ts    : ${JSON.stringify(bl[i] ?? "(eof)")}`;
    }
  }
  return "   (identical line-by-line; length differs)";
}

let fails = 0;
for (const name of fixtures) {
  const dir = path.join(uigen, name);
  const paramsData = JSON.parse(fs.readFileSync(path.join(dir, "params.json"), "utf8"));
  const uiPath = path.join(dir, "ui.json");
  const uiData = fs.existsSync(uiPath) ? JSON.parse(fs.readFileSync(uiPath, "utf8")) : null;
  const outDir = path.join(dir, "out", "Plugin Skins");
  const expTui = fs.readFileSync(path.join(outDir, "TUI.json"), "utf8");
  const expQ = fs.readFileSync(path.join(outDir, "Q-Links.json"), "utf8");

  const got = generate(paramsData, uiData, resolveKit);
  const tuiOk = got.tui === expTui;
  const qOk = got.qlinks === expQ;
  if (tuiOk && qOk) {
    console.log(`PASS  ${name}  (TUI ${expTui.length}B, Q-Links ${expQ.length}B)`);
  } else {
    fails++;
    console.log(`FAIL  ${name}`);
    if (!tuiOk) console.log(`  TUI.json differs:\n${firstDiff(expTui, got.tui)}`);
    if (!qOk) console.log(`  Q-Links.json differs:\n${firstDiff(expQ, got.qlinks)}`);
  }
}
console.log(fails ? `\n${fails} fixture(s) regressed` : `\nAll ${fixtures.length} fixtures match gen_ui`);
process.exit(fails ? 1 : 0);
