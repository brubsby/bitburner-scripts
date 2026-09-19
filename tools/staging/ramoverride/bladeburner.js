// STAGED ns.ramOverride REWRITE of bladeburner.js, with the game-knowledge.md
// §1/§10 defects FIXED.
//
// Every constant is cited against ~/Repos/bitburner (v3.0.2, commit b5b09b8a8).
//
// THIS SCRIPT CANNOT RUN IN BITNODE 4. It needs Source-File 6 or Source-File 7
// (NetscriptFunctions/Bladeburner.ts:35 —
// `canAccessBitNodeFeature(7) || canAccessBitNodeFeature(6)`), and then
// membership of the division. The refusal goes through sfgate.js's
// canUseBladeburner, never an open-coded check, and is published to
// /tel/bladeburner.txt rather than merely returned.
//
// ---------------------------------------------------------------------------
// RAMOVERRIDE 2.6GB — excludes: the whole ns.bladeburner.* surface (~22 calls at 4GB each, NOT scaled by Source-File 4 — RamCostGenerator.ts applies SF4Cost only to the singularity namespace) and ns.singularity.isBusy (0.5GB at base, 8GB at SF4.1), plus common.js's kill/ps/hacknet reads.
//
// Why this is sound: Netscript bills a script for every ns identifier in its
// import graph whether or not the call is reachable (RamCalculations.ts:407
// prices Identifier nodes, findFunc at :225-243 matches bare names), but only
// CALLING a Source-File-gated function throws. So this file may carry the
// references, declare 2.6GB, refuse to act when sfgate.js says it cannot, and be
// correct — instead of being unloadable in every BitNode that cannot use it.
//
// 2.6 = RamCostConstants.Base (1.6) + ns.getResetInfo (1.0). That is everything
// called before the capability decision: sfgate.js is pure, status.js touches
// only ns.write (0GB), and atExit / tprint / print / flags are all 0GB.
//
// When the capability IS present the allocation is raised to the file's FULL
// static price before anything expensive runs, because `dynamicRamUsage` only
// rises and crossing the allocation kills the script
// (NetscriptHelpers.tsx:498-520). A raise the host cannot afford is SILENTLY
// DENIED (NetscriptFunctions.ts:1210-1214 returns the old value), which is why
// it goes through ramgrow.js and why this file returns rather than continuing.
//
// Registered in tools/sim/bncheck.mjs STRUCTURAL. Asserted by
// tools/test/ramoverride.test.mjs [R1..R5]: the game's own calculator prices
// this file in four regimes and the suite fails if the override is ignored or
// if RAISE_CEILING does not reach the full static price.
//
// ---------------------------------------------------------------------------
// WHAT WAS BROKEN.
//
// 1. Every action-type string was invalid. BladeburnerActionType is
//    "General" / "Contracts" / "Operations" / "Black Operations"
//    (Bladeburner/Enums.ts:1-6); the file said "general"/"contract"/
//    "operation"/"black operation". getAction routes the type through a strict
//    nsGetMember (NetscriptFunctions/Bladeburner.ts:46), so the first call
//    threw. The type is now read from `ns.enums.BladeburnerActionType`, which
//    is the game's own frozen enum (NetscriptFunctions.ts:122-145) — the action
//    NAMES are not exposed through ns.enums, so those stay literals, each cited
//    against Bladeburner/Enums.ts.
//
// 2. `currantAction` — a ReferenceError on the first loop iteration.
//    getCurrentAction() also returns **null** when idle
//    (NetscriptFunctions/Bladeburner.ts:120-124), so `currentAction.type` would
//    have thrown as soon as the typo was fixed. Both are handled by sameAction().
//
// 3. getActionTime returns MILLISECONDS
//    (NetscriptFunctions/Bladeburner.ts:125-130, with the explicit comment
//    "// return ms instead of seconds"), and getBonusTime is also ms
//    (:365-368, `storedCycles * CONSTANTS.MilliPerCycle`). The file multiplied
//    by 1000, so every sleep was 1000x too long — a 30-second contract slept
//    for 8 hours.
//
// 4. Duplicate object key "Stealth Retirement Operation". The second literal
//    silently won, giving it 1500 / 1.06 / 1.14 / hpLoss 5 — which are
//    Assassination's numbers. The game says 1000 / 1.05 / 1.11 / hpLoss 10
//    (Bladeburner/data/Operations.ts:161-166). That fed staminaLoss(), so
//    Stealth Retirement's stamina cost was over-stated by
//    (1500^0.28 + 1500/650) / (1000^0.28 + 1000/650) ~= 1.16x.
//
// 5. getSkillMultipliers was a stub returning {1, 1} with a //todo. It is now
//    derived from ns.bladeburner.getSkillLevel, which the file already calls:
//    Bladeburner.ts:775-785 builds each multiplier as the PRODUCT over skills
//    of (1 + baseMult * level / 100), and data/Skills.ts gives the baseMults —
//    Reaper +2% EffAgi (:54-65), Evasive System +4% EffAgi (:66-72),
//    Cyber's Edge +2% Stamina (:84-90).
//
// 6. The hand-derived rank loss (`rankGain/11`, `rankGain/22 /
//    BladeburnerRank`) is replaced by ns.bladeburner.getActionRankLoss
//    (NetscriptFunctions/Bladeburner.ts:170-175 -> Formulas.ts:30-44, which is
//    `action.rankLoss * rewardFac^(level-1)` from the per-action data). That
//    also removes the bitNodeMultipliers.js import, whose only use was the
//    BladeburnerRank term in the wrong rank-loss expression.
//
//    CORRECTION TO game-knowledge.md §6: importing bitNodeMultipliers.js costs
//    **0GB**, not 4GB. Measured with the game's own calculator — an entry
//    script that does nothing prices at 1.60GB, and the same script importing
//    readBitNodeMults also prices at 1.60GB; removing the import from this file
//    changed its price by exactly 0. The 4GB ns.getBitNodeMultipliers charge
//    lives inside bitNodeMultipliers.js's own `main()`, which importers never
//    reference, and the RAM walk is per-scope: only what is reachable from the
//    entry module's own keys is billed. The export was also already renamed to
//    readBitNodeMults, so there is no name collision left to pay for either.
//    §6's "renaming recovers 20GB at zero behavioural cost" across five
//    importers is not available — there is nothing there to recover.
//
// 7. NOT in game-knowledge.md: the file used getActionRepGain as its rank gain.
//    getActionRepGain returns FACTION REPUTATION, not rank:
//    `RankToFactionRepFactor * rankGain * person.mults.faction_rep *
//    (1 + Bladeburners.favor/100)` (Bladeburner.ts:157-163 -> Formulas.ts:46-49),
//    and RankToFactionRepFactor is **2** (data/Constants.ts:41). So every
//    rank-per-second figure was at least 2x too large, scaled by an
//    augmentation multiplier and by faction favor — and
//    minRankGainedByGettingToDaedalus compared that inflated sum directly
//    against getBlackOpRank, which really is rank. The BLACKOPS goal therefore
//    switched on far too early. ns.bladeburner.getActionRankGain
//    (Bladeburner.ts:164-169) is the right call and is what is used now.
//
// 8. NOT in game-knowledge.md: v1 player fields. ns.getPlayer() returns skills
//    under `.skills` and multipliers under `.mults`
//    (NetscriptFunctions.ts:1371-1390). `player.agility`,
//    `player.hacking_skill`, `player.intelligence`, `player.charisma`,
//    `player.bladeburner_stamina_gain_mult` and `player.bladeburner_analysis_mult`
//    are all undefined. The consequence in getStaminaGainPerSecond was
//    `gain * 1 * undefined` = **NaN**, which propagated into
//    net_stamina_per_second for every action, so both STAMINA goals compared
//    NaN and the "am I low on stamina" logic was decided by array order.
//
// 9. Smaller, all verified:
//    - Hyperbolic Regeneration Chamber RESTORES stamina — `staminaGain =
//      maxStamina * (HrcStaminaGain/100)` (Bladeburner.ts:1202, constant at
//      data/Constants.ts:52) — but staminaLoss() returned it as a positive
//      cost, so the one action that fixes low stamina scored worst under the
//      STAMINALOW goal that exists to pick it.
//    - Diplomacy: the game reduces chaos by
//      `charisma^0.045 + charisma/1000` percent (Bladeburner.ts:736-744), so the
//      surviving fraction is (100 - cha^0.045 - cha/1000)/100. The file had
//      `+ player.charisma/1000` — wrong sign — on top of `player.charisma` being
//      undefined, which made chaos_mult NaN and the CHAOS goal meaningless.
//    - getNextBlackOperation returns undefined once every black op is done, and
//      the result was `.concat(...)`ed into the action list, producing a
//      `{city}` object with no type or name that would throw inside
//      getActionEstimatedSuccessChance. Now filtered.
//    - Investigation / Undercover / Field Analysis population-estimate gains
//      are multiplied by the Datamancer skill (Bladeburner.ts:807, :816, :1141
//      all pass them through getSkillMult(SuccessChanceEstimate)); the file
//      used the bare 0.4 / 0.8 / eff. Now that getSkillMultipliers is real this
//      is free.
//    - `player.bladeburner_analysis_mult || 1.08` was an invented default.
//      The real default is 1 (Multipliers.ts:66).
//
// KNOWN, DELIBERATELY NOT FIXED: goals.MONEY maximises
// `low_expected_rank_gain_per_second` after filtering to contracts — it is a
// proxy, not a money model, and this file computes no money at all. The real
// per-contract money is ContractBaseMoneyGain (250e3, data/Constants.ts:49)
// scaled by rewardFac^(level-1), the Hands of Midas skill multiplier and
// currentNodeMults.BladeburnerRank-adjacent node terms. Implementing that needs
// its own verification pass; leaving it as an unlabelled proxy would be the
// worse of the two, so it is labelled here and in the status payload.
// ---------------------------------------------------------------------------
import { killOtherInstances } from "common.js"
import { canUseBladeburner, canUseSingularity, singularityRamMultiplier } from 'sfgate.js'
import { reporter, describe, record } from 'status.js'
import { raiseRam } from 'ramgrow.js'

