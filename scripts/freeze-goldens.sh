#!/usr/bin/env bash
# Re-freeze every golden corpus from v1 (the oracle). Run ONLY when v1's tools intentionally change;
# then mirror the change in the matching src/core/*.ts until `npm test` passes again.
#
#   V1=/path/to/mpc-vst-plugins bash scripts/freeze-goldens.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V1="${V1:?set V1 to a checkout of the v1 tool (open-mpc/mpc-vst-plugins)}"
FIX="$ROOT/test/golden/fixtures"
[ -f "$V1/tools/skin_check.py" ] || { echo "v1 not found at $V1"; exit 1; }

# keep the reference data table in sync (data only; no Akai file)
cp "$V1/tools/skin_roles_2x.json" "$ROOT/src/core/skin_roles_2x.json"

python3 - "$V1" "$FIX" "$ROOT/test/golden" <<'PY'
import json, os, subprocess, sys
v1, fix, goldendir = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, os.path.join(v1, "tools"))
import skin_compat
table = skin_compat.load_table(os.path.join(v1, "tools", "skin_roles_2x.json"))
names = sorted(d for d in os.listdir(fix) if os.path.isdir(os.path.join(fix, d)))

check, compat = {}, {}
for name in names:
    d = os.path.join(fix, name)
    # skin_check via the CLI (its exact stdout)
    r = subprocess.run([sys.executable, "tools/skin_check.py", d], cwd=v1, capture_output=True, text=True)
    check[name] = [l for l in r.stdout.splitlines() if l.strip()]
    # skin_compat via its own os_compat (full, untruncated)
    tui = json.load(open(os.path.join(d, "TUI.json")))
    qlp = os.path.join(d, "Q-Links.json")
    ql = json.load(open(qlp)) if os.path.exists(qlp) else None
    gens, why = skin_compat.os_compat(None, tui, ql, table)
    compat[name] = {"gens": gens, "why": why}
    print(f"{name}: check={len(check[name])}  compat={' and '.join(gens)} ({len(why)})")

json.dump(check, open(os.path.join(goldendir, "skin-check.goldens.json"), "w"), indent=2)
json.dump(compat, open(os.path.join(goldendir, "skin-compat.goldens.json"), "w"), indent=2)
print("froze", len(names), "fixtures x 2 suites")
PY

# ---------------------------------------------------------------------------------------------
# Base-builder goldens: re-run the SDK's gen_ui.py (the Akai oracle) over the authored uigen
# fixtures, and refresh the mpc-red kit manifest the uiBuilder consumes. Needs the SDK.
# ---------------------------------------------------------------------------------------------
SDK="${SDK:?set SDK to a checkout of inmusic-software/mpc-plugin-builder-sdk}"
UIGEN="$ROOT/test/golden/uigen"
if [ -f "$SDK/tools/gen_ui.py" ]; then
  tmp="$(mktemp -d)"
  PYTHONPATH="$SDK/tools" python3 "$SDK/tools/make_ui_kit.py" --out "$tmp/mpc-red" --theme mpc-red --quiet
  python3 - "$tmp/mpc-red/kit.json" "$UIGEN/kit-manifest.mpc-red.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
assets = {n: [a["file"], a["frames"], [a["width"], a["height"]]] for n, a in m["assets"].items()}
json.dump({"theme": m["theme"], "assets": assets}, open(sys.argv[2], "w"), indent=2)
print("froze kit-manifest.mpc-red.json")
PY
  # gen_ui drops the Akai kit PNGs beside TUI.json. Stock MPC art is Akai's — never commit it:
  # record each referenced PNG's sha256[:16] (so uiKit parity can be gated) then delete the files.
  python3 - "$SDK" "$UIGEN" <<'PY'
import hashlib, json, os, subprocess, sys
sdk, uigen = sys.argv[1], sys.argv[2]
env = dict(os.environ, PYTHONPATH=os.path.join(sdk, "tools"))
hashes = {}
for name in sorted(os.listdir(uigen)):
    f = os.path.join(uigen, name)
    pj = os.path.join(f, "params.json")
    if not os.path.isfile(pj):
        continue
    out = os.path.join(f, "out", "Plugin Skins")
    cmd = [sys.executable, os.path.join(sdk, "tools", "gen_ui.py"), "--params", pj, "--out", out, "--quiet"]
    uijson = os.path.join(f, "ui.json")
    if os.path.isfile(uijson):
        cmd[4:4] = ["--ui", uijson]
    subprocess.run(cmd, env=env, check=True)
    pngs = {}
    for fn in sorted(os.listdir(out)):
        if fn.endswith(".png"):
            p = os.path.join(out, fn)
            pngs[fn] = hashlib.sha256(open(p, "rb").read()).hexdigest()[:16]
            os.remove(p)  # Akai art: recorded, not committed
    hashes[name] = pngs
    print("froze uigen/" + name)
json.dump(hashes, open(os.path.join(uigen, "kit-assets.sha256.json"), "w"), indent=2)
PY
  # uiKit golden: full-kit byte hashes for the mpc-red theme (no PNGs committed — Akai's art).
  python3 - "$SDK" "$ROOT/test/golden/uikit/mpc-red.sha256.json" <<'PY'
import hashlib, json, os, subprocess, sys, tempfile
sdk, dst = sys.argv[1], sys.argv[2]
d = tempfile.mkdtemp()
env = dict(os.environ, PYTHONPATH=os.path.join(sdk, "tools"))
subprocess.run([sys.executable, os.path.join(sdk, "tools", "make_ui_kit.py"), "--out", d, "--theme", "mpc-red", "--quiet"], env=env, check=True)
assets = {fn: hashlib.sha256(open(os.path.join(d, fn), "rb").read()).hexdigest()
          for fn in sorted(os.listdir(d)) if fn.endswith(".png")}
man = hashlib.sha256(open(os.path.join(d, "kit.json"), "rb").read()).hexdigest()
os.makedirs(os.path.dirname(dst), exist_ok=True)
json.dump({"theme": "mpc-red", "manifestSha256": man, "assets": assets}, open(dst, "w"), indent=2)
open(dst, "a").write("\n")
print("froze uikit/mpc-red.sha256.json (%d assets)" % len(assets))
PY
  rm -rf "$tmp"
else
  echo "SDK not at $SDK; skipped uigen (base-builder) and uikit goldens"
fi
