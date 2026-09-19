// [SF] Source-File gates are complete, and sfgate.js still agrees with the game.
//
// The bug class: a capability gate written from memory that is *almost* right.
// `ownedSF.get(14) >= 2` looks like the rule and is not — the real one
// (netscriptGoImplementation.ts:488-489) also grants access at level 1 inside
// BitNode 14. Being wrong this way is silent: the script does not crash, it
// simply never uses a capability it has, in the one BitNode built around it.
//
// Three things are checked here.
//
//   SF1 sfgate.js's rules still match the game's source. The citations in that
//       file are checked, not trusted — each rule is located in the game's own
//       source and the clauses are asserted to still be there, and the
//       singularity RAM ladder is differential-tested against the live cost
//       function out of the bundle.
//   SF2 No root script open-codes a Source-File comparison. Anything touching
//       `ownedSF` / `activeSourceFile` / `sourceFiles` outside sfgate.js is a
//       second copy of a rule, and second copies drift.
//   SF3 Every Source-File-gated API family a root script touches is gated
//       through sfgate.js — and the family table itself is checked for
//       completeness against the game's own `NetscriptFunctions/` gates, so a
//       family nobody thought of fails the build rather than being missed.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { load, asSave, ramOf, rootScripts, source, codeOnly, importsOf, REPO } from "./ram.mjs";
import { GAME } from "./build-ram.mjs";

const gameSrc = (rel) => fs.readFileSync(path.join(GAME, "src", rel), "utf8");

/** Find `re` in a game source file and report the 1-based line it is on. */
function citeLine(rel, re) {
  const lines = gameSrc(rel).split("\n");
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return { line: i + 1, text: lines[i].trim() };
  return null;
}

/**
 * Every Source-File-gated API family, with the game file that gates it.
 *
 * `sfgate` names the helper in sfgate.js that a script must route through. A
 * family with `sfgate: null` is one the game gates and sfgate.js does not yet
 * know about — that is itself a finding, not a licence to skip it.
 */
