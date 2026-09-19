// [C5] No unregistered BitNode-multiplier constant.
//
// CLAUDE.md says: "when a script gains a constant that depends on a multiplier,
// add it to the ASSUMPTIONS table in bncheck.mjs in the same commit." That is an
// instruction, and instructions are not enforcement — `contract.js`'s 75e6 and
// `pserv.js`'s 25 both went in without it.
//
// How this avoids being a regex that cries wolf: it does not scan for "numbers
// that look suspicious". Each SENSOR names a quantity the game multiplies by a
// BitNodeMultiplier, reads that quantity's BASE VALUE out of the game's own
// constants at run time, and only then looks for that exact literal in a root
// .js — and only on a line whose text is about the right subject. So `25` in a
// sleep timer is invisible and `25` next to "servers" is not, and if upstream
// changes ServerWeakenAmount from 0.05 the sensor moves with it instead of
// silently matching nothing.
//
// Three directions are checked, and the second and third are the ones that
// catch rot:
//   C5a a literal that matches a sensor must be registered in bncheck
//   C5b a bncheck registration must still point at a file that exists
//   C5c a bncheck registration that names a file must still be TRUE of that
//       file — a `where` that says "nfg.js MIN_FAVOR = 150" after nfg.js stops
//       saying 150 is worse than no entry, because it reads as checked.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { load, rootScripts, source, REPO } from "./ram.mjs";
import { GAME } from "./build-ram.mjs";

const BNCHECK = path.join(REPO, "tools/sim/bncheck.mjs");

/** Locate a regex in a game source file; returns {line, text} or null. */
function cite(rel, re) {
  const lines = fs.readFileSync(path.join(GAME, "src", rel), "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return { line: i + 1, text: lines[i].trim() };
  return null;
}

/**
 * Quantities the game multiplies by a BitNodeMultiplier.
 *
 * base:  read from the game at run time, so it cannot go stale
 * at:    the line in game source that applies the multiplier — checked, so a
 *        refactor upstream breaks this test rather than quietly disarming it
 * about: what the line in OUR code has to be talking about for a literal of
 *        this value to count. This is the false-positive control.
 */
function sensors(G) {
  const bn1 = G.getBitNodeMultipliers(1, 1);
  const wd = G.serverMetadata.find((s) => s.hostname === "w0r1d_d43m0n");
  return [
    { mult: "ServerWeakenRate", base: G.ServerConstants.ServerWeakenAmount, at: ["Server/ServerHelpers.ts", /ServerWeakenAmount \* threads \* coreBonus \* currentNodeMults\.ServerWeakenRate/], about: /weaken|security/i },
    { mult: "FavorToDonateToFaction", base: G.CONSTANTS.BaseFavorToDonate, at: ["Faction/formulas/donation.ts", /BaseFavorToDonate \* currentNodeMults\.FavorToDonateToFaction/], about: /favor|donat/i },
    { mult: "FactionWorkRepGain", base: G.CONSTANTS.DonateMoneyToRepDivisor, at: ["Faction/formulas/donation.ts", /DonateMoneyToRepDivisor.*currentNodeMults\.FactionWorkRepGain/], about: /donat|rep\b|reputation/i },
    { mult: "DaedalusAugsRequirement", base: bn1.DaedalusAugsRequirement, at: ["Programs/Programs.ts", /currentNodeMults\.DaedalusAugsRequirement/], about: /daedalus/i /* NOT /augmentation/: Illuminati's requirement is a flat
       haveAugmentations(30) (FactionInfo.tsx:132) and is NOT multiplied, so
       faction.js:8 carrying a bare 30 is correct. Matching it would be the
       false positive that gets this test deleted. */ },
    { mult: "WorldDaemonDifficulty", base: typeof wd?.requiredHackingSkill === "number" ? wd.requiredHackingSkill : null, at: ["Server/ServerHelpers.ts", /requiredHackingSkill \*= currentNodeMults\.WorldDaemonDifficulty/], about: /w0r1d|daemon|red ?pill|endgame/i },
    { mult: "CloudServerLimit", base: G.ServerConstants.CloudServerLimit, at: ["Server/ServerPurchases.ts", /ServerConstants\.CloudServerLimit \* currentNodeMults\.CloudServerLimit/], about: /server|pserv|cloud|fleet/i },
    { mult: "CloudServerMaxRam", base: G.ServerConstants.CloudServerMaxRam, at: ["Server/ServerPurchases.ts", /ServerConstants\.CloudServerMaxRam \* currentNodeMults\.CloudServerMaxRam/], about: /server|ram|cloud|fleet/i },
    { mult: "CloudServerCost", base: G.ServerConstants.BaseCostFor1GBOfRamServer, at: ["Server/ServerPurchases.ts", /currentNodeMults\.CloudServerCost/], about: /server|cost|gb|cloud/i },
    { mult: "HomeComputerRamCost", base: G.ServerConstants.BaseCostFor1GBOfRamHome, at: ["PersonObjects/Player/PlayerObjectServerMethods.ts", /BaseCostFor1GBOfRamHome \* mult \* currentNodeMults\.HomeComputerRamCost/], about: /home|ram|cost|upgrade/i },
    { mult: "CodingContractMoney", base: G.CONSTANTS.CodingContractBaseMoneyGain, at: ["PersonObjects/Player/PlayerObjectGeneralMethods.ts", /CodingContractBaseMoneyGain \* difficulty \* currentNodeMults\.CodingContractMoney/], about: /contract|reward|money/i },
    { mult: "GoPower", base: 0.002, at: ["Go/effects/effect.ts", /0\.002 \* power \* currentNodeMults\.GoPower/], about: /go\b|node ?power|ipvgo|effect/i },
  ];
}

/** bncheck's ASSUMPTIONS table, parsed out of its source (importing it pulls in jsdom). */
function bncheckAssumptions() {
  const src = fs.readFileSync(BNCHECK, "utf8");
  const out = [];
  for (const m of src.matchAll(/id:\s*"([^"]+)",[\s\S]*?mult:\s*"([^"]+)",[\s\S]*?where:\s*"((?:[^"\\]|\\.)*)"/g)) {
    out.push({ id: m[1], mult: m[2], where: m[3] });
  }
  return out;
}