const RAMOVERRIDE_STATUS = '/tel/bladeburner.txt'

/** This file's FULL static price as a function of the Singularity RAM
 *  multiplier (sfgate.js:71-77 — 1 inside BN4, 16 at SF4.1, 4 at SF4.2, 1 at
 *  SF4.3). 88.1 = everything not under ns.singularity; 0.5 = ns.singularity.isBusy
 *  at base price. Both measured with the game's own calculator
 *  (tools/staging/fix4/measure.mjs) and re-checked on every run by
 *  ramoverride.test.mjs [R5]. Up 4GB on the pre-fix file's 88.1: +4 for
 *  getActionRankGain, +4 for getActionRankLoss, -4 for getActionRepGain, and
 *  **0** for dropping the bitNodeMultipliers.js import — see the correction
 *  note below. */
const RAISE_CEILING = (mult) => 92.1 + 0.5 * mult

export async function main(ns) {
  ns.ramOverride(2.6)

  const rerrors = []
  const note = reporter(ns, RAMOVERRIDE_STATUS, () => ({ errors: rerrors.slice(-5) }))
  ns.atExit(() => note.exit('stopped', { detail: 'bladeburner.js exited' }))

  // Ask the GAME what this save can do, through the shared rules. Not a
  // try/catch around the namespace: RAM is billed before a line executes, so
  // such a guard can never fire (CLAUDE.md, "a guard that can never fire").
  const info = ns.getResetInfo()
  if (!canUseBladeburner(info)) {
    note('waiting', {
      result: 'capability-absent',
      gate: 'canUseBladeburner',
      needs: 'Source-File 6 or Source-File 7',
      bitNode: info.currentNode,
      detail:
        'canUseBladeburner() is false for this save, so bladeburner.js cannot act. Staying at the 2.6GB floor ' +
        'instead of reserving its full price. Bladeburner needs Source-File 6 or 7, or BitNode 6/7 (NetscriptFunctions/Bladeburner.ts:35). There is nothing to do by hand without the division.',
    })
    return
  }
  // bladeburner.js also calls ns.singularity.isBusy, which is SF4-gated. The
  // Bladeburner API alone is not enough to run this file end to end.
  if (!canUseSingularity(info)) {
    note('waiting', {
      result: 'no-singularity',
      gate: 'canUseSingularity',
      needs: 'Source-File 4',
      detail:
        'the Bladeburner API is available but ns.singularity.isBusy is not (needs Source-File 4 or ' +
        'BitNode 4), and this script calls it every loop. Staying at the 2.6GB floor.',
      bitNode: info.currentNode,
    })
    return
  }

  const want = RAISE_CEILING(singularityRamMultiplier(info))
  if (!raiseRam(ns, want, RAMOVERRIDE_STATUS, 'bladeburner.js needs its full allocation before the first gated call')) return

  try {
    note('ok', { result: 'running', allocation: want, detail: 'allocation raised; running the original body' })
    await act(ns, note)
    note('ok', { result: 'finished', detail: 'bladeburner.js returned normally' })
  } catch (err) {
    ns.print(record(rerrors, err))
    note('error', { result: 'error', detail: describe(err) })
    throw err
  }
}



