// installSkin against a fake device (a directory driven by real sh): staged skin-only swap, in both the
// 3.10 "VST2 Plugins" layout and the 3.9 Force "Synths" layout.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import { DeviceService, type Transport, type ExecResult } from "../src/app/device.ts";
import { installSkin } from "../src/app/installSkin.ts";
import { buildFromParams } from "../src/app/project.ts";

let fails = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) console.log(`  PASS  ${n}`); else { fails++; console.log(`  FAIL  ${n}${d ? " — " + d : ""}`); } };

// Fake device = a directory acting as "<mount>/VST2 Plugins"; commands are executed against it via sh.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fakedev-"));
const mount = path.join(root, "nvme");
const plug = path.join(mount, "VST2 Plugins", "sd88me - VST - Demo");
fs.mkdirSync(path.join(plug, "Plugin Skins"), { recursive: true });
fs.mkdirSync(path.join(plug, "VST"), { recursive: true });
fs.writeFileSync(path.join(plug, "plugin.json"), '{"name":"Demo"}');
fs.writeFileSync(path.join(plug, "VST", "demo.so"), "ELF");
fs.writeFileSync(path.join(plug, "Plugin Skins", "TUI.json"), "OLD");
const sh = (cmd: string, input?: Buffer) => spawnSync("sh", ["-c", cmd], { input, maxBuffer: 1 << 28 });
const transport: Transport = {
  run: async (c) => { const r = sh(c); return { code: r.status ?? -1, stdout: String(r.stdout), stderr: String(r.stderr) } as ExecResult; },
  pipeIn: async (c, b) => { const r = sh(c, b); return { code: r.status ?? -1, stdout: String(r.stdout), stderr: String(r.stderr) } as ExecResult; },
  pipeOut: async (c) => { const r = sh(c); return { code: r.status ?? -1, stdout: r.stdout as Buffer, stderr: String(r.stderr) }; },
} as Transport;

const built = buildFromParams([{ key: "cutoff", name: "Cutoff" }]);
const res = await installSkin(new DeviceService(transport), mount, "sd88me - VST - Demo", built);
ok("reports the folder", res.folder === "sd88me - VST - Demo");
ok("Plugin Skins/TUI.json replaced", fs.readFileSync(path.join(plug, "Plugin Skins", "TUI.json"), "utf8") === built.tui);
ok("Q-Links.json written", fs.existsSync(path.join(plug, "Plugin Skins", "Q-Links.json")));
ok("plugin binary + plugin.json untouched", fs.readFileSync(path.join(plug, "VST", "demo.so"), "utf8") === "ELF" && fs.existsSync(path.join(plug, "plugin.json")));

// 3.9.x Force layout: <mount>/Synths/<plugin>
const plug2 = path.join(mount, "Synths", "sd88me - VST - Old");
fs.mkdirSync(path.join(plug2, "Plugin Skins"), { recursive: true });
fs.mkdirSync(path.join(plug2, "SAMPLES"), { recursive: true });
fs.writeFileSync(path.join(plug2, "plugin.json"), '{"name":"Old"}');
fs.writeFileSync(path.join(plug2, "SAMPLES", "keep.wav"), "WAV");
fs.writeFileSync(path.join(plug2, "Plugin Skins", "TUI.json"), "OLD");
const r2 = await installSkin(new DeviceService(transport), mount, "sd88me - VST - Old", built, { dir: "Synths" });
ok("Synths layout: skin replaced", fs.readFileSync(path.join(plug2, "Plugin Skins", "TUI.json"), "utf8") === built.tui && r2.dir === "Synths");
ok("Synths layout: user data untouched", fs.readFileSync(path.join(plug2, "SAMPLES", "keep.wav"), "utf8") === "WAV");
ok("no staging dir left behind", !fs.existsSync(path.join(plug2, ".skin-staging")));

// refuses a non-SDK plugin folder, changing nothing
const plug3 = path.join(mount, "Synths", "AIR - Something");
fs.mkdirSync(path.join(plug3, "Plugin Skins"), { recursive: true });
fs.writeFileSync(path.join(plug3, "Plugin Skins", "TUI.json"), "THEIRS");
let msg = ""; try { await installSkin(new DeviceService(transport), mount, "AIR - Something", built, { dir: "Synths" }); } catch (e) { msg = String(e); }
ok("non-SDK folder refused with a clear message", /no plugin.json/.test(msg), msg);
ok("refused install changed nothing", fs.readFileSync(path.join(plug3, "Plugin Skins", "TUI.json"), "utf8") === "THEIRS");

// a failed transfer (bad tar) leaves the existing skin intact
const bad: Transport = { ...transport, pipeIn: async (c) => { const r = sh(c, Buffer.from("not a tar")); return { code: r.status ?? -1, stdout: String(r.stdout), stderr: String(r.stderr) } as ExecResult; } } as Transport;
let failed = false; try { await installSkin(new DeviceService(bad), mount, "sd88me - VST - Old", built, { dir: "Synths" }); } catch { failed = true; }
ok("corrupt transfer is reported", failed);
ok("corrupt transfer left the previous skin intact", fs.readFileSync(path.join(plug2, "Plugin Skins", "TUI.json"), "utf8") === built.tui);

// confinement
import { remoteSkinCommand, remotePluginsPath, DeviceError } from "../src/app/device.ts";
ok("unsafe folder rejected", (() => { try { remoteSkinCommand("/m", "../x", "Synths"); return false; } catch (e) { return e instanceof DeviceError; } })());
ok("arbitrary directory rejected", (() => { try { remotePluginsPath("/m", "etc" as any); return false; } catch (e) { return e instanceof DeviceError; } })());
ok("detects which plugin dirs exist", JSON.stringify(await new DeviceService(transport).pluginDirs(mount)) === '["VST2 Plugins","Synths"]');
fs.rmSync(root, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nAll install-skin assertions pass");
process.exit(fails ? 1 : 0);
