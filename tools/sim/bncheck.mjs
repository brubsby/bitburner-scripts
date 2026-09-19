// What breaks in the next BitNode. Run this BEFORE entering one.
//
//   node tools/sim/bncheck.mjs 12        what changes in BN12
//   node tools/sim/bncheck.mjs 12 --all  include assumptions that still hold
//   node tools/sim/bncheck.mjs --survey  one line per BitNode, worst first
//
// Every script in this repo was written against BitNode 1, where all 55
// BitNodeMultipliers are 1 and no Source-File is owned. Several carry that in
// as a *hardcoded constant* rather than a lookup — which is correct, cheap and
// deliberate inside the game's RAM budget, but silently wrong the moment the
// BitNode changes.
//
// `getBitNodeMultipliers(n, lvl)` is a pure function of the BitNode number
// (src/BitNode/BitNode.tsx:564), so this can compute the answer for a BitNode
// we have not entered yet, from the game's own source, with no Source-File and
// no guessing.
//
// Each entry names: the assumption, the multiplier that governs it, where the
// assumption physically lives, and what goes wrong if it is violated. Anything
// flagged must be fixed or consciously accepted before that BitNode is played.
//
// CALIBRATION: not applicable, and this is the one honest case of that. There
// is nothing to calibrate against — the whole point is to answer for a BitNode
// we have NOT entered, and no live measurement of BN12 exists on a BN1 save.
// What stands in for calibration is that the answer is not modelled at all: it
// is `getBitNodeMultipliers(n, lvl)` called directly out of the game bundle, so
// the only way this is wrong is if the ASSUMPTIONS table below misdescribes our
// own code. Check that by reading the cited file, not by trusting the table.
//
// The BN1 column IS checkable, and checking it is worth the ten seconds: every
// multiplier must read 1 for n=1, because that is the world every measurement
// in this repo was taken in. `node tools/sim/bncheck.mjs 1` prints it.

import "./env.mjs";
const g = await import("./game.bundle.mjs");

const argv = process.argv.slice(2);
const showAll = argv.includes("--all");
const survey = argv.includes("--survey");
const bn = Number(argv.find((a) => /^\d+$/.test(a)) ?? 1);

// SEVERITY, not a violation count. This file used to test `actual === expect`
// and report how MANY assumptions differed, which ranked BitNode 12 — where
// every multiplier is 0.98 — as the worst node in the game. It is the mildest
// after BN1. That output was reported to the user as "BN12 breaks 13 of 15",
// which was wrong in the only way that mattered: it inverted the ranking.
//
// Two changes fix it.
//
// 1. A TOLERANCE, per assumption, with the slack it is measured against named.
//    `tol: 0.10` on the weaken/grow rates is not a guess — batch.js:84 sizes
//    every grow and weaken thread count with `SETTINGS.margin = 1.1`, so a 10%
//    under-estimate of thread effect is already absorbed by construction. The
//    0.05 default is the point below which a figure in a comment or a doc is
//    not worth re-deriving. A tolerance that is not stated next to the decision
//    it protects is a fudge; these are stated.
//
// 2. A SEVERITY, in doublings of error, weighted by whether the deviation is in
//    the direction that actually hurts and by how much the assumption matters.
//    `dangerous` names the direction: ServerWeakenRate above 1 merely wastes
//    threads because weaken clamps at minSecurity, while below 1 desyncs the
//    pipeline permanently. `impact` is 3 for "the run stops working", 2 for
//    "the run is measurably worse", 1 for "only the reasoning in a comment is
//    wrong". Sorting by severity puts the two that actually stop the batcher at
//    the top of the list instead of burying them alphabetically.
//
/**
 * mult:      BitNodeMultipliers key this assumption depends on (null = structural)
 * expect:    the BN1 value the code assumes
 * where:     file(s) carrying the assumption
 * breaks:    what actually goes wrong
 * tol:       relative deviation below which behaviour is unchanged (default 0.05)
 * dangerous: 'below' | 'above' | 'both' — which direction actually hurts
 * impact:    3 stops the run, 2 degrades it, 1 only invalidates prose
 */
