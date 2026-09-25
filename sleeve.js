// STAGED ns.ramOverride REWRITE of sleeve.js, with the game-knowledge.md
// §1/§10 defects FIXED.
//
// The ns.ramOverride scaffolding is unchanged in shape; only the body that was
// preserved as `act(ns)` has been repaired, plus one import removed (see
// "THE IMPORT THAT WENT AWAY" below). Every constant is cited against
// ~/Repos/bitburner (v3.0.2, commit b5b09b8a8).
//
// THIS SCRIPT CANNOT RUN IN BITNODE 4. It needs Source-File 10 (or BitNode 10):
// NetscriptFunctions/Sleeve.ts:51-58 throws "You do not have access to the
// Sleeve API" otherwise. The refusal goes through sfgate.js's canUseSleeve,
// never an open-coded check, and it is published to /tel/sleeve.txt rather than
// merely returned.
//
// ---------------------------------------------------------------------------
// RAMOVERRIDE 2.6GB (raises to 45.75) — excludes: the ns.sleeve.* surface (getNumSleeves / getSleeve / getTask / travel / setToGymWorkout / setToUniversityCourse / setToCommitCrime / setToSynchronize / setToShockRecovery / setToFactionWork, 4GB each, NOT scaled by Source-File 4), plus common.js's spawn/kill/ps/hacknet reads.
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
// 1. `js.sleeve` — a ReferenceError on the first loop iteration, before
//    anything else could fail. Twice, in getSleeves.
//
// 2. getSleeveStats / getInformation were REMOVED in v2.2.0. The game says so
//    itself: NetscriptFunctions/Sleeve.ts:337-339 registers them via
//    setRemovedFunctions with `replacement: "sleeve.getSleeve"`. getSleeve
//    (Sleeve.ts:193-212) returns
//    `{hp, skills, exp, mults, city, shock, sync, memory, storedCycles}` —
//    note `skills` is NESTED, the same shape change ns.getPlayer() made.
//
// 3. getTask() was called with no argument; the signature is
//    getTask(sleeveNumber) (Sleeve.ts:184-192). It also returns **null** when
//    the sleeve is idle, which every use site here dereferenced.
//
// 4. "RobStore" / "DealDrugs" are not CrimeType members — they are "Rob Store"
//    and "Deal Drugs" (Crime/Enums.ts:3,6), and setToCommitCrime routes them
//    through a strict nsGetMember (Sleeve.ts:93). Likewise the gym stats:
//    GymType is "str"/"def"/"dex"/"agi" (Work/Enums.ts:17-22), checked at
//    Sleeve.ts:178.
//
// 5. `!sleeve.task.crime == skill_crime_map[skill]` parses as
//    `(!sleeve.task.crime) == skill_crime_map[skill]` — a boolean compared to a
//    string, which is false for every non-empty crime name, in BOTH the
//    "already doing it" and "doing something else" cases. The guard could never
//    fire. The field is also `crimeType`, not `crime`
//    (SleeveCrimeWork.ts:57-65), and it only exists when `task.type === "CRIME"`.
//
// 6. NOT in game-knowledge.md: "ZB Institute Of Technology" has a lowercase
//    "of" in the game — `VolhavenZBInstituteOfTechnology = "ZB Institute of
//    Technology"` (Locations/Enums.ts:59). setToUniversityCourse takes the
//    university as a plain string (Sleeve.ts:102) and
//    Sleeve.takeUniversityCourse returns false on a mismatch, which this script
//    discarded. Every Volhaven study assignment was a silent no-op.
//
// 7. Every setTo* / travel call returns a boolean nobody read. They are now
//    counted and published.
//
// ---------------------------------------------------------------------------
// THE IMPORT THAT WENT AWAY.
//
// `import { factions, companies_with_factions } from 'faction.js'` is gone.
// `factions` was never referenced, and `companies_with_factions` appeared in
// exactly one place: `if (companies_with_factions.includes())` — called with no
// argument, so always false, so the branch was dead and the `else` always ran.
//
// faction.js's augmentation helpers are ns.singularity.*, which cost this file
// 21GB at base price and 336GB at SF4.1, and forced a second capability gate
// (canUseSingularity) on a script whose only real requirement is Source-File 10.
// Dropping it removes that gate and 21*mult GB. Invariant B4: a Source-File-
// gated API belongs in its own script, not referenced from one that does not
// use it.
//
// The feature that branch was a placeholder for — assigning a sleeve to company
// work to earn a corporation faction's reputation — was never written. If it is
// written, it belongs behind its own sfgate check, with ns.sleeve.setToCompanyWork
// (Sleeve.ts:119-140) and ns.enums.CompanyName, and it does NOT need faction.js.
// ---------------------------------------------------------------------------
import { killOtherInstances, getItem, setItem } from 'common.js'
import { travel_cost } from 'constants.js'
import { canUseSleeve } from 'sfgate.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { fleetExpToPlayer, fleetFactionRepPerSec, fleetRates, sleeveAssignments, syncBreakevenHours, sleeveExitOf } from 'sleeveplan.js'
import { bestExitPolicy } from 'exitplan.js'
import { CRIMES, GYMS, gymRate } from 'bodyplan.js'
import { reporter, describe, record } from 'status.js'
import { raiseRam } from 'ramgrow.js'
import { enter, leave } from 'trace.js'

