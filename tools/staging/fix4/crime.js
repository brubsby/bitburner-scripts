// STAGED ns.ramOverride REWRITE of crime.js, with the game-knowledge.md §1/§10
// defects FIXED.
//
// The ns.ramOverride scaffolding is unchanged from the deployed file; only the
// body that was preserved as `act(ns)` has been repaired. Every constant below
// is cited against ~/Repos/bitburner (v3.0.2, commit b5b09b8a8).
//
// ---------------------------------------------------------------------------
// RAMOVERRIDE 2.6GB — excludes: ns.singularity.getCrimeChance / getCrimeStats / commitCrime (5GB each at base, 80GB each at SF4.1), isBusy (0.5/8GB) and isFocused (0.1/1.6GB), plus common.js's spawn/kill/ps/hacknet reads.
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
// WHAT WAS BROKEN, and where the fix is checked against source.
//
// 1. All twelve crime names were invalid enum members ("shoplift" vs
//    "Shoplift", Crime/Enums.ts:1-14). getCrimeChance/getCrimeStats route the
//    argument through `getEnumHelper("CrimeType").nsGetMember` with no options
//    (Singularity.ts:1032, :1043), which is strict (EnumHelper.ts:63-70 only
//    fuzz-matches under {fuzzy:true}), so the FIRST call threw and the script
//    never did anything. "assassinate" would have failed even with fuzzy
//    matching: the member is "Assassination" (Crime/Enums.ts:12).
//    FIX: the literals are gone. `Object.values(ns.enums.CrimeType)` is the
//    game's own frozen enum object (NetscriptFunctions.ts:122-145, handed to
//    every script at :1570), so this can no longer drift.
//
// 2. Karma expectation was `karma * chance`. A FAILED crime still awards
//    karma/4 (Work/CrimeWork.ts:75-78: `gains = scaleWorkStats(gains, 0.25);
//    karma /= 4`), so the expectation is karma*(3*chance+1)/4 — exactly the
//    factor the file already applied to the exp fields. Under-counted every
//    crime's karma by up to 25% of its base, and by MORE for the low-chance
//    crimes, which is precisely where the ranking is decided.
//
// 3. commitCrime(crime) took the default focus=true (Singularity.ts:1007) and
//    then `Player.startFocusing(); Router.toPage(Page.Work)` (:1022-1024),
//    dragging the UI to the Work page every crime and fighting cmd.js /
//    upkeep.js / augbuy.js. Now passes false explicitly.
//
// 4. NOT in game-knowledge.md: ns.getPlayer() returns skills nested under
//    `.skills` (NetscriptFunctions.ts:1371-1390). There is no flat `strength`
//    or `hacking_skill` key, so common.js:71's `player.hacking =
//    player.hacking_skill` is `undefined` and every `player[stat]` read here
//    was `undefined`. Consequences: `--training` filtered every skill out and
//    exited immediately reporting success, and `--strength --target 300` could
//    never terminate (`300 <= undefined` is false forever).
// ---------------------------------------------------------------------------
import { local_storage_keys, getItem, setItem, getDetailedPlayerData } from "common.js";
import { canUseSingularity, singularityRamMultiplier } from 'sfgate.js'
import { reporter, describe, record } from 'status.js'
import { raiseRam } from 'ramgrow.js'

const RAMOVERRIDE_STATUS = '/tel/crime.txt'

/** This file's FULL static price as a function of the Singularity RAM
 *  multiplier (sfgate.js:71-77 — 1 inside BN4, 16 at SF4.1, 4 at SF4.2, 1 at
 *  SF4.3). 5.1 = everything not under ns.singularity; 15.6 = the
 *  ns.singularity surface at base price (the extra 0.1 over the pre-fix file is
 *  ns.singularity.isFocused, RamCostGenerator.ts:213 `isFocused: SF4Cost(0.1)`). Both measured with the
 *  game's own calculator (tools/staging/fix4/measure.mjs) and re-checked on
 *  every run by ramoverride.test.mjs [R5]. */
const RAISE_CEILING = (mult) => 5.1 + 15.6 * mult

