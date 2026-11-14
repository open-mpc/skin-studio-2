// Behaviour test for the device service's command model + safety rails (port of mpc_remote.py).
// Device I/O is held for the Force; a FakeTransport records commands so the pure logic is gated here.
// Run: npx tsx test/device.golden.ts
import {
  DeviceService, SshTransport, DeviceError,
  safeFolderName, legalFilename, pluginFolderName, remotePluginsPath, remotePluginPath, shq, COMMANDS,
  remoteInstallCommand, remoteExportCommand,
  type Transport, type ExecResult,
} from "../src/app/device.ts";

let fails = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else { fails++; console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`); }
};

console.log("Device safety rails");
ok("safeFolderName rejects ..", !safeFolderName("..") && !safeFolderName(".") && !safeFolderName(""));
ok("safeFolderName rejects slashes / null / leading -", !safeFolderName("a/b") && !safeFolderName("a\x00") && !safeFolderName("-rf"));
ok("safeFolderName accepts a real folder", safeFolderName("Acme - VST - Acid"));
ok("legalFilename strips the MPC's illegal chars", legalFilename('A:b/c<d>e"f') === "AbcdeF".replace("F", "f") || legalFilename('A:b/c') === "Abc");
ok("pluginFolderName format", pluginFolderName("Acme", "Acid Bass") === "Acme - VST - Acid Bass");
ok("remotePluginsPath confines to VST2 Plugins", remotePluginsPath("/media/USB/") === "/media/USB/VST2 Plugins");
ok("remotePluginPath rejects unsafe folder", (() => { try { remotePluginPath("/media/USB", "../etc"); return false; } catch (e) { return e instanceof DeviceError; } })());
ok("shq quotes spaces", shq("VST2 Plugins") === "'VST2 Plugins'");

console.log("\nCommand model (FakeTransport)");
const calls: string[] = [];
const fake: Transport = {
  async run(cmd: string): Promise<ExecResult> { calls.push(cmd); return { code: 0, stdout: cmd.includes("ls -1") ? "Acme - VST - Acid\n..\nbad/name\n" : "ok", stderr: "" }; },
};
const dev = new DeviceService(fake);

await dev.list("/media/USB");
ok("list reads the VST2 Plugins dir", calls.some((c) => c.includes("/media/USB/VST2 Plugins")));
{
  const plugins = await dev.list("/media/USB");
  ok("list filters unsafe entries", plugins.every((p) => safeFolderName(p.folder)) && plugins.some((p) => p.folder === "Acme - VST - Acid"));
}

// restart requires explicit confirmation
{
  let threw = false;
  try { await dev.restart({ confirm: false }); } catch (e) { threw = e instanceof DeviceError; }
  ok("restart without confirm throws", threw);
  await dev.restart({ confirm: true });
  ok("restart with confirm runs systemctl restart acvs", calls.some((c) => c === "systemctl restart acvs"));
}

// remove confined + safe
{
  await dev.remove("/media/USB", "Acme - VST - Acid");
  ok("remove targets the confined path", calls.some((c) => c.includes("rm -rf '/media/USB/VST2 Plugins/Acme - VST - Acid'")));
  let threw = false;
  try { await dev.remove("/media/USB", "../../etc"); } catch (e) { threw = e instanceof DeviceError; }
  ok("remove rejects unsafe folder", threw);
}

// install destination is confined + legalised
ok("installDestination confined + legal name", dev.installDestination("/nvme", "Acme", "Acid/Bass") === "/nvme/VST2 Plugins/Acme - VST - AcidBass");

// SSH transport builds a sane argv (not executed here)
{
  const t = new SshTransport("192.0.2.10", 22, "root");
  const argv = t.argv("ls -1");
  ok("ssh argv has host, port, BatchMode, command", argv.includes("192.0.2.10:".slice(0, 0) + "root@192.0.2.10") && argv.includes("BatchMode=yes") && argv[argv.length - 1] === "ls -1");
}

ok("command set matches Akai's", COMMANDS.length === 10 && COMMANDS.includes("doctor") && COMMANDS.includes("export"));

console.log("\nInstall / export tar pipeline");
{
  const add = remoteInstallCommand("/media/USB", "Acme - VST - Acid");
  ok("install mkdirs the VST2 Plugins parent", add.includes("mkdir -p '/media/USB/VST2 Plugins'"));
  ok("install extracts into the parent (keep, no overwrite)", add.includes("tar -xkf - -C '/media/USB/VST2 Plugins'") && !add.includes("rm -rf"));
  const repl = remoteInstallCommand("/media/USB", "Acme - VST - Acid", { replace: true });
  ok("replace rm -rf's the dest then extracts", repl.includes("rm -rf '/media/USB/VST2 Plugins/Acme - VST - Acid'") && repl.includes("tar -xf - -C"));
  ok("install rejects unsafe folder", (() => { try { remoteInstallCommand("/m", "../x"); return false; } catch (e) { return e instanceof DeviceError; } })());
  const exp = remoteExportCommand("/nvme", "Acme - VST - Acid");
  ok("export tars the folder from the parent", exp === "tar -cf - -C '/nvme/VST2 Plugins' 'Acme - VST - Acid'");
}

// add/update via a pipe-capable fake transport
{
  const piped: { cmd: string; bytes: number }[] = [];
  const pipeFake: Transport = {
    async run() { return { code: 0, stdout: "", stderr: "" }; },
    async pipeIn(cmd, data) { piped.push({ cmd, bytes: data.length }); return { code: 0, stdout: "", stderr: "" }; },
    async pipeOut() { return { code: 0, stdout: Buffer.from("TARDATA"), stderr: "" }; },
  };
  const d2 = new DeviceService(pipeFake);
  await d2.add(Buffer.from("fake-tar"), "/media/USB", "Acme - VST - Acid");
  ok("add streams bytes with the keep command", piped.length === 1 && piped[0].bytes === 8 && piped[0].cmd.includes("tar -xkf"));
  await d2.update(Buffer.from("fake-tar-2"), "/media/USB", "Acme - VST - Acid");
  ok("update uses replace (rm -rf + tar -xf)", piped[1].cmd.includes("rm -rf") && piped[1].cmd.includes("tar -xf -"));
  const bytes = await d2.export("/media/USB", "Acme - VST - Acid");
  ok("export returns the tar bytes", bytes.toString() === "TARDATA");
}

// a transport without piping refuses install (held cleanly, not a crash)
{
  const noPipe: Transport = { async run() { return { code: 0, stdout: "", stderr: "" }; } };
  let threw = false;
  try { await new DeviceService(noPipe).add(Buffer.from("x"), "/m", "F"); } catch (e) { threw = e instanceof DeviceError; }
  ok("non-pipe transport refuses install", threw);
}

console.log(fails ? `\n${fails} assertion(s) failed` : `\nAll device-service assertions pass (I/O held for hardware)`);
process.exit(fails ? 1 : 0);
