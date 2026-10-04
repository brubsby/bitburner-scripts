// [GT] Thompson sampling over the Go opponents' win rates, and the hidden
// opponent "????????????" (GoOpponent.w0r1d_d43m0n — a Go BOARD, not the
// w0r1d_d43m0n server).
//
//   GT1 The Beta posterior is updated exactly (prior + decayed counts), the
//       priors sit on the old point estimates, and the gamma/Beta sampler
//       reproduces the Beta's mean and variance.
//   GT2 Thompson choice converges to the opponent that is best on the TRUE
//       win rates, from synthetic outcomes, in both directions — so the draws
//       actually drive the price.
//   GT3 The hidden opponent is offered only with The Red Pill INSTALLED, is
//       skipped by name otherwise, and the game-source facts it rests on are
//       pinned (komi, bonusPower, channel, forced 19x19, the TRP gate).
//   GT4 Its price: the climb weight is a with/without on the same inputs and
//       matches exitplan's climb; on the Bladeburner route it is a known 0 and
//       pricing never picks it — while the capped measurement batch still runs.
//   GT5 The measurement record and the gameplan observation format.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { fileURLToPath } from "node:url";
import "./gameresolve.mjs";

// Not ram.mjs's REPO: that drags in esbuild, which a mutant sandbox has not got.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

