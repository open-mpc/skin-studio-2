// Golden test: the TS uiKit port must reproduce the SDK make_ui_kit.py output BYTE FOR BYTE.
// Oracle = Akai's make_ui_kit.py. Despite V8/CPython libm last-ULP divergence (which is real — see
// uiKit.ts header), the kit rasters come out hash-identical across all 6 themes and custom accents
// (verified at freeze time), so the gate is exact PNG hash, the strongest contract.
// Run: npx tsx test/uiKit.golden.ts
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { renderKit } from "../src/core/uiKit.ts";

const here = path.dirname(new URL(import.meta.url).pathname);
const golden = JSON.parse(fs.readFileSync(path.join(here, "golden/uikit/mpc-red.sha256.json"), "utf8")) as {
  theme: string;
  manifestSha256: string;
  assets: Record<string, string>;
};

const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

let fails = 0;
const kit = renderKit(golden.theme);

// manifest
const manOk = sha(kit.manifestJson) === golden.manifestSha256;
if (manOk) console.log("PASS  kit.json manifest");
else {
  fails++;
  console.log(`FAIL  kit.json manifest  oracle=${golden.manifestSha256.slice(0, 16)} ts=${sha(kit.manifestJson).slice(0, 16)}`);
}

// every asset PNG, byte-for-byte
const names = Object.keys(golden.assets).map((f) => f.replace(/\.png$/, ""));
for (const name of names) {
  const png = kit.pngs[name];
  if (!png) {
    fails++;
    console.log(`FAIL  ${name}.png  (not rendered)`);
    continue;
  }
  const got = sha(png);
  const exp = golden.assets[name + ".png"];
  if (got === exp) console.log(`PASS  ${name}.png  (${png.length}B)`);
  else {
    fails++;
    console.log(`FAIL  ${name}.png  oracle=${exp.slice(0, 16)} ts=${got.slice(0, 16)}`);
  }
}

const total = names.length + 1;
console.log(fails ? `\n${fails}/${total} assets regressed` : `\nAll ${total} kit assets match make_ui_kit byte-for-byte`);
process.exit(fails ? 1 : 0);
