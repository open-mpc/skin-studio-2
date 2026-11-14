// Golden test: the TS skinCompat port must reproduce v1's os_compat() output exactly per fixture.
// Run: npx tsx test/skinCompat.golden.ts
import * as fs from "fs";
import * as path from "path";
import { osCompat } from "../src/core/skinCompat.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
type Golden = { gens: string[]; why: string[] };
const goldens: Record<string, Golden> = JSON.parse(
  fs.readFileSync(path.join(here, "golden/skin-compat.goldens.json"), "utf8")
);

const eqArr = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

let fails = 0;
for (const [name, exp] of Object.entries(goldens)) {
  const dir = path.join(here, "golden/fixtures", name);
  const tui = JSON.parse(fs.readFileSync(path.join(dir, "TUI.json"), "utf8"));
  const qlp = path.join(dir, "Q-Links.json");
  const ql = fs.existsSync(qlp) ? JSON.parse(fs.readFileSync(qlp, "utf8")) : null;
  const got = osCompat(null, tui, ql);
  const same = eqArr(got.gens, exp.gens) && eqArr(got.why, exp.why);
  if (same) {
    console.log(`PASS  ${name}  (${got.gens.join(" and ")}, ${got.why.length} notes)`);
  } else {
    fails++;
    console.log(`FAIL  ${name}`);
    if (!eqArr(got.gens, exp.gens)) console.log(`   gens v1=${exp.gens} ts=${got.gens}`);
    const max = Math.max(got.why.length, exp.why.length);
    for (let i = 0; i < max; i++) {
      if (got.why[i] !== exp.why[i]) {
        console.log(`   @${i}\n   v1: ${exp.why[i] ?? "(none)"}\n   ts: ${got.why[i] ?? "(none)"}`);
      }
    }
  }
}
console.log(fails ? `\n${fails} fixture(s) regressed` : `\nAll ${Object.keys(goldens).length} fixtures match v1`);
process.exit(fails ? 1 : 0);