/**
 * The four action types, from the game's own enum.
 *
 * Bladeburner/Enums.ts:1-6:
 *   General = "General", Contract = "Contracts",
 *   Operation = "Operations", BlackOp = "Black Operations"
 *
 * Exposed as ns.enums.BladeburnerActionType (NSEnums, NetscriptDefinitions.d.ts:9880).
 * The ACTION NAMES are not exposed — BladeburnerContractName,
 * BladeburnerOperationName, BladeburnerBlackOpName, BladeburnerGeneralActionName
 * and BladeburnerSkillName are all absent from NSEnums — so those remain string
 * literals here, each checked against Bladeburner/Enums.ts. Contract, operation
 * and black-op names are read back out of the game anyway
 * (getContractNames / getOperationNames / getBlackOpNames), so the only literals
 * that must match are the general actions and the skill names.
 */
const actionTypes = (ns) => {
  const T = ns.enums.BladeburnerActionType
  return { general: T.General, contract: T.Contract, operation: T.Operation, blackOp: T.BlackOp }
}

/** Set once at the top of act(), from ns.enums. Every `action.type` comparison
 *  below reads it, including the ones inside the module-level `goals` table. */
let TYPE = null

/** BladeburnerGeneralActionName (Bladeburner/Enums.ts:8-15). */
const GENERAL = {
  training: "Training",
  fieldAnalysis: "Field Analysis",
  recruitment: "Recruitment",
  diplomacy: "Diplomacy",
  hyperbolicRegen: "Hyperbolic Regeneration Chamber",
  inciteViolence: "Incite Violence",
}

/**
 * Action duration, honouring banked bonus time.
 *
 * BOTH of these are in MILLISECONDS:
 *   getActionTime  NetscriptFunctions/Bladeburner.ts:125-130 — the body is
 *                  `action.getActionTime(...) * 1000` under the comment
 *                  "// return ms instead of seconds"
 *   getBonusTime   :365-368 — `bladeburner.storedCycles * CONSTANTS.MilliPerCycle`
 * The caller used to multiply the result by 1000 again.
 */
const actionTimeWithBonus = (ns, action) => {
  let bonusTime = ns.bladeburner.getBonusTime();
  let baseTime = ns.bladeburner.getActionTime(action.type, action.name);
  return bonusTime > baseTime ? Math.ceil(baseTime / 5) : baseTime;
}

/** CityName (Locations/Enums.ts:70-77). Read from ns.enums so the spelling of
 *  "Sector-12" and "New Tokyo" can never drift; getCityChaos and switchCity both
 *  check them strictly (NetscriptFunctions/Bladeburner.ts:307, :316). */
const bladeburnerCityNames = (ns) => Object.values(ns.enums.CityName)
let CITIES = []

const stamina_free_actions = [
  GENERAL.fieldAnalysis, // "Does not use stamina" — Bladeburner.ts:1124
  GENERAL.recruitment,
  GENERAL.diplomacy,
];

// Skill names: BladeburnerSkillName, Bladeburner/Enums.ts:62-75. Grouped by how
// eagerly this script wants to buy them (skillWeight below).
const s_skills = [
  "Reaper",
  "Evasive System",
  "Overclock",
];

const a_skills = [
  "Blade's Intuition",
  "Short-Circuit",
  "Digital Observer",
  "Datamancer",
];

const b_skills = [
  "Cyber's Edge",
  "Cloak",
];

const c_skills = [
  "Tracer",
  "Hands of Midas",
  "Hyperdrive",
];

/**
 * Per-action difficulty data, used ONLY for the stamina-cost model.
 *
 * Contracts: Bladeburner/data/Contracts.ts. Operations:
 * Bladeburner/data/Operations.ts. Black ops: Bladeburner/data/BlackOperations.ts.
 *
 * The rank gain and rank loss that used to be derived from these come from the
 * API now (getActionRankGain / getActionRankLoss), so only baseDifficulty,
 * difficultyFac and hpLoss are still needed. difficultyFac is applied as
 * `baseDifficulty * difficultyFac^(level-1)` for levelable actions
 * (Actions/LevelableAction.ts:58-64); a black op has no level and
 * Actions/Action.ts:140-142 returns baseDifficulty unchanged, which the
 * `(action.level || 1) - 1` exponent already reproduces.
 */