export async function main(ns) {
  ns.ramOverride(2.6)

  const rerrors = []
  const note = reporter(ns, RAMOVERRIDE_STATUS, () => ({ errors: rerrors.slice(-5) }))
  ns.atExit(() => note.exit('stopped', { detail: 'crime.js exited' }))

  // Ask the GAME what this save can do, through the shared rules. Not a
  // try/catch around the namespace: RAM is billed before a line executes, so
  // such a guard can never fire (CLAUDE.md, "a guard that can never fire").
  const info = ns.getResetInfo()
  if (!canUseSingularity(info)) {
    note('waiting', {
      result: 'capability-absent',
      gate: 'canUseSingularity',
      bitNode: info.currentNode,
      detail:
        'canUseSingularity() is false for this save, so crime.js cannot act. Staying at the 2.6GB floor ' +
        'instead of reserving its full price. Commit crimes by hand: City tab -> The Slums. SlumsLocation.tsx:25 checks event.isTrusted, so a click is required whatever the Source-File.',
    })
    return
  }

  const want = RAISE_CEILING(singularityRamMultiplier(info))
  if (!raiseRam(ns, want, RAMOVERRIDE_STATUS, 'crime.js needs its full allocation before the first gated call')) return

  try {
    note('ok', { result: 'running', allocation: want, detail: 'allocation raised; running the original body' })
    await act(ns, note, info)
    note('ok', { result: 'finished', detail: 'crime.js returned normally' })
  } catch (err) {
    ns.print(record(rerrors, err))
    note('error', { result: 'error', detail: describe(err) })
    throw err
  }
}



/**
 * Every crime, straight out of the game's own frozen enum.
 *
 * Crime/Enums.ts:1-14. Twelve members, Title Case with spaces:
 *   Shoplift, Rob Store, Mug, Larceny, Deal Drugs, Bond Forgery, Traffick Arms,
 *   Homicide, Grand Theft Auto, Kidnap, Assassination, Heist.
 *
 * Reading them from `ns.enums.CrimeType` rather than retyping them is the whole
 * point: a string literal that must match an enum is a latent version-break,
 * and this file previously carried twelve of them, all wrong.
 */
const crimeNames = (ns) => Object.values(ns.enums.CrimeType)

let BOOLEAN_FLAG_NAMES = [
  'money',
  'kills',
  'karma',
  'hacking',
  'strength',
  'defense',
  'dexterity',
  'charisma',
  'intelligence',
  'training',
]

let FLAG_STAT_MAP = {
  money: 'money_per_millisecond',
  kills: 'kills_per_millisecond',
  karma: 'karma_per_millisecond',
  hacking: 'hacking_exp_per_millisecond',
  strength: 'strength_exp_per_millisecond',
  defense: 'defense_exp_per_millisecond',
  dexterity: 'dexterity_exp_per_millisecond',
  charisma: 'charisma_exp_per_millisecond',
  intelligence: 'intelligence_exp_per_millisecond',
}

/**
 * ns.getPlayer() returns EXACTLY thirteen fields and the skills are nested
 * (NetscriptFunctions.ts:1371-1390): hp, skills, exp, mults, city,
 * numPeopleKilled, money, location, totalPlaytime, jobs, factions, entropy,
 * karma. There is no flat `strength`, and no `hacking_skill` at all — that name
 * is from the 2021 API, which is why common.js:71's
 * `player.hacking = player.hacking_skill` assigns undefined.
 *
 * `money` and `karma` really are top-level; `kills` is added by
 * getDetailedPlayerData (common.js:69) from localStorage.
 */
const SKILL_FIELDS = ['hacking', 'strength', 'defense', 'dexterity', 'agility', 'charisma', 'intelligence']
const statValue = (player, stat) => (SKILL_FIELDS.includes(stat) ? player.skills[stat] : player[stat])

let EPSILON_SLEEP = 100

/**
 * The focus penalty, which this script now incurs deliberately.
 *
 * CrimeWork.ts:65 takes `Player.focusPenalty()` and CrimeWork.ts:68 applies it
 * to every exp field — and CrimeWork.ts:85 to karma — but NOT to money, because
 * :68 passes `scaleMoney = false` (WorkStats.ts:49-50). focusPenalty is
 * CONSTANTS.BaseFocusBonus = 0.8 (Constants.ts:87) unless the Neuroreceptor
 * Management Implant is installed, in which case it is 1 in both states
 * (PlayerObjectGeneralMethods.ts:622-628, augmentation name at
 * Augmentation/Enums.ts:43).
 *
 * It is a single scalar across all twelve crimes, so it cannot change WHICH
 * crime wins for a given stat. It is modelled anyway because the numbers this
 * script prints and publishes are read as real rates, and a silent 20% error in
 * a reported rate is exactly the "quiet default" CLAUDE.md is about.
 */
const NEURORECEPTOR = 'Neuroreceptor Management Implant' // Augmentation/Enums.ts:43
function focusPenalty(ns, info) {
  if (info?.ownedAugs?.has?.(NEURORECEPTOR)) return 1
  return ns.singularity.isFocused() ? 1 : 0.8 // Constants.ts:87 BaseFocusBonus
}

