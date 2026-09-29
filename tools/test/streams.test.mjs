// [SI] EVERY INCOME STREAM ONCE, each with its own growth driver.
//
// The game books every stock sale's realised profit as the selling script's
// income (StockMarket/BuyingAndSelling.tsx:175 and :364 -> onlineMoneyMade and
// scriptProdSinceLastAug), so ns.getTotalScriptIncome is hacking PLUS the
// trader. Until 2026-09-29 the exit model took that whole figure as its
// level-scaled `incomePerSec` AND priced the trader again through its own
// compounding return (capitalReturnPerSec): live BN9 03:21, script income
// $13.36m/s of which the batcher (exp farm) earned $0/s and stock.js ~$13.1m/s,
// while r x equity = 3.49e-4 x $100b ~ $35m/s rode beside it. The second copy
// also grew with the hacking level and every hacking_money augmentation.
//
//   SI1  incomeOf takes the trader's script share out of the hacking stream
//   SI2  the trader's money is counted ONCE in the exit's money integral
//   SI3  hacking-level growth scales the hacking stream and never the trader
//   SI4  the trader's return is fitted where small hacknet/contract flows land
//        every row (BN9), and a lumpy purchase is still refused
//   SI5  the income prior measures the hacking stream (tel.js's third element)
//   SI7  a pre-split life's hacking is reconstructed from bounds, or refused
//   SI8  replay live BN9 05:36: the legacy-total prior rebuilt as hacking
//   SI9  a life split part-way: exact after, capped before
//   SI10 the fresh life's hacking income is a posterior (prior x measurement)
//   SI11 replay live BN9 05:46 (0.08h after an install, batcher prepping)
//   SI6  wiring: progress.js / buyserv.js / stock.js / tel.js

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const ne = await import("../../nodeecon.js");
const B = await import("../../bayes.js");
const xp = await import("../../exitplan.js");

const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-12);

// The live BN9 03:21 state (progress.txt income + stock.txt), as a trader record.
const LIFE = 1790620681588;
const NOW = Date.parse("2026-09-29T03:21:30.000Z");
const traderRec = (o = {}) => ({ at: "2026-09-29T03:21:00.000Z", lastAugReset: LIFE, equity: 1.0e11, returnPerSec: 3.49e-4, capitalCap: 1.03e13, incomePerSec: 13103377, scriptIncome: { perSec: 13103377, made: 13103377 * 10900 }, ...o });
// What progress.js's exitInputsBaseOf takes from an incomeOf result.
const exitTerms = (e) => ({ incomePerSec: e.incomePerSec, flatIncomePerSec: e.flatPerSec, capitalReturnPerSec: e.capitalReturnPerSec, capitalCap: e.capitalCap });
// Money after `hours` through the exit's own integrator (bisect hoursToMoney).
const moneyAfter = (hours, o) => {
  let lo = o.money0;
  let hi = o.money0 * 10 + 1e15;
  for (let k = 0; k < 80; k++) {
    const mid = (lo + hi) / 2;
    const h = xp.hoursToMoney(mid, o);
    if (h !== null && h <= hours) lo = mid;
    else hi = mid;
  }
  return lo;
};

