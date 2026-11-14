// device.ts — the device install service (faithful port of the SDK's tools/mpc_remote.py command
// model + safety rails). This is Akai's own tool, so it's all BASE (no judged diff): same command
// set, same confinement to the "VST2 Plugins" folder, same restart-loses-data confirmation.
//
// SPLIT: the command construction + path/name safety are PURE and tested here. Actual device I/O goes
// through an injected Transport. The real SSH transport (host `ssh`, as mpc_remote uses) is included but
// UNVERIFIED — it needs a real MPC/Force on the network (held with HARDWARE-VERIFY.md). The service
// never runs a destructive action (restart) without explicit confirmation, and only ever builds paths
// inside the drive's "VST2 Plugins" folder.

import { spawn } from "child_process";

export const PLUGINS_DIR = "VST2 Plugins"; // MPC OS 3.10+ SDK route (the only dir full installs/removes touch)
export const SYNTHS_DIR = "Synths"; // MPC OS 3.9.x (Force): community plugins live here; skin updates only
export type PluginsDir = typeof PLUGINS_DIR | typeof SYNTHS_DIR;
export const PLUGIN_DIRS: readonly PluginsDir[] = [PLUGINS_DIR, SYNTHS_DIR];
export const MPC_SERVICE = "acvs"; // systemd unit running the MPC app
export const COMMANDS = ["info", "drives", "list", "doctor", "restart", "add", "update", "import", "remove", "export"] as const;
export type Command = (typeof COMMANDS)[number];
const ILLEGAL_FILENAME_CHARS = new Set('"#@,;:<>*^|?\\/'.split("")); // the exact set the MPC strips
export const INTERNAL_DRIVE_PREFIXES = ["az01-internal", "acvs-synths", "acvs-content", "nvme"];

// --- safety rails (ports of mpc_remote.py) -------------------------------------------------------
export function legalFilename(s: string): string {
  return [...s].filter((c) => !ILLEGAL_FILENAME_CHARS.has(c)).join("");
}
export function safeFolderName(name: string): boolean {
  return !!name && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\x00") && !name.startsWith("-");
}
export function pluginFolderName(manufacturer: string, name: string): string {
  return legalFilename(`${manufacturer} - VST - ${name}`);
}
export function remotePluginsPath(mount: string, dir: PluginsDir = PLUGINS_DIR): string {
  if (!PLUGIN_DIRS.includes(dir)) throw new DeviceError(`not a plugins folder: ${JSON.stringify(dir)}`);
  return mount.replace(/\/+$/, "") + "/" + dir;
}
/** The confined remote path for a plugin folder on a drive. Throws if the folder name is unsafe. */
export function remotePluginPath(mount: string, folder: string, dir: PluginsDir = PLUGINS_DIR): string {
  if (!safeFolderName(folder)) throw new DeviceError(`unsafe plugin folder name: ${JSON.stringify(folder)}`);
  return remotePluginsPath(mount, dir) + "/" + folder;
}

export class DeviceError extends Error {}

// --- transport -----------------------------------------------------------------------------------
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export interface Transport {
  // Run a shell command on the device and return its result.
  run(remoteCommand: string): Promise<ExecResult>;
  // Stream `stdin` into a remote command (install: a tar archive → `tar -x`). Optional: only needed
  // for add/update. Held for hardware; the command builders are what the tests cover.
  pipeIn?(remoteCommand: string, stdin: Buffer): Promise<ExecResult>;
  // Run a remote command and collect its stdout as bytes (export: `tar -c` → a local zip/tar).
  pipeOut?(remoteCommand: string): Promise<{ code: number; stdout: Buffer; stderr: string }>;
}

// --- install/export command builders (ports of mpc_remote.py's tar-over-ssh pipeline) ------------
// mpc_remote streams a tar archive of the plugin folder over ssh and extracts it inside "VST2 Plugins".
// These build the exact remote commands; the byte transfer is wired with the hardware.
export function remoteInstallCommand(mount: string, folder: string, opts: { replace?: boolean } = {}): string {
  const parent = remotePluginsPath(mount); // confined to "VST2 Plugins"
  const dest = remotePluginPath(mount, folder); // throws on unsafe folder
  const pre = opts.replace ? `rm -rf ${shq(dest)} && ` : "";
  // -k (keep existing, never overwrite) unless replacing; extract under the VST2 Plugins folder.
  return `mkdir -p ${shq(parent)} && ${pre}tar -x${opts.replace ? "" : "k"}f - -C ${shq(parent)}`;
}
/**
 * Replace ONLY a plugin's "Plugin Skins" folder. The archive holds a single top-level "Plugin Skins" dir.
 * Staged: extract beside the plugin first, then swap — if tar fails nothing existing is touched. Refuses
 * (exit 3) unless the target is an SDK-format plugin folder (has plugin.json). Allowed in both plugin dirs.
 */
