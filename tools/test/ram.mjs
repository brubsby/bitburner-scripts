// Offline RAM pricing for every script the daemon deploys, using the game's own
// `Script/RamCalculations.ts` rather than a reimplementation of it.
//
// Why that matters: the game prices every *bare identifier* by name, recursing
// the whole RamCosts tree (RamCalculations.ts:405-440 walks Identifier nodes,
// findFunc at :225-243 matches by bare name on any object). That is how a local
// variable called `attempt` once cost a script 10GB via ns.codingcontract.attempt.
// A hand-rolled "count the ns.* call sites" checker gets that wrong and gets it
// wrong silently. Two agents have already written calculators that reproduce
// this; using the real one removes the class of bug entirely.
//
// CALIBRATED: `calibrate()` reproduces the LIVE game's `calculateRam` over the
// control port for a sample of scripts and prints the error on every run, pass
// or fail. If the daemon is unreachable it says UNCALIBRATED in as many words
// rather than staying quiet — silence reads as "checked and fine", which is the
// state that produced two fabricated validations in this repo.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, isStale, OUT } from "./build-ram.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../..");

/**
 * The daemon's own file list, reproduced exactly (tools/rfa-daemon.mjs:31,39-52).
 * Reproduced rather than imported because importing the daemon module would
 * start it — and the daemon must not be disturbed. tools/test/hygiene.test.mjs
 * (invariant D1) is what asserts the two copies of SKIP_DIRS have not diverged.
 */
const SKIP_DIRS = new Set(["node_modules", "tools", "variants", "archive", "min", ".git", ".telemetry", ".idea"]);

export function trackedFiles(dir = REPO, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      out.push(...trackedFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name === "NetscriptDefinitions.d.ts") continue;
    else if (/\.(js|jsx|ts|tsx|txt|script)$/.test(entry.name)) {
      out.push({ local: path.join(dir, entry.name), remote: `${prefix}${entry.name}` });
    }
  }
  return out;
}

/** Root-level .js only — the set that hot-deploys and that a player types `run` on. */
export function rootScripts() {
  return trackedFiles()
    .filter((f) => f.remote.endsWith(".js") && !f.remote.includes("/"))
    .map((f) => f.remote)
    .sort();
}

let G = null;
let SCRIPTS = null;

export async function load() {
  if (G) return G;
  if (isStale()) await build({ quiet: true });
  G = await import(`${OUT}?t=${fs.statSync(OUT).mtimeMs}`);
  SCRIPTS = new Map();
  for (const f of trackedFiles()) {
    if (!/\.(js|jsx|ts|tsx|script)$/.test(f.remote)) continue;
    SCRIPTS.set(f.remote, { filename: f.remote, server: "home", code: fs.readFileSync(f.local, "utf8") });
  }
  return G;
}

export function source(name) {
  return SCRIPTS.get(name)?.code ?? null;
}

/**
 * Pretend to be a save with this BitNode and these Source-Files.
 *
 * This is not cosmetic. Singularity RAM costs are *functions* of player state
 * (RamCostGenerator.ts:82-96 — full price inside BN4, 16x at SF4.1, 4x at
 * SF4.2, 1x at SF4.3), so "the RAM of this script" is not a single number. A
 * suite that prices everything once has tested exactly one save.
 *
 * The stub is complete, not an approximation: RamCostGenerator.ts references
 * exactly two Player members, `bitNodeN` (:84) and `activeSourceFileLvl` (:87).
 */
export function asSave({ bitNode = 1, sf = {} } = {}) {
  G.setPlayer({ bitNodeN: bitNode, activeSourceFileLvl: (n) => sf[n] ?? 0 });
  return { bitNode, sf };
}