const RAMOVERRIDE_STATUS = '/tel/sleeve.txt'
/** What progress.js wants the fleet doing, and over what horizon. Written on
 *  home; this script runs `where: 'anywhere'`, so it must be PULLED before it
 *  is read or ns.read returns '' and every sleeve silently falls back to the
 *  no-plan default. Invariant C10. */
const PLAN = '/tel/sleeveplan.txt'
// progress.js's exit inputs: synchronise / shock / train-first are priced as
// two simulated exits (sleeveplan.sleeveExitOf), falling back, named, when
// this is stale or absent.
const EXIT_INPUTS = '/tel/exitinputs.txt'
/** The CrimeType strings setToCommitCrime accepts (Crime/Enums.ts), via the
 *  one table this repo keeps checked against game source ([BP1]). */
const CRIME_NAMES = new Set(Object.keys(CRIMES))

/** This file's FULL static price as a function of the Singularity RAM
 *  multiplier (sfgate.js:71-77). The ns.singularity surface is now EMPTY — the
 *  faction.js import that supplied it is gone — so the price no longer depends
 *  on Source-File 4 level at all and the `* mult` term is 0. Kept in the
 *  RAISE_CEILING(mult) shape because tools/test/ramoverride.test.mjs [R5]
 *  evaluates it per regime; a constant that ignores `mult` is the honest answer
 *  here, not a shortcut. Measured with the game's own calculator
 *  (tools/staging/fix4/measure.mjs). */
const RAISE_CEILING = (mult) => 45.75 + 0 * mult

export async function main(ns) {
  ns.ramOverride(2.6)

  const rerrors = []
  const note = reporter(ns, RAMOVERRIDE_STATUS, () => ({ errors: rerrors.slice(-5) }))
  // THE DAEMON ONLY MIRRORS /tel/* FROM HOME, and boot.js places this script
  // `where: 'anywhere'`. Without this push its telemetry — including the
  // atExit record that says WHY it stopped — is written to whichever rooted
  // host it landed on and is never seen again. That is exactly how its first
  // live start failed in silence: it exited four seconds in on a host too
  // small for its RAM raise, and the only evidence sat on foodnstuff.
  // 41.75 -> 45.75GB: ns.sleeve.setToFactionWork, so the fleet can work the
  // faction whose reputation gates the exit — priced at 56h of a 687h exit for
  // one trained sleeve, against 0.63h for the exp transfer. Still under the
  // tier-64 placement boot.js gives this script.
  // 41.15 -> 41.75GB: ns.scp (0.60GB) was NOT already in this file's price —
  // I asserted it was, and [R5] priced the file with the game's own
  // calculator and proved otherwise. ns.getHostname was already there.
  const mirror = () => {
    try {
      if (ns.getHostname() !== 'home') ns.scp(RAMOVERRIDE_STATUS, 'home', ns.getHostname())
    } catch {
      /* home unreachable; the local copy still stands */
    }
  }
  const say = (health, fields) => {
    note(health, fields)
    mirror()
  }
  ns.atExit(() => {
    note.exit('stopped', { detail: 'sleeve.js exited' })
    mirror()
  })

  // Ask the GAME what this save can do, through the shared rules. Not a
  // try/catch around the namespace: RAM is billed before a line executes, so
  // such a guard can never fire (CLAUDE.md, "a guard that can never fire").
  const info = ns.getResetInfo()
  if (!canUseSleeve(info)) {
    say('waiting', {
      result: 'capability-absent',
      gate: 'canUseSleeve',
      needs: 'Source-File 10',
      bitNode: info.currentNode,
      detail:
        'canUseSleeve() is false for this save, so sleeve.js cannot act. Staying at the 2.6GB floor ' +
        'instead of reserving its full price. Sleeves need Source-File 10 or BitNode 10 (NetscriptFunctions/Sleeve.ts:51-58). Without it there are no sleeves to task.',
    })
    return
  }

  const want = RAISE_CEILING(1)
  if (!(await raiseRam(ns, want, RAMOVERRIDE_STATUS, 'sleeve.js needs its full allocation before the first gated call'))) return

  try {
    say('ok', { result: 'running', allocation: want, detail: 'allocation raised; running the original body' })
    await act(ns, say)
    say('ok', { result: 'finished', detail: 'sleeve.js returned normally' })
  } catch (err) {
    ns.print(record(rerrors, err))
    say('error', { result: 'error', detail: describe(err) })
    throw err
  }
}



