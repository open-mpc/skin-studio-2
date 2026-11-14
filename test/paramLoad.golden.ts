// Behaviour test for the param loader/importer (port of v1 params.py + schwung adapter). Verifies the
// three input shapes normalise into the packer's InputParam[]/sections correctly.
// Run: npx tsx test/paramLoad.golden.ts
import { loadParamFile, packLayout } from "../src/core/paramLayout.ts";

let fails = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else { fails++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
};

console.log("Case 1: bare array → params, no sections");
{
  const r = loadParamFile([{ key: "a", name: "A" }, { key: "b", name: "B" }]);
  ok("2 params", r.params.length === 2);
  ok("no sections", r.sections === undefined);
}

console.log("Case 2: {params, sections}");
{
  const r = loadParamFile({
    params: [{ key: "cutoff", name: "Cutoff" }, { key: "reso", name: "Reso" }],
    sections: [{ label: "Filter", keys: ["cutoff", "reso"] }],
  });
  ok("2 params", r.params.length === 2);
  ok("1 section 'Filter'", r.sections?.length === 1 && r.sections[0].label === "Filter");
  ok("feeds packer", packLayout(r.params, r.sections).pages.length === 1);
}

console.log("Case 3: Schwung module.json → chain_params + ui_hierarchy");
{
  const mod = {
    capabilities: {
      chain_params: [
        { key: "freq", name: "Freq" },
        { key: "trig", name: "Trigger", access: "write" },
        { key: "amt", name: "Amount" },
      ],
      ui_hierarchy: {
        levels: {
          root: { label: "Main", params: ["freq", "trig"] },
          mod: { label: "Mod", params: ["amt"] },
        },
      },
    },
  };
  const r = loadParamFile(mod);
  ok("3 params", r.params.length === 3);
  ok("access:write → momentary", r.params.find((p) => p.key === "trig")?.momentary === true);
  ok("non-write param not momentary", !r.params.find((p) => p.key === "freq")?.momentary);
  ok("2 sections from ui_hierarchy", r.sections?.length === 2, JSON.stringify(r.sections?.map((s) => s.label)));
  ok("root first, labelled 'Main'", r.sections?.[0].label === "Main" && JSON.stringify(r.sections?.[0].keys) === JSON.stringify(["freq", "trig"]));
  ok("mod section 'Mod' = [amt]", r.sections?.[1].label === "Mod" && JSON.stringify(r.sections?.[1].keys) === JSON.stringify(["amt"]));
}

console.log("Case 4: unknown shape rejected");
{
  let threw = false;
  try { loadParamFile({ foo: 1 }); } catch { threw = true; }
  ok("no parameter list → error", threw);
}

console.log(fails ? `\n${fails} assertion(s) failed` : `\nAll param-loader cases pass`);
process.exit(fails ? 1 : 0);