const ASSUMPTIONS = [
  {
    id: "world-daemon-difficulty",
    tol: 0.0001, dangerous: "both", impact: 3,
    // The single number the entire endgame aims at. Not a tolerance question —
    // any value != 1 moves the finish line, so this is exact-match.
    mult: "WorldDaemonDifficulty",
    expect: 1,
    where: "tools/sim/daedalus-plan.mjs (WD_TARGET), progress.js (gate `target`)",
    breaks:
      "w0r1d_d43m0n's required hacking level is 3000 * WorldDaemonDifficulty (Server/ServerHelpers.ts:423), and backdooring it is what ENDS the BitNode. daedalus-plan.mjs hardcoded 3000, the BitNode 1 value, so in BN5 (1.5) it aimed 33% low and in BN2 (5) it would aim at 3000 against a real 15,000 — reporting the final gate as reached when it is nowhere near. The error is invisible in BN1 and silent everywhere else: the plan still prints finite, plausible hours, they are just aimed at the wrong target. It also changes the RANKING, not only the total: at the true 4500 the 'skip BitRunners' variant needs 230 hours to reach the level where at 3000 it looked instant. progress.js computes this correctly and publishes target=4500; the two disagreed until daedalus-plan.mjs was made to derive it from the node.",
  },
  {
    id: "linear-cloud-pricing",
    tol: 0.02, dangerous: "both", impact: 3,
    // Any deviation at all changes the cost CURVE, not just a level — buyserv picks the wrong fleet shape. 2% because the exponent amplifies it: softcap^(log2(ram)-6) over a 1PB server is softcap^14.
    mult: "CloudServerSoftcap",
    expect: 1,
    where: "buyserv.js (header + 'largest affordable doubling')",
    breaks:
      "Cloud RAM stops being $/GB-flat: cost = ram * base * softcap^(log2(ram)-6), so ANY value != 1 makes price size-dependent (>1 punishes large servers, <1 rewards them). buyserv concentrates spend into the single biggest server because at softcap=1 total RAM per dollar is size-independent and only contiguity matters. With softcap=2 (BN11) a 1PB server costs ~32,000x what the flat rate implies, and levelling the fleet beats concentrating it. buyserv will not overpay — it reads getServerUpgradeCost — but it will buy the wrong shape and may stall entirely.",
  },
  {
    id: "cloud-cost",
    tol: 0.05, dangerous: "both", impact: 1,
    mult: "CloudServerCost",
    expect: 1,
    where: "buyserv.js header reasoning ($55k/GB), docs/roadmap.md",
    breaks: "Every cost figure in comments and docs is off by this factor. buyserv.js itself prices through ns.cloud.getPurchasedServerCost, so its behaviour is fine; reasoning about it is not.",
  },
  {
    id: "cloud-cost-pserv",
    tol: 0.05, dangerous: "both", impact: 2,
    // impact 2, not 1: unlike buyserv.js this one is arithmetic the script
    // actually spends money on, not a figure in a comment.
    mult: "CloudServerCost",
    expect: 1,
    where: "archive/superseded/pserv.js gbRamCost = 55000 (archive/superseded/pserv.js:5)",
    breaks:
      "HARDCODED, and the scaling it does apply is to a multiplier that no longer exists. pserv.js:98 does `settings.gbRamCost *= getBitNodeMultipliers().PurchasedServerCost` — the v1 name; the game renamed it CloudServerCost (BitNodeMultipliers.ts:131), and bitNodeMultipliers.js still merges over a v1-named defaults table, so the factor read is a constant 1 whatever the node says. Every affordability test in pserv.js (:124,:136,:138,:163,:164,:181,:183) is therefore off by CloudServerCost: too high and it buys servers it cannot pay for, too low and it never buys. pserv.js is superseded by buyserv.js and not in the boot stack, which is the only reason this is not impact 3.",
  },
  {
    id: "cloud-limit",
    tol: 0.05, dangerous: "both", impact: 1,
    mult: "CloudServerLimit",
    expect: 1,
    where: "buyserv.js (ns.cloud.getServerLimit is read, so behaviour adapts)",
    breaks: "Fewer/more servers than 25. Read at runtime, so this is informational only.",
  },
  {
    id: "cloud-limit-pserv",
    tol: 0.05, dangerous: "both", impact: 1,
    mult: "CloudServerLimit",
    expect: 1,
    where: "archive/superseded/pserv.js maxPlayerServers = 25 (archive/superseded/pserv.js:4)",
    breaks:
      "A hardcoded default that pserv.js:97 overwrites with ns.cloud.getServerLimit() before the loop starts, so the live behaviour adapts. It still matters as a number: it is what the file reads as, and a node where the limit is 0 (BN1 answers 25, several answer less) exits at pserv.js:101 — the literal is the thing that makes that path look unreachable.",
  },
  {
    id: "cloud-maxram",
    tol: 0.05, dangerous: "both", impact: 1,
    mult: "CloudServerMaxRam",
    expect: 1,
    where: "buyserv.js (ns.cloud.getRamLimit is read)",
    breaks: "Max server size changes. Read at runtime; informational.",
  },
  {
    id: "cloud-maxram-pserv",
    tol: 0.05, dangerous: "both", impact: 1,
    mult: "CloudServerMaxRam",
    expect: 1,
    where: "archive/superseded/pserv.js maxGbRam = 1048576 (archive/superseded/pserv.js:6)",
    breaks:
      "A hardcoded default overwritten at pserv.js:96 by ns.cloud.getRamLimit(), so sizing adapts. Informational, with the same caveat as cloud-limit-pserv: the literal is what a reader takes the ceiling to be, and every doubling loop in the file (:125,:139,:165,:184) clamps against it.",
  },
  {
    id: "weaken-rate",
    tol: 0.10, dangerous: "below", impact: 3,
    // tol 0.10 = SETTINGS.margin (batch.js:84), which already over-provisions weaken threads by 10%. Below 1 is the dangerous direction; above 1 only wastes threads because weaken clamps at minSecurity.
    mult: "ServerWeakenRate",
    expect: 1,
    where: "batch.js WEAKEN_PER_THREAD = 0.05, archive/superseded/hack.js settings.changes.weaken = 0.05 (archive/superseded/hack.js:22)",
    breaks:
      "HARDCODED in both. getWeakenEffect multiplies by ServerWeakenRate, so weaken threads are mis-sized by exactly this factor. >1 (BN11 = 2) merely wastes threads, since weaken clamps at minSecurity. <1 is the dangerous direction: security is never fully removed, hackFraction stays below what the planner assumes, and the pipeline desyncs into permanent re-prep. hack.js carries its own copy in the same table as the hack/grow security ADDITIONS (0.002/0.004), which are NOT multiplier-scaled — so the three numbers look alike and only one of them moves with the node.",
  },
  {
    id: "growth-rate",
    tol: 0.10, dangerous: "below", impact: 3,
    // tol 0.10 = SETTINGS.margin (batch.js:84). Over-growing is free (capped at moneyMax); under-growing starves every batch.
    mult: "ServerGrowthRate",
    expect: 1,
    where: "batch.js growthK / growThreads",
    breaks:
      "Grow thread counts wrong by this factor. Over-growing is harmless (capped at moneyMax); under-growing means money never reaches the level the hack fraction assumes, so every batch takes less than planned.",
  },
  {
    id: "hack-money",
    tol: 0.05, dangerous: "below", impact: 3,
    mult: "ScriptHackMoney",
    expect: 1,
    where: "batch.js hackFraction — MITIGATED by measurement, see below",
    breaks:
      "hackFraction is scaled by player mults but NOT by currentNodeMults.ScriptHackMoney, so a raw reading over-estimates yield per hack thread and under-sizes grow, draining targets to the floor. " +
      "ALREADY HANDLED, and this entry used to imply otherwise: batch.js cannot call getBitNodeMultipliers (it throws without SF5), so it MEASURES the missing factor instead (batch.js:312-326) — y == ScriptHackMoney exactly when the no-Formulas fallback is in use, and y == 1 with Formulas.exe because calculatePercentMoneyHacked already carries the node multiplier. " +
      "Live in BN5 the calibration reports verdict ok, 'agrees with Formulas.exe: measured 1 against the expected 1.0', 128 samples — so the 0.15 here is the NODE being poor, not the batcher being wrong, and low income in BN5 is expected rather than a bug to chase. " +
      "The hazard DOES return if the calibration is disabled (batch.js's rollback switch) or reports too few samples: check batch.txt's `calibration.verdict` before believing this is still mitigated.",
  },
  {
    id: "hack-money-gain",
    tol: 0.05, dangerous: "both", impact: 2,
    mult: "ScriptHackMoneyGain",
    expect: 1,
    where: "batch.js earnings accounting",
    breaks: "Money actually received differs from money modelled; target ranking is skewed toward the wrong servers.",
  },
  {
    id: "hack-exp",
    tol: 0.05, dangerous: "below", impact: 1,
    mult: "HackExpGain",
    expect: 1,
    where: "docs, exp-rate reasoning",
    breaks: "Levelling speed differs from every estimate in docs/roadmap.md.",
  },
  {
    id: "faction-rep",
    tol: 0.05, dangerous: "below", impact: 3,
    // Below 1 makes nfg.js under-donate and loop forever without affording the level — it never terminates, it just never succeeds.
    mult: "FactionWorkRepGain",
    expect: 1,
    where: "nfg.js donation sizing, share.js reasoning, favor.js repFromDonation/donationForRep",
    breaks:
      "nfg.js computes donation = shortfall * 1e6 assuming faction_rep >= 1; favor.js:77 repFromDonation takes the same 1e6 base. repFromDonation multiplies by FactionWorkRepGain too — below 1 it will systematically UNDER-donate and loop without ever affording the level.",
  },
  {
    id: "donate-favor",
    tol: 0.005, dangerous: "both", impact: 3,
    // tol 0.005: favorNeededToDonate() takes a floor(), so 150*1.004 is still 150 while 150*0.99 is 148 — a value that rounds to a different integer is a different gate.
    // 'both', not 'above': high means nfg.js donates at a faction that cannot accept it, and low means nfg.js's own MIN_FAVOR = 150 blocks donations the game would allow. BN8 sets this to 0, i.e. donations are free from favor 0, and nfg.js would still sit waiting for 150.
    mult: "FavorToDonateToFaction",
    expect: 1,
    where: "nfg.js MIN_FAVOR = 150; favor.js:65 favorNeededToDonate()",
    breaks:
      "HARDCODED. favorNeededToDonate() = floor(150 * this). If it rises, nfg.js will try to donate at a faction that cannot accept donations and report 'donation input not found'.",
  },
  {
    id: "daedalus-augs",
    tol: 0.0167, dangerous: "both", impact: 2,
    // tol 1/60: the quantity is an integer count of augmentations, so anything that changes it by one whole augmentation matters and nothing smaller exists.
    mult: "DaedalusAugsRequirement",
    expect: 30,
    where: "bitNodeMultipliers.js:85 (defaults table), faction.js:20 (30 * mult), docs/roadmap.md, the whole endgame plan",
    breaks:
      "The augmentation count needed for Daedalus changes; every 'we need N more augs' calculation is wrong. " +
      "Note the game value is an ABSOLUTE COUNT, not a scale factor (FactionInfo.tsx:142 passes it straight to " +
      "haveAugmentations), so faction.js:20's `30 * mult` is a category error that was right only while the " +
      "fallback table wrongly held 1. With SF5 and the real table it would demand 900 augmentations.",
  },
  {
    id: "go-power",
    tol: 0.05, dangerous: "below", impact: 2,
    mult: "GoPower",
    expect: 1,
    where: "go.js header, golib.js effect estimates",
    breaks: "IPvGO node power yields a different faction_rep bonus than the tables in go.js claim.",
  },
  {
    id: "home-ram-cost",
    tol: 0.05, dangerous: "above", impact: 2,
    // impact raised from 1: this stopped being "only the reasoning shifts" when
    // the price moved out of homeup.js's button-reading and into arithmetic.
    mult: "HomeComputerRamCost",
    expect: 1,
    where: "homecost.js ramUpgradeCost = ram * 32000 * 1.58^log2(ram) (homecost.js:34)",
    breaks:
      "HARDCODED. getUpgradeHomeRamCost (PlayerObjectServerMethods.ts:30) is `ram * BaseCostFor1GBOfRamHome * 1.58^log2(ram) * HomeComputerRamCost`, and homecost.js omits the last factor. This used to be registered against homeup.js on the grounds that homeup read prices off the buttons and therefore adapted — that is no longer true and had already gone stale here: the arithmetic moved to homecost.js precisely because reading the buttons cannot tell 'cannot afford' from 'maxed' (RamButton.tsx:49). watchdog.js's homeup trigger now gates on nextHomeUpgrade(), so in a node where this is not 1 the trigger is wrong by that factor in both directions — too high and homeup never wakes, too low and it wakes every 5 minutes to find it cannot pay.",
  },
  {
    id: "contract-money",
    tol: 0.05, dangerous: "both", impact: 2,
    // 'both': too low and ctauto.js's ranking under-values contracts against
    // hacking; too high and every "contracts are worth $25m each" figure in the
    // roadmap over-states the only income source that works while unattended.
    mult: "CodingContractMoney",
    expect: 1,
    where: "contractplan.js BASE_MONEY_GAIN = 75e6 — multiplied by the node's CodingContractMoney in expectedReward",
    breaks:
      "HARDCODED. PlayerObjectGeneralMethods.ts multiplies CodingContractBaseMoneyGain by difficulty AND currentNodeMults.CodingContractMoney, and contract.js applies only the difficulty scaling. This exact constant has already been wrong once in the expensive direction: it read 4000 (the Bitburner v1 value) against the real 75e6, an 18,750x understatement that made contracts look worthless for years of play. A BitNode multiplier reintroduces the same error class quietly — BN8 sets this to 0, which makes every contract worth nothing and the ranking that prefers them actively harmful.",
  },
  {
    id: "infiltration-rep",
    tol: 0.05, dangerous: "both", impact: 1,
    mult: "InfiltrationRep",
    expect: 1,
    where: "docs/roadmap.md §17",
    breaks: "The 'infiltration is 3.6-7x faction work' verdict changes.",
  },
];