const actionConstants = {
  //contracts
  "Tracking": {
    baseDifficulty: 125,
    difficultyFac: 1.02,
    rewardFac: 1.041,
    hpLoss: 0.5,
  },
  "Bounty Hunter": {
    baseDifficulty: 250,
    difficultyFac: 1.04,
    rewardFac: 1.085,
    hpLoss: 1,
  },
  "Retirement": {
    baseDifficulty: 200,
    difficultyFac: 1.03,
    rewardFac: 1.065,
    hpLoss: 1,
  },
  //ops
  "Investigation": {
    baseDifficulty: 400,
    difficultyFac: 1.03,
    rewardFac: 1.07,
    hpLoss: 0,
  },
  "Undercover Operation": {
    baseDifficulty: 500,
    difficultyFac: 1.04,
    rewardFac: 1.09,
    hpLoss: 2,
  },
  "Sting Operation": {
    baseDifficulty: 650,
    difficultyFac: 1.04,
    rewardFac: 1.095,
    hpLoss: 2.5,
  },
  "Raid": {
    baseDifficulty: 800,
    difficultyFac: 1.045,
    rewardFac: 1.1,
    hpLoss: 50,
  },
  // Operations.ts:161-166. The file carried this key TWICE and the second copy
  // — Assassination's 1500 / 1.06 / 1.14 / 5 — silently won.
  "Stealth Retirement Operation": {
    baseDifficulty: 1000,
    difficultyFac: 1.05,
    rewardFac: 1.11,
    hpLoss: 10,
  },
  "Assassination": {
    baseDifficulty: 1500,
    difficultyFac: 1.06,
    rewardFac: 1.14,
    hpLoss: 5,
  },
  // blackops
  "Operation Typhoon": {
    baseDifficulty: 2000,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 100,
  },
  "Operation Zero": {
    baseDifficulty: 2500,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 50,
  },
  "Operation X": {
    baseDifficulty: 3000,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 100,
  },
  "Operation Titan": {
    baseDifficulty: 4000,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 100,
  },
  "Operation Ares": {
    baseDifficulty: 5000,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 200,
  },
  "Operation Archangel": {
    baseDifficulty: 7500,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 25,
  },
  "Operation Juggernaut": {
    baseDifficulty: 10e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 300,
  },
  "Operation Red Dragon": {
    baseDifficulty: 12.5e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 500,
  },
  "Operation K": {
    baseDifficulty: 15e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 1000,
  },
  "Operation Deckard": {
    baseDifficulty: 20e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 200,
  },
  "Operation Tyrell": {
    baseDifficulty: 25e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 500,
  },
  "Operation Wallace": {
    baseDifficulty: 30e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 1500,
  },
  "Operation Shoulder of Orion": {
    baseDifficulty: 35e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 1500,
  },
  "Operation Hyron": {
    baseDifficulty: 40e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 500,
  },
  "Operation Morpheus": {
    baseDifficulty: 45e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 100,
  },
  "Operation Ion Storm": {
    baseDifficulty: 50e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 5000,
  },
  "Operation Annihilus": {
    baseDifficulty: 55e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 10e3,
  },
  "Operation Ultron": {
    baseDifficulty: 60e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 10e3,
  },
  "Operation Centurion": {
    baseDifficulty: 70e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 10e3,
  },
  "Operation Vindictus": {
    baseDifficulty: 75e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 20e3,
  },
  "Operation Daedalus": {
    baseDifficulty: 80e3,
    difficultyFac: 1.01,
    rewardFac: 1.02,
    hpLoss: 100e3,
  },
}

const goals = {
  RANK: {
    name: "RANK",
    valueToMaxFunction: action => action.low_expected_rank_gain_per_second,
    debugStringFunction: (ns, action) =>
      `-:${(action.rank_loss).toFixed(3).padStart(6)
      } +:${(action.rank_gain).toFixed(3).padStart(7)
      } r/s:${[
        action.low_expected_rank_gain_per_second,
        action.avg_expected_rank_gain_per_second,
        action.high_expected_rank_gain_per_second,
      ].map(rps => (rps).toFixed(3)).join('/')}`,
  },
  MONEY: {
    name: "MONEY",
    // NOT a money model — see the header. Contracts are the only actions that
    // pay (data/Constants.ts:49 ContractBaseMoneyGain), so this filters to them
    // and then ranks by rank/s as a proxy. Labelled, not silently wrong.
    valueToMaxFunction: action => action.low_expected_rank_gain_per_second,
    filter: action => action.type == TYPE.contract,
    debugStringFunction: () => "",
  },
  CHAOS: {
    name: "CHAOS",
    valueToMaxFunction: action => 1 / action.chaos_mult,
    filter: (action, city) => action.city == city,
    debugStringFunction: (ns, action) =>
      `*chaos:${(action.chaos_mult).toFixed(3).padStart(6)}`,
  },
  STAMINALOW: {
    name: "STAMINALOW",
    // often you net regain stamina for actions, 0 stamina actions or
    // regeneration chamber not always necessary, so max something else
    valueToMaxFunction: (action, secondaryGoal) =>
      action.net_stamina_per_second > 0 ?
      secondaryGoal.valueToMaxFunction(action) :
      action.net_stamina_per_second,
      debugStringFunction: (ns, action, secondaryGoal) =>
        `+stam:${(action.net_stamina).toFixed(3).padStart(6)
        } +stam/s:${(action.net_stamina_per_second).toFixed(3).padStart(6)
        } ${secondaryGoal.debugStringFunction(ns, action)}`,
  },
  STAMINA: {
    name: "STAMINA",
    // max other goal per stamina, we have medium stamina but not low
    valueToMaxFunction: (action, secondaryGoal) =>
      secondaryGoal.valueToMaxFunction(action) +
      action.net_stamina_per_second,
      debugStringFunction: (ns, action, secondaryGoal) =>
        `+stam:${(action.net_stamina).toFixed(3).padStart(6)
        } +stam/s:${(action.net_stamina_per_second).toFixed(3).padStart(6)
        } ${secondaryGoal.name.toLowerCase().substring(0,3)
        }/s+stam/s:${(secondaryGoal.valueToMaxFunction(action) +
          action.net_stamina_per_second).toFixed(3).padStart(7)
        }`,
  },
  ESTIMATE: {
    name: "ESTIMATE",
    valueToMaxFunction: action => action.low_expected_pop_est_percent_per_second,
    filter: (action, city) => action.city == city,
    debugStringFunction: (ns, action) =>
      `+:${(action.expected_comm_est).toFixed(3).padStart(5)
      } pepps:${[
        action.low_expected_pop_est_percent_per_second,
        action.avg_expected_pop_est_percent_per_second,
        action.high_expected_pop_est_percent_per_second,
      ].map(rps => (rps).toFixed(5)).join('/')}`,
  },
  RECRUITMENT: {
    name: "RECRUITMENT",
    valueToMaxFunction: action => action.low_expected_team_gain_per_second,
    debugStringFunction: () => "",
  },
  BLACKOPS: {
    name: "BLACKOPS",
    valueToMaxFunction: action => action.type == TYPE.blackOp ?
      action.avg_expected_rank_gain_per_second : 0,
    debugStringFunction: () => "",
  }
}