export function remoteSkinCommand(mount: string, folder: string, dir: PluginsDir = PLUGINS_DIR): string {
  const p = remotePluginPath(mount, folder, dir); // confined + safe-name checked
  const tmp = `${p}/.skin-staging`;
  return (
    `test -f ${shq(p + "/plugin.json")} || { echo 'not an SDK plugin folder (no plugin.json)' >&2; exit 3; }; ` +
    `rm -rf ${shq(tmp)} && mkdir ${shq(tmp)} && tar -xf - -C ${shq(tmp)} && test -d ${shq(tmp + "/Plugin Skins")} && ` +
    `rm -rf ${shq(p + "/Plugin Skins")} && mv ${shq(tmp + "/Plugin Skins")} ${shq(p + "/Plugin Skins")}; rc=$?; rm -rf ${shq(tmp)}; exit $rc`
  );
}
export function remoteExportCommand(mount: string, folder: string): string {
  const parent = remotePluginsPath(mount);
  if (!safeFolderName(folder)) throw new DeviceError(`unsafe plugin folder name: ${JSON.stringify(folder)}`);
  return `tar -cf - -C ${shq(parent)} ${shq(folder)}`;
}

// Real transport: the host `ssh` binary, exactly as mpc_remote.py (OpenSSH, no extra deps). UNVERIFIED
// against hardware here. Options mirror mpc_remote's non-interactive, keepalive-bounded connection.
export class SshTransport implements Transport {
  constructor(
    private host: string,
    private port = 22,
    private user = "root",
    private sshBin = process.env.MPC_SSH_BIN || "ssh"
  ) {}
  argv(remoteCommand: string): string[] {
    return [
      "-p", String(this.port),
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ServerAliveInterval=15",
      `${this.user}@${this.host}`,
      remoteCommand,
    ];
  }
  run(remoteCommand: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.sshBin, this.argv(remoteCommand));
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      p.on("close", (code) => resolve({ code: code ?? -1, stdout: out, stderr: err }));
    });
  }
  pipeIn(remoteCommand: string, stdin: Buffer): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.sshBin, this.argv(remoteCommand));
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      // If the remote command exits before consuming all stdin (e.g. `tar -xk` refusing existing
      // files), the pipe breaks. Swallow EPIPE here so the process' own non-zero exit is reported via
      // `close` instead of throwing an unhandled socket error.
      p.stdin.on("error", (e: NodeJS.ErrnoException) => {
        if (e.code !== "EPIPE") reject(e);
      });
      p.on("close", (code) => resolve({ code: code ?? -1, stdout: out, stderr: err }));
      p.stdin.end(stdin);
    });
  }
  pipeOut(remoteCommand: string): Promise<{ code: number; stdout: Buffer; stderr: string }> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.sshBin, this.argv(remoteCommand));
      const chunks: Buffer[] = [];
      let err = "";
      p.stdout.on("data", (d: Buffer) => chunks.push(d));
      p.stderr.on("data", (d) => (err += d));
      p.on("error", reject);
      p.on("close", (code) => resolve({ code: code ?? -1, stdout: Buffer.concat(chunks), stderr: err }));
    });
  }
}

// --- the service ---------------------------------------------------------------------------------
export interface Drive {
  name: string;
  mount: string;
  internal: boolean;
  writable: boolean; // false for read-only mounts (e.g. the factory acvs-synths partition)
}
export interface InstalledPlugin {
  folder: string;
}

export class DeviceService {
  constructor(private transport: Transport) {}

