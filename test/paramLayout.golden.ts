// Behaviour test for the auto-layout widget selector (Akai-first). No v1 byte-oracle — v1 is not the
// spec. Each case asserts a parameter maps to its Akai-native construct per plan "Ledger 1".
// Run: npx tsx test/paramLayout.golden.ts
import { widgetFor, type InputParam, type WidgetChoice } from "../src/core/paramLayout.ts";

type Case = { p: InputParam; expect: Partial<WidgetChoice>; why: string };
const cases: Case[] = [
  // Discrete → switch / slider+menu (SDK rule 1; switch ≤4 is a hard constraint)
  { p: { key: "sync", options: ["Off", "On"] }, expect: { widget: "switch", tui: "simple" }, why: "bool → switch" },
  { p: { key: "mode", options: ["LP", "BP", "HP"] }, expect: { widget: "switch", tui: "simple" }, why: "3-choice → switch" },
  { p: { key: "wave", options: ["Saw", "Sq", "Sin", "Tri"] }, expect: { widget: "switch", tui: "simple" }, why: "4-choice → switch" },
  { p: { key: "div", options: ["1/4", "1/8", "1/16", "1/32", "1/64"] }, expect: { widget: "slider", overlay: "menu", tui: "simple" }, why: "5+ → slider+menu" },

  // Continuous → fader (levels/ADSR) / bipolar knob (centre-zero) / knob (else)  (SDK rules 2–4)
  { p: { key: "attack", name: "Attack" }, expect: { widget: "fader", tui: "simple" }, why: "ADSR stage → fader" },
  { p: { key: "mix", name: "Dry/Wet" }, expect: { widget: "fader", tui: "simple" }, why: "mix → fader" },
  { p: { key: "volume", name: "Volume" }, expect: { widget: "fader", tui: "simple" }, why: "level → fader" },
  { p: { key: "pan", name: "Pan" }, expect: { widget: "knob", polarity: "bipolar", tui: "simple" }, why: "pan → bipolar knob" },
  { p: { key: "tune", name: "Fine Tune" }, expect: { widget: "knob", polarity: "bipolar", tui: "simple" }, why: "tune → bipolar knob" },
  { p: { key: "cutoff", name: "Cutoff" }, expect: { widget: "knob", polarity: "auto", tui: "simple" }, why: "continuous → knob (auto)" },
  { p: { key: "reso", name: "Resonance" }, expect: { widget: "knob", polarity: "auto", tui: "simple" }, why: "continuous → knob" },

  // v1 param-type hints → native Akai FULL-TUI constructs (never dropped)
  { p: { key: "panic", type: "trigger" }, expect: { widget: "button", tui: "full", momentary: true }, why: "trigger → Instant Button" },
  { p: { key: "tap", momentary: true }, expect: { widget: "button", tui: "full", momentary: true }, why: "momentary → Instant Button" },
  { p: { key: "level_out", type: "readout" }, expect: { widget: "readout", tui: "full" }, why: "readout → Value label" },
  { p: { key: "octave", type: "stepper" }, expect: { widget: "stepper", tui: "full" }, why: "stepper → NumericOverlay" },
  { p: { key: "step1", type: "slot" }, expect: { widget: "slot", tui: "full" }, why: "slot → repeats/{Increment}" },
];

let fails = 0;
for (const { p, expect, why } of cases) {
  const got = widgetFor(p);
  const mismatch = (Object.keys(expect) as (keyof WidgetChoice)[]).filter((k) => got[k] !== expect[k]);
  if (mismatch.length === 0) {
    console.log(`PASS  ${p.key.padEnd(10)} → ${got.widget}${got.polarity && got.polarity !== "auto" ? "/" + got.polarity : ""}${got.overlay === "menu" ? "+menu" : ""} (${why})`);
  } else {
    fails++;
    console.log(`FAIL  ${p.key}: ${why}`);
    for (const k of mismatch) console.log(`   ${k}: expected ${JSON.stringify(expect[k])}, got ${JSON.stringify(got[k])}`);
  }
}
console.log(fails ? `\n${fails}/${cases.length} cases wrong` : `\nAll ${cases.length} widget-selection cases match the Akai-first ledger`);
process.exit(fails ? 1 : 0);