const estimate_threshold = .2;

const skillWeight = (skillName) => {
  if (s_skills.includes(skillName)) return 1;
  if (a_skills.includes(skillName)) return 2;
  if (b_skills.includes(skillName)) return 3;
  if (c_skills.includes(skillName)) return 4;
  return 5;
}

const upgradeSkills = async (ns) => {
  let skillNames = ns.bladeburner.getSkillNames();
  while (true) {
    let skillStats = skillNames.map(skillName => ({
      name: skillName,
      level: ns.bladeburner.getSkillLevel(skillName),
      cost: ns.bladeburner.getSkillUpgradeCost(skillName),
      weighted_cost: skillWeight(skillName) *
        ns.bladeburner.getSkillUpgradeCost(skillName),
    }));
    // Overclock caps at level 90 (data/Skills.ts:44-53 `maxLvl: 90`), and past
    // the cap getSkillUpgradeCost returns Infinity (NetscriptFunctions/Bladeburner.ts:245-247).
    skillStats = skillStats.filter(skill =>
      !(skill.name == "Overclock" && skill.level >= 90));

    let lowestSkill = skillStats.reduce((result, next) => result.weighted_cost < next.weighted_cost ? result : next);
    if (ns.bladeburner.getSkillPoints() >= lowestSkill.cost) {
      if (!ns.bladeburner.upgradeSkill(lowestSkill.name)) {
        break;
      }
    } else {
      break;
    }
    await ns.sleep(25);
  }

};

/**
 * The Bladeburner skill multipliers this script needs, derived rather than
 * stubbed.
 *
 * Bladeburner.ts:775-785 — for each skill with a non-zero level, and for each
 * BladeburnerMultName it contributes to, the multiplier is multiplied by
 * `1 + baseMult * level / 100`. So a name touched by two skills gets their
 * product.
 *
 * From data/Skills.ts:
 *   Reaper          (:54-65)  EffStr/EffDef/EffDex/EffAgi +2 each
 *   Evasive System  (:66-72)  EffDex/EffAgi +4
 *   Cyber's Edge    (:84-90)  Stamina +2
 *   Datamancer      (:73-83)  SuccessChanceEstimate +5
 *
 * Skill names are BladeburnerSkillName members (Bladeburner/Enums.ts:62-75) and
 * getSkillLevel checks them strictly (NetscriptFunctions/Bladeburner.ts:236).
 * They are also exactly what getSkillNames() returns, so the upgrade loop above
 * and this table cannot disagree about what exists.
 */
const getSkillMultipliers = (ns) => {
  const lvl = (name) => ns.bladeburner.getSkillLevel(name);
  const mult = (baseMult, level) => 1 + (baseMult * level) / 100;
  return {
    effective_agility: mult(2, lvl("Reaper")) * mult(4, lvl("Evasive System")),
    stamina: mult(2, lvl("Cyber's Edge")),
    estimate: mult(5, lvl("Datamancer")),
  }
}

/**
 * Bladeburner.ts:1318-1326 calculateStaminaGainPerSecond:
 *   effAgility    = agility * EffAgi skill multiplier   (getEffectiveSkillLevel, :758-773)
 *   maxStaminaBonus = maxStamina / 70000                (MaxStaminaToGainFactor, data/Constants.ts:6)
 *   gain          = (0.0085 + maxStaminaBonus) * effAgility^0.17   (StaminaGainPerSecond, :4)
 *   return gain * Stamina skill multiplier * Player.mults.bladeburner_stamina_gain
 *
 * `player.agility` and `player.bladeburner_stamina_gain_mult` are 2021-API
 * names. Under v3 they are undefined and this whole function returned NaN.
 */
const getStaminaGainPerSecond = (ns) => {
  let player = ns.getPlayer();
  let skillMultipliers = getSkillMultipliers(ns);
  let effAgility = player.skills.agility * skillMultipliers.effective_agility;
  let maxStaminaBonus = ns.bladeburner.getStamina()[1] / 70000;
  let gain = (0.0085 + maxStaminaBonus) * Math.pow(effAgility, 0.17);
  return gain * skillMultipliers.stamina * player.mults.bladeburner_stamina_gain;
};

/**
 * Stamina cost of one attempt. NEGATIVE means the action restores stamina.
 *
 *   Training                Bladeburner.ts:1094 — 0.5 * BaseStaminaLoss
 *   Field Analysis /
 *     Recruitment /
 *     Diplomacy             no stamina term in their branches (:1123, :1155, :1186)
 *   Hyperbolic Regen        Bladeburner.ts:1202 — GAINS maxStamina * 1/100
 *                           (HrcStaminaGain, data/Constants.ts:52). Returned as
 *                           a positive cost before, which made the STAMINALOW
 *                           goal rank the regeneration chamber last.
 *   everything else         Bladeburner.ts:916-922 / :1016-1020 —
 *                           BaseStaminaLoss * (difficulty^0.28 + difficulty/650)
 *                           (DiffMult{Exponential,Linear}Factor, data/Constants.ts:15-16)
 */
