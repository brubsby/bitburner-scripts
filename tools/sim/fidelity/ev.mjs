// Expected value at each decision point.
//
// Every function here answers one question with a number, so a strategy — in
// the sim or in the live game — can compare alternatives instead of racing
// them. Three rules the module keeps to:
//
//  1. **Everything is priced in RAM-seconds.** RAM is the only genuinely
//     scarce resource in the early game; wall time is free (we are not the
//     ones waiting) and money is a renewable. A thread of `op` held for its
//     duration costs `ramPerThread * durationSeconds`, and that is the
//     denominator of every rate below.
//  2. **Security is an externality and is charged back.** A hack thread adds
//     0.002 security and a grow thread 0.004; undoing that costs weaken
//     threads, and those threads are held for 4x hack time. Charging them to
//     the op that caused them is what turns the naive index M*phi/T into the
//     ratio auto.js now uses, and the constants 1.98 / 6.16 in auto.js fall
//     out of `loadedHackRamSeconds` / `loadedGrowRamSeconds` below rather than
//     being magic.
//  3. **Experience is a second currency, not a footnote.** At the point in the
//     run where money is flat and the level is climbing, exp is the binding
//     constraint. Every op EV therefore reports `exp` alongside `money`, and
//     `blendedValue` puts an explicit, caller-chosen dollar price on exp so
//     the two can be added.
//
// All formulas come from the game's own source via game.mjs. Where a figure is
// derived rather than read, the derivation is in the comment.

import {
  ServerConstants,
  calculateGrowMoney,
  calculateGrowTime,
  calculateHackingChance,
  calculateHackingExpGain,
  calculateHackingTime,
  calculatePercentMoneyHacked,
  calculateServerGrowthLog,
  calculateSkill,
  calculateWeakenTime,
  getWeakenEffect,
  numCycleForGrowthCorrected,
} from "../game.mjs";

/** RAM per thread of the dedicated workers. early.js self-decides and costs more. */
export const RAM = { hack: 1.7, grow: 1.75, weaken: 1.75, earlyJs: 2.4 };

/** src/Server/data/Constants.ts — 0.002. Growing costs twice this. */
export const FORTIFY = ServerConstants.ServerFortifyAmount;

/** A view of a server at minimum security: the state we intend to keep it in. */
export function prepped(server) {
  return { ...server, hackDifficulty: server.minDifficulty };
}

// ---------------------------------------------------------------------------
// Loaded costs: what a thread of each op really costs once you charge it for
// the security it creates.
// ---------------------------------------------------------------------------

/** Weaken threads needed to undo `security` points, at `cores`. */
export function weakenThreadsFor(security, cores = 1) {
  return security / getWeakenEffect(1, cores);
}

/**
 * RAM-seconds a single hack thread really costs: its own 1.7GB for T seconds,
 * plus the weaken threads its 0.002 security forces, each held for 4T.
 *
 *   1.7*T + (0.002/0.05)*1.75*4*T = 1.7*T + 0.28*T = 1.98*T     (cores = 1)
 */
export function loadedHackRamSeconds(server, player, { cores = 1, ram = RAM } = {}) {
  const T = calculateHackingTime(server, player);
  const w = weakenThreadsFor(FORTIFY, cores);
  return ram.hack * T + w * ram.weaken * calculateWeakenTime(server, player);
}

/**
 * The same for a grow thread: 1.75GB for 3.2T, plus 0.004 security of weaken.
 *
 *   1.75*3.2T + (0.004/0.05)*1.75*4T = 5.6*T + 0.56*T = 6.16*T  (cores = 1)
 */
export function loadedGrowRamSeconds(server, player, { cores = 1, ram = RAM } = {}) {
  const Tg = calculateGrowTime(server, player);
  const w = weakenThreadsFor(2 * FORTIFY, cores);
  return ram.grow * Tg + w * ram.weaken * calculateWeakenTime(server, player);
}

export function weakenRamSeconds(server, player, { ram = RAM } = {}) {
  return ram.weaken * calculateWeakenTime(server, player);
}