/** Literal forms a base value can be written as in JS. */
function literalForms(v) {
  const out = new Set([String(v)]);
  if (Number.isInteger(v)) {
    out.add(v.toExponential().replace("e+", "e"));
    if (v >= 1000) out.add(v.toLocaleString("en-US").replace(/,/g, "_"));
    const exp = Math.log10(v);
    if (Number.isInteger(exp) && exp >= 3) out.add(`1e${exp}`);
    // 75000000 -> 75e6, 1048576 -> 2 ** 20
    const s = String(v);
    const zeros = s.length - s.replace(/0+$/, "").length;
    if (zeros >= 3) out.add(`${s.slice(0, s.length - zeros)}e${zeros}`);
    const log2 = Math.log2(v);
    if (Number.isInteger(log2) && log2 >= 10) out.add(`2 ** ${log2}`);
  }
  return [...out];
}

export async function run() {
  const G = await load();
  const c = new Check("C5", "BitNode-multiplier constants are registered in bncheck.mjs (invariant C5)");
  const SENSORS = sensors(G);
  const registry = bncheckAssumptions();
  c.note(`bncheck.mjs ASSUMPTIONS parsed: ${registry.length} entries covering ${new Set(registry.map((r) => r.mult)).size} multipliers`);

  /* -- the sensors themselves must still describe the game --------------- */
  for (const s of SENSORS) {
    c.examined(1);
    if (s.base == null) {
      c.fail(`sensor for ${s.mult} could not read its base value from the game`, "the constant it watches has moved or been renamed");
      continue;
    }
    const found = cite(s.at[0], s.at[1]);
    if (!found) {
      c.fail(`the game no longer applies ${s.mult} where this test expects`, `${s.at[0]}: looked for ${s.at[1]}\nThis test is now watching a rule that has moved. Re-find it before trusting anything below.`);
      continue;
    }
    c.note(`${s.mult.padEnd(24)} base ${String(s.base).padEnd(9)} applied at ${s.at[0]}:${found.line}`);
  }

  /* -- C5a: literals in root .js must be registered ----------------------- */
  const registered = (mult, file) => registry.some((r) => r.mult === mult && r.where.includes(file));

  // THE ONE EXEMPTION, and why it is not a hole.
  //
  // bitNodeMultipliers.js's BITNODE_OVERRIDES table is not a consumer that
  // hardcoded a multiplier-dependent constant — it IS the multiplier values,
  // transcribed from BitNode.tsx so they can be read without SF5. Every sensor
  // fires on it by construction, which would bury the real findings.
  //
  // What makes this safe rather than a blind spot is that the table is checked
  // HARDER than this file could check it: BN1 diffs all 304 of its entries
  // against ~/Repos/bitburner/src/BitNode/BitNode.tsx on every run and fails on
  // any drift. The exemption moves the verification, it does not remove it.
  //
  // The exemption is bounded to the table's own line range, so a genuinely
  // hardcoded constant ELSEWHERE in the same file is still caught. And because
  // CLAUDE.md's "an exemption that never matches" is a real failure here —
  // sfgate.test.mjs has one that can never fire — the range is asserted
  // non-empty below rather than assumed.
  const exemptRange = (() => {
    const src = source("bitNodeMultipliers.js");
    if (!src) return null;
    const lines = src.split("\n");
    const start = lines.findIndex((l) => l.includes("const BITNODE_OVERRIDES"));
    if (start < 0) return null;
    let end = start;
    while (end < lines.length && !/^\}/.test(lines[end])) end++;
    return end > start + 1 ? { start: start + 1, end: end + 1 } : null;
  })();
  c.examined(1);
  if (!exemptRange) {
    c.fail("the BITNODE_OVERRIDES exemption matched nothing",
      "an exemption that cannot fire is indistinguishable from no exemption, and hides whichever finding it was meant to allow — " +
        "if the table was renamed or removed, delete this exemption rather than leaving it dead");
  } else {
    c.note(`BITNODE_OVERRIDES exempted at bitNodeMultipliers.js:${exemptRange.start}-${exemptRange.end}, verified instead by check BN1`);
  }

  let hits = 0;
  let exempted = 0;
  for (const name of rootScripts()) {
    const lines = source(name).split("\n");
    c.examined(1);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(\/\/|\*)/.test(line)) continue; // a comment is prose, not a constant
      if (name === "bitNodeMultipliers.js" && exemptRange && i + 1 >= exemptRange.start && i + 1 <= exemptRange.end) {
        exempted++;
        continue;
      }
      for (const s of SENSORS) {
        if (s.base == null || !s.about.test(line)) continue;
        const forms = literalForms(s.base);
        const hit = forms.find((f) => new RegExp(`(^|[^\\w.])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w.]|$)`).test(line));
        if (!hit) continue;
        // Already multiplied by the real thing right here? Then it is correct.
        if (/getBitNodeMultipliers\(\)/.test(line)) continue;
        hits++;
        if (registered(s.mult, name)) continue;
        c.fail(
          `${name}:${i + 1} hardcodes ${hit}, which the game multiplies by ${s.mult}, and bncheck.mjs does not know`,
          `  ${line.trim()}\n` +
            `${s.at[0]} multiplies this quantity by currentNodeMults.${s.mult}.\n` +
            `Add an ASSUMPTIONS entry to tools/sim/bncheck.mjs with mult: "${s.mult}" and a \`where\` naming ${name}, ` +
            `or read the multiplier at run time.`,
        );
      }
    }
  }
  c.note(`${hits} multiplier-dependent literals found in root .js (registered or not)`);
  if (exempted) c.note(`${exempted} line(s) inside the BITNODE_OVERRIDES table skipped here and checked by BN1 instead`);

  /* -- C5b/C5c: registrations must still be true --------------------------- */
  for (const r of registry) {
    c.examined(1);
    // Every filename the `where` names must exist.
    // Match the FULL cited path, not just the basename. A citation may point
    // into archive/ or docs/ — `archive/superseded/pserv.js` is a legitimate
    // reference to a script that was archived, and reading only the basename
    // reported it as "pserv.js, which does not exist" while the file was
    // sitting exactly where the citation said.
    for (const m of r.where.matchAll(/\b((?:[\w.-]+\/)*[\w.-]+\.(?:js|md))\b/g)) {
      const f = m[1];
      const exists = fs.existsSync(path.join(REPO, f)) || fs.existsSync(path.join(REPO, "docs", f.replace(/^docs\//, ""))) || fs.existsSync(path.join(REPO, f.replace(/^docs\//, "docs/")));
      if (!exists) c.fail(`bncheck [${r.id}] cites ${f}, which does not exist`, `where: ${r.where}`);
    }
    // If a sensor covers this multiplier and the `where` names a root script,
    // the literal had better still be in that script.
    const s = SENSORS.find((x) => x.mult === r.mult);
    if (!s || s.base == null) continue;
    // Entries whose `where` says the value is READ at run time are describing a
    // script that deliberately has no literal. Checking for one would flag the
    // correct thing. buyserv.js is the worked example: it reads
    // ns.cloud.getServerLimit, so 25 not appearing is the point.
    if (/\bis read\b|reads |adapts|at runtime|run time/i.test(r.where)) continue;
    for (const m of r.where.matchAll(/\b([\w.-]+\.js)\b/g)) {
      const f = m[1];
      const code = source(f);
      if (!code) continue;
      const forms = literalForms(s.base);
      // Whole file, comments included, and no subject filter: the registration
      // has already asserted *which* file, so all that is left to check is
      // whether the number is still in it. A constant that lives in a header
      // comment (go.js's GoPower tables) counts.
      const present = forms.some((v) => new RegExp(`(^|[^\\w.])${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w.]|$)`).test(code));
      if (!present) {
        c.warn(
          `bncheck [${r.id}] says the ${r.mult} assumption lives in ${f}, but ${f} no longer contains ${s.base} on a relevant line`,
          `where: ${r.where}\nEither the constant moved (update the entry) or it was removed (drop the entry). ` +
            `A registration that is no longer true reads as "checked" and is worse than none.`,
        );
      }
    }
  }

  /* -- coverage: which sensors nothing in the repo triggers -------------- */
  const covered = new Set(registry.map((r) => r.mult));
  const uncovered = SENSORS.filter((s) => !covered.has(s.mult)).map((s) => s.mult);
  if (uncovered.length) c.note(`multipliers this test watches that bncheck has no entry for at all: ${uncovered.join(", ")}`);

  return [c, ...runBC9()];
}

/* ----------------------------------------------------------------- BC9 --- */
/**
 * [BC9] factions.js lists EVERY faction the game has — no hand-picked subset.
 *
 * THE RULE: every faction and every augmentation is a candidate for the
 * augmentation count. A subset written by hand is a silent cap on the search
 * space, and silent is the operative word — the 16 factions progress.js used to
 * omit appeared in neither `joinForecasts` nor `unpriceable`, so nothing in any
 * telemetry file said they had been skipped.
 *
 * Measured cost of that omission, in BitNode 1, nine augmentations short of
 * Daedalus with the hacking multiplier already past the exit requirement: the
 * schedule grinding 1,138,561 reputation at ECorp (5.8h budgeted) while
 * Tian Di Hui's eight augmentations sat behind 138,750 and Netburners' five
 * behind 28,125. Its own forecast put the augmentation count 92.5 hours away.
 *
 * Re-derived from the game's FactionName enum on every run, so a game update
 * that adds a faction fails HERE rather than quietly shrinking the plan.
 */
function runBC9() {
  const c = new Check("BC9", "factions.js is the complete faction list, re-derived from the game's own enum");
  const enumSrc = fs.readFileSync(path.join(GAME, "src/Faction/Enums.ts"), "utf8");
  const fromGame = [...enumSrc.matchAll(/(\w+) = "([^"]+)"/g)].map((m) => m[2]);
  c.examined(1);
  if (fromGame.length < 30) {
    c.fail(`only ${fromGame.length} names parsed out of Faction/Enums.ts — the parser, not the data, is probably wrong`);
    return [c];
  }

  const mod = fs.readFileSync(path.join(REPO, "factions.js"), "utf8");
  const listed = [...mod.matchAll(/^  '(.+?)',$/gm)].map((m) => m[1].replace(/\\'/g, "'"));
  const nonFactions = ["unknown", "rumored", "known"];
  const expected = fromGame.filter((n) => !nonFactions.includes(n));

  c.examined(1);
  const missing = expected.filter((n) => !listed.includes(n));
  if (missing.length) {
    c.fail(`factions.js is missing ${missing.length} faction(s) the game defines: ${missing.join(", ")}`,
      "a faction absent from this list is invisible to the planner — not ranked low, not reported as skipped, just gone");
  }
  c.examined(1);
  const extra = listed.filter((n) => !expected.includes(n));
  if (extra.length) {
    c.fail(`factions.js lists ${extra.length} name(s) the game does not: ${extra.join(", ")}`);
  }
  // The three discovery states are excluded ON PURPOSE. Asserting it stops a
  // future reader "fixing" the list by adding them back.
  c.examined(1);
  for (const n of nonFactions) {
    if (listed.includes(n)) c.fail(`'${n}' is a FactionName discovery STATE, not a faction, and must not be a candidate`);
  }
  c.note(`${listed.length} factions, matching the game's enum exactly (${nonFactions.length} discovery states correctly excluded)`);
  return [c];
}