const staminaLoss = (ns, action) => {
  if (action.name == GENERAL.training) {
    return 0.285 * 0.5;
  } else if (stamina_free_actions.includes(action.name)) {
    return 0;
  } else if (action.name == GENERAL.hyperbolicRegen) {
    return -ns.bladeburner.getStamina()[1] / 100;
  } else {
    let constants = actionConstants[action.name];
    if (!constants) {
      // A name the table does not know is a table that has fallen behind the
      // game, not a zero-cost action. Say so rather than scoring it as free.
      throw new Error(
        `bladeburner.js: no difficulty data for action "${action.name}" (type ${action.type}). ` +
          `actionConstants is a copy of Bladeburner/data/{Contracts,Operations,BlackOperations}.ts and ` +
          `needs updating.`,
      );
    }
    let difficulty = constants.baseDifficulty *
      Math.pow(constants.difficultyFac, (action.level || 1) - 1);
    let difficultyMultiplier = Math.pow(difficulty, 0.28) + difficulty / 650;
    return 0.285 * difficultyMultiplier;
  }
}

const setAllAutolevel = (ns, autolevel) =>
  getLeveledActions(ns).filter(action =>
    ns.bladeburner.getActionAutolevel(action.type, action.name) != autolevel)
      .forEach(action =>
        ns.bladeburner.setActionAutolevel(action.type, action.name, autolevel));

const getLeveledActions = (ns) =>
  ns.bladeburner.getContractNames().map(contractName =>
    ({type: TYPE.contract, name: contractName})).concat(
      ns.bladeburner.getOperationNames().map(operationName =>
      ({type: TYPE.operation, name: operationName})));

const getAllLevelsOfLeveledActions = (ns) =>
  getLeveledActions(ns).map(action =>
    [...Array(ns.bladeburner.getActionMaxLevel(action.type, action.name))
      .keys()].map(i=>i+1).map(level => ({...action, ...{level: level}})).flat()).flat();

const addCitiesToActions = (ns, actions) =>
  CITIES.map(city =>
    actions.map(action =>
      ({...action, ...{city: city}}))).flat();

const annotateActions = (ns, actions) => {
  let player = ns.getPlayer();
  let staminaGainPerSecond = getStaminaGainPerSecond(ns);
  let skillMultipliers = getSkillMultipliers(ns);
  return actions.map(action => {
    switchCityAndLevelToAction(ns, action);
    let estimatedSuccessChance = action.type == TYPE.general && action.name != GENERAL.recruitment ?
      [1, 1] :
      ns.bladeburner.getActionEstimatedSuccessChance(action.type, action.name);
    // MILLISECONDS (NetscriptFunctions/Bladeburner.ts:125-130).
    let time = ns.bladeburner.getActionTime(action.type, action.name);
    // RANK, not reputation. getActionRepGain — what this used to call — returns
    // RankToFactionRepFactor(=2) * rankGain * faction_rep * (1 + favor/100)
    // (Formulas.ts:46-49, data/Constants.ts:41).
    let rankGain = ns.bladeburner.getActionRankGain(action.type, action.name, action.level);
    // Straight from the per-action data: rankLoss * rewardFac^(level-1)
    // (Formulas.ts:30-44). No hand-derived /11 or /22, and no BitNode term —
    // calculateActionRankLoss does not carry one, unlike calculateActionRankGain.
    let rankLoss = ns.bladeburner.getActionRankLoss(action.type, action.name, action.level);
    let popEstPercent;
    let expectedCommEst;
    switch (action.name) {
      case "Investigation":
        // Bladeburner.ts:804-809 — 0.4 * getSkillMult(SuccessChanceEstimate)
        popEstPercent = 0.4 * skillMultipliers.estimate; // times successChanceEstimate
        expectedCommEst = 0.02; // times successChanceEstimate
        break;
      case "Undercover Operation":
        // Bladeburner.ts:813-818 — 0.8 * getSkillMult(SuccessChanceEstimate)
        popEstPercent = 0.8 * skillMultipliers.estimate; // times successChanceEstimate
        expectedCommEst = 0.02; // times successChanceEstimate
        break;
      case GENERAL.fieldAnalysis:
        // Bladeburner.ts:1123-1142. `bladeburner_analysis` lives under
        // player.mults and defaults to 1 (Multipliers.ts:31,66) — the old
        // `player.bladeburner_analysis_mult || 1.08` read undefined and then
        // invented 1.08.
        popEstPercent =
          (0.04 * Math.pow(player.skills.hacking, 0.3) +
          0.04 * Math.pow(player.skills.intelligence, 0.9) +
          0.02 * Math.pow(player.skills.charisma, 0.3)) *
          player.mults.bladeburner_analysis *
          skillMultipliers.estimate;
        expectedCommEst = 0;
        break;
      default:
        popEstPercent = 0;
        expectedCommEst = 0;
    }
    let teamGain = action.name == GENERAL.recruitment ? 1 : 0;
    // Bladeburner.ts:736-744: chaos falls by (charisma^0.045 + charisma/1000)
    // PERCENT, so the surviving fraction is (100 - that)/100. The old
    // expression added charisma/1000 instead of subtracting it, on top of
    // reading player.charisma, which is undefined -> the whole CHAOS goal
    // compared NaN.
    let chaosMult = action.name == GENERAL.diplomacy ?
      (100 - (Math.pow(player.skills.charisma, 0.045) + player.skills.charisma / 1000)) / 100 : 1
    let lowSuccessChance = estimatedSuccessChance[0];
    let highSuccessChance = estimatedSuccessChance[1];
    let avgSuccessChance = (lowSuccessChance + highSuccessChance) / 2;
    let count = action.type == TYPE.general ? Infinity :
      ns.bladeburner.getActionCountRemaining(action.type, action.name);
    let staminaCost = staminaLoss(ns, action);
    let netStamina = staminaGainPerSecond * (time / 1000) - staminaCost;
    let requiredRank = action.type == TYPE.blackOp ?
      ns.bladeburner.getBlackOpRank(action.name) : 0;
    return {...action, ...{
      count: count,
      time: time,
      stamina_cost: staminaCost,
      net_stamina: netStamina,
      net_stamina_per_second: netStamina / (time / 1000),
      required_rank: requiredRank,
      low_success_chance: lowSuccessChance,
      high_success_chance: highSuccessChance,
      avg_success_chance: avgSuccessChance,
      success_chance_range: highSuccessChance - lowSuccessChance,

      rank_gain: rankGain,
      rank_loss: rankLoss,
      low_expected_rank_gain_per_second: (rankGain * lowSuccessChance - (1 - lowSuccessChance) * rankLoss) / (time / 1000),
      avg_expected_rank_gain_per_second: (rankGain * avgSuccessChance - (1 - avgSuccessChance) * rankLoss) / (time / 1000),
      high_expected_rank_gain_per_second: (rankGain * highSuccessChance - (1 - highSuccessChance) * rankLoss) / (time / 1000),

      pop_est_percent: popEstPercent,
      low_expected_pop_est_percent_per_second: popEstPercent * lowSuccessChance / (time / 1000),
      avg_expected_pop_est_percent_per_second: popEstPercent * avgSuccessChance / (time / 1000),
      high_expected_pop_est_percent_per_second: popEstPercent * highSuccessChance / (time / 1000),

      expected_comm_est: expectedCommEst,
      low_expected_comm_est_per_second: expectedCommEst * lowSuccessChance / (time / 1000),
      avg_expected_comm_est_per_second: expectedCommEst * avgSuccessChance / (time / 1000),
      high_expected_comm_est_per_second: expectedCommEst * highSuccessChance / (time / 1000),

      team_gain: teamGain,
      low_expected_team_gain_per_second: teamGain * lowSuccessChance / (time / 1000),
      avg_expected_team_gain_per_second: teamGain * avgSuccessChance / (time / 1000),
      high_expected_team_gain_per_second: teamGain * highSuccessChance / (time / 1000),

      chaos_mult: chaosMult,
    }};
  });
};

