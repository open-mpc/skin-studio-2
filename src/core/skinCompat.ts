// skinCompat.ts — faithful TypeScript port of mpc-vst-plugins tools/skin_compat.py (v1).
//
// NO-REGRESSION CONTRACT: reproduces v1's os_compat()/skin_problems() output exactly (message wording,
// ordering, version/field sorting). Verified against frozen v1 output in
// test/golden/skin-compat.goldens.json. Change v1 first, re-freeze, then mirror here.
//
// Question answered: does a plugin's skin use only the JSON object versions/fields that the stock skins of
// MPC OS 2.15.1 use? If so it is "2.x-shaped" (2.x reads it, and 3.x too); otherwise it is 3.x-only.
// The reference table (src/core/skin_roles_2x.json) holds version numbers and field names only — no Akai file.

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TABLE_PATH = path.join(HERE, "skin_roles_2x.json");

const MAX_GLIBC_2X: [number, number] = [2, 32];
// Component types MPC defines itself; any other type name is a widget the skin defines locally.
const BASE_TYPES = new Set(["Image", "Label", "Focus", "Button", "Knob", "Slider", "Meter", "Decorator", "Indicator"]);

export type Table = Record<string, Record<string, string[]>>;
// role -> versionString -> set of field names
type Roles = Map<string, Map<string, Set<string>>>;

function addRole(out: Roles, role: string, version: unknown, fields: Iterable<string>): void {
  const vkey = String(version);
  let byV = out.get(role);
  if (!byV) {
    byV = new Map();
    out.set(role, byV);
  }
  let set = byV.get(vkey);
  if (!set) {
    set = new Set();
    byV.set(vkey, set);
  }
  for (const f of fields) set.add(f);
}

// Mirror skin_compat.roles_of: {role: {version: {field,...}}} for every versioned object.
export function rolesOf(doc: unknown, prefix: string): Roles {
  const out: Roles = new Map();

  function walk(o: unknown, role: string, typ: unknown): void {
    if (o !== null && typeof o === "object" && !Array.isArray(o)) {
      const obj = o as Record<string, unknown>;
      if ("version" in obj) {
        let key = role;
        if (role === "data") {
          key = "data:" + (typeof typ === "string" && BASE_TYPES.has(typ) ? typ : "(local widget)");
        }
        addRole(out, prefix + key, obj["version"], Object.keys(obj).filter((k) => k !== "version"));
      }
      for (const [k, x] of Object.entries(obj)) {
        const childRole = k + (Array.isArray(x) ? "[]" : "");
        const childTyp = k === "data" ? obj["type"] : typ;
        walk(x, childRole, childTyp);
      }
    } else if (Array.isArray(o)) {
      for (const x of o) walk(x, role, typ);
    }
  }

  walk(doc, "(root)", null);
  return out;
}

function mergeRoles(into: Roles, from: Roles): void {
  for (const [role, byV] of from) {
    for (const [v, fields] of byV) addRole(into, role, v, fields);
  }
}

export function loadTable(tablePath: string = TABLE_PATH): Table {
  return JSON.parse(fs.readFileSync(tablePath, "utf8")).roles as Table;
}

export function skinProblems(tui: any, qlinks: any = null, table: Table = loadTable()): string[] {
  if (tui === null || typeof tui !== "object" || tui.pageData === null || typeof tui.pageData !== "object") {
    return ["TUI.json has no pageData"];
  }
  const seen = rolesOf(tui, "TUI:");
  if (qlinks !== null && qlinks !== undefined) mergeRoles(seen, rolesOf(qlinks, "QLinks:"));

  const problems: string[] = [];
  for (const role of [...seen.keys()].sort()) {
    const known = table[role]; // undefined == Python's None
    const byV = seen.get(role)!;
    for (const v of [...byV.keys()].sort()) {
      // version keys are already strings; Python sorts them with key=str — same order.
      if (known === undefined) {
        problems.push(`${role}: not a kind of object 2.15.1 skins have (version ${v})`);
      } else if (!(v in known)) {
        problems.push(`${role} version ${v} (2.15.1 uses ${Object.keys(known).sort().join(", ")})`);
      } else {
        const knownFields = new Set(known[v]);
        const extra = [...byV.get(v)!].filter((f) => !knownFields.has(f)).sort();
        if (extra.length) {
          problems.push(`${role} version ${v} has field(s) 2.15.1 does not use: ${extra.join(", ")}`);
        }
      }
    }
  }
  return problems;
}

// (generations the plugin is compatible with, why not 2.x). glibc is "x.y[.z]" or null.
export function osCompat(
  glibc: string | null,
  tui: any,
  qlinks: any = null,
  table: Table = loadTable()
): { gens: string[]; why: string[] } {
  const why: string[] = [];
  if (glibc) {
    const [maj, min] = glibc.split(".").slice(0, 2).map((p) => parseInt(p, 10));
    if (maj > MAX_GLIBC_2X[0] || (maj === MAX_GLIBC_2X[0] && min > MAX_GLIBC_2X[1])) {
      why.push(`needs glibc ${glibc}, MPC OS 2.x has about 2.32`);
    }
  }
  why.push(...skinProblems(tui, qlinks, table));
  return { gens: why.length ? ["3.x"] : ["2.x", "3.x"], why };
}