/** Structural facts that are not BitNodeMultipliers but are just as load-bearing. */
const STRUCTURAL = [
  ["No Source-File 4", "cmd.js, augbuy.js, torbuy.js, nfg.js, backdoor.js all drive the DOM because ns.singularity throws. With SF4 these could use the API — they will still WORK, but they are needlessly fragile and slow."],
  ["Intelligence is 0 (needs SF5)", "batch.js omits the intelligence terms in calculateHackingChance/percentMoneyHacked, and reputation.ts adds int/3 to work gain. Non-zero intelligence makes every formula in batch.js and every rep estimate low."],
  ["Hacknet = nodes, not servers (SF9)", "hacknet.js buys Netburners-qualifying nodes. With SF9 they become hacknet SERVERS with different costs, an API change (ns.hacknet.*), and they contribute RAM."],
  ["go.cheat requires SF14.2", "go-cheat.js is gated on ns.getResetInfo().ownedSF.get(14) >= 2 and is skipped otherwise. Correct already, but the cheat policy only becomes live there."],
  ["Faction join needs a trusted click", "FactionsRoot.tsx:89 checks event.isTrusted; no in-game script can join a faction in ANY BitNode. This never changes."],
  ["Purchased servers are single-core", "batch.js reads getServer(h).cpuCores per host rather than assuming, so this adapts. Informational."],

  // --- ns.ramOverride floors (invariant C5) --------------------------------
  // These are NOT BitNodeMultipliers, which is why they live here rather than in
  // ASSUMPTIONS: they depend on the SOURCE-FILE 4 level and the current BitNode
  // (RamCostGenerator.ts:82-96), a dimension the multiplier table does not
  // cover. They still belong on the arriving-in-a-new-node checklist, because
  // each is a hand-written number in a shipped script whose validity is a claim
  // about what this save can and cannot call.
  [
    "ns.ramOverride floors are 2.6GB, and the raise ceilings are SF4-dependent",
    "healer.js, createProgram.js, training.js, crime.js, faction.js, bladeburner.js, sleeve.js, endgame.js and progress.js each declare " +
      "`ns.ramOverride(2.6)` as the first statement of main (2.6 = RamCostConstants.Base 1.6 + ns.getResetInfo 1.0) and then " +
      "raise to `nonSing + singBase * singularityRamMultiplier(resetInfo)` before the first gated call. The FLOOR is " +
      "BitNode-independent; the CEILING is not — singBase is multiplied by 1 inside BN4, 16 at SF4.1, 4 at SF4.2, 1 at SF4.3. " +
      "Entering a node where that multiplier rises makes every ceiling rise with it, and a raise the host cannot afford is " +
      "SILENTLY DENIED (NetscriptFunctions.ts:1210-1214 returns the old allocation without throwing) — ramgrow.js checks the " +
      "return value and publishes, which is the only reason that is not a crash loop. " +
      "tools/test/ramoverride.test.mjs [R1..R5] re-derives every one of these numbers from the game's own calculator on each " +
      "run, in four regimes, so this row is a pointer rather than a second copy of the constants.",
  ],
  [
    "ns.ramOverride is ignored in eleven silent shapes",
    "An override is honoured ONLY as the first statement of a FunctionDeclaration literally named `main`, with one numeric " +
      "literal >= 1.6, in the entry module (RamCalculations.ts:352-360, :484-487, :174-181). `ns.disableLog('ALL')` first, an " +
      "arrow `main`, `export default`, a non-literal argument, a literal below 1.6 — each yields FULL price with no warning. " +
      "This is BitNode-independent and will not show up in any multiplier check; tools/test/ramoverride.test.mjs [R4] is the " +
      "negative control that proves the detector for it can still fail.",
  ],
];