export const sleeve_keys = {
	SLEEVE_TASKS: "BB_SLEEVE_TASKS",
};

/** Locations/Enums.ts — the gym and university in each city that has one. */
const cityGymMap = (ns) => ({
	[ns.enums.CityName.Sector12]: ns.enums.LocationName.Sector12PowerhouseGym,
	[ns.enums.CityName.Volhaven]: ns.enums.LocationName.VolhavenMilleniumFitnessGym,
	[ns.enums.CityName.Aevum]: ns.enums.LocationName.AevumSnapFitnessGym,
})

const cityUniMap = (ns) => ({
	[ns.enums.CityName.Sector12]: ns.enums.LocationName.Sector12RothmanUniversity,
	// "ZB Institute of Technology" — lowercase "of" (Locations/Enums.ts:59).
	[ns.enums.CityName.Volhaven]: ns.enums.LocationName.VolhavenZBInstituteOfTechnology,
	[ns.enums.CityName.Aevum]: ns.enums.LocationName.AevumSummitUniversity,
})

/** UniversityClassType members (Work/Enums.ts:7-14), strict at Sleeve.ts:103. */
const skillCourseMap = (ns) => ({
	hacking: ns.enums.UniversityClassType.algorithms,
	charisma: ns.enums.UniversityClassType.leadership,
})

/** CrimeType members (Crime/Enums.ts:3,6), strict at Sleeve.ts:93.
 *  Was "RobStore" / "DealDrugs" — neither is a member, with or without fuzzy
 *  matching (EnumHelper.ts:65 strips spaces and hyphens, not case boundaries,
 *  and fuzzy is not requested here anyway). */
const skillCrimeMap = (ns) => ({
	hacking: ns.enums.CrimeType.robStore,
	charisma: ns.enums.CrimeType.dealDrugs,
})

/** GymType members — the SHORT codes (Work/Enums.ts:17-22), strict at
 *  Sleeve.ts:178. Every one of the four long names this file used to pass threw. */
const gymStatMap = (ns) => ({
	strength: ns.enums.GymType.strength,
	defense: ns.enums.GymType.defense,
	dexterity: ns.enums.GymType.dexterity,
	agility: ns.enums.GymType.agility,
})

/** ns.getPlayer() nests skills (NetscriptFunctions.ts:1371-1390); so does
 *  ns.sleeve.getSleeve (Sleeve.ts:200-210). There is no flat `hacking_skill`. */
const lowestPlayerCombatSkill = (player) => [
	["strength", player.skills.strength],
	["defense", player.skills.defense],
	["dexterity", player.skills.dexterity],
	["agility", player.skills.agility],
].reduce((result, next) => next[1] < result[1] ? next : result)[0];

const lowestPlayerUniSkill = (player) => [
	["hacking", player.skills.hacking],
	["charisma", player.skills.charisma],
].reduce((result, next) => next[1] < result[1] ? next : result)[0];

/**
 * Is this sleeve already committing exactly this crime?
 *
 * getTask(n) returns null when idle (Sleeve.ts:190) and otherwise a task whose
 * crime field is `crimeType`, present only on the CRIME variant
 * (SleeveCrimeWork.ts:57-65, NetscriptDefinitions.d.ts:1164-1170).
 *
 * The shipped expression was `!sleeve.task.crime == skill_crime_map[skill]`,
 * which JavaScript parses as `(!sleeve.task.crime) == skill_crime_map[skill]` —
 * a boolean compared to a string, false whichever crime is running — on a field
 * that does not exist, on an object that is often null.
 */
const isAlreadyCommitting = (task, crimeName) =>
	!!task && task.type === "CRIME" && task.crimeType === crimeName;

