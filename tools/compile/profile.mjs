// A capability profile: the (BitNode, Source-Files, home RAM, owned augs) tuple
// that decides which ns surfaces a build is allowed to reference.
//
//   node tools/compile/profile.mjs                     # the LIVE save
//   node tools/compile/profile.mjs --bitnode 1         # a node we are not in
//   node tools/compile/profile.mjs --bitnode 1 --sf 4:1
//   node tools/compile/profile.mjs --bitnode 14 --sf 14:1 --home-ram 64
//
// READ-ONLY against the daemon. The only RPC it makes is `getSaveFile`, which
// the install procedure in CLAUDE.md already uses for backups and which does
// NOT consume the 24h export-favor bonus. It never pushes, deletes or restarts.
//
// ---------------------------------------------------------------------------
// Why the capability rules are IMPORTED rather than restated.
//
// Every rule here has an "...or you are currently inside that BitNode" clause,
// and every one of them is easy to write from memory without it. go.js shipped
// `ownedSF.get(14) >= 2`, which is wrong in exactly BitNode 14 — silently, with
// no error, in the one node built around the capability. sfgate.js is where
// that class of mistake was made once and fixed once, with citations into the
// game source.
//
// So this module builds the same `resetInfo` shape the game hands a script
// (NetscriptFunctions.ts:1444 — ownedSF is a Map, ownedAugs a Set, plus
// currentNode and bitNodeOptions) and calls sfgate's predicates on it. If
// sfgate.js is corrected, every build produced after that correction changes
// with it. A compile-time constant that is a second copy of a runtime rule is a
// fork, and forks drift — CLAUDE.md's "true here, false elsewhere".
//
// The one thing this file is allowed to know that sfgate does not: `dist`
// cannot ask the game anything at compile time, so the profile also carries the
// identity of the save it was derived from (`source`, `stamp`) for the runtime
// mismatch check. See NOTES-compile.md.

import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../..");

// The live rules, not a copy of them.
const sfgate = await import(path.join(REPO, "sfgate.js"));

const CONTROL = process.env.BB_CONTROL ?? "http://localhost:12526";

/* ------------------------------------------------------------- the save */