/** mulberry32: a seeded uniform rng, so every run of this suite is the same run. */
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function run() {
  const checks = [];
  const gp = await import("../../goplan.js");

  /* ------------------------------------------------------------------ GT1 */
  const c1 = new Check("GT1", "the Beta posterior updates exactly, starts on the old point estimates, and the sampler draws the Beta it names");
  {
    // Priors: mean = WIN_RATE (behaviour starts where it was), modest weight.
    for (const [name, p0] of Object.entries(gp.WIN_RATE)) {
      c1.examined(1);
      const pr = gp.posteriorOf(gp.emptyPosterior(), name, 5);
      if (!(Math.abs(pr.mean - p0) < 0.02)) c1.fail(`${name}'s prior mean ${pr.mean} must be its point estimate ${p0}`);
      if (!(pr.a + pr.b <= gp.THOMPSON.priorN + 0.2)) c1.fail(`${name}'s prior must be modest (a+b ${pr.a + pr.b} > ${gp.THOMPSON.priorN})`);
    }
    c1.examined(1);
    const w0p = gp.posteriorOf(gp.emptyPosterior(), gp.W0, 5);
    if (!(w0p.a === 1 && w0p.b === 1)) c1.fail(`the hidden opponent's prior must be Beta(1,1) (wide), got Beta(${w0p.a},${w0p.b})`);

    // Update arithmetic: decay then add, on the right arm only, raw games counted.
    c1.examined(1);
    let s = gp.emptyPosterior();
    const seq = [true, true, false, true, false, false, true];
    let w = 0, l = 0;
    for (const won of seq) {
      s = gp.updatePosterior(s, "Daedalus", 5, won, 0.9);
      w = w * 0.9 + (won ? 1 : 0);
      l = l * 0.9 + (won ? 0 : 1);
    }
    const pd = gp.posteriorOf(s, "Daedalus", 5);
    const pr = gp.priorOf("Daedalus");
    if (!(Math.abs(pd.a - (pr.a + w)) < 1e-12 && Math.abs(pd.b - (pr.b + l)) < 1e-12)) c1.fail(`posterior must be prior + decayed counts: got Beta(${pd.a}, ${pd.b}), want Beta(${pr.a + w}, ${pr.b + l})`);
    if (pd.games !== seq.length) c1.fail(`raw games must count every game undecayed (${pd.games} vs ${seq.length})`);
    if (gp.posteriorOf(s, "Illuminati", 5).n !== 0) c1.fail("an update leaked onto another arm");
    // No decay = plain counting; the hidden opponent's arm is keyed at 19 whatever size is asked.
    let s2 = gp.updatePosterior(gp.emptyPosterior(), gp.W0, 5, true, 1);
    s2 = gp.updatePosterior(s2, gp.W0, 9, false, 1);
    const p2 = gp.posteriorOf(s2, gp.W0, 13);
    if (!(p2.a === 2 && p2.b === 2)) c1.fail(`the hidden opponent's arm must be one arm at 19x19 (got Beta(${p2.a},${p2.b}))`);
    if (!gp.armKey(gp.W0, 5).endsWith("@19")) c1.fail("the hidden opponent's arm key must name 19x19");
    // Persistence round trip; an unreadable file is the priors, said so.
    c1.examined(1);
    const back = gp.parsePosterior(JSON.stringify(s));
    if (back.why || gp.posteriorOf(back.state, "Daedalus", 5).a !== pd.a) c1.fail("the posterior must survive a write/read round trip");
    const bad = gp.parsePosterior("{not json");
    if (!bad.why || Object.keys(bad.state.arms).length) c1.fail("an unreadable posterior file must start from the priors AND say so");

    // The sampler: mean and variance of Beta(a,b) for shapes either side of 1.
    const rng = rng32(7);
    for (const [a, b] of [[0.3, 0.7], [2, 5], [9.33, 0.67], [40, 12]]) {
      c1.examined(1);
      const N = 20000;
      let m = 0, m2 = 0;
      for (let i = 0; i < N; i++) {
        const x = gp.betaDraw(a, b, rng);
        if (!(x >= 0 && x <= 1)) { c1.fail(`Beta(${a},${b}) drew ${x} outside [0,1]`); break; }
        m += x;
        m2 += x * x;
      }
      m /= N;
      const v = m2 / N - m * m;
      const em = a / (a + b), ev = (a * b) / ((a + b) ** 2 * (a + b + 1));
      if (!(Math.abs(m - em) < 4 * Math.sqrt(ev / N) + 1e-3)) c1.fail(`Beta(${a},${b}) sample mean ${m.toFixed(4)} vs ${em.toFixed(4)}`);
      if (!(Math.abs(v / ev - 1) < 0.06)) c1.fail(`Beta(${a},${b}) sample variance ${v.toExponential(3)} vs ${ev.toExponential(3)}`);
      c1.note(`Beta(${a},${b}): mean ${m.toFixed(4)} (want ${em.toFixed(4)}), var ${v.toExponential(3)} (want ${ev.toExponential(3)})`);
    }
  }
  checks.push(c1);

  /* ------------------------------------------------------------------ GT2 */
  const c2 = new Check("GT2", "Thompson choice converges to the opponent best on the TRUE win rates (synthetic outcomes, both directions)");
  {
    // Two priced boards, nothing banked (so the choice is the rates alone, not
    // concavity). At the prior point estimates Illuminati leads: weights
    // hacking_money / hacking_speed = 2 put TheBlackHand at 0.9*3733*2 =
    // 6719 against Illuminati 0.7*10331 = 7232. If Illuminati's TRUE win rate
    // is 0.05 its rate scales by rateScale(0.05, 0.25) ~ 0.69 -> ~4970, and
    // TheBlackHand is right; at a true 0.6 Illuminati stays right.
    const W = { faction_rep: 0, hacking_speed: 1, hacking_money: 2 };
    const NP = { Daedalus: 0, Illuminati: 0, TheBlackHand: 0 };
    for (const [trueI, want] of [[0.05, "TheBlackHand"], [0.6, "Illuminati"]]) {
      c2.examined(1);
      const truth = { ...gp.WIN_RATE, Illuminati: trueI };
      const rng = rng32(trueI === 0.05 ? 11 : 12);
      let state = gp.emptyPosterior();
      const picks = [];
      for (let g = 0; g < 600; g++) {
        const draw = gp.drawWinRates(state, Object.keys(gp.OPPONENTS), 5, rng);
        const r = gp.chooseOpponent({ weights: W, windowH: 2, incumbent: picks.at(-1) ?? "Daedalus", nodePower: NP, winRates: draw });
        if (r.refused) { c2.fail("a decidable objective refused under Thompson draws", r.why); break; }
        picks.push(r.opponent);
        state = gp.updatePosterior(state, r.opponent, 5, rng() < truth[r.opponent]);
      }
      const tail = picks.slice(-100);
      const share = tail.filter((x) => x === want).length / tail.length;
      const post = gp.posteriorOf(state, "Illuminati", 5);
      c2.note(`true Illuminati ${trueI}: last-100 share on ${want} ${(share * 100).toFixed(0)}%, Illuminati posterior mean ${post.mean.toFixed(3)} after ${post.games} games`);
      if (!(share >= 0.85)) c2.fail(`with Illuminati's true win rate ${trueI} the choice must settle on ${want} (last 100: ${(share * 100).toFixed(0)}%)`);
    }
    // Without draws the old deterministic pricing is untouched (point estimates).
    c2.examined(1);
    const det = gp.chooseOpponent({ weights: W, windowH: 2, incumbent: "Daedalus", nodePower: NP });
    if (det.opponent !== "Illuminati") c2.fail(`without draws the point estimates must price as before (Illuminati), got ${det.opponent}`, det.why);
    // go.js draws per game boundary and hands the draw to the pricing.
    c2.examined(1);
    const src = read("go.js");
    if (!/drawWinRates\(posterior/.test(src) || !/winRates:\s*draw/.test(src)) c2.fail("go.js must draw from the posterior and price on the draw");
    if (!/updatePosterior\(posterior, opponent, size, won[,)]/.test(src)) c2.fail("go.js must fold every finished game into the posterior");
    if (!/writeHome\(THOMPSON\.file/.test(src)) c2.fail("go.js must persist the posterior so it survives restarts");
  }
  checks.push(c2);

  /* ------------------------------------------------------------------ GT3 */
  const c3 = new Check("GT3", "the hidden opponent is offered only with The Red Pill INSTALLED, skipped by name otherwise, on the facts game source states");
  {
    const GO = path.resolve(REPO, "../bitburner/src/Go");
    const src = (f) => fs.readFileSync(path.join(GO, f), "utf8");
    c3.examined(1);
    try {
      const ni = src("effects/netscriptGoImplementation.ts");
      if (!/opponent === GoOpponent\.w0r1d_d43m0n && !Player\.hasAugmentation\(AugmentationName\.TheRedPill, true\)/.test(ni)) c3.fail("resetBoardState's gate is no longer 'The Red Pill INSTALLED' — re-derive w0Eligible");
      const consts = src("Constants.ts");
      const blk = consts.slice(consts.indexOf("[GoOpponent.w0r1d_d43m0n]"));
      const komi = Number(blk.match(/komi:\s*([\d.]+)/)?.[1]);
      const bp = Number(blk.match(/bonusPower:\s*([\d.]+)/)?.[1]);
      if (komi !== gp.OPPONENTS[gp.W0].komi) c3.fail(`komi ${komi} in source vs ${gp.OPPONENTS[gp.W0].komi} here`);
      if (bp !== gp.OPPONENTS[gp.W0].power) c3.fail(`bonusPower ${bp} in source vs ${gp.OPPONENTS[gp.W0].power} here`);
      const eff = src("effects/effect.ts");
      if (!/case GoOpponent\.w0r1d_d43m0n:\s*mults\.hacking \*= effect/.test(eff)) c3.fail("the hidden opponent no longer feeds mults.hacking — its channel is wrong");
      const bs = src("boardState/boardState.ts");
      if (!/if \(ai === GoOpponent\.w0r1d_d43m0n\) \{[\s\S]{0,200}boardSize = 19/.test(bs)) c3.fail("the hidden opponent's board is no longer forced to 19x19");
      c3.note(`source: komi ${komi}, bonusPower ${bp}, channel mults.hacking, board 19x19, gate The Red Pill installed`);
    } catch (e) {
      c3.fail(`game source unreadable under ${GO}`, String(e));
    }
    // Eligibility from getResetInfo().ownedAugs (a Map of INSTALLED augs).
    for (const [owned, want, what] of [
      [new Map([["The Red Pill", 1]]), true, "Map with TRP"],
      [new Map([["NeuroFlux Governor", 3]]), false, "Map without TRP"],
      [["The Red Pill"], true, "array with TRP"],
      [undefined, false, "unreadable"],
    ]) {
      c3.examined(1);
      const r = gp.w0Eligible({ ownedAugs: owned });
      if (r.eligible !== want) c3.fail(`w0Eligible(${what}) must be ${want}`, r.why);
      if (!r.why) c3.fail(`w0Eligible(${what}) must say why`);
    }
    // Pricing: skipped BY NAME without TRP, and without a weight; chosen when it leads.
    const W = { faction_rep: 0.1, hacking_speed: 0.1, hacking_money: 0.1 };
    const NP = { Daedalus: 0, Illuminati: 0, TheBlackHand: 0 };
    c3.examined(1);
    const closed = gp.chooseOpponent({ weights: { ...W, hacking: 1e6 }, windowH: 2, incumbent: "Daedalus", nodePower: NP });
    if (closed.opponent === gp.W0 || !/w0r1d_d43m0n \(hacking: not discovered/.test(closed.why)) c3.fail("without The Red Pill the hidden opponent must be skipped by name, whatever its weight", closed.why);
    c3.examined(1);
    const noW = gp.chooseOpponent({ weights: W, windowH: 2, incumbent: "Daedalus", nodePower: NP, redPill: true });
    if (noW.refused || !/w0r1d_d43m0n \(hacking: objective carries no weight/.test(noW.why)) c3.fail("open but unpriced, the hidden opponent must be skipped by name, not refuse the rest", noW.why);
    c3.examined(1);
    const open = gp.chooseOpponent({ weights: { ...W, hacking: 10 }, windowH: 2, incumbent: "Daedalus", nodePower: NP, redPill: true });
    if (open.opponent !== gp.W0) c3.fail(`with The Red Pill installed and the climb weighing 10 h/ln it must lead (bonusPower 2), got ${open.opponent}`, open.why);
    // go.js: eligibility from the reset probe it already pays for, handed to the pricing.
    c3.examined(1);
    const g = read("go.js");
    if (!/w0Eligible\(reset\)/.test(g) || !/redPill:\s*w0\.eligible/.test(g)) c3.fail("go.js must gate the hidden opponent on getResetInfo's installed augs and pass it to chooseOpponent");
    if (/w0r1d_d43m0n['"]?\s*\)/.test(g.replace(/gameName\([^)]*\)/g, "")) && /connect|backdoor|nuke|brutessh/i.test(g)) c3.fail("go.js must never touch the w0r1d_d43m0n SERVER");
  }
  checks.push(c3);

  /* ------------------------------------------------------------------ GT4 */
  const c4 = new Check("GT4", "the hidden opponent's price: a with/without climb on the exit inputs, ~0 on the Bladeburner route, and the capped measurement batch");
  {
    const ex = await import("../../exitplan.js");
    // Fidelity: climbHours is exitplan's climb (affine and flat).
    c4.examined(2);
    for (const [mult, exp0, F, k] of [[1.41, 3400, 0, 45.4 / 141], [8.2, 2.5e8, 50, 3.1], [6, 1e9, 0, 70]]) {
      const target = mult === 6 ? 3000 : 9000;
      const mine = gp.climbHours({ target, mult, exp0, flat: F, k });
      const ref = ex.hoursToLevelShaped(target, mult, exp0, ex.affineRate(F, k));
      if (!(Math.abs(mine / ref - 1) < 1e-3)) c4.fail(`climbHours ${mine} vs exitplan.hoursToLevelShaped ${ref} at mult ${mult}, exp ${exp0}`);
      c4.note(`climb to ${target} at mult ${mult}, exp ${exp0.toExponential(2)}: ${mine.toPrecision(5)}h (exitplan ${ref.toPrecision(5)}h)`);
    }
    const flatMine = gp.climbHours({ target: 6000, mult: 12, exp0: 1e6, flat: 1e4, k: 0 });
    const flatRef = ex.hoursToLevel(6000, 12, 1e6, 1e4);
    if (!(Math.abs(flatMine / flatRef - 1) < 1e-3)) c4.fail(`flat-rate climb ${flatMine} vs exitplan.hoursToLevel ${flatRef}`);

    // The weight is the with/without difference on the same inputs.
    const now = Date.parse("2026-10-02T12:00:00Z");
    const rec = { at: "2026-10-02T11:55:00Z", lastAugReset: 42, inputs: { exitLevel: 3000, hackingMult: 6, hackingExp: 1e9, expPerSec: 2e5, expFlatPerSec: 0, expScalesWithLevel: true } };
    c4.examined(1);
    const hw = gp.hackLevelWeight(rec, { route: "hack", lastAugReset: 42, now, D: 0.01 });
    const lvl = gp.levelAt(1e9, 6);
    const kk = 2e5 / (lvl + 50);
    const T0 = gp.climbHours({ target: 3000, mult: 6, exp0: 1e9, flat: 0, k: kk });
    const T1 = gp.climbHours({ target: 3000, mult: 6 * Math.exp(0.01), exp0: 1e9, flat: 0, k: kk });
    if (!(hw.weight > 0 && Math.abs(hw.weight - (T0 - T1) / 0.01) < 1e-9 * hw.weight)) c4.fail(`the hacking route's weight must be (T(m) - T(m e^D))/D on one set of inputs: ${hw.weight} vs ${(T0 - T1) / 0.01}`, hw.why);
    c4.note(`hack route: sprint ${T0.toFixed(2)}h, weight ${hw.weight.toFixed(2)} exit hours per ln of mults.hacking`);
    // Refusals are named nulls, never a zero.
    for (const [r, o, what] of [
      [null, { route: "hack" }, "no exit inputs"],
      [rec, { route: "hack", lastAugReset: 7, now }, "another life's inputs"],
      [rec, { route: "hack", lastAugReset: 42, now: now + 3600e3 }, "stale inputs"],
    ]) {
      c4.examined(1);
      const x = gp.hackLevelWeight(r, o);
      if (x.weight !== null || !x.why) c4.fail(`${what} must refuse with a reason (got ${JSON.stringify(x)})`);
    }

    // THE BLADEBURNER ROUTE: a known 0, and the pricing never picks the board.
    c4.examined(1);
    const plan = { node: 4, decisions: { bladeRoute: { key: "blade" } } };
    if (gp.routeOf(plan, 4) !== "blade") c4.fail("plan.txt decisions.bladeRoute.key 'blade' must read as the Bladeburner route");
    if (gp.routeOf({ node: 4, decisions: {} }, 4) !== "hack") c4.fail("no Bladeburner decision is the hacking route");
    if (gp.routeOf(plan, 9) !== null) c4.fail("another node's plan must not name this node's route");
    const bw = gp.hackLevelWeight(rec, { route: "blade", lastAugReset: 42, now });
    if (bw.weight !== 0) c4.fail(`on the Bladeburner route the weight must be a known 0, got ${bw.weight}`);
    c4.examined(1);
    const W = { faction_rep: 0.01, hacking_speed: 0.01, hacking_money: 0.01, hacking: bw.weight };
    const rngB = rng32(3);
    let picked = 0;
    for (let i = 0; i < 200; i++) {
      const draw = gp.drawWinRates(gp.emptyPosterior(), Object.keys(gp.OPPONENTS), 5, rngB);
      const r = gp.chooseOpponent({ weights: W, windowH: 2, incumbent: "Daedalus", nodePower: { Daedalus: 0, Illuminati: 0, TheBlackHand: 0 }, redPill: true, winRates: draw, powerPerHour: { ...gp.POWER_PER_HOUR, [gp.W0]: 1e6 } });
      if (r.opponent === gp.W0) picked++;
    }
    if (picked) c4.fail(`on the Bladeburner route pricing picked the hidden opponent ${picked}/200 times — its value there is 0`);

    // THE MEASUREMENT BATCH: explores while open, wide and under the cap — on
    // any route — and stops at the cap, when narrow, closed, or solverless.
    c4.examined(1);
    let st = gp.emptyPosterior();
    const e0 = gp.exploreW0({ eligible: true, state: st });
    if (!e0.explore) c4.fail("an open, never-played hidden opponent must be measured", e0.why);
    if (gp.exploreW0({ eligible: false, state: st }).explore) c4.fail("a closed board must not be explored");
    if (gp.exploreW0({ eligible: true, state: st, solverOk: false }).explore) c4.fail("no measurement on the 20ms fallback");
    let n = 0;
    while (gp.exploreW0({ eligible: true, state: st }).explore && n < 1000) {
      st = gp.updatePosterior(st, gp.W0, 19, n % 3 === 0);
      n++;
    }
    if (n !== gp.W0_EXPLORE_GAMES) c4.fail(`the measurement batch must stop at the cap W0_EXPLORE_GAMES=${gp.W0_EXPLORE_GAMES}, ran ${n}`);
    c4.note(`measurement batch: ${n} games, then '${gp.exploreW0({ eligible: true, state: st }).why}'`);
    const g = read("go.js");
    c4.examined(1);
    if (!/exploreW0\(/.test(g) || !/if \(ex\.explore\) return \{ opponent: W0/.test(g)) c4.fail("go.js must run the measurement batch before pricing");
    if (!/hackLevelWeight\(exitRec, \{ route: routeOf\(planRec/.test(g)) c4.fail("go.js must price the hidden opponent on the route plan.txt commits");
  }
  checks.push(c4);

  /* ------------------------------------------------------------------ GT5 */
  const c5 = new Check("GT5", "the hidden opponent's measurement record, and the gameplan observation {param, value, sd, at, source}");
  {
    let r = null;
    const games = [
      { won: true, power: 300, hours: 0.2 },
      { won: false, power: 100, hours: 0.25 },
      { won: true, power: 250, hours: 0.15 },
      { won: false, power: 50, hours: 0.2 },
    ];
    for (const [i, x] of games.entries()) r = gp.w0RecordAdd(r, { at: `2026-10-02T0${i}:00:00Z`, ...x });
    c5.examined(1);
    const P = 700, H = 0.8;
    if (r.totals.games !== 4 || r.totals.wins !== 2 || Math.abs(r.totals.power - P) > 1e-9 || Math.abs(r.totals.hours - H) > 1e-9) c5.fail(`totals wrong: ${JSON.stringify(r.totals)}`);
    if (!(Math.abs(r.rate.value - P / H) < 1e-9)) c5.fail(`the rate must be sum(power)/sum(hours) = ${P / H}, got ${r.rate.value}`);
    if (!(r.rate.sd > 0 && r.rate.n === 4 && r.rate.wins === 2)) c5.fail(`the rate must carry a positive sd, its n and wins: ${JSON.stringify(r.rate)}`);
    c5.note(`4 games: ${r.rate.value.toFixed(1)} power/h, sd ${r.rate.sd.toFixed(1)}`);
    c5.examined(1);
    const o = gp.w0Obs(r.rate, "2026-10-02T04:00:00Z");
    const keys = Object.keys(o ?? {}).sort().join(",");
    if (keys !== "at,param,sd,source,value") c5.fail(`the observation must be exactly {param, value, sd, at, source}, got {${keys}}`);
    if (o?.param !== "w0" || typeof o.value !== "number" || typeof o.sd !== "number" || typeof o.source !== "string") c5.fail(`observation fields mistyped: ${JSON.stringify(o)}`);
    if (gp.w0Obs(null, "x") !== null) c5.fail("no rate, no observation (never a zero)");
    c5.examined(1);
    if (!(gp.obsDue(20) && gp.obsDue(40) && !gp.obsDue(19) && !gp.obsDue(0))) c5.fail(`the observation must be published every ${gp.OBS_EVERY} games`);
    if (gp.OBS_FILE !== "/tel/gameplan-obs.txt") c5.fail(`the observation channel is /tel/gameplan-obs.txt, not ${gp.OBS_FILE}`);
    c5.examined(1);
    const g = read("go.js");
    if (!/writeHome\(OBS_FILE, JSON\.stringify\(obs\) \+ '\\n', 'a'\)/.test(g)) c5.fail("go.js must APPEND one JSON line per observation to the channel");
    if (!/writeHome\(W0_FILE/.test(g)) c5.fail("go.js must write the per-game measurement record");
  }
  checks.push(c5);

  /* ------------------------------------------------------------------ GT6 */
  // END TO END through go.js main() on a mock ns with The Red Pill installed:
  // the measurement batch must actually play the hidden opponent by its enum
  // value, size every request from the 19x19 board the game deals (not the 5x5
  // flag), persist the posterior, keep the per-game record, and append ONE
  // observation line after OBS_EVERY games.
  const c6 = new Check("GT6", "go.js main(): with The Red Pill installed the hidden opponent is measured end to end (19x19, posterior, record, observation)");
  {
    const go = await import("../../go.js");
    const files = new Map();
    const resets = [];
    const reqSizes = new Set();
    let finished = 0;
    const B = Array.from({ length: 19 }, () => ".".repeat(19));
    const stats = () => ({ "????????????": { wins: finished, losses: 0, winStreak: finished, highestWinStreak: finished, bonusPercent: finished * 0.8, rep: 0 } });
    const ns = {
      flags: () => ({ size: 5, maxms: 2, idle: 0, topk: 4, remotems: 0, games: gp.OBS_EVERY, opponent: "Daedalus" }),
      disableLog() {},
      tprint() {},
      print() {},
      getResetInfo: () => ({ lastAugReset: 1, currentNode: 4, ownedSF: new Map(), ownedAugs: new Map([["The Red Pill", 1]]) }),
      getHostname: () => "home",
      scp() {},
      read: (f) => files.get(f) ?? "",
      fileExists: () => false,
      atExit() {},
      write: (f, data, mode) => {
        if (f === "/go/req.txt") reqSizes.add(JSON.parse(data).size);
        files.set(f, mode === "a" ? (files.get(f) ?? "") + data : data);
        // THE SOLVER ANSWERS: the measurement's precondition (exploreW0 stops
        // measuring on the 20ms fallback, and the early-game pricing then
        // picks a board — which is correct, and not what this check tests).
        if (f === "/go/req.txt") {
          const q = JSON.parse(data);
          const [x, y] = q.valid?.[0] ?? [0, 0];
          files.set("/go/move.txt", JSON.stringify({ seq: q.seq, x, y }));
        }
      },
      sleep: () => new Promise((r) => setTimeout(r, 0)),
      exec: () => 0,
      isRunning: () => false,
      go: {
        analysis: { getStats: stats, getValidMoves: () => Array.from({ length: 19 }, () => new Array(19).fill(true)) },
        resetBoardState: (who, size) => resets.push([who, size]),
        getGameState: () => ({ komi: 9.5, blackScore: 20, whiteScore: 9.5 }),
        getBoardState: () => B,
        makeMove: () => {
          finished++;
          return Promise.resolve({ type: "gameOver", x: null, y: null });
        },
        passTurn: () => {
          finished++;
          return Promise.resolve({ type: "gameOver", x: null, y: null });
        },
      },
    };
    try {
      await Promise.race([go.main(ns), new Promise((_, rej) => setTimeout(() => rej(new Error("main() did not finish 20 mock games in 60s")), 60000))]);
    } catch (e) {
      c6.fail(String(e?.message ?? e));
    }
    c6.examined(resets.length);
    if (!resets.length || !resets.every(([who]) => who === "????????????")) c6.fail(`every game must be against the hidden opponent's enum value during the batch: ${JSON.stringify(resets.slice(0, 3))}`);
    if (![...reqSizes].every((s) => s === 19) || !reqSizes.size) c6.fail(`every solver request must carry the dealt board size 19, saw ${[...reqSizes]}`);
    const post = gp.parsePosterior(files.get(gp.THOMPSON.file) ?? "");
    const arm = gp.posteriorOf(post.state, gp.W0, 19);
    c6.examined(1);
    if (post.why || arm.games !== gp.OBS_EVERY) c6.fail(`the posterior file must hold ${gp.OBS_EVERY} games on the 19x19 arm, got ${arm.games} (${post.why})`);
    const rec = JSON.parse(files.get(gp.W0_FILE) ?? "null");
    c6.examined(1);
    if (rec?.totals?.games !== gp.OBS_EVERY || rec?.totals?.wins !== gp.OBS_EVERY) c6.fail(`the measurement record must count every game and win: ${JSON.stringify(rec?.totals)}`);
    if (!(rec?.rate?.value > 0)) c6.fail("the measurement record must carry a positive power/hour");
    const lines = (files.get(gp.OBS_FILE) ?? "").split("\n").filter(Boolean);
    c6.examined(1);
    if (lines.length !== 1) c6.fail(`exactly one observation after ${gp.OBS_EVERY} games, got ${lines.length}`);
    else {
      const o = JSON.parse(lines[0]);
      if (o.param !== "w0" || !(o.value > 0) || !(o.sd >= 0)) c6.fail(`observation malformed: ${lines[0]}`);
      c6.note(`observation: ${lines[0]}`);
    }
    const tel = JSON.parse(files.get("/tel/go.txt") ?? "null");
    c6.examined(1);
    if (tel?.w0?.eligible !== true || tel?.boardSize !== 19 || !tel?.thompson?.arms?.[gp.W0]) c6.fail(`/tel/go.txt must publish the hidden opponent's state, the dealt board and the posteriors: ${JSON.stringify({ w0: tel?.w0?.eligible, boardSize: tel?.boardSize })}`);
  }
  checks.push(c6);

  return checks;
}
