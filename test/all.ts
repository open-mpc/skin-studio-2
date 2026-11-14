// Runs every golden suite; exits non-zero if any regressed.
import { spawnSync } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const suites = ["skinCheck.golden.ts", "skinCompat.golden.ts", "uiBuilder.golden.ts", "uiKit.golden.ts", "paramLayout.golden.ts", "paramPack.golden.ts", "fullTui.golden.ts", "freeform.golden.ts", "paramLoad.golden.ts", "preview.golden.ts", "previewSvg.golden.ts", "looks.golden.ts", "project.golden.ts", "doc.golden.ts", "installSkin.golden.ts", "svgRoundTrip.golden.ts", "skinSet.golden.ts", "device.golden.ts", "beta.golden.ts"];
let fail = 0;
for (const s of suites) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync("npx", ["tsx", path.join(here, s)], { stdio: "inherit" });
  if (r.status !== 0) fail = 1;
}
process.exit(fail);
