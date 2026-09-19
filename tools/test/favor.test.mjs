// [FV] faction favour — the threshold that turns money into reputation.
//
// Calibrated against the GAME'S OWN formulas, not against my arithmetic:
// tools/sim bundles the real source, so favorToRep/repToFavor/addRepToFavor are
// compared value-for-value rather than to numbers I typed. This repo has been
// bitten by a hand-derived constant more than once, most recently a RAM ceiling
// that was 5GB short because it was computed instead of measured.

import { Check } from "./harness.mjs";

const fv = await import("../../favor.js");
const { favorToRep, repToFavor, addRepToFavor, favorNeededToDonate, repFromDonation, donationForRep, donationGap, favorPath, repLadder, nfgLevelsByDonation, repToCross, MAX_FAVOR } = fv;

export async function run() {
  const checks = [];

  /* ---------------------------------------------------------------- FV1 --- */
  const c1 = new Check("FV1", "CALIBRATION: the favour curve matches the game's own formulas exactly");
  {
    let g;
    try {
      await import("../sim/env.mjs");
      g = await import("../sim/game.bundle.mjs");
    } catch (e) {
      c1.warn(`could not load the game bundle: ${e.message}`, "FV1 is the only check that proves these are the GAME's formulas; without it the rest is self-consistent but unverified");
    }
    if (g?.favorToRep && g?.repToFavor) {
      let worst = 0;
      for (const f of [0, 1, 10, 37.5, 95.1, 149, 150, 151, 1000, MAX_FAVOR]) {
        c1.examined(1);
        const mine = favorToRep(f);
        const theirs = g.favorToRep(f);
        const rel = theirs === 0 ? Math.abs(mine) : Math.abs(mine - theirs) / Math.abs(theirs);
        worst = Math.max(worst, rel);
        if (rel > 1e-12) c1.fail(`favorToRep(${f}): mine ${mine}, game ${theirs}`);
      }
      for (const r of [0, 1, 25000, 139350, 462507, 1e7]) {
        c1.examined(1);
        const mine = repToFavor(r);
        const theirs = g.repToFavor(r);
        const rel = theirs === 0 ? Math.abs(mine) : Math.abs(mine - theirs) / Math.abs(theirs);
        worst = Math.max(worst, rel);
        if (rel > 1e-12) c1.fail(`repToFavor(${r}): mine ${mine}, game ${theirs}`);
      }
      c1.note(`worst relative error against the game's own favor.ts: ${worst.toExponential(2)}`);
      if (g.addRepToFavor) {
        c1.examined(1);
        const mine = addRepToFavor(95.1, 3089);
        const theirs = g.addRepToFavor(95.1, 3089);
        if (Math.abs(mine - theirs) > 1e-9) c1.fail(`addRepToFavor: mine ${mine}, game ${theirs}`);
      }
    }
  }
  checks.push(c1);

  /* ---------------------------------------------------------------- FV2 --- */
  const c2 = new Check("FV2", "favour is granted at an INSTALL, from reputation banked — not earned continuously");
  {
    // The coupling that makes this module live next to the install gate: rep
    // converts to favour exactly once per install, and rep resets afterwards.
    c2.examined(1);
    if (addRepToFavor(100, 0) !== repToFavor(favorToRep(100))) c2.fail("zero reputation must leave favour unchanged");
    c2.examined(1);
    if (!(addRepToFavor(100, 50000) > 100)) c2.fail("banked reputation must raise favour at the install");
    c2.examined(1);
    // Round trip: the curve must invert.
    for (const f of [0, 50, 95.1, 150, 300]) {
      if (Math.abs(repToFavor(favorToRep(f)) - f) > 1e-9) c2.fail(`favorToRep/repToFavor do not invert at ${f}`);
    }
    c2.examined(1);
    // Negative reputation must not reduce favour — favour never goes backwards.
    if (addRepToFavor(100, -99999) !== repToFavor(favorToRep(100))) c2.fail("negative reputation must not reduce favour");
  }
  checks.push(c2);

  /* ---------------------------------------------------------------- FV3 --- */
  const c3 = new Check("FV3", "the donation threshold and its BitNode multiplier");
  {
    c3.examined(1);
    if (favorNeededToDonate() !== 150) c3.fail(`base threshold is ${favorNeededToDonate()}, expected 150 (Constants.ts:31)`);
    c3.examined(1);
    // Several BitNodes scale it; assuming 150 everywhere is a real bug class.
    if (favorNeededToDonate(2) !== 300) c3.fail("FavorToDonateToFaction must scale the threshold");
    c3.examined(1);
    if (favorNeededToDonate(0.5) !== 75) c3.fail("a sub-1 multiplier must lower the threshold, and it floors");
    c3.examined(1);
    // 150 favour is ~462,507 banked reputation — the number that makes the
    // grind long and the threshold worth planning for.
    const need = favorToRep(150);
    if (!(need > 462000 && need < 463000)) c3.fail(`favorToRep(150) = ${need}, expected ~462,507`);
    c3.note(`150 favour requires ${Math.round(need).toLocaleString()} banked reputation`);
  }
  checks.push(c3);

  /* ---------------------------------------------------------------- FV4 --- */
  const c4 = new Check("FV4", "donations use THREE factors — the BitNode term is the one that gets dropped");
  {
    c4.examined(1);
    // donation.ts:9 — amount/1e6 * mults.faction_rep * currentNodeMults.FactionWorkRepGain
    if (repFromDonation(1e6, 1, 1) !== 1) c4.fail("$1m at unit multipliers must be 1 reputation");
    c4.examined(1);
    // BitNode 4: FactionWorkRepGain = 0.75. Omitting it overstates by a third.
    const live = repFromDonation(1e9, 1.981, 0.75);
    const wrong = repFromDonation(1e9, 1.981, 1);
    if (Math.abs(live - 1485.75) > 0.01) c4.fail(`$1b at our live multipliers gives ${live}, expected 1485.75`);
    if (!(wrong > live)) c4.fail("dropping the BitNode term must overstate, not understate");
    c4.note(`at our live multipliers, $1b buys ${live.toFixed(0)} reputation (dropping the BN term would claim ${wrong.toFixed(0)})`);
    c4.examined(1);
    // Round trip against donationForRep.
    if (Math.abs(donationForRep(repFromDonation(5e9, 1.981, 0.75), 1.981, 0.75) - 5e9) > 1) {
      c4.fail("repFromDonation and donationForRep must invert");
    }
    c4.examined(1);
    if (isFinite(donationForRep(100, 0, 0.75))) c4.fail("a zero multiplier must yield Infinity, not a division by zero");
  }
  checks.push(c4);

  /* ---------------------------------------------------------------- FV5 --- */
  const c5 = new Check("FV5", "the live gap: how far our factions are from donating");
  {
    // The real state at the time this was written.
    const live = [
      { name: "CyberSec", favor: 95.1, rep: 1054 },
      { name: "NiteSec", favor: 35.4, rep: 3089 },
    ];
    const path = favorPath(live);
    c5.examined(1);
    if (path.donating.length) c5.fail(`${path.donating} should not be able to donate below 150 favour`);
    c5.examined(1);
    if (path.nearest?.name !== "CyberSec") c5.fail(`nearest should be CyberSec, got ${path.nearest?.name}`);
    c5.note(`CyberSec needs ${Math.round(path.nearest.repToBank).toLocaleString()} more banked reputation to cross 150`);
    c5.examined(1);
    // A faction already over the threshold reports zero gap and can donate.
    const over = donationGap({ name: "Daedalus", favor: 150, rep: 0 });
    if (!over.canDonateNow || over.repToBank !== 0) c5.fail("a faction at the threshold must report canDonateNow with no gap");
    c5.examined(1);
    // The case worth surfacing: enough reputation banked that the NEXT install
    // crosses the threshold. That makes the install worth far more than its
    // multiplier alone, and nothing else in the stack would notice.
    const willCross = donationGap({ name: "X", favor: 149, rep: favorToRep(150) - favorToRep(149) + 1 });
    if (!willCross.crossesOnNextInstall) c5.fail("a faction that would cross on the next install must say so");
    if (willCross.canDonateNow) c5.fail("it has not crossed yet — only the install converts it");
  }
  checks.push(c5);

  /* ---------------------------------------------------------------- FV6 --- */
  const c6 = new Check("FV6", "an unreadable faction is reported, never treated as satisfied");
  {
    for (const [name, f] of [
      ["missing favor", { name: "A" }],
      ["null favor", { name: "B", favor: null }],
      ["NaN favor", { name: "C", favor: NaN }],
      ["negative favor", { name: "D", favor: -1 }],
      ["string favor", { name: "E", favor: "150" }],
    ]) {
      c6.examined(1);
      if (donationGap(f) !== null) c6.fail(`${name} did not read as unknown`);
    }
    c6.examined(1);
    const path = favorPath([{ name: "ok", favor: 10, rep: 0 }, { name: "bad" }]);
    if (!path.unreadable.includes("bad")) c6.fail("an unreadable faction must be reported, not dropped");
    if (path.gaps.length !== 1) c6.fail("readable factions must still be ranked");
  }
  checks.push(c6);

  /* ---------------------------------------------------------------- FV7 --- */
  const c7 = new Check("FV7", "the donation unlock is priced as a RATIO of rates, needing no horizon");
  {
    const { donationUplift } = fv;
    const common = { baseRepPerSec: 3.43, repMult: 1.53, nodeWorkRepMult: 0.75 };

    // Below the threshold there is no unlock to price.
    c7.examined(1);
    if (donationUplift({ ...common, favorAfter: 149, incomePerSec: 1e6 }) !== 1) {
      c7.fail("a faction below the threshold must have no uplift");
    }

    // At and above it, the uplift scales with income — which is exactly why it
    // could not be a constant, and why it is a ratio rather than a horizon
    // integral. Every version of the install gate that needed a horizon shipped
    // a bug; a ratio of two rates needs none.
    c7.examined(1);
    const low = donationUplift({ ...common, favorAfter: 150, incomePerSec: 30e3 });
    const mid = donationUplift({ ...common, favorAfter: 150, incomePerSec: 750e3 });
    const high = donationUplift({ ...common, favorAfter: 150, incomePerSec: 5e6 });
    if (!(low < mid && mid < high)) c7.fail(`uplift must rise with income, got ${low} ${mid} ${high}`);
    c7.note(`uplift x${low.toFixed(3)} at $30k/s, x${mid.toFixed(3)} at $750k/s, x${high.toFixed(3)} at $5m/s`);

    c7.examined(1);
    // The arithmetic itself: 1 + r_donate/r_work.
    const rWork = 3.43 * (1 + 150 / 100);
    const rDonate = (750e3 / 1e6) * 1.53 * 0.75;
    if (Math.abs(mid - (1 + rDonate / rWork)) > 1e-9) c7.fail(`uplift is not 1 + r_donate/r_work (got ${mid})`);

    // Unreadable inputs must yield NO uplift rather than an invented one —
    // overstating this would argue for chasing a threshold that does not pay.
    for (const [name, o] of [
      ["no income", { ...common, favorAfter: 150 }],
      ["no rate", { favorAfter: 150, incomePerSec: 1e6, repMult: 1.5, nodeWorkRepMult: 0.75 }],
      ["zero rate", { ...common, baseRepPerSec: 0, favorAfter: 150, incomePerSec: 1e6 }],
      ["NaN favour", { ...common, favorAfter: NaN, incomePerSec: 1e6 }],
      ["negative income", { ...common, favorAfter: 150, incomePerSec: -1 }],
    ]) {
      c7.examined(1);
      if (donationUplift(o) !== 1) c7.fail(`${name} produced an uplift`);
    }

    c7.examined(1);
    // A BitNode that moves the threshold must move the test with it.
    if (donationUplift({ ...common, favorAfter: 150, incomePerSec: 1e6, favorToDonateMult: 2 }) !== 1) {
      c7.fail("at a doubled threshold, 150 favour is no longer enough");
    }
  }
  checks.push(c7);

  /* ---------------------------------------------------------------- FV8 --- */
  const c8 = new Check("FV8", "the ladder: rep requirements price in INSTALL WINDOWS, favour AND rate growth compounding");
  {
    // The live shape this was built from: BitRunners CSP-G5 at 275k rep,
    // favour 0, base ~7.3 rep/s, median window 1.72h, measured multiplier
    // growth ~3.4% per install.
    const live = { windowH: 1.72, baseRepPerSec: 7.3, favor: 0, rateGrowthPerCycle: 1.034 };

    c8.examined(1);
    const big = repLadder(275e3, live);
    if (!big || big.reachableNow || !isFinite(big.cycles)) c8.fail(`275k should ladder to a finite ETA with growth, got ${JSON.stringify(big)}`);
    else {
      // Hand-walk the module's own (FV1-calibrated) compounding.
      let f = 0, banked = 7.3 * 1.72 * 3600, hours = 1.72, cyc = null;
      for (let n = 1; n <= 200; n++) {
        f = addRepToFavor(f, banked);
        const rate = 7.3 * Math.pow(1.034, n) * (1 + f / 100);
        const grindH = 275e3 / rate / 3600;
        if (grindH <= 1.72) { cyc = n; hours += grindH; break; }
        banked = rate * 1.72 * 3600;
        hours += 1.72;
      }
      if (big.cycles !== cyc) c8.fail(`cycles: module ${big.cycles}, hand-walk ${cyc}`);
      if (Math.abs(big.totalHours - hours) > 1e-9) c8.fail(`hours: module ${big.totalHours}, hand-walk ${hours}`);
      c8.note(`BitRunners 275k: ${big.cycles} install cycles, ~${big.totalHours.toFixed(0)}h wall-clock at favour ${big.favorAtUnlock.toFixed(0)} (the old schedule said "21.1h", continuous)`);
    }

    c8.examined(1);
    // FAVOUR ALONE IS NOT ENOUGH for the big targets — the design bug this
    // check exists to keep dead. Without rate growth, fitting 275k in 1.72h
    // needs favour ~508 = 5.8e8 banked rep; the ladder must say Infinity
    // rather than pretend.
    const favourOnly = repLadder(275e3, { ...live, rateGrowthPerCycle: 1 });
    if (!favourOnly || favourOnly.cycles !== Infinity) {
      c8.fail(`favour-only must be honest about 275k: got ${favourOnly?.cycles} cycles`,
        "if this ever becomes finite, either the favour curve changed or someone re-simplified the ladder");
    }

    c8.examined(1);
    // Within one window: the caller's trajectory hours pass through untouched.
    const near = repLadder(30e3, { ...live, hoursNow: 1.1, remainingWindowH: 1.5 });
    if (!near?.reachableNow || near.totalHours !== 1.1) c8.fail("a within-window grind must keep its trajectory-priced hours");
    c8.examined(1);
    // Rep already held counts, and can satisfy outright.
    const held = repLadder(30e3, { ...live, currentRep: 30e3 });
    if (!held?.reachableNow || held.totalHours !== 0) c8.fail("a requirement already met is zero hours");
    c8.examined(1);
    // Favour, window length and growth all shorten the ladder, monotonically.
    const base = repLadder(275e3, live);
    if (!(repLadder(275e3, { ...live, favor: 100 }).totalHours < base.totalHours)) c8.fail("favour must shorten the ladder");
    if (!(repLadder(275e3, { ...live, windowH: 4 }).totalHours < base.totalHours)) c8.fail("a longer window must shorten the ladder");
    if (!(repLadder(275e3, { ...live, rateGrowthPerCycle: 1.1 }).totalHours < base.totalHours)) c8.fail("faster growth must shorten the ladder");

    c8.examined(1);
    for (const bad of [
      [NaN, live], [275e3, {}], [275e3, { ...live, windowH: 0 }], [275e3, { ...live, baseRepPerSec: -1 }],
    ]) {
      if (repLadder(bad[0], bad[1]) !== null) c8.fail(`unreadable inputs must refuse: ${JSON.stringify(bad[1])}`);
    }
  }
  checks.push(c8);

  /* ---------------------------------------------------------------- FV9 --- */
  const c9 = new Check("FV9", "the donation terminal: the ladder ends at favour 150 + money, not at grind-fits");
  {
    // Live shape + the donation-side inputs: faction_rep 2.0, BN4's 0.75,
    // income $440k/s compounding at the same measured g.
    const live = {
      windowH: 1.72, baseRepPerSec: 7.3, favor: 0, rateGrowthPerCycle: 1.034,
      donateAt: 150, repMult: 2.0, nodeWorkRepMult: 0.75, incomePerSec: 440e3,
    };

    c9.examined(1);
    const withDon = repLadder(275e3, live);
    const grindOnly = repLadder(275e3, { ...live, donateAt: undefined });
    if (!withDon || !grindOnly) c9.fail("both arms must price");
    else {
      // The claim measured live before building this: grind terminal fires at
      // favour 243 (cycle 18); favour 150 arrives at cycle 6. Whether the
      // DONATION then fires depends on income covering $183b in one window —
      // at $440k/s compounding, that takes more cycles, but strictly fewer
      // than the grind needed. Assert the composition, not a magic number.
      if (!(withDon.totalHours <= grindOnly.totalHours)) c9.fail("adding a terminal can only shorten the ladder");
      if (withDon.via === "donation" && !(withDon.cycles < grindOnly.cycles)) {
        c9.fail("a donation terminal that fired must have fired EARLIER than the grind terminal");
      }
      c9.note(`275k: grind-only ${grindOnly.cycles} cycles (favour ${grindOnly.favorAtUnlock.toFixed(0)}); with donations ${withDon.cycles} cycles via ${withDon.via}${withDon.donationDollars ? ` ($${(withDon.donationDollars / 1e9).toFixed(0)}b)` : ""}`);
    }

    c9.examined(1);
    // With RICH income the donation dominates outright and fires at the
    // first cycle whose favour crosses 150 — cycle 6 at this shape.
    const rich = repLadder(275e3, { ...live, incomePerSec: 1e8 });
    if (!(rich.via === "donation")) c9.fail("at $100m/s the donation must be the terminal");
    if (!(rich.cycles < repLadder(275e3, { ...live, donateAt: undefined }).cycles)) c9.fail("the rich donation must beat the grind");
    if (!(rich.donationDollars > 0)) c9.fail("a donation terminal must say what it spends");

    c9.examined(1);
    // Already across the threshold: money in hand counts, and a covered
    // donation is reachable NOW — the CyberSec state one install from today.
    const across = repLadder(200e3, {
      ...live, favor: 155, money: 200e9, incomePerSec: 440e3, hoursNow: 9,
    });
    if (!across?.reachableNow || across.via !== "donation") c9.fail(`favour 155 + covering cash must donate now: ${JSON.stringify(across)}`);
    if (Math.abs(across.donationDollars - (200e3 * 1e6) / 2.0 / 0.75) > 1) c9.fail("the dollars must be donation.ts's own arithmetic");

    c9.examined(1);
    // Grinding can still win now-side when it is genuinely cheaper.
    const grindWins = repLadder(5e3, { ...live, favor: 155, money: 0, incomePerSec: 1, hoursNow: 0.2, remainingWindowH: 1 });
    if (!grindWins?.reachableNow || grindWins.via !== "grind") c9.fail("a 12-minute grind must beat an unaffordable donation");

    c9.examined(1);
    // Half-specified donation inputs must degrade to the grind ladder, never guess.
    for (const partial of [
      { donateAt: 150 },
      { donateAt: 150, repMult: 2 },
      { donateAt: 150, repMult: 2, nodeWorkRepMult: 0.75 },
      { donateAt: 150, repMult: 2, nodeWorkRepMult: 0.75, incomePerSec: 0 },
    ]) {
      const r = repLadder(275e3, { ...live, donateAt: undefined, ...partial, incomePerSec: partial.incomePerSec });
      const base = repLadder(275e3, { ...live, donateAt: undefined });
      if (!r || r.cycles !== base.cycles || r.via === "donation") {
        c9.fail(`partial donation inputs ${JSON.stringify(partial)} must price exactly like grind-only`);
      }
    }
  }
  checks.push(c9);

  /* --------------------------------------------------------------- FV10 --- */
  const c10 = new Check("FV10", "the crossing's pieces: NFG levels per budget, and banked rep to 150 is ladder-exempt additive");
  {
    c10.examined(1);
    // Hand-walk at the live shape: NFG repReq 37,742, faction_rep 2.0, BN 0.75.
    // Level i costs donationForRep(37742 * 1.14^i) = 37742*1.14^i*1e6/1.5.
    const perLevel = (i) => (37742 * Math.pow(1.14, i) * 1e6) / 2.0 / 0.75;
    let left = 100e9, hand = 0;
    while (left >= perLevel(hand)) { left -= perLevel(hand); hand++; }
    const k = nfgLevelsByDonation(100e9, 37742, 2.0, 0.75);
    if (k !== hand) c10.fail(`levels: module ${k}, hand-walk ${hand}`);
    c10.note(`$100b of donations buys ${k} NFG level(s) at the live shape`);

    c10.examined(1);
    // Monotone in budget; zero on unreadable anything.
    if (!(nfgLevelsByDonation(300e9, 37742, 2.0, 0.75) > k)) c10.fail("more budget must buy more levels");
    for (const bad of [[0, 37742, 2, 0.75], [1e9, NaN, 2, 0.75], [1e9, 37742, 0, 0.75]]) {
      if (nfgLevelsByDonation(...bad) !== 0) c10.fail(`unreadable inputs must yield 0 levels: ${bad}`);
    }

    c10.examined(1);
    // repToCross is ADDITIVE in rep-space: splitting the grind across installs
    // loses nothing, because favor.ts converts TOTAL banked rep. This is the
    // property that exempts the crossing from the install-window ladder.
    const gap = repToCross(134);
    const half = gap / 2;
    const afterHalf = addRepToFavor(134, half);
    if (Math.abs(repToCross(afterHalf) - half) > 1e-6) {
      c10.fail("banking half the gap must leave exactly half the gap — additivity failed");
    }
    c10.examined(1);
    if (repToCross(150) !== 0 || repToCross(200) !== 0) c10.fail("already across is zero");
    if (repToCross(NaN) !== null || repToCross(-1) !== null) c10.fail("unreadable favour must refuse");
    if (repToCross(75, { favorToDonateMult: 0.5 }) !== 0) c10.fail("the BitNode threshold multiplier must apply");
  }
  checks.push(c10);

  return checks;
}