const getGeneralActions = (ns) => {
  return [
    {type: TYPE.general, name: GENERAL.training},
    {type: TYPE.general, name: GENERAL.recruitment},
    {type: TYPE.general, name: GENERAL.hyperbolicRegen},
  ].concat(addCitiesToActions(ns, [
    {type: TYPE.general, name: GENERAL.fieldAnalysis},
    {type: TYPE.general, name: GENERAL.diplomacy},
  ]))
};


const getNextBlackOperation = (ns) => {
  let nextOpName = ns.bladeburner.getBlackOpNames().find(blackOpName =>
    ns.bladeburner.getActionCountRemaining(TYPE.blackOp, blackOpName));
  if (nextOpName) {
    return {
      type: TYPE.blackOp,
      name: nextOpName,
    };
  }
};

const getAllAnnotatedActions = (ns) => {
  setAllAutolevel(ns, false);
  // The `.filter(Boolean)` matters: once every black op is done
  // getNextBlackOperation returns undefined, and concat would have appended it
  // as a list element. addCitiesToActions then spreads it into `{city}` — an
  // action with no type and no name — and getActionEstimatedSuccessChance
  // throws on it.
  let leveled = getAllLevelsOfLeveledActions(ns).concat(getNextBlackOperation(ns)).filter(Boolean);
  return annotateActions(ns, addCitiesToActions(ns, leveled).concat(getGeneralActions(ns)));
};

const switchCityAndLevelToAction = (ns, action) => {
  if (action.city && ns.bladeburner.getCity() != action.city)
    ns.bladeburner.switchCity(action.city);
  if (action.level && ns.bladeburner.getActionCurrentLevel(action.type, action.name) != action.level)
    ns.bladeburner.setActionLevel(action.type, action.name, action.level);
};

const getCityMaxEstimateRangeMap = (ns, actions) => {
  let rangeMap = Object.fromEntries(CITIES.map(city => [city, 0]));
  actions.forEach(action => {
    if (action.city && rangeMap[action.city] < action.success_chance_range) {
      rangeMap[action.city] = action.success_chance_range;
    }
  });
  return rangeMap;
};

const printActions = (ns, actions, attributeFn, secondaryGoal) => {
  let maxCityNameLength =
    Math.max(...CITIES.map(cityName => cityName.length));
  let maxNameLength =
    Math.max(...actions.map(action => (action.name || "").length))
  ns.tprint(actions.map(action =>
    `\n${(action.city ? action.city : "").padStart(maxCityNameLength)
    } l:${(action.level ? action.level.toString() : "1").padStart(2)
    } ${action.name.substring(0,15).padStart(maxNameLength)
    } time: ${action.time.toString().padStart(2)
    } %:${[
      action.low_success_chance,
      action.avg_success_chance,
      action.high_success_chance,
      ].map(chance => (chance).toFixed(3)).join('/')
    } ${attributeFn(ns, action, secondaryGoal)}`).join(''));
};

/** Rank, not reputation — getActionRankGain, for the same reason as above. */
const minRankGainedByGettingToDaedalus = (ns) =>
  ns.bladeburner.getBlackOpNames()
    .filter(name => ns.bladeburner.getActionCountRemaining(TYPE.blackOp, name))
    .filter(name => name != "Operation Daedalus")
    .map(name => ns.bladeburner.getActionRankGain(TYPE.blackOp, name))
    .reduce((result, next) => result + next, 0) * 1.1;

/**
 * Is the game already doing exactly this?
 *
 * getCurrentAction() returns null when idle
 * (NetscriptFunctions/Bladeburner.ts:120-124) and otherwise
 * `{type, name}` (BladeburnerCurAction, NetscriptDefinitions.d.ts:849-854).
 * The shipped code read `currantAction.name` — a ReferenceError — and would
 * have thrown on null the moment that was corrected.
 */
const sameAction = (current, next) =>
  !!current && !!next && current.type === next.type && current.name === next.name;