/**
 * How wrong an assumption is, in DOUBLINGS of error, weighted.
 *
 * Not a boolean and not a count. `|log2(actual/expect)|` is the natural scale
 * for a multiplier: 0.5x and 2x are equally wrong, 0.98 is 0.03 doublings and
 * 32x is 5. Then:
 *   - a deviation in the harmless direction is worth a quarter, not nothing,
 *     because it is still a number in the code that no longer matches the game;
 *   - impact multiplies, so "the batcher desyncs" outranks "a comment is stale"
 *     at equal magnitude.
 * Zero when inside tolerance. `actual === 0` is treated as total failure of the
 * assumption rather than -Infinity doublings.
 */
function severity(a, actual) {
  const expect = a.expect;
  const tol = a.tol ?? 0.05;
  if (!isFinite(actual)) return { sev: Infinity, rel: actual, within: false };
  const rel = actual / expect;
  if (Math.abs(rel - 1) <= tol) return { sev: 0, rel, within: true };
  const dir0 = a.dangerous ?? "both";
  if (actual === 0) {
    // The quantity is switched off, not merely scaled. log2(0) is -Infinity, so
    // stand in 6 doublings (64x) — large enough to dominate any ordinary
    // scaling, finite enough that two of them still sum meaningfully.
    const harmful0 = dir0 === "both" || dir0 === "below";
    return { sev: 6 * (a.impact ?? 2) * (harmful0 ? 1 : 0.25), rel, within: false, harmful: harmful0 };
  }
  const doublings = Math.abs(Math.log2(rel));
  const dir = a.dangerous ?? "both";
  const harmful = dir === "both" || (dir === "below" && rel < 1) || (dir === "above" && rel > 1);
  return { sev: doublings * (harmful ? 1 : 0.25) * (a.impact ?? 2), rel, within: false, harmful };
}