/** RAM of one script, or {error}. Prices the whole import graph. */
export function ramOf(name) {
  const s = SCRIPTS.get(name);
  if (!s) return { error: `not tracked: ${name}` };
  const r = G.calculateRamUsage(s.code, name, "home", SCRIPTS);
  if (r.errorCode !== undefined) return { error: `${G.RamCalculationErrorCode[r.errorCode] ?? r.errorCode}: ${r.errorMessage}` };
  // The game rounds for display but stores the raw sum; round the same way the
  // push log and `free` do so comparisons against the live value are exact.
  return { cost: Math.round(r.cost * 100) / 100, entries: r.entries };
}

/** Price an arbitrary code string as if it were a script on home. Used by the
 *  suite's own self-tests: a checker that has never been shown a known-bad
 *  input has not been shown to detect anything. */
export function priceCode(code, name = "__selftest.js") {
  const scratch = new Map(SCRIPTS);
  scratch.set(name, { filename: name, server: "home", code });
  const r = G.calculateRamUsage(code, name, "home", scratch);
  return r.errorCode !== undefined ? { error: r.errorMessage } : { cost: Math.round(r.cost * 100) / 100, entries: r.entries };
}

/**
 * Price a script as if `overlay` (remoteName -> code) were already deployed to
 * home, on top of everything that really is.
 *
 * This exists so a design staged under `tools/` — which the daemon does NOT
 * deploy — can be priced with the game's own calculator before anyone touches
 * the running game. A staged file that has only been eyeballed is an
 * unvalidated number, and this repo has shipped two of those.
 */
export function priceOverlay(overlay, name) {
  const scratch = new Map(SCRIPTS);
  for (const [n, code] of Object.entries(overlay)) scratch.set(n, { filename: n, server: "home", code });
  const s = scratch.get(name);
  if (!s) return { error: `not tracked: ${name}` };
  const r = G.calculateRamUsage(s.code, name, "home", scratch);
  if (r.errorCode !== undefined) return { error: `${G.RamCalculationErrorCode[r.errorCode] ?? r.errorCode}: ${r.errorMessage}` };
  return { cost: Math.round(r.cost * 100) / 100, entries: r.entries };
}

/** declaredNames(), but for a code string rather than a tracked file. */
export function declaredInCode(code) {
  const scratch = new Map(SCRIPTS);
  const name = "__overlay.js";
  scratch.set(name, { filename: name, server: "home", code });
  const keep = SCRIPTS;
  SCRIPTS = scratch;
  try {
    return declaredNames(name);
  } finally {
    SCRIPTS = keep;
  }
}

/** Every root script priced under one save. name -> {cost} | {error}. */
export function priceAll(subset) {
  const out = new Map();
  for (const n of subset ?? rootScripts()) out.set(n, ramOf(n));
  return out;
}

/**
 * The same acorn the game's RAM calculator parses with, and the same
 * RamCostConstants it compares an ns.ramOverride literal against.
 *
 * Exported so ramoverride.test.mjs can ask *why* an override was ignored using
 * the identical AST the game saw, instead of a regex over the source. The
 * authority on whether an override took effect is still `ramOf()`; this is only
 * how the diagnosis names which of the failure modes was hit.
 */
export function parseModule(code) {
  return G.acorn.parse(code, { sourceType: "module", ecmaVersion: "latest" });
}

/** RamCostConstants.Base — the floor an ns.ramOverride literal must reach. */
export const ramBase = () => G.RamCostConstants.Base;

/** Bare names under ns.singularity — the only costs that vary with SF4 level. */
export function singularityNames() {
  return new Set(Object.keys(G.RamCosts.singularity ?? {}));
}

/* --------------------------------------------- the ns cost tree, flattened */

/**
 * Every BARE NAME that carries RAM, with its cost.
 *
 * The game does not price `ns.codingcontract.attempt` — it prices the name
 * `attempt`, anywhere, on any object, declared or called (RamCalculations.ts:407
 * adds every Identifier; findFunc at :225-243 searches the whole RamCosts tree
 * by bare name). So this flattened set is the actual hazard list for a local
 * variable name. `attempt` cost 10GB once; `probe` cost 0.2GB via dnet.probe.
 */
