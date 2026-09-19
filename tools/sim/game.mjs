// The game's own formulas, importable from node.
//
//   import { calculateHackingTime, calculateGrowMoney } from "./game.mjs";
//
// Everything re-exported here is the real bitburner-src implementation rather
// than a port, so it cannot drift from the game. The bundle is rebuilt
// automatically when the game source is newer (see env.mjs).
//
// The bundle is pulled in with a dynamic import on purpose. A static
// `export * from "./game.bundle.mjs"` is evaluated as a sibling of env.mjs,
// and the bundle touches the DOM while initialising its theme — it has to run
// strictly after the environment exists, which only awaiting guarantees.

import "./env.mjs";

const game = await import("./game.bundle.mjs");

/**
 * Point every formula at a BitNode's multipliers.
 *
 * THE BUG THIS EXISTS TO FIX. `currentNodeMults` is module state in the game
 * (BitNodeMultipliers.ts:188), initialised to a bare BitNodeMultipliers — every
 * field 1 — and changed only by `initBitNodeMultipliers()`, which the game calls
 * on load and on entering a node. Nothing in tools/sim ever called it. So every
 * model here computed **BitNode 1 physics** no matter which node we were in,
 * with every individual formula exactly right.
 *
 * In BitNode 4 that is `ScriptHackMoney 0.2` and `HackExpGain 0.4` read as 1:
 * **5x too high on hack money and 2.5x on experience**, silently, in every
 * offline number this repo has produced since entering BN4.
 *
 * It is set from the LIVE save by default, because the overwhelmingly common
 * case is "model the game we are actually playing" and the failure mode of
 * getting it wrong is invisible. Pass `n` explicitly to model a node we are not
 * in (bncheck.mjs does this deliberately).
 *
 * Returns the multipliers actually installed, so a caller can print them —
 * `calibrate.mjs` does, because a model that does not say which physics it used
 * is one silent default away from being wrong by 5x again.
 */
export function setBitNode(n, level = 1) {
  const mults = game.getBitNodeMultipliers(n, level);
  game.replaceCurrentNodeMults(mults);
  return mults;
}

/** Which BitNode the formulas are currently configured for, by signature. */
export function currentBitNode() {
  const m = game.currentNodeMults;
  for (let n = 1; n <= 14; n++) {
    const c = game.getBitNodeMultipliers(n, 1);
    if (Object.keys(c).every((k) => c[k] === m[k])) return n;
  }
  return null;
}

/**
 * Configure the physics from the LIVE save, at import time.
 *
 * This is deliberately automatic and deliberately noisy. The bug it replaces was
 * not "someone chose the wrong BitNode" — it was that nobody chose at all, and
 * the silent default happened to be right for the only node we had ever played.
 * A fix that must be remembered is the same bug with extra steps.
 *
 * If the daemon is unreachable the formulas stay at BitNode 1 and this says so
 * on stderr. That is the one case where a model can still be quietly wrong, so
 * it is the one case that shouts.
 */
async function autoConfigure() {
  try {
    const res = await fetch(`http://localhost:${process.env.CTL_PORT ?? 12526}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "getSaveFile" }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json();
    const zlib = await import("node:zlib");
    const raw = zlib.gunzipSync(Buffer.from(j.result.save, "latin1")).toString("utf8");
    const p = JSON.parse(JSON.parse(raw).data.PlayerSave).data;
    const n = p.bitNodeN ?? 1;
    const sf = new Map(p.sourceFiles?.data ?? []).get(n) ?? 0;
    setBitNode(n, sf + 1);
    if (!process.env.SIM_QUIET) console.error(`[sim] physics: BitNode ${n} (SF${n}.${sf})`);
    return n;
  } catch (err) {
    console.error(
      `[sim] *** PHYSICS NOT CONFIGURED *** could not read the live save (${String(err).slice(0, 60)}).\n` +
        `[sim] Formulas are running BitNode 1 multipliers. In BitNode 4 that is 5x too high on\n` +
        `[sim] hack money and 2.5x on experience. Call setBitNode(n) explicitly, or accept BN1.`,
    );
    return null;
  }
}

/** The BitNode the formulas were configured for at import, or null if unknown. */
export const configuredBitNode = await autoConfigure();

export default game;

export const {
  // src/Hacking.ts
  calculateHackingChance,
  calculateHackingExpGain,
  calculatePercentMoneyHacked,
  calculateHackingTime,
  calculateGrowTime,
  calculateWeakenTime,
  // src/Server/formulas/grow.ts
  calculateServerGrowth,
  calculateServerGrowthLog,
  calculateGrowMoney,
  // src/Server/ServerHelpers.ts
  numCycleForGrowthCorrected,
  processSingleServerGrowth,
  getCoreBonus,
  getWeakenEffect,
  // src/PersonObjects/formulas/*
  calculateSkill,
  calculateExp,
  calculateSkillProgress,
  getEmptySkillProgress,
  calculateIntelligenceBonus,
  // misc
  Server,
  ServerConstants,
  currentNodeMults,
  getUpgradeHomeRamCost,
  getUpgradeHomeCoresCost,
  // src/Server/ServerPurchases.ts
  getCloudServerCost,
  getCloudServerLimit,
  getCloudServerMaxRam,
  // src/Constants.ts, src/DarkWeb/DarkWebItems.ts
  CONSTANTS,
  DarkWebItems,
} = game;