async function rpc(method, params) {
  const res = await fetch(`${CONTROL}/rpc`, {
    method: "POST",
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

/** gzip(latin1) -> JSON, exactly as tools/rfa-daemon.mjs:304-309 does it. */
function decodeSave(result) {
  const raw = result.binary
    ? zlib.gunzipSync(Buffer.from(result.save, "latin1")).toString("utf8")
    : Buffer.from(result.save, "base64").toString("utf8");
  return JSON.parse(raw);
}

// The save is a reviver tree: each section is itself a JSON string.
const section = (save, name) => {
  const v = save?.data?.[name];
  return typeof v === "string" ? JSON.parse(v) : v;
};

/**
 * Read the live save into a profile.
 *
 * Throws rather than defaulting if anything it needs is absent. A profile that
 * quietly falls back to "no Source-Files" would produce a build that silently
 * loses every gated capability — the worst failure shape in CLAUDE.md — and it
 * would look like a successful build.
 */
export async function liveProfile() {
  const save = decodeSave(await rpc("getSaveFile"));
  const p = section(save, "PlayerSave")?.data;
  if (!p) throw new Error("save has no PlayerSave section — schema drift, refusing to guess");
  if (typeof p.bitNodeN !== "number") throw new Error("save has no PlayerSave.bitNodeN — refusing to guess the BitNode");

  // sourceFiles is serialised as a JSONMap: {ctor:'JSONMap', data:[[n,lvl],...]}
  const sfPairs = p.sourceFiles?.data ?? p.sourceFiles;
  if (!Array.isArray(sfPairs)) throw new Error("save has no PlayerSave.sourceFiles array — refusing to guess Source-File levels");
  const sf = Object.fromEntries(sfPairs);

  const servers = section(save, "AllServersSave") ?? {};
  let homeRam = null;
  for (const key of Object.keys(servers)) {
    const s = servers[key]?.data ?? servers[key];
    if (s?.hostname === "home") homeRam = s.maxRam;
  }
  if (homeRam == null) throw new Error("save has no home server — refusing to guess home RAM");

  const augs = (p.augmentations ?? []).map((a) => a?.data?.name ?? a?.name ?? a);

  return makeProfile({
    bitNode: p.bitNodeN,
    sf,
    homeRam,
    augs,
    bitNodeOptions: p.bitNodeOptions ?? {},
    source: `live save ${save?.data?.SaveIdentifier ?? ""}`.trim(),
  });
}

/* --------------------------------------------------------- the profile */

/**
 * Build a profile from explicit inputs. Every capability is derived, never
 * passed in — there is exactly one place a rule can be wrong, and it is
 * sfgate.js.
 */
export function makeProfile({ bitNode, sf = {}, homeRam = null, augs = [], bitNodeOptions = {}, source = "hand-set" }) {
  if (typeof bitNode !== "number" || bitNode < 1) throw new Error(`bitNode must be a number, got ${bitNode}`);

  // Exactly the shape ns.getResetInfo() returns, so sfgate's predicates run
  // against the same input in the build as they do in the game.
  const resetInfo = {
    currentNode: bitNode,
    ownedSF: new Map(Object.entries(sf).map(([n, lvl]) => [Number(n), lvl])),
    ownedAugs: new Set(augs),
    bitNodeOptions,
  };

  const caps = {
    // Singularity: the big one. Not "do we have SF4" — inside BN4 the API is
    // free of the Source-File entirely (BitNodeUtils.ts:17), which is the whole
    // reason docs/autonomy.md builds the autonomous stack there.
    CAP_SINGULARITY: sfgate.canUseSingularity(resetInfo),
    // What a singularity call costs relative to base: x16 / x4 / x1
    // (RamCostGenerator.ts:82-96). Not a capability — a budget input. A build
    // that references singularity at all needs this to decide whether the
    // surface is affordable at this home size.
    SING_RAM_MULT: sfgate.singularityRamMultiplier(resetInfo),
    // go.cheat.*: sf14 > 1, OR sf14 === 1 while inside BitNode 14.
    CAP_GO_CHEAT: sfgate.canUseGoCheat(resetInfo),
    CAP_GANG: sfgate.canUseGang(resetInfo),
    CAP_SLEEVE: sfgate.canUseSleeve(resetInfo),
    CAP_CORPORATION: sfgate.canUseCorporation(resetInfo),
    CAP_BLADEBURNER: sfgate.canUseBladeburner(resetInfo),
    CAP_GRAFTING: sfgate.canUseGrafting(resetInfo),
    CAP_HACKNET_SERVERS: sfgate.hasHacknetServers(resetInfo),
    CAP_STANEK: sfgate.hasStaneksGift(resetInfo),
    CAP_STOCK_SHORT: sfgate.canShortStock(resetInfo),
    CAP_STOCK_ORDERS: sfgate.canUseStockOrders(resetInfo),
    CAP_BN_MULTS: sfgate.canReadBitNodeMultipliers(resetInfo),
  };

  // homeRam: measured if we read a save, otherwise the node-entry floor
  // (Prestige.ts:242-248) — which is a real number, not a guess, and is the
  // budget a bootstrap build has to fit inside.
  const startRam = sfgate.homeStartRam(resetInfo);

  return {
    bitNode,
    sf,
    homeRam: homeRam ?? startRam,
    homeStartRam: startRam,
    homeRamMeasured: homeRam != null,
    augs,
    bitNodeOptions,
    source,
    caps,
    // Identity of this build's regime, stamped into every output so the running
    // game can notice it is executing a build for a different save. Deliberately
    // made of the INPUTS, not the derived capabilities: two different inputs
    // that happen to agree today should still be distinguishable.
    stamp: stampOf(bitNode, sf),
  };
}

/** `bn4/sf1.1` — short, stable, and cheap for a script to compare. */
export function stampOf(bitNode, sf) {
  const parts = Object.entries(sf)
    .map(([n, lvl]) => [Number(n), lvl])
    .filter(([, lvl]) => lvl > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([n, lvl]) => `sf${n}.${lvl}`);
  return [`bn${bitNode}`, ...parts].join("/") || `bn${bitNode}`;
}

/** Parse `--sf 4:1,14:2` into {4:1, 14:2}. */
export function parseSf(s) {
  if (!s) return {};
  const out = {};
  for (const pair of s.split(",")) {
    const m = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(pair);
    if (!m) throw new Error(`--sf entry must be N:LEVEL, got "${pair}"`);
    out[Number(m[1])] = Number(m[2]);
  }
  return out;
}

/** Every flag this tool understands. Anything else is a refusal, not a default. */
const KNOWN = new Set(["bitnode", "sf", "home-ram", "augs", "json", "dry-run", "help"]);
const VALUED = new Set(["bitnode", "sf", "home-ram", "augs"]);

/**
 * The profile a command line asks for: `--bitnode` present means hand-set,
 * absent means read the live save.
 *
 * A hand-set profile is not a lesser thing — CLAUDE.md's "write for every stage
 * of the game" is exactly the requirement to produce a build for a regime we
 * are not in, and the payoff table in NOTES-compile.md is four of them.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REFUSES UNKNOWN ARGUMENTS, which most CLIs here do not.
 *
 * The first version silently ignored anything it did not recognise and fell
 * through to `liveProfile()`. Under zsh, `for a in "--bitnode 1"; do node
 * build.mjs $a; done` passes ONE argument, `"--bitnode 1"`, because zsh does
 * not word-split unquoted parameters — so `indexOf("--bitnode")` missed, the
 * flag vanished, and three consecutive builds that were supposed to be BN1,
 * BN1+SF4.1 and BN14 were all silently built for the LIVE save instead. Every
 * one of them printed a correct-looking header, a passing RAM gate and an
 * identical table, and it took a third look to notice the three "different"
 * regimes had produced byte-identical output.
 *
 * That is the exact failure this whole prototype is supposed to be protecting
 * against — a build produced for the wrong regime, reporting success — and it
 * happened to the build tool itself within an hour of it existing. It is also a
 * good argument for the runtime check in profilecheck.js: had that dist been
 * deployed, nothing in the game would have complained either.
 */
export async function profileFromArgs(argv = process.argv.slice(2)) {
  const unknown = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const name = a.slice(2).split("=")[0];
    if (!KNOWN.has(name)) unknown.push(a);
    else if (VALUED.has(name) && !a.includes("=")) i++; // skip its value
  }
  if (unknown.length) {
    throw new Error(
      `unrecognised argument(s): ${unknown.map((u) => JSON.stringify(u)).join(", ")}\n` +
        `  known flags: ${[...KNOWN].map((k) => "--" + k).join(" ")}\n` +
        `  Refusing rather than falling back to the live save: a build for the wrong\n` +
        `  profile that reports success is the failure this tool exists to prevent.\n` +
        `  (If this came from a shell loop, zsh does not word-split unquoted \$vars —\n` +
        `  use "\${=a}" or an array.)`,
    );
  }

  const opt = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    if (i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) return argv[i + 1];
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    if (i >= 0) throw new Error(`--${name} needs a value`);
    return dflt;
  };
  const bn = opt("bitnode", null);
  if (bn == null) return liveProfile();
  return makeProfile({
    bitNode: Number(bn),
    sf: parseSf(opt("sf", "")),
    homeRam: opt("home-ram", null) == null ? null : Number(opt("home-ram", null)),
    augs: (opt("augs", "") || "").split(",").filter(Boolean),
    source: "hand-set (--bitnode)",
  });
}

export function describeProfile(p) {
  const on = Object.entries(p.caps)
    .filter(([k, v]) => k.startsWith("CAP_") && v)
    .map(([k]) => k.replace("CAP_", "").toLowerCase());
  return [
    `profile ${p.stamp}   (${p.source})`,
    `  home RAM   ${p.homeRam}GB ${p.homeRamMeasured ? "(measured)" : `(node-entry floor for these Source-Files)`}`,
    `  singularity x${p.caps.SING_RAM_MULT} RAM`,
    `  capable of: ${on.length ? on.join(", ") : "nothing Source-File-gated"}`,
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = await profileFromArgs();
  console.log(describeProfile(p));
  if (process.argv.includes("--json")) console.log(JSON.stringify(p, (k, v) => (v instanceof Map || v instanceof Set ? [...v] : v), 2));
}