// ---------------------------------------------------------------------------
// Per-operation expected value.
//
// Each returns { money, exp, ramSeconds, seconds, ... } for ONE THREAD, from
// the world as it is *now*. Money is the expectation, so the hack-chance
// weighting is already applied and a 30%-chance hack is worth 30% of its take.
// ---------------------------------------------------------------------------

/**
 * One hack thread. `threads` matters only through the drain cap and the
 * security it adds, so pass the batch size when you have it.
 *
 * The exp term is the part every naive index drops: a hack pays
 * `expGain * chance + expGain/4 * (1 - chance)`, i.e. it still pays a quarter
 * when it misses, and a hack that lands on an already-empty server is demoted
 * to the failure rate (`moneyDrained === 0 => expGainedOnSuccess =
 * expGainedOnFailure`, NetscriptHelpers.tsx). That last clause is why
 * oversubscription is worse than merely useless — see marginalHackThread.
 */
export function evHackThread(server, player, { threads = 1, cores = 1, ram = RAM } = {}) {
  const T = calculateHackingTime(server, player);
  const chance = calculateHackingChance(server, player);
  const phi = calculatePercentMoneyHacked(server, player);
  const expFull = calculateHackingExpGain(server, player);

  const drainAll = Math.min(server.moneyAvailable, Math.max(0, server.moneyAvailable * phi * threads));
  const perThread = threads > 0 ? drainAll / threads : 0;
  const empty = drainAll <= 0;
  const exp = empty ? expFull / 4 : expFull * chance + (expFull / 4) * (1 - chance);

  return {
    op: "hack",
    seconds: T,
    chance,
    phi,
    money: chance * perThread,
    exp,
    ramSeconds: ram.hack * T,
    loadedRamSeconds: loadedHackRamSeconds(server, player, { cores, ram }),
    securityAdded: FORTIFY,
  };
}

/**
 * One grow thread, valued by the money it puts on the server.
 *
 * calculateGrowMoney is `(M + n) * exp(k*n)` capped at moneyMax, so the
 * marginal dollar of the n-th thread is `(dM'/dn) = exp(k*n)*(1 + k*(M+n))`,
 * which at n = 0 is `1 + k*M`. Server money is only worth `chance * phi`-ish
 * to the player, but in a harvesting steady state every dollar grown onto the
 * server is eventually taken, so the honest conversion is the hack chance
 * alone — a dollar that reaches the player is a dollar.
 *
 * Against the cap the marginal collapses to zero, which is exactly the
 * over-grow waste the sim needs to see.
 */
export function evGrowThread(server, player, { threads = 1, cores = 1, ram = RAM } = {}) {
  const Tg = calculateGrowTime(server, player);
  const k = calculateServerGrowthLog(server, 1, player, cores);
  const exp = calculateHackingExpGain(server, player);

  const before = server.moneyAvailable;
  const after = calculateGrowMoney(server, threads, player, cores);
  const perThread = threads > 0 ? (after - before) / threads : 0;

  // Threads that actually did something — the rest add no security either
  // (processSingleServerGrowth clamps usedCycles), which is why over-growing
  // is cheap rather than harmful.
  const used =
    after !== before
      ? Math.min(Math.max(0, Math.ceil(numCycleForGrowthCorrected(server, after, before, cores, player))), threads)
      : 0;

  return {
    op: "grow",
    seconds: Tg,
    k,
    money: calculateHackingChance(prepped(server), player) * perThread,
    serverMoney: perThread,
    exp,
    ramSeconds: ram.grow * Tg,
    loadedRamSeconds: loadedGrowRamSeconds(server, player, { cores, ram }),
    securityAdded: threads > 0 ? (2 * FORTIFY * used) / threads : 0,
    wastedThreads: threads - used,
  };
}

/**
 * One weaken thread. It earns no money directly; its value is that it makes
 * every subsequent op on this server shorter and every hack more likely and
 * bigger. Priced as the RAM-seconds it saves.
 *
 * T is linear in hackDifficulty (src/Hacking.ts):
 *   T = 5*(2.5*R*D + 500)/(L+50)/speedMult   =>   dT/dD = 5*2.5*R/(L+50)/mult
 * so removing `w = 0.05*coreBonus` security cuts every op's duration by
 * `w * dT/dD`. Over a horizon in which the fleet will launch `opsAhead`
 * op-threads against this server, the saving is that times their RAM.
 *
 * It also raises phi and chance, both linear in (100 - D)/100 — reported
 * separately as `phiGain` / `chanceGain` because those only pay off if you
 * actually hack afterwards.
 */