export function pricedNames() {
  const out = new Map();
  const walk = (obj) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "object" && v !== null) walk(v);
      else {
        const cost = typeof v === "function" ? v() : v;
        if (typeof cost === "number" && cost > 0) out.set(k, Math.max(out.get(k) ?? 0, cost));
      }
    }
  };
  walk(G.RamCosts);
  return out;
}

/** Source with comments and string literals blanked, for "is it really used" tests. */
export function codeOnly(name) {
  const code = source(name) ?? "";
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
}

/** Static import graph of a root script: every module it pulls in, transitively. */
export function importsOf(name, seen = new Set()) {
  if (seen.has(name)) return seen;
  seen.add(name);
  const code = source(name);
  if (!code) return seen;
  for (const m of code.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)) {
    const dep = m[1].replace(/^\.?\//, "");
    if (SCRIPTS.has(dep)) importsOf(dep, seen);
  }
  return seen;
}

/** Names this file DECLARES: locals, params, functions, classes, imports. */
export function declaredNames(name) {
  const code = source(name);
  if (code == null) return null;
  let ast;
  try {
    ast = G.acorn.parse(code, { sourceType: "module", ecmaVersion: "latest" });
  } catch (e) {
    return { error: e.message };
  }
  const found = new Map(); // name -> kind
  const add = (n, kind) => n && !found.has(n) && found.set(n, kind);
  const pattern = (p, kind) => {
    if (!p) return;
    switch (p.type) {
      case "Identifier": return add(p.name, kind);
      case "ObjectPattern": return p.properties.forEach((q) => pattern(q.value ?? q.argument, kind));
      case "ArrayPattern": return p.elements.forEach((q) => pattern(q, kind));
      case "AssignmentPattern": return pattern(p.left, kind);
      case "RestElement": return pattern(p.argument, kind);
    }
  };
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    switch (node.type) {
      case "VariableDeclarator": pattern(node.id, "local"); break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.id) add(node.id.name, "function");
        node.params.forEach((p) => pattern(p, "param"));
        break;
      case "ClassDeclaration": if (node.id) add(node.id.name, "class"); break;
      case "CatchClause": pattern(node.param, "catch"); break;
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier": add(node.local?.name, "import"); break;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === "string") visit(v);
    }
  };
  visit(ast);
  return { found };
}

/* ------------------------------------------------------------- calibration */

const CONTROL = process.env.BB_CONTROL ?? "http://localhost:12526";

async function rpc(method, params) {
  const res = await fetch(`${CONTROL}/rpc`, {
    method: "POST",
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(4000),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

/**
 * Reproduce the running game's own calculateRam for `sample` scripts.
 *
 * Read-only: `calculateRam` and `/state` only. Never pushes, never deletes.
 * Returns {calibrated, rows:[{name, mine, live, err}], reason}.
 */
export async function calibrate(sample) {
  let state;
  try {
    const res = await fetch(`${CONTROL}/state`, { signal: AbortSignal.timeout(4000) });
    state = await res.json();
  } catch (e) {
    return { calibrated: false, rows: [], reason: `control port ${CONTROL} unreachable (${e.message})` };
  }
  // Price under the LIVE save's BitNode and Source-Files, or the comparison is
  // meaningless for any script touching singularity.
  const sf = {};
  for (const [n, lvl] of state.sourceFiles?.data ?? []) sf[n] = lvl;
  asSave({ bitNode: state.bitNode, sf });

  const rows = [];
  for (const name of sample) {
    let live;
    try {
      live = await rpc("calculateRam", { filename: name, server: "home" });
    } catch (e) {
      rows.push({ name, mine: ramOf(name).cost, live: null, err: null, note: e.message });
      continue;
    }
    const mine = ramOf(name).cost;
    rows.push({ name, mine, live, err: live ? Math.abs(mine - live) / live : mine === live ? 0 : 1 });
  }
  return { calibrated: true, rows, state, reason: null };
}