/**
 * Expected value per attempt for every crime.
 *
 * Work/CrimeWork.ts:70-85 is the authority:
 *
 *   const success = determineCrimeSuccess(crime.type)      // :70
 *   if (success) { gainMoney(gains.money);                 // :72  success-only
 *                  numPeopleKilled += crime.kills;         // :73  success-only
 *                  gainIntelligenceExp(gains.intExp) }     // :74  success-only
 *   else         { gains = scaleWorkStats(gains, 0.25);    // :76  exp x 1/4
 *                  karma /= 4 }                            // :77  karma x 1/4
 *   ...gainHackingExp/Strength/.../Charisma(gains.*)       // :79-84 always
 *   Player.karma -= karma * focusBonus                     // :85  always
 *
 * So money, kills and intelligence exp are success-only (x chance), while the
 * six ordinary exp fields AND karma are paid at full rate on success and at a
 * quarter on failure: x (chance + (1-chance)/4) = x (3*chance+1)/4.
 *
 * THE BUG: this file already had `failXpFactor` and applied it to the exp
 * fields, but multiplied karma by the bare chance. Since karma is the reason to
 * run this script at all before a gang, that under-counted the thing being
 * optimised — and worst for low-chance crimes, where the failure term dominates.
 */
function getExpectedCrimeReturns(ns, focus) {
  return crimeNames(ns).reduce((result, crimeName) => {
    let crimeChance = ns.singularity.getCrimeChance(crimeName)
    let crimeStats = ns.singularity.getCrimeStats(crimeName)
    // Paid in full on success, at a quarter on failure (CrimeWork.ts:76-77).
    let failXpFactor = ((3 * crimeChance + 1) / 4) * focus
    // Paid only on success (CrimeWork.ts:71-74). Money is NOT focus-scaled
    // (CrimeWork.ts:68 passes scaleMoney = false).
    let successFactor = crimeChance
    let expectedReturns = {
      money: crimeStats.money * successFactor,
      hacking_exp: crimeStats.hacking_exp * failXpFactor,
      strength_exp: crimeStats.strength_exp * failXpFactor,
      defense_exp: crimeStats.defense_exp * failXpFactor,
      dexterity_exp: crimeStats.dexterity_exp * failXpFactor,
      agility_exp: crimeStats.agility_exp * failXpFactor,
      charisma_exp: crimeStats.charisma_exp * failXpFactor,
      intelligence_exp: crimeStats.intelligence_exp * successFactor * focus,
      kills: crimeStats.kills * successFactor,
      karma: crimeStats.karma * failXpFactor,
      chance: crimeChance,
      time: crimeStats.time,
      money_per_millisecond: (crimeStats.money * successFactor) / crimeStats.time,
      hacking_exp_per_millisecond: (crimeStats.hacking_exp * failXpFactor) / crimeStats.time,
      strength_exp_per_millisecond: (crimeStats.strength_exp * failXpFactor) / crimeStats.time,
      defense_exp_per_millisecond: (crimeStats.defense_exp * failXpFactor) / crimeStats.time,
      dexterity_exp_per_millisecond: (crimeStats.dexterity_exp * failXpFactor) / crimeStats.time,
      agility_exp_per_millisecond: (crimeStats.agility_exp * failXpFactor) / crimeStats.time,
      charisma_exp_per_millisecond: (crimeStats.charisma_exp * failXpFactor) / crimeStats.time,
      intelligence_exp_per_millisecond: (crimeStats.intelligence_exp * successFactor * focus) / crimeStats.time,
      kills_per_millisecond: (crimeStats.kills * successFactor) / crimeStats.time,
      karma_per_millisecond: (crimeStats.karma * failXpFactor) / crimeStats.time,
    }
    result[crimeName] = expectedReturns
    return result
  }, {})
}

function getBestReturnCrimeFor(ns, stat, focus) {
  let expectedCrimeReturns = getExpectedCrimeReturns(ns, focus)
  let reducer = (result, currentValue) => {
    return currentValue[1][stat] > result[1][stat] ? currentValue : result
  }
  let bestEntry = Object.entries(expectedCrimeReturns).reduce(reducer)
  return bestEntry
}

