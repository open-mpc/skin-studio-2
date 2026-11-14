// Golden test: the TS skinCheck port must reproduce v1's findings exactly for every frozen fixture.
// Run: npx tsx test/skinCheck.golden.ts   (exit 0 = parity, exit 1 = a regression)
import * as fs from "fs";
import * as path from "path";
import { check } from "../src/core/skinCheck.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const goldens: Record<string, string[]> = JSON.parse(
  fs.readFileSync(path.join(here, "golden/skin-check.goldens.json"), "utf8")
);

let fails = 0;
for (const [name, expected] of Object.entries(goldens)) {
  const got = check(path.join(here, "golden/fixtures", name));
  const same = got.length === expected.length && got.every((l, i) => l === expected[i]);
  if (same) {
    console.log(`PASS  ${name}  (${got.length} findings)`);
  } else {
    fails++;
    console.log(`FAIL  ${name}`);
    const max = Math.max(got.length, expected.length);
    for (let i = 0; i < max; i++) {
      if (got[i] !== expected[i]) {
        console.log(`   @${i}`);
        console.log(`   v1: ${expected[i] ?? "(none)"}`);
        console.log(`   ts: ${got[i] ?? "(none)"}`);
      }
    }
  }
}
console.log(fails ? `\n${fails} fixture(s) regressed` : `\nAll ${Object.keys(goldens).length} fixtures match v1`);
process.exit(fails ? 1 : 0);