async function act(ns, note) {
  let flags = ns.flags([
    ["debug", false],
    ["money", false],
    ["top-actions", 20],
  ]);

  // Read the enums ONCE, before anything compares against them. Everything in
  // this module — including the `goals` filters defined above — reads TYPE.
  TYPE = actionTypes(ns);
  CITIES = bladeburnerCityNames(ns);

  killOtherInstances(ns);

  while (true) {
    let [stamina, maxStamina] = ns.bladeburner.getStamina();
    let actions = getAllAnnotatedActions(ns);
    let cityMaxEstimateRangeMap = getCityMaxEstimateRangeMap(ns, actions);
    let maxCityRangeEntry = Object.entries(cityMaxEstimateRangeMap)
      .reduce((result, next) => result[1] > next[1] ? result : next);
    let lowEstimateCity = maxCityRangeEntry[1] > estimate_threshold ?
      maxCityRangeEntry[0] : "";
    let chaosCity = CITIES.find(city =>
        ns.bladeburner.getCityChaos(city) > 50 &&
        actions.filter(action => action.city == city)
          .filter(action => action.type != TYPE.blackOp)
          .find(action => action.high_success_chance < 1
            && action.low_success_chance != 0)
    );

    let goalName = goals.RANK.name;
    let secondaryGoalName;
    let goalCity;

    if (flags.money) {
      goalName = goals.MONEY.name;
    }
    if (chaosCity) {
      goalName = goals.CHAOS.name;
      goalCity = chaosCity;
    }
    if (lowEstimateCity) {
      goalName = goals.ESTIMATE.name;
      goalCity = lowEstimateCity;
    }
    if (chaosCity && lowEstimateCity) {
      if (Math.random() < .5) {
        goalName = goals.ESTIMATE.name;
        goalCity = lowEstimateCity;
      } else {
        goalName = goals.CHAOS.name;
        goalCity = chaosCity;
      }
    }
    let rankFromOps = minRankGainedByGettingToDaedalus(ns);
    let rank = ns.bladeburner.getRank();
    let daedalusRank = ns.bladeburner.getBlackOpRank("Operation Daedalus");
    if (flags.debug) {
      ns.tprint(`rankFromOps: ${rankFromOps}, rank: ${rank
      }, totalExpected: ${rankFromOps + rank}, daedalus req: ${daedalusRank}`);
    }
    if (rankFromOps + rank > daedalusRank) {
        goalName = goals.BLACKOPS.name;
        goalCity = "";
    }
    if (stamina < maxStamina * .5) {
      secondaryGoalName = goalName;
      goalName = goals.STAMINALOW.name;
    } else if (stamina < maxStamina * .75) {
      secondaryGoalName = goalName;
      goalName = goals.STAMINA.name;
    }

    let nextAction = {};

    if (flags.debug) {
      ns.tprint(`primary goal: ${goalName
      }${secondaryGoalName ? `, secondary goal: ${secondaryGoalName}`: ``
      }${goalCity ? `, goal city: ${goalCity}`: ``}`);
    }

    let goalDict = goals[goalName];
    let secondGoalDict = goals[secondaryGoalName];

    let filteredActions = actions;
    if (goalDict.filter) {
      filteredActions = filteredActions.filter(action =>
        goalDict.filter(action, goalCity));
    }
    if (secondGoalDict && secondGoalDict.filter) {
      filteredActions = filteredActions.filter(action =>
        secondGoalDict.filter(action, goalCity));
    }
    filteredActions = filteredActions.filter(action => action.count > 0)
      .filter(action => !action.required_rank || action.required_rank <= rank);

    // remove raids for cities with no communities
    let noRaidCities = CITIES.map(cityName => ({
        city: cityName,
        estimated_communities: ns.bladeburner.getCityCommunities(cityName)
      })).filter(cityDict => cityDict.estimated_communities <= 0)
      .map(cityDict => cityDict.city);
    filteredActions = filteredActions.filter(action =>
      !(action.name == "Raid" && noRaidCities.includes(action.city)));

    ns.print(JSON.stringify(filteredActions, null, 2));
    if (!filteredActions.length) {
      // no possible actions due to count, waiting for more by training
      nextAction = {type: TYPE.general, name: GENERAL.training};
    } else {
      if (flags.debug) {
        let topActions = filteredActions.sort((a, b) =>
          goalDict.valueToMaxFunction(b, secondGoalDict) -
          goalDict.valueToMaxFunction(a, secondGoalDict))
          .filter((action, index) => index < flags["top-actions"]);
        printActions(ns, topActions, goalDict.debugStringFunction, secondGoalDict);
      }
      nextAction = filteredActions.reduce((result, next) =>
        goalDict.valueToMaxFunction(result, secondGoalDict) >
        goalDict.valueToMaxFunction(next, secondGoalDict) ?
          result : next);
    }

    switchCityAndLevelToAction(ns, nextAction);
    let currentAction = ns.bladeburner.getCurrentAction();
    let busy = ns.singularity.isBusy();
    let started = null;
    let timeToSleep = 10 * 1000;
    if (!busy && !sameAction(currentAction, nextAction)) {
      started = ns.bladeburner.startAction(nextAction.type, nextAction.name);
      // actionTimeWithBonus is already MILLISECONDS. The shipped file
      // multiplied it by 1000 here, turning a 30s contract into an 8h sleep.
      timeToSleep = Math.max(100, actionTimeWithBonus(ns, nextAction));
    }
    note(started === false ? 'error' : 'ok', {
      result: started === false ? 'start-refused' : (started === null ? 'already-running' : 'started'),
      goal: goalName,
      secondaryGoal: secondaryGoalName ?? null,
      goalCity: goalCity || null,
      moneyGoalIsAProxy: goalName === goals.MONEY.name,
      rank,
      rankFromRemainingBlackOps: rankFromOps,
      daedalusRankRequired: daedalusRank,
      stamina,
      maxStamina,
      action: { type: nextAction.type, name: nextAction.name, level: nextAction.level ?? null, city: nextAction.city ?? null },
      sleepMs: timeToSleep,
      singularityBusy: busy,
      detail: started === false
        ? `ns.bladeburner.startAction("${nextAction.type}", "${nextAction.name}") returned false — the game refused it; the reason is in this script's log (Bladeburner/Bladeburner.ts:183-186).`
        : `bladeburner.js goal ${goalName}: ${nextAction.name}`,
    })
    await ns.sleep(timeToSleep);
    await upgradeSkills(ns);
  }
}