export function evWeakenThread(server, player, { cores = 1, ram = RAM, opsAhead = 1, opRam = RAM.grow } = {}) {
  const Tw = calculateWeakenTime(server, player);
  const w = getWeakenEffect(1, cores);
  const effective = Math.min(w, Math.max(0, server.hackDifficulty - server.minDifficulty));

  const T = calculateHackingTime(server, player);
  // dT/dD without re-deriving the constant: T is affine in D with intercept
  // 5*500/(L+50)/mult, so dT/dD = (T - intercept)/D. Get it by evaluating at
  // two difficulties, which is robust to any future formula change.
  const T2 = calculateHackingTime({ ...server, hackDifficulty: server.hackDifficulty + 1 }, player);
  const dTdD = T2 - T;

  const after = { ...server, hackDifficulty: server.hackDifficulty - effective };
  return {
    op: "weaken",
    seconds: Tw,
    securityRemoved: effective,
    ramSecondsSaved: effective * dTdD * opsAhead * opRam,
    phiGain: calculatePercentMoneyHacked(after, player) - calculatePercentMoneyHacked(server, player),
    chanceGain: calculateHackingChance(after, player) - calculateHackingChance(server, player),
    exp: calculateHackingExpGain(server, player),
    ramSeconds: ram.weaken * Tw,
    money: 0,
  };
}

/**
 * The marginal return of the n-th hack thread, which is the thing prior-art
 * claims goes *negative* past a target's capacity. It does, and here is why in
 * one place:
 *
 *  - Money is capped: total drain is `min(moneyAvailable, M*phi*n)`, so past
 *    `n* = 1/phi` the extra threads take nothing.
 *  - Security is not capped by money: fortify is
 *    `0.002 * min(threads, ceil(1/phi))`, so it saturates too — at n*.
 *  - But exp *is* demoted: when the drain is zero the whole cohort gets
 *    exp/4. And the RAM is spent regardless.
 *
 * So the marginal thread past n* returns 0 money, 0 extra security, and a
 * quarter of the exp it would have earned elsewhere, while occupying 1.7GB for
 * T seconds. Negative in opportunity-cost terms, which is what matters.
 */
export function marginalHackThread(server, player, n, opts = {}) {
  const a = evHackThread(server, player, { ...opts, threads: Math.max(1, n) });
  const b = evHackThread(server, player, { ...opts, threads: Math.max(1, n) + 1 });
  const chance = calculateHackingChance(server, player);
  const phi = calculatePercentMoneyHacked(server, player);
  return {
    money: chance * (b.money * (n + 1) - a.money * n),
    capacity: phi > 0 ? 1 / phi : Infinity,
    saturated: n >= (phi > 0 ? 1 / phi : Infinity),
  };
}

// ---------------------------------------------------------------------------
// Steady state: what a prepped target is worth per RAM-second.
// ---------------------------------------------------------------------------

/**
 * Money per RAM-second a target sustains once prepped, in the small-hack-
 * fraction limit. This is auto.js's `rateOf`, derived rather than transcribed:
 *
 *   score = chance * M / ( loadedHackRamSeconds/phi + loadedGrowRamSeconds/k )
 *
 * Take fraction f with f/phi hack threads; put it back with f/k grow threads
 * (since grow is exp(k*n), returning a fraction f costs ~f/k threads as f->0).
 */
export function harvestRate(server, player, { cores = 1, ram = RAM } = {}) {
  const p = prepped(server);
  const phi = calculatePercentMoneyHacked(p, player);
  const k = calculateServerGrowthLog(p, 1, player, cores);
  if (!(phi > 0) || !(k > 0)) return 0;
  const chance = calculateHackingChance(p, player);
  const perDollar = loadedHackRamSeconds(p, player, { cores, ram }) / phi + loadedGrowRamSeconds(p, player, { cores, ram }) / k;
  return (chance * server.moneyMax) / perDollar;
}