const FAMILIES = [
  { id: "singularity", sf: 4, ns: /^singularity\./, gate: "NetscriptFunctions/Singularity.ts", cite: /checkSingularityAccess/, sfgate: "canUseSingularity" },
  { id: "go.cheat", sf: 14,
    // `/^cheat\./`, NOT `/^go\.cheat\./`. RamCostGenerator records this family
    // as `cheat.removeRouter`, `cheat.destroyNode` and so on — the `go.`
    // prefix is not part of the recorded name. The old pattern could not match
    // anything, so invariant B4 was asserted by a check that was dead for the
    // one file it exists to police.
    ns: /^(go\.)?cheat\./, gate: "Go/effects/netscriptGoImplementation.ts", cite: /activeSourceFileLvl\(14\)/, sfgate: "canUseGoCheat" },
  { id: "gang", sf: 2, ns: /^gang\./, gate: "PersonObjects/Player/PlayerObjectGangMethods.ts", cite: /canAccessBitNodeFeature\(2\)/, sfgate: "canUseGang" },
  { id: "bladeburner", sf: 6, ns: /^bladeburner\./, gate: "NetscriptFunctions/Bladeburner.ts", cite: /canAccessBitNodeFeature\(7\)\s*\|\|\s*canAccessBitNodeFeature\(6\)/, sfgate: "canUseBladeburner" },
  { id: "sleeve", sf: 10, ns: /^sleeve\./, gate: "NetscriptFunctions/Sleeve.ts", cite: /canAccessBitNodeFeature\(10\)/, sfgate: "canUseSleeve" },
  { id: "corporation", sf: 3, ns: /^corporation\./, gate: "PersonObjects/Player/PlayerObjectCorporationMethods.ts", cite: /canAccessBitNodeFeature\(3\)/, sfgate: "canUseCorporation" },
  // Grafting is Source-File 10 — the SAME gate as sleeves, not one of its own.
  { id: "grafting", sf: 10, ns: /^grafting\./, gate: "PersonObjects/Player/PlayerObjectGeneralMethods.ts", cite: /canAccessGrafting/, sfgate: "canUseGrafting" },
  // The stock gate is a LEVEL comparison (>= 2 for shorts, >= 3 for orders), so
  // the helper takes the level rather than answering a yes/no.
  { id: "stock-4S", sf: 8, ns: /^stock\.(get4SMarketData|getOrders|purchase4SMarketData|has4SData)/, gate: "NetscriptFunctions/StockMarket.ts", cite: /activeSourceFileLvl\(8\)/, sfgate: "canUseStockSF" },
  { id: "hacknet-servers", sf: 9, ns: /^hacknet\.(numHashes|hashCapacity|hashCost|spendHashes|upgradeCache|getHashUpgrade)/, gate: "Hacknet/HacknetHelpers.tsx", cite: /canAccessBitNodeFeature\(9\)/, sfgate: "hasHacknetServers" },
  { id: "bitnode-mults", sf: 5, ns: /^getBitNodeMultipliers$/, gate: "NetscriptFunctions.ts", cite: /canAccessBitNodeFeature\(5\)/, sfgate: "canReadBitNodeMultipliers" },
  // Stanek is NOT Source-File gated at the API — it is gated on owning the
  // augmentation. Listed so the completeness sweep does not re-flag it and so
  // nobody adds a phantom SF13 gate for it. canAccessBitNodeFeature(13) only
  // controls whether the gift can be ACQUIRED.
  { id: "stanek", sf: 13, ns: /^stanek\./, gate: "NetscriptFunctions/Stanek.ts", cite: /hasAugmentation\(AugmentationName\.StaneksGift1/, sfgate: "hasStaneksGift", note: "gated on owning StaneksGift1, not on SF13 directly" },
];

export async function run() {
  await load();
  return [rulesCheck(), openCodedCheck(), familyCheck()];
}

/* ----------------------------------------------------------------- SF1 --- */

function rulesCheck() {
  const c = new Check("SF1", "sfgate.js's rules still match game source (invariants A11, A12, A13)");
  const sf = source("sfgate.js");
  if (!sf) {
    c.fail("sfgate.js is missing from the repo root", "every other check in C assumes it exists");
    return c;
  }

  // Each rule: where it lives in the game, the clauses that must still be
  // there, and the clause sfgate.js must still encode. Both sides are checked —
  // a check that only reads our file is a check that we wrote the same thing
  // twice.
  const RULES = [
    {
      id: "canAccessFeature",
      rel: "BitNode/BitNodeUtils.ts",
      game: /Player\.bitNodeN === bitNode \|\| Player\.activeSourceFileLvl\(bitNode\) > 0/,
      ours: /currentNode === n \|\| sfLevel\(resetInfo, n\) > 0/,
      says: "being INSIDE BitNode n grants n's feature with no Source-File",
    },
    {
      id: "go.cheat",
      rel: "Go/effects/netscriptGoImplementation.ts",
      game: /activeSourceFileLvl\(14\) === 1 && Player\.bitNodeN === 14/,
      ours: /sf14 > 1 \|\| \(sf14 === 1 && resetInfo\?\.currentNode === 14\)/,
      says: "level > 1, OR level exactly 1 while inside BitNode 14 — NOT `>= 2`",
    },
    {
      id: "homeStartRam",
      rel: "Prestige.ts",
      game: /activeSourceFileLvl\(9\) >= 2/,
      ours: /sfLevel\(resetInfo, 9\) >= 128 \? 128 : 0|if \(sfLevel\(resetInfo, 9\) >= 2\) return 128/,
      says: "128GB with SF9>=2, 32GB with SF1, otherwise 8GB",
    },
    {
      id: "homeStartRam-sf1",
      rel: "Prestige.ts",
      game: /activeSourceFileLvl\(1\) > 0/,
      ours: /if \(sfLevel\(resetInfo, 1\) > 0\) return 32/,
      says: "the SF1 arm — 32GB, which is the only one this save has ever seen",
    },
  ];

  for (const r of RULES) {
    c.examined(1);
    const found = citeLine(r.rel, r.game);
    if (!found) {
      c.fail(`game source no longer contains the rule sfgate.js cites for ${r.id}`, `${r.rel}: expected ${r.game}\nsfgate.js says: ${r.says}`);
      continue;
    }
    c.note(`${r.id.padEnd(18)} ${r.rel}:${found.line}  ${found.text.slice(0, 88)}`);
    if (!r.ours.test(sf)) {
      c.fail(`sfgate.js no longer encodes ${r.id}`, `expected to find ${r.ours} in sfgate.js — the rule is ${r.says}`);
    }
  }

  // Citation hygiene: sfgate.js names file:line in its header. Line numbers
  // rot. Check every one that names a line range.
  for (const m of source("sfgate.js").matchAll(/([A-Za-z/]+\.tsx?):(\d+)(?:-(\d+))?/g)) {
    const [, rel, a, b] = m;
    c.examined(1);
    const full = ["", "BitNode/", "Netscript/", "Go/effects/", "Server/"].map((p) => path.join(GAME, "src", p, rel)).find((p) => fs.existsSync(p));
    if (!full) { c.warn(`sfgate.js cites ${rel} which is not where the test looks`, "citation not machine-checkable"); continue; }
    const lines = fs.readFileSync(full, "utf8").split("\n");
    const lo = Number(a), hi = Number(b ?? a);
    if (hi > lines.length) c.fail(`sfgate.js cites ${rel}:${a}${b ? "-" + b : ""} but that file has ${lines.length} lines`, "stale citation");
  }

  /* The one rule that can be executed rather than read: the singularity RAM
     ladder. sfgate.js claims a multiplier; the game's own cost function is in
     the bundle. Compare them over every save state. */
  return differentialLadder(c);
}

async function sfgateModule() {
  return import(path.join(REPO, "sfgate.js"));
}

function differentialLadder(c) {
  // Deliberately synchronous-looking: the caller awaits the Check array, and a
  // Check is just data, so returning a promise here is fine.
  return (async () => {
    const g = await import(`${path.join(REPO, "tools/test/ram.bundle.mjs")}`);
    const mod = await sfgateModule();
    const BASE = 3; // singularity.joinFaction base cost, RamCostGenerator.ts
    let worst = 0;
    for (const bitNode of [1, 4, 12]) {
      for (const lvl of [0, 1, 2, 3]) {
        g.setPlayer({ bitNodeN: bitNode, activeSourceFileLvl: (n) => (n === 4 ? lvl : 0) });
        const gameMult = g.RamCosts.singularity.joinFaction() / BASE;
        const ours = mod.singularityRamMultiplier({ currentNode: bitNode, ownedSF: new Map([[4, lvl]]) });
        c.examined(1);
        if (ours !== gameMult) {
          c.fail(
            `sfgate.singularityRamMultiplier disagrees with the game at BN${bitNode}, SF4.${lvl}`,
            `sfgate says x${ours}, RamCosts.singularity.joinFaction() implies x${gameMult}`,
          );
        }
        worst = Math.max(worst, gameMult);
      }
    }
    c.note(`singularity RAM ladder: 12 (bitNode, SF4 level) pairs checked against RamCosts directly — worst multiplier x${worst}`);
    return c;
  })();
}

/* ----------------------------------------------------------------- SF2 --- */

function openCodedCheck() {
  const c = new Check("SF2", "no root script open-codes a Source-File comparison (invariants A11)");
  const RAW = /\b(ownedSF|activeSourceFileLvl|activeSourceFiles|sourceFiles)\b/;
  for (const name of rootScripts()) {
    c.examined(1);
    if (name === "sfgate.js") continue;
    const code = codeOnly(name);
    if (!RAW.test(code)) continue;
    const lines = source(name).split("\n");
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const bare = lines[i].replace(/\/\/.*$/, "");
      if (RAW.test(bare)) hits.push(`${name}:${i + 1}  ${lines[i].trim().slice(0, 100)}`);
    }
    if (!hits.length) continue;
    const routed = [...importsOf(name)].includes("sfgate.js");
    c.fail(
      `${name} reads Source-File state directly${routed ? " despite importing sfgate.js" : ""}`,
      hits.join("\n") + `\nThe rule belongs in sfgate.js. A second copy is how \`>= 2\` survived for go.cheat.`,
    );
  }
  return c;
}