// Sleeves are Persons: the game levels every skill as
// calculateSkill(exp, mults.<stat> x the node's <Stat>LevelMultiplier)
// (Person.ts:61-144). Planning that turns exp into levels (sleeveplan's
// train-first simulation) must see the product; raw mults overstated every
// level x2.5 in BN10 (combat 0.4, hacking 0.35).
const LEVEL_MULTS = { hacking: 'HackingLevelMultiplier', strength: 'StrengthLevelMultiplier', defense: 'DefenseLevelMultiplier', dexterity: 'DexterityLevelMultiplier', agility: 'AgilityLevelMultiplier', charisma: 'CharismaLevelMultiplier' }
const getSleeves = (ns) => {
	const node = bitNodeMults(ns.getResetInfo()?.currentNode) ?? null
	return [...Array(ns.sleeve.getNumSleeves()).keys()].map(index => {
		const sl = ns.sleeve.getSleeve(index)
		const mults = { ...sl.mults }
		for (const [k, key] of Object.entries(LEVEL_MULTS)) {
			const f = node?.[key]
			if (typeof f === 'number' && isFinite(f) && f > 0 && typeof mults[k] === 'number') mults[k] = mults[k] * f
		}
		return { ...sl, mults, task: ns.sleeve.getTask(index), index }
	});
};

// Module scope stays side-effect free: the shipped file read localStorage at
// IMPORT time, which runs before main() has decided the script may act at all.
let print_tasks = false;
let sleeveTasks = [];