/** Exp per RAM-second of the same steady state — the other currency. */
export function harvestExpRate(server, player, { cores = 1, ram = RAM } = {}) {
  const p = prepped(server);
  const phi = calculatePercentMoneyHacked(p, player);
  const k = calculateServerGrowthLog(p, 1, player, cores);
  if (!(phi > 0) || !(k > 0)) return 0;
  const e = calculateHackingExpGain(p, player);
  // One "cycle" per dollar-fraction: 1/phi hack threads + 1/k grow threads +
  // the weakens both force. Exp is per thread regardless of op.
  const hackT = 1 / phi;
  const growT = 1 / k;
  const weakT = weakenThreadsFor(FORTIFY, cores) * hackT + weakenThreadsFor(2 * FORTIFY, cores) * growT;
  const threads = hackT + growT + weakT;
  const ramSec =
    loadedHackRamSeconds(p, player, { cores, ram }) / phi + loadedGrowRamSeconds(p, player, { cores, ram }) / k;
  return ramSec > 0 ? (e * threads) / ramSec : 0;
}

/**
 * What it costs, in RAM-seconds, to get this server from where it is now to
 * prepped (min security, max money). This is the number a retarget decision
 * has to pay and the sim previously charged nothing for.
 */
export function prepCost(server, player, { cores = 1, ram = RAM } = {}) {
  const w = getWeakenEffect(1, cores);
  const Tw = calculateWeakenTime(server, player);

  // Pass 1: weaken to minimum from where we are.
  const excess = Math.max(0, server.hackDifficulty - server.minDifficulty);
  let weakenThreads = Math.ceil(excess / w);

  // Pass 2: grow to max, which itself adds security that must also be weakened.
  const p = prepped(server);
  let growThreads = 0;
  if (server.moneyAvailable < server.moneyMax) {
    growThreads = Math.ceil(
      Math.max(0, numCycleForGrowthCorrected(p, server.moneyMax, Math.max(1, server.moneyAvailable), cores, player)),
    );
    weakenThreads += Math.ceil((2 * FORTIFY * growThreads) / w);
  }

  const Tg = calculateGrowTime(p, player);
  const ramSeconds = weakenThreads * ram.weaken * Tw + growThreads * ram.grow * Tg;

  return {
    weakenThreads,
    growThreads,
    ramSeconds,
    /** Wall seconds if the whole fleet is thrown at it. Ops cannot be split
     *  below one duration, so the floor is one weaken plus one grow. */
    secondsAtRam: (fleetRamGb) => {
      if (!(fleetRamGb > 0)) return Infinity;
      const serial = (excess > 0 ? Tw : 0) + (growThreads > 0 ? Tg + Tw : 0);
      return Math.max(serial, ramSeconds / fleetRamGb);
    },
  };
}

// ---------------------------------------------------------------------------
// Per-decision expected value.
// ---------------------------------------------------------------------------

/**
 * Retarget, or stay?
 *
 * This is the decision that cost us two hours. The old `rateOf` comparison was
 * `rate(candidate) > rate(current)`, which is the H -> infinity, zero-prep-cost
 * limit — under that model switching is free and always right, and the fleet
 * re-preps forever. The honest comparison over a finite horizon H, with fleet
 * RAM R:
 *
 *   value(x) = rate(x) * R * max(0, H - prepSeconds(x))
 *
 * plus, for the switch, the work already in flight against the incumbent,
 * which a kill destroys outright. That last term is not a sunk cost you may
 * ignore: `deploy()` kills the workers, so the incumbent's own prep restarts
 * from the *security and money it is at*, not from scratch — but any op in
 * flight is gone, and its thread-seconds have to be re-spent.
 *
 * Returns the full working so a caller can log why it decided what it did.
 */
