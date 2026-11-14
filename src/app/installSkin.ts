// installSkin.ts — put a built skin onto an installed plugin on the MPC, via DeviceService only (writes are
// confined to a plugin folder's "Plugin Skins" inside "VST2 Plugins" (MPC OS 3.10+) or "Synths" (3.9.x Force)).
// Only a tar of the new Plugin Skins is sent; it is staged then swapped in, so a failed transfer changes nothing
// and the plugin's binary, Content and user data are never touched.
// NOTE: MPC caches skins — the app must be restarted/the plugin reloaded afterwards (the caller asks the
// user; this module never restarts). Managed devices (Plugin Manager G2) may restore the original.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DeviceService, DeviceError, localTarBuffer, PLUGINS_DIR, type PluginsDir } from "./device.ts";
import { writePluginSkins, type BuildResult } from "./project.ts";

export async function installSkin(
  svc: DeviceService,
  mount: string,
  folder: string,
  built: BuildResult,
  opts: { tarBin?: string; dir?: PluginsDir } = {}
): Promise<{ folder: string; files: number; dir: PluginsDir }> {
  const dir = opts.dir ?? PLUGINS_DIR;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skinstudio-"));
  try {
    const skinDir = writePluginSkins(tmp, built); // <tmp>/Plugin Skins/
    const r = await svc.replaceSkin(await localTarBuffer(tmp, "Plugin Skins", opts.tarBin), mount, folder, dir);
    if (r.code === 3) throw new DeviceError(`"${folder}" on the device is not an SDK plugin folder (no plugin.json) — only SDK-format plugins can take a skin`);
    if (r.code !== 0) throw new DeviceError(`install failed: ${r.stderr.trim() || "exit " + r.code}`);
    return { folder, files: fs.readdirSync(skinDir).length, dir };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