async function act(ns, note) {
  // Black-box recorder (trace.js): the synchronous work between sleeps is an
  // open section; a page that hangs inside it leaves the mark behind.
  enter('sleeve')
  const nap = async (ms) => {
    leave('sleeve')
    await ns.sleep(ms)
    enter('sleeve')
  }
	let flags = ns.flags([]);
	sleeveTasks = getItem(sleeve_keys.SLEEVE_TASKS) || [];

	if (ns.ps(ns.getHostname()).filter(server =>
      server.filename == ns.getScriptName()).length > 1) {
    print_tasks = true;
    if (!flags._ || !flags._.length) {
      note('waiting', { result: 'duplicate-instance', detail: 'another sleeve.js is already running and no task list was given' });
      ns.exit();
      return;
    }
  }

  killOtherInstances(ns);

	if (flags._ && flags._.length) {
		sleeveTasks = flags._;
		setItem(sleeve_keys.SLEEVE_TASKS, sleeveTasks);
	}

	const GYM_STAT = gymStatMap(ns);
	const COURSE = skillCourseMap(ns);
	const CRIME = skillCrimeMap(ns);
	const CITY_GYM = cityGymMap(ns);
	const CITY_UNI = cityUniMap(ns);
	const SECTOR12 = ns.enums.CityName.Sector12;
	const VOLHAVEN = ns.enums.CityName.Volhaven;
	const POWERHOUSE = ns.enums.LocationName.Sector12PowerhouseGym;
	const ZB = ns.enums.LocationName.VolhavenZBInstituteOfTechnology;
	const MUG = ns.enums.CrimeType.mug;            // best combat xp per second
	const HOMICIDE = ns.enums.CrimeType.homicide;  // karma + kills

	// Every setTo*/travel call returns a boolean the shipped file threw away.
	// Refusals are collected per tick and published, so "the sleeves are doing
	// nothing" is distinguishable from "the sleeves are doing nothing and the
	// game said why nine times".
	let refusals = [];
	const doTask = (label, fn) => {
		let okResult = false;
		try {
			okResult = fn() !== false;
		} catch (err) {
			refusals.push(`${label}: threw ${describe(err)}`);
			return false;
		}
		if (!okResult) refusals.push(`${label}: returned false`);
		return okResult;
	};

	// Deduplicated: an unrecognised task name repeats every 30s forever, and a
	// terminal full of the same line is how a real message gets missed.
	const warned = new Set();

	const node = bitNodeMults(ns.getResetInfo()?.currentNode) ?? null

	while (true) {
		refusals = [];
		let sleeves = getSleeves(ns);
		sleeves.sort((a, b) => b.sync - a.sync || a.shock - b.shock);

		//allow other scripts to control this one for no ram cost
		let localStorageSleeveTasks = getItem(sleeve_keys.SLEEVE_TASKS);
		if (localStorageSleeveTasks && localStorageSleeveTasks.length) {
			sleeveTasks = localStorageSleeveTasks;
		}

		// THE PLAN, from progress.js. Pull first — see PLAN's comment.
		if (ns.getHostname() !== 'home') {
			try { ns.scp(PLAN, ns.getHostname(), 'home') } catch { /* previous copy stands */ }
			try { ns.scp(EXIT_INPUTS, ns.getHostname(), 'home') } catch { /* previous copy stands */ }
		}
		let plan = null
		try { plan = JSON.parse(ns.read(PLAN) || 'null') } catch { plan = null }
		// A plan from another BitNode is not a plan: prestigeSourceFile calls
		// sleeve.prestige() on every sleeve, so the fleet it was written for no
		// longer exists.
		if (plan && node !== null && plan.bitNode !== ns.getResetInfo()?.currentNode) plan = null
		// WITHOUT A PLAN, WORK FOR MONEY. Doing nothing was the shipped
		// behaviour and it is the one clearly wrong answer: boot.js launches
		// this script with no arguments, so `sleeveTasks` was always empty,
		// every sleeve hit `if (!sleeveTask) return`, and the script whose
		// BitNode was entered FOR sleeves never assigned a single one. Money is
		// the default because no objective is harmed by a sleeve earning it,
		// and because the alternative — assuming karma — is the assumption that
		// cost this run four hours of Homicide in a node where the gang is not
		// worth its gate.
		const objective = plan?.objective ?? 'money'
		const horizonHours = typeof plan?.horizonHours === 'number' && isFinite(plan.horizonHours) ? plan.horizonHours : null
		const auto = sleeveAssignments(sleeves, node, {
			objective,
			horizonHours,
			playerIntelligence: ns.getPlayer?.().skills?.intelligence,
			// The faction whose reputation the run actually needs, and the
			// inputs to price it. progress.js publishes the faction only when
			// the player is already a MEMBER — setToFactionWork throws
			// otherwise, and a throw per sleeve per tick is not a plan.
			repFaction: typeof plan?.repFaction === 'string' ? plan.repFaction : null,
			// The Covenant campaign's stat (objective 'covenant').
			trainStat: typeof plan?.trainStat === 'string' ? plan.trainStat : null,
			nodeWorkRepMult: node?.FactionWorkRepGain,
			sharePower: typeof plan?.sharePower === 'number' && isFinite(plan.sharePower) && plan.sharePower > 0 ? plan.sharePower : 1,
			exitOf: (() => {
				try {
					return sleeveExitOf(JSON.parse(ns.read(EXIT_INPUTS) || 'null'), ns.getResetInfo().lastAugReset, bestExitPolicy)
				} catch {
					return null
				}
			})(),
		})

		sleeves.forEach((sleeve, index) => {
			let sleeveTask = sleeveTasks[index] ?
				sleeveTasks[index].toLowerCase() : undefined;
			// No hand-written word for this sleeve: take the plan's answer.
			if (!sleeveTask) sleeveTask = auto?.tasks?.[index] ?? undefined;
			if (!sleeveTask) return;
			// FACTION WORK is the one task that needs more than a word, so the
			// planner emits an object for it. setToFactionWork THROWS rather
			// than returning false — not a member, another sleeve already holds
			// the faction, or it is the gang's faction — so doTask's catch is
			// what keeps a refusal a published refusal instead of a dead script.
			if (typeof sleeveTask === 'object') {
				if (sleeveTask.kind === 'faction' && sleeveTask.faction) {
					const already = sleeve.task?.type === 'FACTION' && sleeve.task?.factionName === sleeveTask.faction
					if (!already) {
						doTask(`sleeve ${sleeve.index} faction ${sleeveTask.faction}/${sleeveTask.workType}`,
							() => ns.sleeve.setToFactionWork(sleeve.index, sleeveTask.faction, sleeveTask.workType));
					}
				}
				return;
			}
			switch (sleeveTask) {
				case 'strength':
				case 'str':
				case 'defense':
				case 'def':
				case 'dexterity':
				case 'dex':
				case 'agility':
				case 'agi':
				case 'combat':
				case 'gym': {
					let player = ns.getPlayer();
					// The task word may be the long skill name or the short
					// code; both map to the same GymType member.
					let skill = sleeveTask === 'combat' || sleeveTask === 'gym'
						? lowestPlayerCombatSkill(player)
						: sleeveTask;
					let stat = GYM_STAT[skill] ?? skill; // already a short code
					if (sleeve.city == SECTOR12) {
						doTask(`sleeve ${sleeve.index} gym ${POWERHOUSE}/${stat}`,
							() => ns.sleeve.setToGymWorkout(sleeve.index, POWERHOUSE, stat));
					} else if (player.money > travel_cost) {
						if (doTask(`sleeve ${sleeve.index} travel ${SECTOR12}`,
								() => ns.sleeve.travel(sleeve.index, SECTOR12))) {
							doTask(`sleeve ${sleeve.index} gym ${POWERHOUSE}/${stat}`,
								() => ns.sleeve.setToGymWorkout(sleeve.index, POWERHOUSE, stat));
						}
					} else if (CITY_GYM[sleeve.city]) {
						// workout at current city if possible and poor
						doTask(`sleeve ${sleeve.index} gym ${CITY_GYM[sleeve.city]}/${stat}`,
							() => ns.sleeve.setToGymWorkout(sleeve.index, CITY_GYM[sleeve.city], stat));
					} else if (!isAlreadyCommitting(sleeve.task, MUG)) {
						// no gym in this city and too poor to move, mug until
						// next time (best combat xp)
						doTask(`sleeve ${sleeve.index} crime ${MUG}`,
							() => ns.sleeve.setToCommitCrime(sleeve.index, MUG));
					}
				} break;

				case 'hacking':
				case 'hack':
				case 'charisma':
				case 'cha':
				case 'university':
				case 'uni': {
					let player = ns.getPlayer();
					let skill = sleeveTask;
					if (skill == 'uni' || skill == 'university') {
						skill = lowestPlayerUniSkill(player);
					}
					if (skill == 'hack') skill = 'hacking';
					if (skill == 'cha') skill = 'charisma';
					let course = COURSE[skill];
					let crime = CRIME[skill];
					if (sleeve.city == VOLHAVEN) {
						doTask(`sleeve ${sleeve.index} uni ${ZB}/${course}`,
							() => ns.sleeve.setToUniversityCourse(sleeve.index, ZB, course));
					} else if (player.money > travel_cost) {
						if (doTask(`sleeve ${sleeve.index} travel ${VOLHAVEN}`,
								() => ns.sleeve.travel(sleeve.index, VOLHAVEN))) {
							doTask(`sleeve ${sleeve.index} uni ${ZB}/${course}`,
								() => ns.sleeve.setToUniversityCourse(sleeve.index, ZB, course));
						}
					} else if (CITY_UNI[sleeve.city]) {
						// study at current city if possible and poor.
						// (The shipped file tested city_gym_map here and indexed
						// city_uni_map — same three keys, so harmless, but it
						// only looked correct by coincidence.)
						doTask(`sleeve ${sleeve.index} uni ${CITY_UNI[sleeve.city]}/${course}`,
							() => ns.sleeve.setToUniversityCourse(sleeve.index, CITY_UNI[sleeve.city], course));
					} else if (!isAlreadyCommitting(sleeve.task, crime)) {
						//no uni in this city and too poor to move, crime until next time
						doTask(`sleeve ${sleeve.index} crime ${crime}`,
							() => ns.sleeve.setToCommitCrime(sleeve.index, crime));
					}
				} break;

				// THE PLANNED TASKS. sleeveplan emits 'sync', 'shock' or a
				// CrimeType name; the cases above are the hand-written words.
				case 'sync': {
					if (sleeve.task?.type !== 'SYNCHRO') {
						doTask(`sleeve ${sleeve.index} synchronize`,
							() => ns.sleeve.setToSynchronize(sleeve.index));
					}
				} break;

				case 'shock': {
					if (sleeve.task?.type !== 'RECOVERY') {
						doTask(`sleeve ${sleeve.index} shock recovery`,
							() => ns.sleeve.setToShockRecovery(sleeve.index));
					}
				} break;

				default: {
					// A CrimeType name, from the plan or typed by hand. Re-issuing
					// it would be worse than doing nothing: startWork calls
					// finish() on the current work (Sleeve.ts:182-185) and
					// SleeveCrimeWork's cyclesWorked goes back to zero, so a
					// 30s tick re-issuing a 600s Heist completes it NEVER.
					if (CRIME_NAMES.has(sleeveTask)) {
						if (!isAlreadyCommitting(sleeve.task, sleeveTask)) {
							doTask(`sleeve ${sleeve.index} crime ${sleeveTask}`,
								() => ns.sleeve.setToCommitCrime(sleeve.index, sleeveTask));
						}
						break;
					}
					if (!warned.has(sleeveTask)) {
						warned.add(sleeveTask);
						ns.tprint(`sleeve.js: unknown task "${sleeveTask}" for sleeve ${sleeve.index}; falling back to sync/shock/homicide.`);
					}
					if (sleeve.sync < 100) {
						doTask(`sleeve ${sleeve.index} synchronize`,
							() => ns.sleeve.setToSynchronize(sleeve.index));
					} else if (sleeve.shock > 0) {
						doTask(`sleeve ${sleeve.index} shock recovery`,
							() => ns.sleeve.setToShockRecovery(sleeve.index));
					} else if (!isAlreadyCommitting(sleeve.task, HOMICIDE)) {
						doTask(`sleeve ${sleeve.index} crime ${HOMICIDE}`,
							() => ns.sleeve.setToCommitCrime(sleeve.index, HOMICIDE));
					}
				}
			}
		});

		if (print_tasks) ns.print(JSON.stringify(sleeves.map(s => ({ index: s.index, city: s.city, sync: s.sync, shock: s.shock, task: s.task })), null, 2));

		// SYNC IS THE WHOLE MECHANISM, so it is published rather than left in a
		// print nobody reads. SleeveCrimeWork.ts:47 credits the player
		// `crime.karma * sleeve.syncBonus()`, and syncBonus() is sync/100 — a
		// fresh sleeve starts at sync = max(memory, 1), so it contributes ONE
		// PERCENT of the karma until synchronised. A monitor watching only the
		// assignment count would report eight sleeves committing Homicide and
		// call that healthy while they delivered almost nothing.
		//
		// shock is published beside it because it gates effectiveness the same
		// way (shockBonus = (100 - shock)/100) and decays passively in
		// Sleeve.process(), so a reader can tell "recovering" from "stuck".
		const syncs = sleeves.map((x) => x.sync)
		const shocks = sleeves.map((x) => x.shock)
		const mean = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : null)
		// WHAT THE FLEET IS WORTH TO THE TRAJECTORY. progress.js has no
		// ns.sleeve.* budget (9 members at 4GB each), so the actor that owns
		// the API prices the fleet and publishes the rates; the planner reads
		// two numbers. karmaChannelCtx feeds them to karmaGrindAcrossCycles as
		// `assist`, which is how the karma gate stopped being priced as though
		// the player grinds it alone.
		//
		// Published as null, never 0, when it cannot be priced — a fleet that
		// reads as zero is indistinguishable from no fleet at all, and the
		// reader must be able to say "unknown" rather than "none".
		const rates = fleetRates(sleeves, node, { objective })
		// THE EXP TRANSFER. applySleeveGains hands the player the sleeve's exp
		// scaled by sync, and `disableSleeveExpAndAugmentation` is a BitNode
		// OPTION that zeroes it outright — read from the save rather than
		// assumed, because a known zero and an unknown are different answers
		// and only one of them can be planned around.
		const disableSleeveExp = ns.getResetInfo()?.bitNodeOptions?.disableSleeveExpAndAugmentation === true
		// ACTUAL, not hypothetical: progress.js feeds this straight to
		// bestExitPolicy as the rate the exit climb runs on, so a sleeve in a
		// gym must contribute ZERO hacking exp, not the Algorithms rate it
		// would earn if it were at university.
		const expT = fleetExpToPlayer(sleeves, { disableSleeveExp, onlyStudying: true })
		// The hypothetical is still worth publishing — it is what the study
		// objective would buy — but under a name that cannot be mistaken for
		// what the fleet is delivering right now.
		const expIfStudying = fleetExpToPlayer(sleeves, { disableSleeveExp, onlyStudying: false })
		// FACTION REPUTATION. Unlike karma and the exp transfer this is NOT
		// sync-scaled (SleeveFactionWork.ts:36 applies shockBonus alone), so an
		// unsynchronised fleet is at full value here — and only ONE sleeve may
		// work a faction, so this is the best single sleeve, never a sum.
		const repT = fleetFactionRepPerSec(sleeves, {
			nodeWorkRepMult: node?.FactionWorkRepGain,
			// FROM THE PLAN, not ns.getSharePower — that call is 2.6GB and would
			// push this file's ceiling from 41.75 to 44.35, past the tier
			// boot.js places it at. progress.js already pays for it (it needs
			// the same quantity for the reputation estimator), so it travels in
			// /tel/sleeveplan.txt. Absent, the share bonus is 1: the game's own
			// floor when nothing is sharing, and the conservative value here
			// since sharing only ever raises it.
			sharePower: typeof plan?.sharePower === 'number' && isFinite(plan.sharePower) && plan.sharePower > 0 ? plan.sharePower : 1,
			favor: 0,
		})
		note(refusals.length ? 'error' : 'ok', {
			result: refusals.length ? 'refusals' : 'assigned',
			sleeves: sleeves.length,
			bitNode: ns.getResetInfo()?.currentNode ?? null,
			// The fleet as a trajectory term. C11 checks progress.js's reads
			// against these names.
			// WHAT THE FLEET WOULD DELIVER UNDER EACH OBJECTIVE — the inputs of
			// progress.js's objective choice, which simulates the exit under
			// each and keeps the soonest (CLAUDE.md: trajectories against
			// trajectories). Null, never 0, where unpriceable.
			// Combat exp the fleet hands the PLAYER per second if every sleeve
			// trains that stat at the best gym, at training multiplier 1 (linear
			// in it: progress.js scales by ns.hacknet.getTrainingMult, which would
			// cost this file 0.5GB). The Covenant campaign's legs are priced with it.
			gymToPlayerAtTm1: (() => {
				const gym = [...GYMS].sort((a, b) => b.expMult - a.expMult)[0]
				const tm = 1
				const out = {}
				for (const st of ['strength', 'defense', 'dexterity', 'agility']) {
					let v = 0
					for (const sl of sleeves) {
						const r = gymRate(gym, st, sl, tm)
						if (typeof r === 'number' && isFinite(r) && typeof sl.sync === 'number') v += r * (sl.sync / 100) * ((100 - (sl.shock ?? 0)) / 100)
					}
					out[st] = v
				}
				return out
			})(),
			byObjective: (() => {
				const k = fleetRates(sleeves, node, { objective: 'karma' })
				const m = fleetRates(sleeves, node, { objective: 'money' })
				return {
					karma: k ? k.karmaPerSec : null,
					money: m ? m.moneyPerSec : null,
					rep: repT ? repT.base : null,
					exp: expIfStudying ? expIfStudying.hacking : null,
				}
			})(),
			karmaPerSec: rates ? rates.karmaPerSec : null,
			killsPerSec: rates ? rates.killsPerSec : null,
			contributing: rates ? rates.contributing : null,
			// Hacking exp/s the fleet would hand the PLAYER if studying. Null,
			// never 0, when it cannot be priced.
			expToPlayerHacking: expT ? expT.hacking : null,
			expToPlayerHackingIfStudying: expIfStudying ? expIfStudying.hacking : null,
			// Base rate (favour divided out) — the shape exitplan's repPerSec wants.
			factionRepPerSec: repT ? repT.base : null,
			factionWorkType: repT ? repT.workType ?? null : null,
			disableSleeveExp,
			objective,
			horizonHours,
			syncBreakevenHours: syncBreakevenHours(ns.getPlayer?.().skills?.intelligence),
			plan: auto ? auto.why : null,
			syncMean: mean(syncs),
			syncMin: syncs.length ? Math.min(...syncs) : null,
			shockMean: mean(shocks),
			// karma actually delivered per unit of nominal crime karma: the sum
			// of syncBonus() across sleeves, which is what the grind is worth.
			karmaYield: syncs.length ? syncs.reduce((p, q) => p + q / 100, 0) : null,
			// SKILLS RIDE THE RECORD. Without them the training leg is invisible:
			// a reader sees the rep rate climbing and cannot tell whether the
			// sleeve is training, already trained, or being credited someone
			// else's numbers. `str/def/dex/agi` are what field work sums and
			// what every crime weights, so they are the four that explain the
			// rate — and sleeveplan's whole train-or-work search is a claim
			// about them that nothing could previously check against the game.
			assigned: sleeves.map((x) => ({
				i: x.index,
				sync: +x.sync.toFixed(1),
				shock: +x.shock.toFixed(1),
				task: x.task?.type ?? x.task ?? null,
				skills: { str: x.skills?.strength ?? null, def: x.skills?.defense ?? null, dex: x.skills?.dexterity ?? null, agi: x.skills?.agility ?? null, hack: x.skills?.hacking ?? null },
			})),
			tasks: sleeveTasks,
			unknownTasks: [...warned],
			refusals,
			detail: refusals.length
				? `${refusals.length} sleeve assignment(s) were refused by the game this tick`
				: `${sleeves.length} sleeve(s) assigned`,
		});
		await nap(30000);
	}
}