export function evRetarget({
  current,
  candidate,
  player,
  fleetRamGb,
  horizonSeconds,
  inFlightRamSeconds = 0,
  cores = 1,
  ram = RAM,
  expPrice = 0,
}) {
  const value = (s) => {
    if (!s) return { rate: 0, prepSeconds: 0, total: 0 };
    const rate = harvestRate(s, player, { cores, ram }) + expPrice * harvestExpRate(s, player, { cores, ram });
    const prep = prepCost(s, player, { cores, ram });
    const prepSeconds = prep.secondsAtRam(fleetRamGb);
    return {
      rate,
      prepSeconds,
      prepRamSeconds: prep.ramSeconds,
      total: rate * fleetRamGb * Math.max(0, horizonSeconds - prepSeconds),
    };
  };

  const stay = value(current);
  const move = value(candidate);
  // Switching also throws away whatever is mid-flight. Charge it at the
  // incumbent's rate, because that is the production those RAM-seconds were
  // about to buy.
  const discarded = inFlightRamSeconds * stay.rate;

  return {
    stay,
    move,
    discarded,
    gain: move.total - stay.total - discarded,
    switch: move.total - discarded > stay.total,
  };
}

/**
 * Prep further, or hack now?
 *
 * early.js's MONEY_FLOOR in closed form. Hacking at fraction f of max money
 * takes f*M per cycle and costs the hack RAM-seconds; the alternative is to
 * spend those RAM-seconds growing to f' > f first. Growing from f to f' costs
 * `ln(f'/f)/k` threads and yields `(f' - f)*M` more per take.
 *
 * Returns the marginal dollars per RAM-second of each choice, so the caller
 * takes the larger.
 */
export function evPrepVsHack(server, player, { cores = 1, ram = RAM, threads = 1 } = {}) {
  const hack = evHackThread(server, player, { threads, cores, ram });
  const grow = evGrowThread(server, player, { threads, cores, ram });
  const prepSec = Math.max(0, server.hackDifficulty - server.minDifficulty);
  const weak = evWeakenThread(server, player, { cores, ram, opsAhead: threads });

  const hackPer = hack.loadedRamSeconds > 0 ? hack.money / hack.loadedRamSeconds : 0;
  const growPer = grow.loadedRamSeconds > 0 ? grow.money / grow.loadedRamSeconds : 0;
  // A weaken is only worth doing while security is elevated; price it by the
  // RAM-seconds it gives back, converted at the better of the two rates.
  const weakPer =
    prepSec > 0 && weak.ramSeconds > 0 ? (weak.ramSecondsSaved * Math.max(hackPer, growPer)) / weak.ramSeconds : 0;

  const best = weakPer >= hackPer && weakPer >= growPer ? "weaken" : growPer > hackPer ? "grow" : "hack";
  return { hackPer, growPer, weakPer, best, hack, grow, weaken: weak };
}

/**
 * Buy RAM, or hold the cash?
 *
 * RAM is only worth buying if it will be *used* — the fleet already runs at
 * 99% utilisation, so the marginal GB earns the current best harvest rate for
 * the rest of the horizon. Against that, holding cash earns nothing in BN1
 * without the stock market. So the test is simply whether the GB pays for
 * itself inside the horizon:
 *
 *   payback = cost / (rate * H)
 *
 * The interesting case, and the one the optimizer's numbers hide, is that the
 * rate here must be the *achieved* rate, not the theoretical one. If the fleet
 * is churning through prep and earning zero, more RAM buys more zero.
 */
export function evBuyRam({ gb, cost, achievedRatePerRamSecond, horizonSeconds }) {
  const revenue = achievedRatePerRamSecond * gb * horizonSeconds;
  return {
    revenue,
    cost,
    net: revenue - cost,
    paybackSeconds: achievedRatePerRamSecond > 0 ? cost / (achievedRatePerRamSecond * gb) : Infinity,
    buy: revenue > cost,
  };
}

/**
 * Split the fleet across k targets, or concentrate it?
 *
 * A target absorbs a bounded number of threads: `1/phi` hack threads take all
 * its money, and no more grow threads help once it is at moneyMax. Past that
 * the marginal thread returns zero (marginalHackThread). So the answer is a
 * greedy fill of a ranked list — which is exactly optimal because the return
 * per target is linear up to its cap (prior-art section 6) — and this function
 * just reports where the cap falls.
 */