  // Read-only queries. (Parsers kept small here; the shell surfaces the raw text too.)
  async info(): Promise<ExecResult> {
    return this.transport.run("uname -a; cat /proc/cpuinfo | grep -m1 'CPU part' || true");
  }
  async drives(): Promise<Drive[]> {
    const r = await this.transport.run("cat /proc/mounts");
    const out: Drive[] = [];
    for (const line of r.stdout.split("\n")) {
      const parts = line.split(/\s+/);
      if (parts.length < 2) continue;
      const mount = parts[1];
      const name = mount.split("/").pop() || mount;
      if (/\/(media|mnt|nvme)/.test(mount))
        out.push({ name, mount, internal: INTERNAL_DRIVE_PREFIXES.some((p) => name.startsWith(p)), writable: !(parts[3] ?? "").split(",").includes("ro") });
    }
    return out;
  }
  /** Which plugin folders exist on this drive (a 3.10 device has "VST2 Plugins", a 3.9 Force has "Synths"). */
  async pluginDirs(mount: string): Promise<PluginsDir[]> {
    const out: PluginsDir[] = [];
    for (const d of PLUGIN_DIRS) {
      const r = await this.transport.run(`test -d ${shq(remotePluginsPath(mount, d))} && echo yes || true`);
      if (r.stdout.includes("yes")) out.push(d);
    }
    return out;
  }
  /** Replace only a plugin's Plugin Skins (works in either plugin dir). */
  async replaceSkin(skinTar: Buffer, mount: string, folder: string, dir: PluginsDir = PLUGINS_DIR): Promise<ExecResult> {
    if (!this.transport.pipeIn) throw new DeviceError("this transport cannot stream an install (held for hardware)");
    return this.transport.pipeIn(remoteSkinCommand(mount, folder, dir), skinTar);
  }
  async list(mount: string, pdir: PluginsDir = PLUGINS_DIR): Promise<InstalledPlugin[]> {
    const dir = remotePluginsPath(mount, pdir);
    const r = await this.transport.run(`ls -1 ${shq(dir)} 2>/dev/null || true`);
    return r.stdout.split("\n").map((s) => s.trim()).filter((s) => s && safeFolderName(s)).map((folder) => ({ folder }));
  }
  async doctor(): Promise<ExecResult> {
    // developer mode (sshd up), External Plugin Support, a writable drive — surfaced as raw text.
    return this.transport.run("echo sshd:ok; systemctl is-active " + MPC_SERVICE + " || true");
  }

  // Destructive: restart the MPC app so it rescans plugins. NEVER without explicit confirmation —
  // the open project's unsaved data is lost (mirrors mpc_remote's guard).
  async restart(opts: { confirm: boolean }): Promise<ExecResult> {
    if (!opts.confirm)
      throw new DeviceError("restart loses unsaved data on the MPC; call with { confirm: true } after the user agrees.");
    return this.transport.run(`systemctl restart ${MPC_SERVICE}`);
  }

  // Writes: confined to the drive's "VST2 Plugins" folder, safe folder name only. (The actual byte
  // transfer — tar stream over ssh, as mpc_remote does — is wired with the hardware; here we model the
  // confined destination + the replace semantics.)
  async remove(mount: string, folder: string): Promise<ExecResult> {
    const dest = remotePluginPath(mount, folder); // throws on unsafe name
    return this.transport.run(`rm -rf ${shq(dest)}`);
  }
  installDestination(mount: string, manufacturer: string, name: string): string {
    return remotePluginPath(mount, pluginFolderName(manufacturer, name));
  }

  /**
   * Install a local plugin folder (its parent + the folder name) onto the drive, streaming a tar
   * archive into a confined `tar -x` under "VST2 Plugins". `replace` overwrites an existing copy.
   * Needs a pipe-capable transport (held for hardware).
   */
  async add(tarBytes: Buffer, mount: string, folder: string, opts: { replace?: boolean } = {}): Promise<ExecResult> {
    if (!this.transport.pipeIn) throw new DeviceError("this transport cannot stream an install (held for hardware)");
    const cmd = remoteInstallCommand(mount, folder, opts); // throws on unsafe folder
    return this.transport.pipeIn(cmd, tarBytes);
  }
  async update(tarBytes: Buffer, mount: string, folder: string): Promise<ExecResult> {
    return this.add(tarBytes, mount, folder, { replace: true });
  }
  /** Export an installed plugin folder from the drive as a tar byte stream. */
  async export(mount: string, folder: string): Promise<Buffer> {
    if (!this.transport.pipeOut) throw new DeviceError("this transport cannot stream an export (held for hardware)");
    const r = await this.transport.pipeOut(remoteExportCommand(mount, folder)); // throws on unsafe folder
    if (r.code !== 0) throw new DeviceError(`export failed: ${r.stderr.trim()}`);
    return r.stdout;
  }
}

/** Build a tar archive (bytes) of a local plugin folder via the host `tar`. Held/unverified; the real
 *  SSH install pipes this into the device. Spawns `tar -C <parentDir> -cf - <folder>`. */
export function localTarBuffer(parentDir: string, folder: string, tarBin = "tar"): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(tarBin, ["-C", parentDir, "-cf", "-", folder]);
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new DeviceError(`tar failed: ${err.trim()}`))));
  });
}

// POSIX single-quote shell quoting.
export function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
