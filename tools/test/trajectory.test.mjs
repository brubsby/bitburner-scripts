// [TJ] the reputation trajectory — a rising rate priced in closed form.
//
// The closed form is checked against brute numeric integration, because a
// hand-derived primitive is exactly the artifact class this repo distrusts:
// one sign error in the ((a+rT)ln(a+rT) - ...) expression and every schedule
// hour is silently wrong in a way nothing downstream would notice.

import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const { repModel, incomeModel, estimateBaseRepPerSec } = await import("../../trajectory.js");
const { skillFromExp } = await import("../../installgate.js");

export async function run() {
  const checks = [];

  // The live shape at the time of writing: base 3.6 rep/s at hacking 515,
  // exp 1.4e5-ish, mult 1.9, 490 exp/s.
  const live = { baseRepPerSec: 3.6, hacking: 515, hackingExp: 1.4e5, hackingMult: 1.9, expPerSec: 490 };

  /* ---------------------------------------------------------------- TJ1 --- */
  const c1 = new Check("TJ1", "CALIBRATION: the closed form matches brute-force numeric integration");
  {
    const m = repModel(live);
    const C = live.baseRepPerSec / live.hacking;
    // Riemann sum at 1-second steps over the game's own (unfloored) level curve.
    const brute = (startH, h, fav) => {
      let acc = 0;
      const t0 = startH * 3600, T = (startH + h) * 3600;
      for (let t = t0; t < T; t++) {
        const lvl = live.hackingMult * (32 * Math.log(live.hackingExp + live.expPerSec * (t + 0.5) + 534.6) - 200);
        acc += C * fav * Math.max(lvl, 1);
      }
      return acc;
    };
    for (const [startH, h, fav] of [[0, 2, 1], [0, 20, 2.5], [5, 10, 1.354], [0.1, 0.5, 1]]) {
      c1.examined(1);
      const closed = m.repBetween(startH, h, fav);
      const numeric = brute(startH, h, fav);
      const rel = Math.abs(closed - numeric) / numeric;
      if (rel > 1e-4) c1.fail(`repBetween(${startH},${h},${fav}): closed ${closed.toFixed(0)} vs numeric ${numeric.toFixed(0)} (${(rel * 100).toFixed(3)}%)`);
    }
    c1.note("closed form within 0.01% of 1-second Riemann integration at four shapes");
  }
  checks.push(c1);

  /* ---------------------------------------------------------------- TJ2 --- */
  const c2 = new Check("TJ2", "a rising rate finishes SOONER than the snapshot says — and inversion round-trips");
  {
    const m = repModel(live);
    c2.examined(1);
    // The claim this module exists for: 20h-of-rep at the snapshot rate takes
    // materially less than 20h on the trajectory.
    const repAt20hConst = live.baseRepPerSec * 20 * 3600;
    const hTraj = m.hoursFor(repAt20hConst, 1, 0);
    if (!(hTraj < 20)) c2.fail(`the trajectory must beat the snapshot, got ${hTraj}h for a constant-rate 20h haul`);
    c2.note(`a snapshot-20h reputation haul actually takes ${hTraj.toFixed(1)}h at the measured exp flow`);

    c2.examined(1);
    // Round trip: hoursFor(repBetween(x)) = x.
    for (const h of [0.5, 3, 17, 40]) {
      const rep = m.repBetween(0, h, 1.5);
      const back = m.hoursFor(rep, 1.5, 0);
      if (Math.abs(back - h) > 1e-6 * h + 1e-9) c2.fail(`round trip at ${h}h came back as ${back}h`);
    }
    c2.examined(1);
    // Later starts run at a higher level: same rep, fewer hours.
    if (!(m.hoursFor(1e5, 1, 10) < m.hoursFor(1e5, 1, 0))) c2.fail("a later start must be faster, not slower");
    c2.examined(1);
    // Favour multiplies straight through.
    if (Math.abs(m.repBetween(0, 5, 2) - 2 * m.repBetween(0, 5, 1)) > 1e-9) c2.fail("favour must scale linearly");
  }
  checks.push(c2);

  /* ---------------------------------------------------------------- TJ3 --- */
  const c3 = new Check("TJ3", "degradation is explicit: no exp rate = flat calibrated model, bad inputs = null");
  {
    c3.examined(1);
    // No measured exp flow: the model still builds, flags itself flat, and
    // reproduces constant-rate arithmetic exactly — the pre-trajectory answer.
    const flat = repModel({ ...live, expPerSec: null });
    if (!flat || flat.grows) c3.fail("missing exp rate must degrade to a flat model, not refuse");
    if (Math.abs(flat.repBetween(0, 4, 1.5) - live.baseRepPerSec * 1.5 * 4 * 3600) > 1e-6) {
      c3.fail("the flat model must equal measured-rate x hours");
    }
    if (Math.abs(flat.hoursFor(1e5, 2, 7) - 1e5 / (live.baseRepPerSec * 2) / 3600) > 1e-9) {
      c3.fail("flat inversion must equal the constant-rate division");
    }
    c3.examined(1);
    // Unreadable core inputs refuse — a trajectory guessed from nothing is
    // worse than the snapshot it replaces.
    for (const bad of [
      {},
      { ...live, baseRepPerSec: 0 },
      { ...live, baseRepPerSec: NaN },
      { ...live, hacking: -5 },
      { ...live, hackingMult: 0 },
    ]) {
      if (repModel(bad) !== null) c3.fail(`unreadable inputs ${JSON.stringify(bad).slice(0, 60)} did not refuse`);
    }
    c3.examined(1);
    // Degenerate horizons.
    const m = repModel(live);
    if (m.repBetween(0, 0, 1) !== 0 || m.hoursFor(0, 1, 0) !== 0) c3.fail("zero horizon and zero rep are both zero");
  }
  checks.push(c3);

  /* ---------------------------------------------------------------- TJ4 --- */
  const c4 = new Check("TJ4", "the level inside the integral is the game's own curve");
  {
    // Differentiate repBetween numerically at t: d(rep)/dt should equal
    // C * level(t) * favor — with level from installgate's shared skillFromExp
    // (modulo its floor, hence the 1-level tolerance).
    const m = repModel(live);
    const C = live.baseRepPerSec / live.hacking;
    for (const atH of [0, 6, 30]) {
      c4.examined(1);
      const eps = 1 / 3600; // one second
      const slope = (m.repBetween(0, atH + eps, 1) - m.repBetween(0, atH, 1)) / eps / 3600;
      const lvl = skillFromExp(live.hackingExp + live.expPerSec * atH * 3600, live.hackingMult);
      if (Math.abs(slope / C - lvl) > 1.5) c4.fail(`at ${atH}h the implied level is ${(slope / C).toFixed(1)}, game says ${lvl}`);
    }
  }
  checks.push(c4);

  /* ---------------------------------------------------------------- TJ5 --- */
  const c5 = new Check("TJ5", "income: the (level+50) shape, never below flat, degradation explicit");
  {
    const iv = { incomePerSec: 8500, hacking: 262, hackingExp: 3.2e4, hackingMult: 1.9, expPerSec: 131 };
    const m = incomeModel(iv);

    c5.examined(1);
    // Closed form against 1-second Riemann integration of income x (level+50)/(base).
    const brute = (h) => {
      let acc = 0;
      for (let t = 0; t < h * 3600; t++) {
        const lvl = iv.hackingMult * (32 * Math.log(iv.hackingExp + iv.expPerSec * (t + 0.5) + 534.6) - 200);
        acc += (iv.incomePerSec * (Math.max(lvl, 1) + 50)) / (iv.hacking + 50);
      }
      return acc;
    };
    for (const h of [0.5, 2, 4]) {
      const rel = Math.abs(m.moneyBy(h) - brute(h)) / brute(h);
      if (rel > 1e-4) c5.fail(`moneyBy(${h}): closed ${m.moneyBy(h).toFixed(0)} vs numeric ${brute(h).toFixed(0)}`);
    }

    c5.examined(1);
    // THE BOUND, both directions: growth must project MORE than flat (that is
    // the point), and the factor must match the game's own level curve at the
    // horizon (skill.ts:13 via the shared inputs).
    for (const h of [0.25, 1, 4]) {
      if (!(m.moneyBy(h) > iv.incomePerSec * h * 3600)) c5.fail(`moneyBy(${h}h) must beat the flat projection`);
      const lvl = iv.hackingMult * (32 * Math.log(iv.hackingExp + iv.expPerSec * h * 3600 + 534.6) - 200);
      if (Math.abs(m.factorAt(h) - (lvl + 50) / (iv.hacking + 50)) > 1e-9) c5.fail(`factorAt(${h}) is not (level+50)/(base+50)`);
    }
    c5.note(`at the fresh-life rates, 4h of income projects x${(m.moneyBy(4) / (iv.incomePerSec * 4 * 3600)).toFixed(2)} the flat figure`);

    c5.examined(1);
    // Degradation: no exp flow = exactly flat, factor 1; unreadable = null.
    const flat = incomeModel({ ...iv, expPerSec: null });
    if (!flat || flat.grows) c5.fail("missing exp rate must degrade to flat, not refuse");
    if (Math.abs(flat.moneyBy(3) - iv.incomePerSec * 3 * 3600) > 1e-6) c5.fail("flat moneyBy must equal income x time");
    if (flat.factorAt(3) !== 1) c5.fail("flat factor is 1");
    for (const bad of [{}, { ...iv, incomePerSec: 0 }, { ...iv, hacking: NaN }, { ...iv, hackingMult: -1 }]) {
      if (incomeModel(bad) !== null) c5.fail(`unreadable inputs must refuse: ${JSON.stringify(bad).slice(0, 50)}`);
    }
    c5.examined(1);
    if (m.moneyBy(0) !== 0 || m.factorAt(0) !== 1) c5.fail("zero horizon: no money, factor 1");
  }
  checks.push(c5);

  /* ---------------------------------------------------------------- TJ6 --- */
  const c6 = new Check("TJ6", "the unmeasured-rate estimator matches the game's own getHackingWorkRepGain");
  {
    // CALIBRATION against the bundle, like FV1: the estimator exists because
    // a placeholder of 1 rep/s priced factions 3.5x under truth on every
    // life's first passes and a desk stint spuriously won the ranking. An
    // estimator that drifts from the game's formula just recreates that bug
    // with extra steps, so it is checked value-for-value here.
    let g;
    try {
      await import("../sim/env.mjs");
      g = await import("../sim/game.bundle.mjs");
    } catch (e) {
      c6.warn(`could not load the game bundle: ${e.message}`, "without it the estimator is self-consistent but unverified");
    }
    if (g?.getHackingWorkRepGain) {
      const saved = g.currentNodeMults.FactionWorkRepGain;
      for (const [hacking, int, frep, bn] of [[361, 0, 1.595, 0.75], [100, 0, 1, 1], [2500, 30, 3.5, 0.5]]) {
        c6.examined(1);
        g.currentNodeMults.FactionWorkRepGain = bn;
        // favor 0 (the estimator is a BASE rate) and share bonus as the game
        // computes it right now; x5 cycles/sec is the /sec conversion
        // (FactionWork.process applies gains x cycles at 5 cycles/sec).
        const game = g.getHackingWorkRepGain({ skills: { hacking, intelligence: int }, mults: { faction_rep: frep } }, 0) * 5;
        const mine = estimateBaseRepPerSec({ hacking, intelligence: int, factionRepMult: frep, nodeWorkRepMult: bn, sharePower: 1 });
        const rel = Math.abs(mine - game) / game;
        if (rel > 1e-9) c6.fail(`hacking ${hacking}: estimator ${mine}, game ${game} (${(rel * 100).toFixed(4)}%)`);
      }
      g.currentNodeMults.FactionWorkRepGain = saved;
      c6.note("estimator equals the game's formula x5 cycles at three stat shapes");
    }
    c6.examined(1);
    // At the live shape, the estimate must land near the measured truth —
    // that closeness is WHY it can stand in for the measurement. Placeholder
    // 1 was off 3.5x; this must be within a factor everyone can live with.
    const est = estimateBaseRepPerSec({ hacking: 361, factionRepMult: 1.595, nodeWorkRepMult: 0.75, sharePower: 1.2 });
    if (!(est > 2 && est < 5)) c6.fail(`live-shape estimate ${est} is not in the measured neighbourhood (3.5)`);
    c6.note(`live shape estimates ${est.toFixed(2)} rep/s vs 3.54 measured — the placeholder said 1`);
    c6.examined(1);
    // Refusals and the share floor.
    for (const bad of [{}, { hacking: 361 }, { hacking: 361, factionRepMult: 1.6 }, { hacking: NaN, factionRepMult: 1, nodeWorkRepMult: 1 }]) {
      if (estimateBaseRepPerSec(bad) !== null) c6.fail(`unreadable inputs must refuse: ${JSON.stringify(bad)}`);
    }
    const noShare = estimateBaseRepPerSec({ hacking: 100, factionRepMult: 1, nodeWorkRepMult: 1, sharePower: 0 });
    const unit = estimateBaseRepPerSec({ hacking: 100, factionRepMult: 1, nodeWorkRepMult: 1 });
    if (noShare !== unit) c6.fail("a broken share reading must floor at 1, not zero the estimate");
  }
  checks.push(c6);

  return checks;
}