export function fleetSplit(targets, player, { fleetRamGb, cores = 1, ram = RAM, expPrice = 0 } = {}) {
  const ranked = targets
    .map((s) => ({
      server: s,
      rate: harvestRate(s, player, { cores, ram }) + expPrice * harvestExpRate(s, player, { cores, ram }),
      capacityRamGb: targetCapacityRamGb(s, player, { cores, ram }),
    }))
    .filter((r) => r.rate > 0)
    .sort((a, b) => b.rate - a.rate);

  const plan = [];
  let left = fleetRamGb;
  for (const r of ranked) {
    if (left <= 0) break;
    const give = Math.min(left, r.capacityRamGb);
    plan.push({ ...r, ramGb: give });
    left -= give;
  }
  return { plan, idleRamGb: left, marginalRate: plan.length ? plan[plan.length - 1].rate : 0 };
}

/**
 * GB this target can usefully absorb at once: the threads of a full cycle,
 * each held for its own duration, divided by the cycle period. A target whose
 * money is taken in one hack and regrown over 3.2T can keep
 * `cycleRamSeconds / cycleSeconds` GB busy and not a byte more.
 */
export function targetCapacityRamGb(server, player, { cores = 1, ram = RAM } = {}) {
  const p = prepped(server);
  const phi = calculatePercentMoneyHacked(p, player);
  const k = calculateServerGrowthLog(p, 1, player, cores);
  if (!(phi > 0) || !(k > 0)) return 0;
  const Th = calculateHackingTime(p, player);
  const Tg = calculateGrowTime(p, player);
  const Tw = calculateWeakenTime(p, player);

  const hackThreads = 1 / phi; // take everything, once
  const growThreads = Math.max(
    0,
    numCycleForGrowthCorrected(p, server.moneyMax, Math.max(1, server.moneyMax * (1 - 1)) || 1, cores, player),
  );
  const gThreads = isFinite(growThreads) && growThreads > 0 ? growThreads : 1 / k;
  const wThreads = weakenThreadsFor(FORTIFY * hackThreads + 2 * FORTIFY * gThreads, cores);

  const cycleRamSeconds = hackThreads * ram.hack * Th + gThreads * ram.grow * Tg + wThreads * ram.weaken * Tw;
  const cycleSeconds = Tw + Tg + Th; // serial prep-then-take, which is what early.js does
  return cycleSeconds > 0 ? cycleRamSeconds / cycleSeconds : 0;
}

/**
 * Put a dollar price on a point of hacking level, so exp and money can be
 * added. Levels are worth money because every op's duration is
 * proportional to 1/(L+50) and phi and chance both rise with L.
 *
 * The honest local price: how much does the fleet's achieved rate rise per
 * level, times the horizon?
 */
export function expPriceFromHorizon(server, player, { fleetRamGb, horizonSeconds, cores = 1, ram = RAM } = {}) {
  const now = harvestRate(server, player, { cores, ram });
  const nextLevel = { ...player, skills: { ...player.skills, hacking: player.skills.hacking + 1 } };
  const then = harvestRate(server, nextLevel, { cores, ram });
  const dRate = then - now;
  // Exp needed for one more level, from calculateSkill's inverse.
  const expNow = player.hackExp ?? 0;
  let need = 1;
  {
    const L = calculateSkill(expNow);
    let lo = expNow;
    let hi = Math.max(expNow * 1.5, expNow + 1000);
    while (calculateSkill(hi) <= L) hi *= 1.5;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (calculateSkill(mid) > L) hi = mid;
      else lo = mid;
    }
    need = hi - expNow;
  }
  return {
    dollarsPerLevel: dRate * fleetRamGb * horizonSeconds,
    expPerLevel: need,
    dollarsPerExp: need > 0 ? (dRate * fleetRamGb * horizonSeconds) / need : 0,
  };
}

/** Money + priced exp, for callers that want one scalar. */
export function blendedValue(ev, dollarsPerExp = 0) {
  return (ev.money ?? 0) + dollarsPerExp * (ev.exp ?? 0);
}