function booleanFlagsToStat(ns, flags) {
  let trueBooleanFlags = Object.entries(flags)
    .filter(flagEntry => BOOLEAN_FLAG_NAMES.includes(flagEntry[0]))
    .filter(flagEntry => flagEntry[1])
    .map(flagEntry => flagEntry[0]);
  if (trueBooleanFlags.length != 1) usage(ns);
  let trueFlag = trueBooleanFlags.pop();
  if (Object.keys(FLAG_STAT_MAP).includes(trueFlag)) return trueFlag;
  if (trueFlag == "training") {
    let player = getDetailedPlayerData(ns);
    // statValue, not player[skill] — see SKILL_FIELDS above. This read was
    // undefined for every skill, so `skills` came out empty and the caller
    // reported "done" on the first tick of every run.
    let skills = ['hacking', 'strength', 'defense', 'dexterity', 'agility', 'charisma']
      .filter(skill => statValue(player, skill) < flags.target);
    if (!skills.length) return undefined;
    let lowestSkill = skills.reduce((resultSkill, skill) =>
      statValue(player, skill) > statValue(player, resultSkill) ? resultSkill : skill
    );
    ns.print(`lowestSkill: ${lowestSkill}`);
    return lowestSkill;
  }
  return undefined;
}

function usage(ns) {
  ns.tprint(`Usage: run crime.js --[${BOOLEAN_FLAG_NAMES.join('|')}]`)
  ns.exit()
}

async function act(ns, note, info) {
  let flags = ns.flags(
    BOOLEAN_FLAG_NAMES.map((flag) => [flag, false]).concat([
      ["tail", false],
      ["target", 0],
    ])
  )

  if (flags.tail) {
    ns.ui.openTail();
  }

  let augTimestampEpsilon = 10000;
  let killsDict = getItem(local_storage_keys.kills);
  let lastAugTimestamp = Date.now() - (Date.now() - ns.getResetInfo().lastAugReset);
  // can't find kills or last augmentation didn't occur when we expected it
  if (!killsDict || Math.abs(killsDict.lastAugTimestamp - lastAugTimestamp) >
      augTimestampEpsilon) {
    setItem(local_storage_keys.kills, {
      kills: 0,
      lastAugTimestamp: lastAugTimestamp,
    });
  }

  while(true) {
    let statToMax = booleanFlagsToStat(ns, flags);
    let player = getDetailedPlayerData(ns);
    let current = statToMax ? statValue(player, statToMax) : undefined;
    ns.print(`${statToMax}: ${current}`);
    if (!statToMax || (flags.target && flags.target <= current)) {
      ns.print(`Done committing crimes, ${statToMax} has reached ${flags.target}.`)
      note('ok', {
        result: 'target-reached',
        stat: statToMax ?? null,
        value: current ?? null,
        target: flags.target,
        detail: `crime.js finished: ${statToMax} is ${current}, target ${flags.target}`,
      })
      ns.exit();
      return;
    }
    let statRateToMax = FLAG_STAT_MAP[statToMax];
    ns.print(`statRateToMax: ${statRateToMax}`);
    // Recomputed each loop: the penalty depends on Player.focus, which another
    // script (upkeep.js) can change under us at any time.
    let focus = focusPenalty(ns, info);
    let [bestCrime, crimeReturns] = getBestReturnCrimeFor(ns, statRateToMax, focus)
    ns.print(`${bestCrime} is the best crime for ${statRateToMax} with ${JSON.stringify(crimeReturns,null,2)}`)
    let karmaBefore = ns.heart.break();
    // focus = false. The default is TRUE (Singularity.ts:1007) and then
    // Router.toPage(Page.Work) (:1024), which yanks the UI onto the Work page
    // on every single crime — the thing cmd.js, upkeep.js, augbuy.js and
    // torbuy.js all have to fight. The cost is the 0.8 focus penalty modelled
    // in focusPenalty() above, and it is zero with the Neuroreceptor Management
    // Implant.
    ns.singularity.commitCrime(bestCrime, false);
    note('ok', {
      result: 'committing',
      stat: statToMax,
      value: current,
      target: flags.target || null,
      crime: bestCrime,
      focusPenalty: focus,
      expected: {
        chance: crimeReturns.chance,
        time_ms: crimeReturns.time,
        rate: crimeReturns[statRateToMax],
      },
      detail: `crime.js: ${bestCrime} for ${statRateToMax}`,
    })
    await ns.sleep(crimeReturns.time);
    while(ns.singularity.isBusy()) {
      await ns.sleep(EPSILON_SLEEP);
    }
    if (ns.heart.break() != karmaBefore && crimeReturns.kills) {
      let killsDict = getItem(local_storage_keys.kills);
      killsDict.kills += 1;
      setItem(local_storage_keys.kills, killsDict);
    }
  }

}