// Bands on the TOTAL severity of a node, so "one thing is catastrophic" and
// "six things are mildly off" do not land in the same bucket by accident.
const band = (score) => (score === 0 ? "ok" : score < 1 ? "MINOR" : score < 5 ? "MAJOR" : score < 15 ? "SEVERE" : "FATAL");

function report(n) {
  const m = g.getBitNodeMultipliers(n, 1);
  const broken = [];   // outside tolerance — these need a decision
  const nearMiss = []; // differs, but inside the tolerance it was given
  const held = [];     // exactly as assumed
  for (const a of ASSUMPTIONS) {
    const actual = m[a.mult];
    const s = severity(a, actual);
    const row = { ...a, actual, ...s };
    if (!s.within) broken.push(row);
    else if (actual !== a.expect) nearMiss.push(row);
    else held.push(row);
  }
  broken.sort((x, y) => y.sev - x.sev);
  const score = broken.reduce((t, b) => t + Math.min(b.sev, 20), 0);
  return { m, broken, nearMiss, held, score };
}

if (survey) {
  // Ranked by SEVERITY, not by how many things differ. Counting was what made
  // BN12 (every multiplier 0.98) look like the worst node in the game.
  const rows = [];
  for (let n = 1; n <= 14; n++) {
    try {
      const r = report(n);
      rows.push({ n, ...r });
    } catch {
      rows.push({ n, score: -1, broken: [], nearMiss: [], held: [] });
    }
  }
  rows.sort((a, b) => b.score - a.score);
  console.log("BitNode  severity  band     worst offenders (severity in weighted doublings of error)");
  for (const r of rows) {
    if (r.score < 0) {
      console.log(`BN${String(r.n).padEnd(3)}        ?   (not defined)`);
      continue;
    }
    const top = r.broken
      .slice(0, 4)
      .map((b) => `${b.id} ${b.actual}(${b.sev.toFixed(1)})`)
      .join(", ");
    console.log(
      `BN${String(r.n).padEnd(3)}  ${r.score.toFixed(1).padStart(7)}  ${band(r.score).padEnd(7)} ` +
        `${String(r.broken.length).padStart(2)} outside tol, ${String(r.nearMiss.length).padStart(2)} within  ${top || "(none)"}`,
    );
  }
  console.log(
    "\nSeverity = sum over assumptions of |log2(actual/expect)| x impact(1-3), quartered when the\n" +
      "deviation is in the harmless direction, zero inside each assumption's stated tolerance.\n" +
      "It ranks by HOW WRONG, not by HOW MANY: BN12 sets every multiplier to 0.98, which is 13\n" +
      "differences and almost no consequence.",
  );
} else {
  const { broken, nearMiss, held, score } = report(bn);
  const outside = broken;
  console.log(`=== BitNode ${bn}: severity ${score.toFixed(1)} (${band(score)}), ${outside.length} assumption(s) outside tolerance ===\n`);
  for (const b of outside) {
    console.log(
      `[sev ${b.sev.toFixed(2)}] ${b.id}  ${b.mult}: expected ${b.expect}, actual ${b.actual}  ` +
        `(x${b.rel.toFixed(3)}, tolerance +/-${((b.tol ?? 0.05) * 100).toFixed(1)}%, impact ${b.impact ?? 2}` +
        `${b.harmful === false ? ", in the harmless direction" : ""})`,
    );
    console.log(`   where : ${b.where}`);
    console.log(`   breaks: ${b.breaks}\n`);
  }
  const inTol = nearMiss;
  if (inTol.length) {
    console.log(`--- differ but within tolerance, so behaviour is unchanged (${inTol.length}) ---`);
    for (const b of inTol) console.log(`  ${b.id} (${b.mult} = ${b.actual}, tolerance +/-${((b.tol ?? 0.05) * 100).toFixed(1)}%)`);
    console.log();
  }
  if (showAll && held.length) {
    console.log(`--- exactly as assumed (${held.length}) ---`);
    for (const h of held) console.log(`  ${h.id} (${h.mult} = ${h.actual})`);
    console.log();
  }
  console.log("--- structural assumptions, check by hand ---");
  for (const [what, why] of STRUCTURAL) console.log(`  * ${what}\n      ${why}`);
}
