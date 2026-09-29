// [GW] The Go opponent's weights price a Go bonus, not an augmentation.
//
// THE BUG CLASS (live BN9, 2026-09-29). goplan.chooseOpponent ranked
// opponents on objective.exitWeights, which scale the exit's WHOLE income
// ($10.2M/s, mostly the trader's realised trades) in EVERY later life. A Go
// bonus multiplies one stream (hack()'s $11.6k/s for hacking_money) and dies
// at the next install (Go/Go.ts:34-47). hacking_speed read 0.38 against
// hacking 1 and picked Illuminati; priced over its life on its stream it is
// ~10^5x smaller, below hacknet's.
//
//   GW1 a bonus that expires at the install is worth less than the same gain
//       persisting (the augmentation pricing), and less again over a shorter
//       remaining life.
//   GW2 hacking_money scales with the batcher's share of income: zero
//       batcher income is a zero weight however large incomePerSec is.
//   GW3 the final window: the bonus lasts to the terminal install, so
//       hacking_speed carries the script-exp path; exitplan's
//       preInstallExpMult stops at the terminal install (the climb after it
//       is untouched) and does nothing to a policy that installs first.
//   GW4 refusals are named (stale, other life, unmeasured batcher), and the
//       Monte Carlo is paired: a with-run and its without-run share the draw.
//   GW5 progress.js publishes objective.goWeights and go.js prices on it,
//       never on objective.weights.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";
import "./gameresolve.mjs";

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