/* ----------------------------------------------------------------- SF3 --- */

function familyCheck() {
  const c = new Check("SF3", "every Source-File-gated API is routed through sfgate.js (invariant B4)");
  const sfgateSrc = source("sfgate.js") ?? "";

  // First: does the table still describe the game? A family whose gate has
  // moved is a family whose rule we no longer know.
  for (const f of FAMILIES) {
    c.examined(1);
    let found = null;
    try {
      found = citeLine(f.gate, f.cite);
    } catch (e) {
      c.fail(`family table cites ${f.gate}, which does not exist`, e.message);
      continue;
    }
    if (!found) c.fail(`family ${f.id}: the gate this test expects is gone from ${f.gate}`, `looked for ${f.cite}`);
    else c.note(`${f.id.padEnd(16)} SF${String(f.sf).padEnd(2)} ${f.gate}:${found.line}${f.note ? `  (${f.note})` : ""}`);
    if (f.sfgate && !new RegExp(`\\b${f.sgate ?? f.sfgate}\\b`).test(sfgateSrc)) {
      c.fail(`sfgate.js no longer exports ${f.sfgate} for family ${f.id}`, "the gate has no single source of truth");
    }
  }

  // Completeness: any SF gate in the game's NS API layer that this table does
  // not account for. A new gated namespace upstream should break the build.
  const known = new Set(FAMILIES.map((f) => f.gate));
  const dir = path.join(GAME, "src/NetscriptFunctions");
  for (const file of fs.readdirSync(dir)) {
    const txt = fs.readFileSync(path.join(dir, file), "utf8");
    const gates = [...txt.matchAll(/canAccessBitNodeFeature\((\d+)\)|activeSourceFileLvl\((\d+)\)|checkSingularityAccess/g)];
    if (!gates.length) continue;
    c.examined(1);
    if (known.has(`NetscriptFunctions/${file}`)) continue;
    c.fail(
      `NetscriptFunctions/${file} contains a Source-File gate this test does not know about`,
      `found: ${[...new Set(gates.map((g) => g[0]))].join(", ")}\nAdd it to FAMILIES in tools/test/sfgate.test.mjs.`,
    );
  }

  // Now the actual scripts.
  //
  // Detection is by the game's OWN billing, not by grepping for `ns.singularity.`.
  // autobuy.js does `const sing = ns.singularity` and then `sing.purchaseTor()`,
  // which no source regex catches and which the RAM calculator bills correctly
  // as `singularity.purchaseTor`. Grepping would have reported autobuy.js clean.
  asSave({ bitNode: 4 });
  const stacked = new Set();
  const boot = source("boot.js") ?? "";
  const watch = source("watchdog.js") ?? "";
  for (const m of [...boot.matchAll(/script:\s*'([^']+)'/g), ...watch.matchAll(/script:\s*'([^']+)'/g)])
    for (const dep of importsOf(m[1])) stacked.add(dep);

  // A specialist exec'd by a gated caller is correctly gated — that IS the
  // go.js / go-cheat.js pattern CLAUDE.md prescribes, and the whole point of
  // putting the expensive surface in its own script. Derived, not hardcoded: a
  // script is exempt if some root script imports sfgate.js AND names it.
  const gatedCallers = new Map();
  for (const caller of rootScripts()) {
    if (!importsOf(caller).has("sfgate.js")) continue;
    // RAW source here, deliberately — NOT codeOnly(). We are looking for a
    // FILENAME INSIDE A STRING LITERAL (`ns.exec('go-cheat.js', ...)`), and
    // codeOnly blanks string literals, so this loop matched nothing and every
    // gated-caller exemption was dead. codeOnly is right for "is this
    // identifier really used"; it is exactly wrong for "which file does this
    // script launch".
    for (const m of (source(caller) ?? "").matchAll(/['"]([\w.-]+\.js)['"]/g)) {
      if (!gatedCallers.has(m[1])) gatedCallers.set(m[1], caller);
    }
  }

  for (const name of rootScripts()) {
    if (name === "sfgate.js") continue;
    const entries = (ramOf(name).entries ?? []).map((e) => e.name);
    const routed = importsOf(name).has("sfgate.js");
    for (const f of FAMILIES) {
      const used = entries.filter((e) => f.ns.test(e));
      if (!used.length) continue;
      c.examined(1);
      if (routed) continue;
      if (gatedCallers.has(name)) {
        c.note(`${name} uses ${f.id} but is exec'd by ${gatedCallers.get(name)}, which gates through sfgate.js — the go.js/go-cheat.js split`);
        continue;
      }
      const what = `${name} uses the ${f.id} API (Source-File ${f.sf}) with no gate — billed: ${used.slice(0, 4).join(", ")}${used.length > 4 ? ` +${used.length - 4}` : ""}`;
      const detail =
        `gated by ${f.gate}${f.note ? ` — ${f.note}` : ""}.\n` +
        (f.sfgate
          ? `Import { ${f.sfgate} } from 'sfgate.js' and probe ns.getResetInfo() (1GB) before calling.`
          : `sfgate.js has NO helper for this family yet — add one, citing ${f.gate}.`) +
        `\nA try/catch around the call is not a substitute: the RAM is billed statically in every BitNode whether or not the call is reachable.`;
      if (stacked.has(name)) c.fail(what, detail);
      else c.warn(what, detail);
    }
  }
  return c;
}
