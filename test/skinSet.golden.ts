// Skin sets: several interfaces in one Plugin Skins folder (SKIN_VARIANTS.md layout).
import { buildSkinSet, writeSkinSet, rewriteImagePaths } from "../src/app/skinSet.ts";
import { docFromParamFile, setControl } from "../src/app/doc.ts";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

let fails = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) console.log(`  PASS  ${n}`); else { fails++; console.log(`  FAIL  ${n}${d ? " — " + d : ""}`); } };

const params = [{ key: "cutoff", name: "Cutoff", default: 0.3 }, { key: "res", name: "Resonance", default: 0.3 }, { key: "mix", name: "Mix", default: 0.3 }];
const studio = docFromParamFile(params, "studio");
const classic = setControl(docFromParamFile(params, "classic"), 0, 0, { param: "Cutoff", widget: "fader", polarity: "unipolar" });
const set = buildSkinSet([{ name: "studio", doc: studio }, { name: "classic", doc: classic }], "classic");

const f = (k: string) => set.files.get(k) as string;
ok("both interfaces present", set.files.has("studio/TUI.json") && set.files.has("classic/TUI.json") && set.files.has("studio/Q-Links.json"));
ok("top-level TUI.json is the active interface's", f("TUI.json") === f("classic/TUI.json"));
ok("top-level Q-Links.json is the active interface's", f("Q-Links.json") === f("classic/Q-Links.json"));
ok("ui.txt records the active name", f("ui.txt") === "classic\n");

// every image the top-level TUI references lives inside the interface's folder, and exists in the set
const refs = [...f("TUI.json").matchAll(/"(?:filmStrip|onImage|offImage|image)":\s*"([^"]+)"/g)].map((m) => m[1]);
ok("top-level images point into the active folder", refs.length > 0 && refs.every((r) => r.startsWith("classic/")), refs.slice(0, 3).join(","));
ok("every referenced image is in the set", refs.every((r) => set.files.has(r)), refs.filter((r) => !set.files.has(r)).join(","));
ok("the other interface keeps its own images", [...f("studio/TUI.json").matchAll(/"(?:filmStrip|onImage|offImage)":\s*"([^"]+)"/g)].every((m) => m[1].startsWith("studio/")));

// rewriting is idempotent on nested paths, leaves non-image strings and absolute imports alone
const once = rewriteImagePaths('{"a":{"filmStrip":"k.png","image":"x/y.png","name":"k.png","importFiles":["/abs/o.json"]}}', "n");
ok("bare refs prefixed, nested/absolute/other strings untouched", /"filmStrip":"n\/k\.png"/.test(once) && /"image":"x\/y\.png"/.test(once) && /"name":"k\.png"/.test(once) && /\/abs\/o\.json/.test(once));

// validation
const bad = (fn: () => void) => { try { fn(); return false; } catch { return true; } };
ok("needs two interfaces", bad(() => buildSkinSet([{ name: "a", doc: studio }], "a")));
ok("unknown active rejected", bad(() => buildSkinSet([{ name: "a", doc: studio }, { name: "b", doc: classic }], "zzz")));
ok("unsafe name rejected", bad(() => buildSkinSet([{ name: "../x", doc: studio }, { name: "b", doc: classic }], "b")));
ok("duplicate name rejected", bad(() => buildSkinSet([{ name: "a", doc: studio }, { name: "a", doc: classic }], "a")));
ok("different parameter lists rejected", bad(() => buildSkinSet([{ name: "a", doc: studio }, { name: "b", doc: docFromParamFile([{ key: "x", name: "X" }]) }], "a")));

// writing is idempotent and replaces a previous set
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sset-"));
const dir = writeSkinSet(tmp, set);
fs.writeFileSync(path.join(dir, "stale.txt"), "x");
writeSkinSet(tmp, buildSkinSet([{ name: "studio", doc: studio }, { name: "classic", doc: classic }], "studio"));
// only image names change: a rewritten file differs from the original in nothing else
ok("nothing but image names changes (floats and key order intact)", rewriteImagePaths(f("studio/TUI.json").replace(/studio\//g, ""), "studio") === f("studio/TUI.json") && /30\.0/.test(f("studio/TUI.json")));
ok("rewrite replaces the previous set (no stale files)", !fs.existsSync(path.join(dir, "stale.txt")));
ok("rewrite switched the active interface", fs.readFileSync(path.join(dir, "ui.txt"), "utf8") === "studio\n" && fs.readFileSync(path.join(dir, "TUI.json"), "utf8") === fs.readFileSync(path.join(dir, "studio/TUI.json"), "utf8"));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll skin-set assertions pass");
process.exit(fails ? 1 : 0);