export async function run() {
  const checks = [];
  const { goWeights } = await import("../../goweights.js");
  const { exitWeights } = await import("../../objective.js");
  const { bestExitPolicy, spendRuns, exitHours } = await import("../../exitplan.js");
  const { applyDraw, makeDraws, posteriorsOf } = await import("../../plan.js");

  const now = Date.now();
  // The objective test's shape (OB-EXIT): a stepping ladder with the install
  // point mid-plateau, so a dollar at W is worth something — and money at W
  // consistent with the income (money + $1e8/s x 2h).
  const inputs = { money: 1e9, incomePerSec: 1e8, hacking: 800, hackingExp: 1e9, hackingMult: 1.5, expPerSec: 1e5, repPerSec: 30, exitRep: 0, exitFavor: 0, terminalRep: 2.5e6, exitLevel: 3000, joinMoney: 100e9, cycleHours: 4, multGainPerCycle: 1.1, installGains: { hacking: 1, rep: 1, income: 1, exp: 1 }, persistBaseline: { hacking: 1, rep: 1, income: 1, exp: 1 } };
  const steps = [0, 0.25, 0.5, 1, 2].map((f) => ({ money: 1e12 * f, gains: { hacking: 1 + 0.3 * f, rep: 1.2, income: 1.1, exp: 1.05 } }));
  const rec = { at: new Date(now).toISOString(), lastAugReset: 1, W: 2, finalWindow: false, moneyAtW: 1e9 + 1e8 * 7200, gainsByMoney: steps, eRep: 0.2, eBudget: 0.1, inputs };
  const base = { lastAugReset: 1, now, bestExitPolicy, spendRuns, hackShare: 1, scriptExpPerSec: 5e4, ageH: 2 };

  /* ------------------------------------------------------------------ GW1 */
  const c1 = new Check("GW1", "a Go bonus that expires at the next install is worth less than the same gain persisting, and less over a shorter life");
  {
    c1.examined(3);
    // The whole income is the batcher's here, hack side 1: the same stream
    // the augmentation pricing scales — only the LIFE differs. exitWeights'
    // income channel is the gain from the install on, in every later life
    // (the pricing go.js used to read); the Go bonus is this window's alone.
    const g = goWeights(rec, { ...base, batchMoneyPerSec: inputs.incomePerSec });
    const ew = exitWeights(rec, 1, bestExitPolicy, spendRuns, { chanceObs: 0.9, growShare: 0.3 }, now);
    const expiring = g?.weights?.hacking_money;
    const persistent = ew?.sensitivities?.income;
    if (!(typeof expiring === "number" && typeof persistent === "number")) c1.fail(`both must price: expiring ${expiring}, persistent ${persistent}`, g?.why);
    else if (!(expiring > 0)) c1.fail(`a $100m/s stream for 2h on a stepping ladder must be worth something (got ${expiring})`, JSON.stringify(g.detail));
    else if (!(expiring < persistent)) c1.fail(`expiring at the install (${expiring.toExponential(3)} h/ln) must be worth less than persisting every later life (${persistent.toExponential(3)} h/ln)`);
    else c1.note(`hacking_money, whole income: expires at W=2h ${expiring.toExponential(3)} h/ln vs persistent ${persistent.toExponential(3)} h/ln (x${(persistent / expiring).toFixed(1)})`);
    // THE TIME THAT REMAINS: the same bonus with less of its life left.
    const short = goWeights({ ...rec, W: 0.5 }, { ...base, batchMoneyPerSec: inputs.incomePerSec });
    const s = short?.weights?.hacking_money;
    if (!(typeof s === "number" && typeof expiring === "number" && s < expiring)) c1.fail(`half an hour left must weigh less than two (0.5h ${s} vs 2h ${expiring})`);
    // And nothing left is nothing.
    const none = goWeights({ ...rec, W: 0 }, { ...base, batchMoneyPerSec: inputs.incomePerSec });
    if (none.weights !== null || !/no install point/.test(none.why ?? "")) c1.fail(`W = 0 leaves the bonus no life to price — refuse by name (got ${JSON.stringify(none).slice(0, 200)})`);
  }
  checks.push(c1);

  /* ------------------------------------------------------------------ GW2 */
  const c2 = new Check("GW2", "hacking_money scales with the batcher's share of income, and the trader's income buys the Go bonus nothing");
  {
    c2.examined(4);
    const at = (share) => goWeights(rec, { ...base, batchMoneyPerSec: inputs.incomePerSec * share })?.weights;
    const full = at(1);
    const tenth = at(0.1);
    const thou = at(0.001);
    const zero = at(0);
    if (!full || !tenth || !thou || !zero) c2.fail("every share must price");
    else {
      const r = tenth.hacking_money / full.hacking_money;
      if (!(Math.abs(r - 0.1) < 1e-9)) c2.fail(`a 10% batcher share must weigh 10% of the whole (got ${r})`);
      if (!(Math.abs(thou.hacking_money / full.hacking_money - 0.001) < 1e-9)) c2.fail("the live 1/1000 share must weigh 1/1000 of the whole");
      if (zero.hacking_money !== 0 || zero.hacking_speed !== 0) c2.fail(`no batcher income: hacking_money/speed must weigh exactly 0, with incomePerSec $1e8/s (got ${zero.hacking_money}, ${zero.hacking_speed})`);
      // The hack side's thread share is the money elasticity; speed moves the whole batch.
      const half = goWeights(rec, { ...base, hackShare: 0.5, batchMoneyPerSec: 1e7 })?.weights;
      if (!(half && Math.abs(half.hacking_money / half.hacking_speed - 0.5) < 1e-9)) c2.fail(`hackShare 0.5: hacking_money must be half of hacking_speed (got ${half?.hacking_money}/${half?.hacking_speed})`);
      // The hacknet stream is its own: it does not move with the batcher.
      if (Math.abs(zero.hacknet_node_money - full.hacknet_node_money) > 1e-12) c2.fail("hacknet_node_money must not depend on the batcher's income");
      c2.note(`hacking_money at batcher share 1 / 0.1 / 0.001: ${full.hacking_money.toExponential(3)} / ${tenth.hacking_money.toExponential(3)} / ${thou.hacking_money.toExponential(3)} h/ln`);
    }
    // Hacknet priced over the same life: a stream prices, none is a known 0.
    const hn = goWeights({ ...rec, inputs: { ...inputs, lifeIncome: 5e7 } }, { ...base, batchMoneyPerSec: 0 })?.weights;
    if (!(hn?.hacknet_node_money > 0)) c2.fail(`a $50m/s hacknet stream for 2h must be worth something (got ${hn?.hacknet_node_money})`);
    else if (!(Math.abs(hn.hacknet_node_money / full.hacking_speed - 0.5) < 1e-9)) c2.fail(`hacknet at $50m/s must weigh half the batcher's speed at $100m/s over the same life (${hn.hacknet_node_money} vs ${full.hacking_speed})`);
    if (goWeights(rec, { ...base, batchMoneyPerSec: 0 })?.weights?.hacknet_node_money !== 0) c2.fail("no hacknet stream: hacknet_node_money must be exactly 0");
  }
  checks.push(c2);

  /* ------------------------------------------------------------------ GW3 */
  const c3 = new Check("GW3", "in the final window the bonus runs to the terminal install: speed carries the exp path, and the climb after the install is untouched");
  {
    c3.examined(4);
    // exitplan: preInstallExpMult under hold-to-exit with nothing before the
    // climb changes nothing (the climb is after the terminal install).
    const bare = { money: 1e12, incomePerSec: 1e8, hacking: 800, hackingExp: 1e9, hackingMult: 1.5, expPerSec: 1e5, repPerSec: 30, exitLevel: 3000, joinMoney: 0, terminalRep: 0, cycleHours: 4, multGainPerCycle: 1.1 };
    const h0 = exitHours({ ...bare, installsFirst: 0 }).hours;
    const h1 = exitHours({ ...bare, installsFirst: 0, preInstallExpMult: 2 }).hours;
    if (!(Math.abs(h0 - h1) < 1e-9)) c3.fail(`a pre-install exp bonus must not speed the post-install climb (${h0} vs ${h1})`);
    // ...and does nothing to a policy that installs first.
    const k0 = exitHours({ ...inputs, installsFirst: 2 }).hours;
    const k1 = exitHours({ ...inputs, installsFirst: 2, preInstallExpMult: 2 }).hours;
    if (!(Math.abs(k0 - k1) < 1e-9)) c3.fail(`an install ends the bonus before any simulated leg (${k0} vs ${k1})`);
    // ...but it speeds a join-level climb before the terminal install.
    const j = { money: 0, incomePerSec: 1e6, hacking: 100, hackingExp: 0, hackingMult: 10, expPerSec: 100, repPerSec: 30, exitRep: 0, exitFavor: 0, terminalRep: 1e6, exitLevel: 3000, joinMoney: 1e10, joinLevel: 2500, cycleHours: 4, multGainPerCycle: 1.1 };
    const j0 = exitHours({ ...j, installsFirst: 0 }).hours;
    const j1 = exitHours({ ...j, installsFirst: 0, preInstallExpMult: 2 }).hours;
    if (!(j1 < j0)) c3.fail(`the join-level climb before the terminal install must run faster (${j0} vs ${j1})`);
    // goWeights: the exp path is the difference between speed and money at equal streams.
    const fin = { ...rec, finalWindow: true, inputs: j };
    const withExp = goWeights(fin, { ...base, hackShare: 1, batchMoneyPerSec: 1e5, scriptExpPerSec: 100 });
    const noExp = goWeights(fin, { ...base, hackShare: 1, batchMoneyPerSec: 1e5, scriptExpPerSec: 0 });
    if (!withExp?.weights || !noExp?.weights) c3.fail("the final window must price", withExp?.why ?? noExp?.why);
    else {
      if (!(withExp.weights.hacking_speed > noExp.weights.hacking_speed)) c3.fail(`script exp must add to hacking_speed in the final window (${withExp.weights.hacking_speed} vs ${noExp.weights.hacking_speed})`);
      if (!(withExp.weights.faction_rep > 0)) c3.fail("a ground reputation leg before the terminal install must make faction_rep worth something");
      c3.note(`final window: hacking_speed ${withExp.weights.hacking_speed.toExponential(3)} (exp path on) vs ${noExp.weights.hacking_speed.toExponential(3)} (off); faction_rep ${withExp.weights.faction_rep.toExponential(3)} h/ln`);
    }
  }
  checks.push(c3);

  /* ------------------------------------------------------------------ GW4 */
  const c4 = new Check("GW4", "refusals are named, and the draws are paired (common random numbers)");
  {
    for (const [r, o, what, re] of [
      [{ ...rec, lastAugReset: 2 }, { batchMoneyPerSec: 1e6 }, "another life's record", /another life/],
      [{ ...rec, at: new Date(now - 20 * 60e3).toISOString() }, { batchMoneyPerSec: 1e6 }, "a stale record", /stale/],
      [rec, { batchMoneyPerSec: null }, "an unmeasured batcher", /batcher/],
      [rec, { batchMoneyPerSec: 1e6, hackShare: null }, "an unmeasured hack share with batcher income", /share/],
    ]) {
      c4.examined(1);
      const g = goWeights(r, { ...base, ...o });
      if (g.weights !== null || !re.test(g.why ?? "")) c4.fail(`${what} must refuse by name, got ${JSON.stringify(g).slice(0, 200)}`);
    }
    // PAIRED: every draw's with-run and without-run share the draw. A weight
    // priced on draws must equal the mean of the per-draw paired weights.
    c4.examined(1);
    const draws = makeDraws(posteriorsOf({ obs: { exp: [1, 2, 3, 4].map((k) => ({ at: new Date(now - k * 6e5).toISOString(), v: 1e5 * (1 + 0.2 * (k % 2)) })) } }), 6, 7);
    const all = goWeights(rec, { ...base, batchMoneyPerSec: 1e8, draws, applyDraw });
    const each = draws.map((d) => goWeights(rec, { ...base, batchMoneyPerSec: 1e8, draws: [d], applyDraw })?.weights?.hacking_money);
    const m = each.reduce((a, b) => a + b, 0) / each.length;
    if (!(all?.n === draws.length)) c4.fail(`every draw must be priced (n ${all?.n} of ${draws.length})`);
    else if (!(Math.abs(all.weights.hacking_money - m) <= 1e-9 * Math.max(1, Math.abs(m)))) c4.fail(`the weight must be the mean of the paired per-draw weights (${all.weights.hacking_money} vs ${m})`);
    else c4.note(`${draws.length} paired draws: hacking_money ${m.toExponential(3)} h/ln, per draw ${each.map((x) => x.toExponential(2)).join(" ")}`);
  }
  checks.push(c4);

  /* ------------------------------------------------------------------ GW5 */
  const c5 = new Check("GW5", "progress.js publishes objective.goWeights and go.js prices the opponent on it, not on objective.weights");
  {
    c5.examined(2);
    const p = read("progress.js");
    if (!/goWeightsGen\(/.test(p) || !/goWeights:\s*goPub/.test(p)) c5.fail("progress.js must run goWeightsGen and publish it as weightsMeta.goWeights");
    if (!/draws:\s*pcGo\?\.draws/.test(p)) c5.fail("progress.js must price the Go weights on the plan's draws (common random numbers)");
    const g = read("go.js");
    if (!/weights:\s*gw\?\.weights/.test(g)) c5.fail("go.js must hand chooseOpponent the goWeights");
    if (/weights:\s*gate\?\.objective\?\.weights/.test(g)) c5.fail("go.js prices the opponent on objective.weights again — those price an augmentation, not a Go bonus");
  }
  checks.push(c5);

  return checks;
}