export async function run() {
  const checks = [];

  // -------------------------------------------------------------------
  {
    const c = new Check("SI1", "incomeOf: the trader's realised sales are taken OUT of the script income — the hacking stream is what is left (live BN9: $13.36m/s script income, $13.10m/s of it stock.js)");
    const st = ne.stockRecordOf(traderRec(), LIFE, NOW);
    const e = ne.incomeOf({ scriptIncome: [13361116, 5290457], mults: { ScriptHackMoneyGain: 1 }, stock: st, hacknet: { ok: true, perSec: 504209 }, lifeSec: 10900 });
    c.examined(9);
    c.note(`live split: hacking ${e.levelPerSec.toFixed(0)}/s (was 13361116), trader ${e.stockScriptPerSec}/s via ${e.stockScriptSource}; trader priced as r ${e.capitalReturnPerSec} x equity = $${(e.streams.stock.perSec / 1e6).toFixed(1)}m/s; hacknet ${e.lifePerSec}/s`);
    if (!near(e.levelPerSec, 13361116 - 13103377, 1e-9)) c.fail(`the hacking stream must be script income less the trader's share: ${e.levelPerSec}`);
    if (e.incomePerSec !== e.levelPerSec + e.flatPerSec || e.flatPerSec !== 0) c.fail(`with a measured return the trader is not also flat income: ${JSON.stringify(exitTerms(e))}`);
    if (e.streams.stock.term !== "capitalReturnPerSec" || e.streams.hack.term !== "incomePerSec - flatIncomePerSec" || e.streams.hacknet.term !== "lifeIncome") c.fail(`every stream names its one exit term: ${JSON.stringify(e.streams)}`);
    // A record from before stock.js published scriptIncome: its lifePnl rate stands in.
    const legacy = ne.incomeOf({ scriptIncome: [13361116, 0], stock: ne.stockRecordOf(traderRec({ scriptIncome: undefined }), LIFE, NOW) });
    if (!near(legacy.levelPerSec, 13361116 - 13103377, 1e-9) || !/lifePnl/.test(legacy.stockScriptSource)) c.fail(`a record without scriptIncome must subtract the lifePnl rate, named: ${JSON.stringify(legacy).slice(0, 200)}`);
    // No return measured yet: the trader rides as FLAT income, still once.
    const flat = ne.incomeOf({ scriptIncome: [13361116, 0], stock: ne.stockRecordOf(traderRec({ returnPerSec: null }), LIFE, NOW) });
    if (!near(flat.incomePerSec, 13361116, 1e-9) || !near(flat.flatPerSec, 13103377, 1e-9) || flat.capitalReturnPerSec !== 0) c.fail(`without a return the trader is flat income and NOT also level income: ${JSON.stringify(exitTerms(flat))}`);
    // A losing trader lowers the total; the hacking stream is not inflated by it or below zero.
    const loss = ne.incomeOf({ scriptIncome: [-2e6, 0], stock: ne.stockRecordOf(traderRec({ scriptIncome: { perSec: -2.5e6, made: 0 } }), LIFE, NOW) });
    if (!near(loss.levelPerSec, 5e5, 1e-9)) c.fail(`a losing trader's negative share comes back out: hacking = -2m - (-2.5m) = 0.5m, got ${loss.levelPerSec}`);
    // Since-install fallback ([1]) when the running figure has no hacking left in it.
    const fb = ne.incomeOf({ scriptIncome: [13103377, 6e6], stock: st, lifeSec: 40000 });
    const want = 6e6 - (13103377 * 10900) / 40000;
    if (!near(fb.levelPerSec, want, 1e-9)) c.fail(`the since-install fallback must remove the trader's realised dollars over the life: ${fb.levelPerSec} vs ${want}`);
    // No trader: exactly the old reading.
    const none = ne.incomeOf({ scriptIncome: [7e3, 5e3], stock: null });
    if (none.levelPerSec !== 7e3 || ne.incomeOf({ scriptIncome: [0, 5e3] }).levelPerSec !== 5e3) c.fail("with no trader the script income is the hacking stream, [0] then [1], as before");
    const ha = ne.hackScriptIncome([13361116, 0], st);
    if (!near(ha.perSec, e.levelPerSec, 1e-12)) c.fail("hackScriptIncome (buyserv's read) must agree with incomeOf");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SI2", "STOCK GAINS COUNTED ONCE: on a trader-only income the exit's money integral is the trader's compounding alone — ln(2)/r to double — and the pre-fix inputs (script income as hacking income) doubled it faster");
    c.examined(4);
    // Scripts earn only the trader's sales: the batcher farms exp.
    const S = 1.3e7;
    const E = 1e11;
    const r = 1.3e-4; // S = r x E: the trader's realised rate IS its return on the book
    const st = ne.stockRecordOf(traderRec({ equity: E, returnPerSec: r, capitalCap: null, incomePerSec: S, scriptIncome: { perSec: S, made: 0 } }), LIFE, NOW);
    const e = ne.incomeOf({ scriptIncome: [S, S], stock: st });
    const t = exitTerms(e);
    const base = { money0: E, mult: 0.69, exp0: 1e6, expPerSec: 300 };
    const fixedH = xp.hoursToMoney(2 * E, { ...base, incomeAtLevel1: ((t.incomePerSec - t.flatIncomePerSec) * 51) / (172 + 50), flatPerSec: t.flatIncomePerSec, capitalReturnPerSec: t.capitalReturnPerSec });
    const exact = Math.log(2) / r / 3600;
    const oldH = xp.hoursToMoney(2 * E, { ...base, incomeAtLevel1: (S * 51) / (172 + 50), capitalReturnPerSec: r });
    c.note(`double $100b at r ${r}/s: ${fixedH.toFixed(3)}h (exact ln2/r ${exact.toFixed(3)}h); the double-counted inputs said ${oldH.toFixed(3)}h`);
    if (t.incomePerSec !== 0) c.fail(`the trader's sales must not be in incomePerSec: ${t.incomePerSec}`);
    if (!near(fixedH, exact, 0.01)) c.fail(`counted once, the doubling time is the trader's alone: ${fixedH} vs ${exact}`);
    if (!(oldH < 0.95 * fixedH)) c.fail(`control: the double-counted inputs must reach it sooner (they carried the trader twice): ${oldH} vs ${fixedH}`);
    // Today's cash rate from these terms: the trader's r x E, once — not r x E + S.
    const rate0 = t.incomePerSec + t.capitalReturnPerSec * E;
    if (!near(rate0, S, 1e-9)) c.fail(`the opening money rate must be the trader's measured $/s once: ${rate0} vs ${S}`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SI3", "HACKING-LEVEL GROWTH DOES NOT SCALE STOCK INCOME: a fast hacking climb changes the trader-only money path by nothing, and still lifts a hacking stream (the control)");
    c.examined(4);
    const E = 5e10;
    const st = ne.stockRecordOf(traderRec({ equity: E, returnPerSec: 2e-4, capitalCap: null, incomePerSec: 1e7, scriptIncome: { perSec: 1e7, made: 0 } }), LIFE, NOW);
    const e = ne.incomeOf({ scriptIncome: [1e7, 1e7], stock: st });
    const t = exitTerms(e);
    const o = (expPerSec, lvlIncome) => ({ money0: E, mult: 1, exp0: 0, expPerSec, incomeAtLevel1: lvlIncome, flatPerSec: t.flatIncomePerSec, capitalReturnPerSec: t.capitalReturnPerSec });
    const lvlInc = ((t.incomePerSec - t.flatIncomePerSec) * 51) / (1 + 50);
    const slow = moneyAfter(4, o(1e-6, lvlInc));
    const fast = moneyAfter(4, o(1e7, lvlInc));
    c.note(`trader only, 4h from $50b: level flat ${(slow / 1e9).toFixed(3)}b, level climbing to ${xp.levelAt(1e7 * 4 * 3600, 1)} ${(fast / 1e9).toFixed(3)}b`);
    if (!near(slow, fast, 1e-6)) c.fail(`the trader's money must not respond to the hacking level: ${slow} vs ${fast}`);
    // The pre-fix inputs (the $10m/s sales as level income) DID respond: the bias this removes.
    const oldSlow = moneyAfter(4, o(1e-6, (1e7 * 51) / 51));
    const oldFast = moneyAfter(4, o(1e7, (1e7 * 51) / 51));
    c.note(`the double-counted inputs: ${(oldSlow / 1e9).toFixed(3)}b -> ${(oldFast / 1e9).toFixed(3)}b with the climb`);
    if (!(oldFast > oldSlow * 1.05)) c.fail("control: level-scaled trader income must have grown with the climb (else this check proves nothing)");
    // A real hacking stream still grows with the level.
    const h = (xps) => moneyAfter(4, { money0: 0, mult: 1, exp0: 0, expPerSec: xps, incomeAtLevel1: 1e5 });
    if (!(h(1e7) > 2 * h(1e-6))) c.fail("the hacking stream must still scale with the level");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SI4", "THE TRADER'S RETURN IS FITTED where hacknet/contract cash lands every row (BN9), and a lumpy purchase is still refused; bayes and nodeecon share the flow tolerance");
    c.examined(5);
    if (B.FLOW_TOL_FRAC !== ne.FLOW_TOL_FRAC) c.fail(`bayes.FLOW_TOL_FRAC ${B.FLOW_TOL_FRAC} != nodeecon.FLOW_TOL_FRAC ${ne.FLOW_TOL_FRAC}`);
    // 3h of rows every 10 ticks at 2e-4/s, $33m of hacknet cash per row on ~$30-95b.
    const rows = [];
    let wealth = 3e10;
    let pnl = 0;
    let flows = 0;
    const r = 2e-4;
    for (let t = 10; t <= 1800; t += 10) {
      const d = wealth * (Math.exp(r * 60) - 1);
      pnl += d;
      flows += 3.3e7;
      wealth += d + 3.3e7;
      rows.push({ t, wealth, lifePnl: pnl, externalFlows: flows });
    }
    const rc = ne.realisedCapital(rows);
    const tp = B.traderPosterior(rows);
    c.note(`BN9-shaped rows: realisedCapital ${rc ? rc.r.toExponential(3) : "null"}/s, posterior ${tp ? tp.perSec.mean.toExponential(3) + " ± " + tp.perSec.sd.toExponential(1) : "null"} (true ${r})`);
    if (!rc || !near(rc.r, r, 0.03)) c.fail(`realisedCapital must fit through small flows: ${JSON.stringify(rc)}`);
    if (!tp || !near(tp.perSec.mean, r, 0.05)) c.fail(`traderPosterior must exist through small flows: ${JSON.stringify(tp)?.slice(0, 160)}`);
    // A $5b purchase (>2% of the book) inside one interval is still refused.
    const a = { wealth: 3e10, externalFlows: 0 };
    if (ne.flowNegligible(a, { externalFlows: -5e9 }) || !ne.flowNegligible(a, { externalFlows: 3.3e7 }) || !ne.flowNegligible(a, { externalFlows: 0 })) c.fail("flowNegligible: equal or within 2% keeps the interval; a lumpy purchase refuses it");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SI5", "THE INCOME PRIOR MEASURES THE HACKING STREAM: tel.js's third sample element (moneySources.hacking) when lives carry it; a pre-split total is never taken as hacking — where the non-hacking bound cannot be excluded there is no prior at all");
    c.examined(3);
    const life = (k, total, hack) => [k, { node: 9, complete: true, samples: [[0.1, total * 0.1 * 3600, hack * 0.1 * 3600], [1, total * 3600, hack * 3600], [2, total * 7200, hack * 7200]] }];
    const split = { lives: Object.fromEntries([life("1000", 1e7, 1e4), life("2000", 1.2e7, 1.1e4)]) };
    const pr = B.incomePrior({ earnings: split, node: 9, ageH: 1 });
    c.note(pr ? pr.why : "null");
    if (!pr || !(pr.perSec > 5e3 && pr.perSec < 2e4) || pr.stream !== "hacking") c.fail(`the prior must be the hacking stream (~$1e4/s), not the all-source total (~$1e7/s): ${pr?.perSec}`);
    // The same lives without the split: a $1e7/s total is within the bound on
    // hacknet/crime/trader income, so hacking is not separable — no prior,
    // rather than the $1e7/s total standing in for a $1e4/s stream.
    const legacy = { lives: Object.fromEntries(Object.entries(split.lives).map(([k, L]) => [k, { ...L, samples: L.samples.map((q) => q.slice(0, 2)) }])) };
    const lg = B.incomePrior({ earnings: legacy, node: 9, ageH: 1 });
    c.note(`legacy form: ${lg ? lg.why : "null (not separable, and said so by legacyHackingWindow)"}`);
    if (lg) c.fail(`a legacy total must never stand in for the hacking stream: ${lg.why}`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SI6", "wiring: every exit input and income-per-GB read goes through the stream split; the trader and tel.js publish what it needs");
    c.examined(6);
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    const prog = strip(code("progress.js"));
    // Raw script income is read ONLY in the split itself and the two total-money
    // projections (projectedBudget, joinIncome), where the trader's cash is money.
    const raw = prog.split("\n").filter((l) => /getTotalScriptIncome\(\)/.test(l));
    const allowed = raw.filter((l) => /scriptIncome: ns\.getTotalScriptIncome\(\)/.test(l) || /const inc = ns\.getTotalScriptIncome\(\)/.test(l));
    c.note(`progress.js raw script-income reads: ${raw.length} (${allowed.length} allowed: the split + total-money projections)`);
    if (raw.length !== allowed.length || raw.length > 3) c.fail(`a raw getTotalScriptIncome read feeds a model in progress.js: ${raw.map((l) => l.trim().slice(0, 100)).join(" | ")}`);
    if (!/function econIncomeNow\(ns, info\)[\s\S]{0,400}incomeOf\(\{ scriptIncome: ns\.getTotalScriptIncome\(\), mults: bitNodeMults\(info\?\.currentNode\), stock: stockNow, hacknet: hacknetLifeIncome\(ns, info\), lifeSec \}\)/.test(prog)) c.fail("progress.js econIncomeNow must be the one split (incomeOf with the trader record and lifeSec)");
    if (!/flatIncomePerSec: \(econNow\?\.flatPerSec \?\? 0\) \+ \(contractMoneyPerSec > 0 \? contractMoneyPerSec : 0\)/.test(prog)) c.fail("contract money is flat income in the exit inputs (not hacking-level scaled)");
    if (!/hackScriptIncome\(ns\.getTotalScriptIncome\(\), stockRecordFromText\(/.test(strip(code("buyserv.js")))) c.fail("buyserv.js's income per GB must be the hacking stream (hackScriptIncome)");
    if (!/scriptIncome: \(\(\) => \{\s*try \{\s*const perSec = ns\.getScriptIncome\(ns\.getScriptName\(\), ns\.getHostname\(\), \.\.\.ns\.args\)/.test(strip(code("stock.js")))) c.fail("stock.js must publish its own script income (scriptIncome)");
    if (!/L\.samples\.push\(\[Math\.round\(ageH \* 1e4\) \/ 1e4, Math\.round\(earned\), Math\.round\(hackEarned\)\]\)/.test(strip(code("tel.js")))) c.fail("tel.js must record the hacking stream as the earnings sample's third element");
    checks.push(c);
  }


  // -------------------------------------------------------------------
  {
    const c = new Check("SI7", "A PRE-SPLIT LIFE IS RECONSTRUCTED FROM A BOUND: hacking = total less an upper bound on every other source (the trader's whole realised profit charged to the window, since act-liquidate lands it in one lump); the bracket holds the truth, and a window the bound swamps is refused with its reason");
    c.examined(4);
    const P = B.PRIORS.legacyNonHack;
    // A synthetic life: hacking $1e11/s from 0.1h, other sources $5e6/s, and
    // the trader's $2e11 profit realised in one lump at 1.9h.
    const hack = (h) => Math.max(0, h - 0.1) * 3600 * 1e11;
    const tot = (h) => hack(h) + h * 3600 * 5e6 + (h >= 1.9 ? 2e11 : 0);
    const pts = [];
    for (let h = 0; h <= 2.0001; h += 1 / 12) pts.push([+h.toFixed(4), tot(h)]);
    const r = B.legacyHackingWindow(pts, 1.5, 2, { cash0: 1262, ...P });
    c.note(r.why);
    if (!r.ok || !(r.lo <= 1e11 * 1.0000001 && r.hi >= 1e11) || !(r.perSec > 0.9e11 && r.perSec < 1.1e11)) c.fail(`the bracket must hold the true $1e11/s and its midpoint sit near it: ${JSON.stringify(r)}`);
    // A small earner: $5e5/s total is inside the bound on everything else.
    const small = [[0, 0], [0.5, 5e5 * 1800], [1, 5e5 * 3600]];
    const s1 = B.legacyHackingWindow(small, 0.5, 1, { cash0: 1262, ...P });
    c.note(`small earner: ${s1.why}`);
    if (s1.ok || !(s1.hi === 5e5)) c.fail("a total within the non-hacking bound is not separable; its total is kept as an upper bound only");
    // A later split sample caps the hacking stream below the total.
    const capped = B.legacyHackingWindow(small, 0.5, 1, { cash0: 1262, hackCap: 1000, ...P });
    if (!(capped.hi < 1)) c.fail(`hackCap must bound the window's hacking: ${capped.hi}`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SI8", "REPLAY live BN9 05:36: the fresh-life income prior was BN1's legacy all-source totals ($5.47e8/s median). Rebuilt: every value is a reconstructed hacking rate inside its total, BN1's final life (no multiplier in the ledger) is not scaled at x1, inseparable lives only bound it from above, and the median falls");
    c.examined(6);
    const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-earnings-0536.json"), "utf8"));
    const { bitNodeMults } = await import("../../bitNodeMultipliers.js");
    const shm = (n) => (bitNodeMults(n)?.ScriptHackMoneyGain === 0 ? 0 : bitNodeMults(n)?.ScriptHackMoney);
    const pr = B.incomePrior({ earnings: F.earnings, ledger: F.lifetimes, node: 9, ageH: F.ageH, hackMultNow: F.hackMultRaw, shm });
    c.note(`before: ${F.planIncome.why}`);
    c.note(`after:  ${pr?.why}`);
    for (const x of pr?.excluded ?? []) c.note(`  excluded ${x.life}: ${x.why}`);
    if (!pr) c.fail("the live ledger holds separable BN1 windows: a prior must exist");
    else {
      if (pr.stream !== "hacking" || /LEGACY totals/.test(pr.why)) c.fail(`the prior must be the hacking stream: ${pr.why}`);
      if (!(pr.reconstructed >= 3)) c.fail(`BN1's high-earning lives are separable (hacking >= 50% guaranteed): ${pr.reconstructed}`);
      if (!pr.excluded.some((x) => x.life === "1790600459770" && /multiplier/.test(x.why))) c.fail("BN1's last life has no lifetimes entry: it must be excluded, not scaled at ratio 1");
      if (!(pr.bounded >= 1)) c.fail("an inseparable life still bounds the prior from above (censored)");
      if (!(pr.perSec < F.planIncome.perSec / 2)) c.fail(`the stock-inclusive legacy prior was inflated: the rebuilt median must fall well below $${F.planIncome.perSec.toExponential(2)}/s: $${pr.perSec.toExponential(2)}/s`);
    }
    // The censored term only ever lowers the median (every bound here sits below it).
    if (pr && !(pr.perSec <= pr.perSecUncensored * 1.0000001)) c.fail(`censoring must not raise the median: ${pr.perSec} vs ${pr.perSecUncensored}`);
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SI9", "A LIFE SPLIT PART-WAY (the one running when tel.js began recording the hacking stream) is exact from its first three-element sample on, and before it the totals are capped by the hacking that sample records");
    c.examined(3);
    // BN9-shaped: totals from the trader and hacknet ($1e7/s), hacking $10/s, split from 3h.
    const S = [];
    for (let h = 0.25; h <= 5.0001; h += 0.25) S.push(h < 3 ? [h, 1e7 * h * 3600] : [h, 1e7 * h * 3600, 10 * h * 3600]);
    const earnings = { lives: { 1000: { node: 9, complete: true, samples: S } } };
    const late = B.incomePrior({ earnings, node: 9, ageH: 3.5 });
    c.note(`age 3.5h: ${late?.why}`);
    if (!late || !(late.perSec > 8 && late.perSec < 12)) c.fail(`after the first split sample the hacking stream is exact ($10/s): ${late?.perSec}`);
    const early = B.incomePrior({ earnings, node: 9, ageH: 1 });
    c.note(`age 1h: ${early ? early.why : "null — the $1e7/s total is inseparable, and the 3h sample caps hacking at $30/s: never the total"}`);
    if (early && early.perSec > 1e3) c.fail(`a total must not stand in for the hacking before the split: ${early.perSec}`);
    checks.push(c);
  }


  // -------------------------------------------------------------------
  {
    const c = new Check("SI10", "THE FRESH LIFE'S HACKING INCOME IS A POSTERIOR, never a switch: a prepping batcher's $0/s is no observation (the prior stands alone), the first minutes of landings weigh about as much as the prior, hours of measurement dominate it — and the Monte Carlo keeps the measured flat income beside the drawn hacking stream");
    c.examined(5);
    const prior = { mean: Math.log(1e6), sd: 1.0, perSec: 1e6, why: "prior" };
    const none = B.incomePosterior(prior, B.lifeHackingObservation([[0.0005, 0, 0], [0.0838, 5.8e6, 0]], 0.08, { nowPerSec: 0 }));
    c.note(`prepping (hacking $0 so far): ${none?.why}`);
    if (!none || none.perSec !== 1e6 || none.measuredWeight !== 0) c.fail("nothing earned yet: the prior alone, not a measured $0/s");
    // The first sample with hacking > 0 at 0.1h; the life `hours` past it.
    const samples = (rate, until) => { const q = [[0, 0, 0]]; for (let h = 0.1; h <= until + 1e-9; h += 1 / 60) q.push([h, 1e9 * h, (h - 0.1 + 1 / 60) * 3600 * rate]); return q; };
    const w = (hours) => B.incomePosterior(prior, B.lifeHackingObservation(samples(1e4, 0.1 + hours), 0.1 + hours, { nowPerSec: 1e4 }));
    const early = w(5 / 60);
    const late = w(3);
    c.note(`5 min of landings at $1e4/s: ${early.why}`);
    c.note(`3h: median $${late.perSec.toExponential(2)}/s, weight ${(100 * late.measuredWeight).toFixed(0)}%`);
    if (!(early.measuredWeight > 0.25 && early.measuredWeight < 0.75)) c.fail(`the first minutes must weigh about as much as the prior: ${early.measuredWeight}`);
    if (!(late.measuredWeight > 0.95 && late.perSec < 1.3e4)) c.fail(`hours of measurement dominate: ${late.measuredWeight}, ${late.perSec}`);
    if (!(early.perSec < prior.perSec && early.perSec > 1e4)) c.fail("the posterior lies between the prior and the measurement");
    // plan.applyDraw: the flat part stays, the hacking stream is drawn.
    const P = await import("../../plan.js");
    const o = P.applyDraw({ incomePerSec: 5e5 + 1e6, incomeFlatPerSec: 5e5, incomeFromPrior: true }, { incomeLn: Math.log(2e6) });
    if (!near(o.incomePerSec, 2.5e6, 1e-9)) c.fail(`a draw must keep the flat income beside the drawn hacking stream: ${o.incomePerSec}`);
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    if (!/const pr = incomePostOf\(ns, info, player\)\s*\n\s*if \(!pr\) return \{\}/.test(prog) || /econNow\?\.capitalReturnPerSec \?\? 0\) > 0\) return \{\}/.test(prog)) c.fail("exitInputsBaseOf must take the hacking stream from the posterior in every life (no measured/prior switch, no trader switch) (source guard)");
    checks.push(c);
  }

  // -------------------------------------------------------------------
  {
    const c = new Check("SI11", "REPLAY live BN9 05:46, 0.08h after the 05:42 install (batcher prepping, $0 hacking): the plan read 272h 'income: measured' against the install decision's 104h. With the posterior the income is no longer the measured $0 — and the exit shows what the income does and does not explain");
    c.examined(4);
    const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-freshlife-0546.json"), "utf8"));
    const { bitNodeMults } = await import("../../bitNodeMultipliers.js");
    const shm = (n) => (bitNodeMults(n)?.ScriptHackMoneyGain === 0 ? 0 : bitNodeMults(n)?.ScriptHackMoney);
    const life = F.exitinputs.lastAugReset;
    const ageH = (Date.parse(F.exitinputs.at) - life) / 3.6e6;
    const pr = B.incomePrior({ earnings: F.earnings, ledger: F.lifetimes, node: 9, ageH, hackMultNow: F.hackMultRaw, shm });
    const post = B.incomePosterior(pr, B.lifeHackingObservation(F.earnings.lives[String(life)]?.samples, ageH, { nowPerSec: F.levelPerSec }));
    c.note(`as live: exit q50 ${F.planExit.q50}h (income ${F.planExit.income}); install decision: ${F.installLast.why}`);
    c.note(`posterior at ${ageH.toFixed(2)}h: ${post?.why}`);
    if (!post || post.measuredWeight !== 0) c.fail("prepping at $0/s: the posterior must be the prior alone");
    const i = F.exitinputs.inputs;
    const flat = i.incomePerSec; // live: every dollar of it was flat (contracts), hacking $0
    const exitAt = (inp) => xp.bestExitPolicy(inp).best?.hours ?? null;
    const asLive = exitAt(i);
    const withPost = post ? exitAt({ ...i, incomePerSec: flat + post.perSec }) : null;
    const hacking = (m) => exitAt({ ...i, incomePerSec: flat + m });
    const installH = Number(/installing now is ([\d.]+)h/.exec(F.installLast.why)?.[1]);
    c.note(`point exit: measured $0 hacking ${asLive?.toFixed(1)}h; posterior ${withPost?.toFixed(1)}h; the install decision ${installH}h`);
    if (!(withPost > 0)) c.fail("the fresh life must price");
    if (post && !(withPost <= asLive)) c.fail("a positive hacking posterior cannot price a slower exit than $0 hacking");
    // What the gap IS: the install cadence. The fresh life has no faction
    // offers yet (exitInputsOf skips the purchase model on empty offers), so
    // the cycle falls back to the measured cadence posterior (x1.025 per
    // 6.63h from one thin BN9 life); at x1.2 per cycle the same inputs price
    // ~100h. Income from $0 to the posterior moves it by a few percent.
    const cad = exitAt({ ...i, incomePerSec: flat + (post?.perSec ?? 0), multGainPerCycle: 1.2 });
    c.note(`the same inputs at x1.2 a cycle: ${cad?.toFixed(1)}h — the 104h-vs-272h gap is the cadence source, not the income`);
    if (withPost && installH && Math.abs(withPost - installH) / installH > 0.25) c.warn(`fresh-life exit ${withPost.toFixed(1)}h vs the install decision's ${installH}h: the fresh life's cadence falls back to the thin measured posterior while it has no offers (exitInputsOf) — a cadence issue, not income`);
    checks.push(c);
  }

  return checks;
}
