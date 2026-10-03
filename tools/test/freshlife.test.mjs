// [FL] The fresh life priced from the game's formulas (freshlife.js), and the
// lives entering as the evidence on its error (bayes.formulaErrorPosterior).
//
//   FL1  the server table IS the game's serverMetadata (source vs source)
//   FL2  every ported formula agrees with the game bundle's over a sweep; the
//        expected world agrees with the game's own Server constructor
//   FL3  REPLAY, held out: the formula against 30 recorded lives (exp) and
//        5 (hacking income) — the BN9 life that ended at 05:42, BN1 and BN8
//        lives among them; the calibrated prior beats the raw formula and its
//        80% interval covers
//   FL4  REPLAY live BN9 05:46 (0.08h into the life, batcher prepping): the
//        old prior (earlier lives rescaled by ScriptHackMoney) against the
//        formula prior, both scored on what the life then earned
//   FL5  the exit's exp rate rising with the level: the same answer as the
//        constant rate at a fixed level, the (L + 50) law exactly, the round
//        trip, and absent -> the old model unchanged
//   FL6  the formula error is a posterior: no life -> the stated prior, each
//        life adds weight, a node's own lives dominate its bias, an unlike life
//        is down-weighted; the running life never counts twice
//   FL7  wiring: tel.js records the formula's inputs; progress.js prices the
//        income, the exp rate, the count curve and the cadence on the priors;
//        no "need N lives" gate is left; the simulation is cached and cheap
//
// CALIBRATION: FL3/FL4 ARE the calibration (history.jsonl and the earnings
// ledger, frozen in fixture-freshcal-0929.json by tools/sim/freshcal.mjs);
// every residual prints, pass or fail.

import "./gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const F = await import("../../freshlife.js");
const B = await import("../../bayes.js");
const X = await import("../../exitplan.js");
const { bitNodeMults } = await import("../../bitNodeMultipliers.js");
const CAL = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-freshcal-0929.json"), "utf8"));
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1e-12, Math.abs(b));
const fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);

let G = null;
let gErr = null;
try {
  await import("../sim/env.mjs");
  G = await import("../sim/game.bundle.mjs");
} catch (e) {
  gErr = e;
}

export async function run() {
  const checks = [];

  // ---------------------------------------------------------------------
  {
    const c = new Check("FL1", "the server table is the game's serverMetadata (less w0r1d_d43m0n and darkweb)");
    if (!G) c.fail("could not load the game bundle — the table is unverified, which is NOT a pass", String(gErr).slice(0, 300));
    else {
      const mid = (v) => (v == null ? null : typeof v === "number" ? v : [v.min, v.max]);
      const game = G.serverMetadata.filter((m) => m.hostname !== "w0r1d_d43m0n" && m.hostname !== "darkweb").map((m) => JSON.stringify([m.hostname, mid(m.maxRamExponent), m.numOpenPortsRequired, mid(m.requiredHackingSkill), mid(m.hackDifficulty), mid(m.moneyAvailable), mid(m.serverGrowth)]));
      const ours = F.SERVER_TABLE.map((r) => JSON.stringify(r));
      c.examined(game.length);
      const missing = game.filter((g) => !ours.includes(g));
      const extra = ours.filter((o) => !game.includes(o));
      if (missing.length || extra.length) c.fail(`the table drifted from the game: ${missing.length} row(s) missing/changed, ${extra.length} extra`, [...missing.slice(0, 3), ...extra.slice(0, 3)].join(" | "));
      if (F.SERVER_TABLE.some((r) => r[0] === "w0r1d_d43m0n")) c.fail("w0r1d_d43m0n must never be in the model's network");
      c.note(`${ours.length} servers, every row equal to src/Server/data/servers.ts`);
    }
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("FL2", "the ported formulas agree with the game's over a sweep, and the expected world with its Server constructor");
    if (!G) c.fail("could not load the game bundle — the formulas are unverified, which is NOT a pass", String(gErr).slice(0, 300));
    else {
      let n = 0;
      let worst = 0;
      const person = (L, int, m) => ({ skills: { hacking: L, intelligence: int }, mults: m });
      for (const bnN of [1, 8, 9, 10]) {
        const bn = G.getBitNodeMultipliers(bnN, 1);
        G.replaceCurrentNodeMults(bn);
        for (let i = 0; i < 40; i++) {
          const L = 1 + Math.floor(Math.random() * 3000);
          const int = Math.floor(Math.random() * 200);
          const m = { hacking: 1, hacking_chance: 0.8 + Math.random(), hacking_speed: 0.8 + Math.random(), hacking_money: 0.8 + Math.random(), hacking_grow: 0.8 + Math.random(), hacking_exp: 0.8 + Math.random() };
          const req = 1 + Math.floor(Math.random() * L);
          const sec = 1 + Math.random() * 98;
          const srv = { hasAdminRights: true, hackDifficulty: sec, requiredHackingSkill: req, baseDifficulty: sec * 1.7, serverGrowth: 1 + Math.random() * 99, moneyAvailable: 1e6, moneyMax: 1e9 };
          const p = person(L, int, m);
          const pairs = [
            [F.hackTimeS(req, sec, L, m.hacking_speed, bn.HackingSpeedMultiplier, int), G.calculateHackingTime(srv, p)],
            [F.hackChanceOf(req, sec, L, m.hacking_chance, int), G.calculateHackingChance(srv, p)],
            [F.hackPercentOf(req, sec, L, m.hacking_money, bn.ScriptHackMoney), G.calculatePercentMoneyHacked(srv, p)],
            [F.growLogOf(sec, srv.serverGrowth, m.hacking_grow, bn.ServerGrowthRate), G.calculateServerGrowthLog(srv, 1, p, 1)],
            [F.expBaseOf(srv.baseDifficulty) * m.hacking_exp * bn.HackExpGain, G.calculateHackingExpGain(srv, p)],
            [F.skillOf(L * 1000, 0.7), G.calculateSkill(L * 1000, 0.7)],
          ];
          for (const [a, b] of pairs) {
            n++;
            const e = Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
            worst = Math.max(worst, b === 0 ? Math.abs(a) : e);
          }
        }
        // The expected world against the constructor at the ranges' midpoints.
        const world = F.worldOf(bn);
        for (const w of world.filter((x) => x.moneyMax > 0).slice(0, 12)) {
          const row = F.SERVER_TABLE.find((r) => r[0] === w.host);
          const mid = (v) => (Array.isArray(v) ? (v[0] + v[1]) / 2 : v);
          const s = new G.Server({ hostname: `fl-${w.host}`, ip: "0.0.0.0", hackDifficulty: mid(row[4]), moneyAvailable: mid(row[5]), requiredHackingSkill: mid(row[3]), serverGrowth: mid(row[6]), numOpenPortsRequired: row[2] });
          for (const [a, b, what] of [[w.moneyMax, s.moneyMax, "moneyMax"], [w.money0, s.moneyAvailable, "money0"], [w.baseSec, s.baseDifficulty, "baseDifficulty"], [w.minSec, s.minDifficulty, "minDifficulty"]]) {
            n++;
            if (!close(a, b, 1e-9)) c.fail(`BN${bnN} ${w.host} ${what}: ours ${a}, the game's ${b}`);
          }
        }
      }
      G.replaceCurrentNodeMults(G.getBitNodeMultipliers(1, 1));
      c.examined(n);
      if (worst > 1e-9) c.fail(`a ported formula disagrees with the game by ${worst.toExponential(2)} (relative)`);
      c.note(`${n} comparisons over BN1/8/9/10 (hack time, chance, percent, grow log, exp/op, skill; the constructor's money and security): worst relative error ${worst.toExponential(1)}`);
    }
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("FL3", "REPLAY, held out: the formula prior against the recorded lives — BN9 (ended 05:42), BN1, BN8 among them");
    // Recompute every life from the fixture's recorded inputs: the calibration
    // is reproducible from the fixture, not only from history.jsonl.
    let n = 0;
    for (const L of CAL.lives) {
      const bn = bitNodeMults(L.node);
      const sing = L.node === 4 ? 1 : L.sf4 <= 1 ? 16 : L.sf4 === 2 ? 4 : 1;
      const startMs = Number(L.key);
      const farm = (h) => {
        const t = startMs + h * 3.6e6;
        if (bn.ScriptHackMoneyGain === 0) return t >= Date.parse("2026-09-25T13:39:30Z") ? 1 : 0;
        return t >= Date.parse("2026-09-29T01:52:15Z") ? 0.12 : 0;
      };
      const r = F.replayLife({ bn, mults: L.mults, intelligence: L.track[0][6], reserveGB: F.homeReserveGb(sing), track: L.track.map((t) => [t[0], t[1], t[2], t[3], t[4]]), earnings: L.earnings, farmShare: farm, legacy: { windowFn: B.legacyHackingWindow, bounds: B.PRIORS.legacyNonHack, lifeSd: B.PRIORS.incomeLifeSdLn } });
      n++;
      // The fixture's track is thinned to ~5 min, so a life replays within a few % of the full record.
      if (L.exp && r?.exp && Math.abs(r.exp.ln - L.exp.ln) > 0.15) c.fail(`BN${L.node} ${L.start}: exp residual ${r.exp.ln.toFixed(3)} from the fixture's inputs vs ${L.exp.ln} recorded`);
    }
    const rows = (kind) => {
      const out = [];
      for (const L of CAL.lives) {
        if (!L[kind]) continue;
        const res = (o) => ({ ln: o[kind].ln, hours: o[kind].hours, node: o.node, life: o.key });
        const then = B.formulaErrorPosterior(CAL.lives.filter((o) => o !== L && o[kind] && Date.parse(o.start) + o.endH * 3.6e6 <= Date.parse(L.start) + 60e3).map(res), kind, { node: L.node });
        out.push({ L, raw: L[kind].ln, prior: then.mean, sd: then.sd, err: L[kind].ln - then.mean, in80: Math.abs(L[kind].ln - then.mean) / then.sd <= 1.2816 });
      }
      return out;
    };
    for (const kind of ["exp", "income"]) {
      const R = rows(kind);
      c.examined(R.length);
      c.note(`${kind.toUpperCase()}: ln(realised / formula) raw -> held out (the prior from the lives finished before it)`);
      for (const r of R) if (r.L.node === 9 || kind === "income" || /T(13|23):/.test(r.L.start)) c.note(`  BN${r.L.node} ${r.L.start.slice(0, 16)} (${r.L.endH.toFixed(1)}h${r.L.complete ? "" : ", running"}): raw ${fmt(r.raw)} (x${Math.exp(r.raw).toFixed(2)}) -> prior ${fmt(r.prior)} x/÷${Math.exp(1.2816 * r.sd).toFixed(1)}, error ${fmt(r.err)} (x${Math.exp(r.err).toFixed(2)}) ${r.in80 ? "inside" : "OUTSIDE"} the 80% interval`);
      const rms = (f) => Math.sqrt(R.reduce((a, r) => a + f(r) ** 2, 0) / R.length);
      const cover = R.filter((r) => r.in80).length / R.length;
      c.note(`  ${R.length} lives: raw rms x${Math.exp(rms((r) => r.raw)).toFixed(2)}, held-out rms x${Math.exp(rms((r) => r.err)).toFixed(2)}, 80% interval covers ${(100 * cover).toFixed(0)}%`);
      if (kind === "exp") {
        if (!(rms((r) => r.err) < rms((r) => r.raw))) c.fail("the calibrated exp prior must beat the raw formula on held-out lives");
        if (!(cover >= 0.6 && cover <= 0.97)) c.fail(`the exp prior's 80% interval covers ${(100 * cover).toFixed(0)}% of held-out lives — outside [60, 97]`);
      } else if (!(cover >= 0.6)) c.fail(`the income prior's 80% interval covers ${(100 * cover).toFixed(0)}% of held-out lives`);
      // The lives the request names.
      if (!R.some((r) => r.L.node === 9 && r.L.start.startsWith("2026-09-28T18:38"))) c.fail(`${kind}: the BN9 life that ended at 05:42 must be in the replay`);
      if (kind === "exp" && !R.some((r) => r.L.node === 1) && !R.some((r) => r.L.node === 8)) c.fail("a BN1 or BN8 life must be in the replay");
    }
    c.examined(n);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("FL4", "REPLAY live BN9 05:46 (0.08h in, prepping): the old prior (lives x ScriptHackMoney) vs the formula prior, scored on what the life then earned");
    const FX = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-freshlife-0546.json"), "utf8"));
    const FE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-earnings-0536.json"), "utf8"));
    const L2 = CAL.lives.find((l) => l.node === 9 && l.start.startsWith("2026-09-29T05:42"));
    const L1 = CAL.lives.find((l) => l.node === 9 && l.start.startsWith("2026-09-28T18:38"));
    if (!L2 || !L1) c.fail("the fixture must carry both BN9 lives");
    else {
      // Realised: the hacking stream over the first 0.5h window it earned, and over the life.
      const e2 = L2.earnings.filter((q) => Number.isFinite(q[2]));
      const at = (h) => {
        for (let i = 1; i < e2.length; i++) if (h <= e2[i][0]) return e2[i - 1][2] + ((e2[i][2] - e2[i - 1][2]) * (h - e2[i - 1][0])) / (e2[i][0] - e2[i - 1][0]);
        return e2[e2.length - 1][2];
      };
      const realWin = (at(0.58) - at(0.08)) / (0.5 * 3600);
      const realLife = e2[e2.length - 1][2] / (e2[e2.length - 1][0] * 3600);
      // The formula as the plan prices it at 05:46: this life's inputs, the
      // error posterior from the lives finished before it (the seed without it).
      const bn = bitNodeMults(9);
      const sim = F.simulateFreshLife({ bn, mults: L2.mults, intelligence: 125, homeGB: 4096 - F.homeReserveGb(4), farmShare: 0.12, horizonH: 12 });
      const res = F.calibrationResiduals(null, { exclude: L2.key });
      const err = B.formulaErrorPosterior(res.income, "income", { node: 9 });
      const pr = B.formulaRatePrior(sim.pts, 0.08, err, { key: "cum", what: "income" });
      // The old prior at that moment (/tel/plan.txt 05:46) and the one it read hours later (plan.txt 12:13).
      const old546 = FX.planIncome;
      const oldLater = { perSec: 5.95e7, sdLn: Math.log(159.3) / 1.2816 };
      const score = (med, sd, real) => ({ err: Math.log(real / med), z: Math.log(real / med) / sd });
      const sNew = score(pr.perSec, pr.sd, realWin);
      const sOld = score(old546.perSec, old546.sdLn, realWin);
      const sLater = score(oldLater.perSec, oldLater.sdLn, realLife);
      const sNewLife = score(pr.perSec, pr.sd, realLife);
      c.examined(4);
      c.note(`realised hacking 0.08-0.58h $${realWin.toExponential(2)}/s; over the life so far $${realLife.toExponential(2)}/s`);
      c.note(`OLD (05:46, 1 legacy BN9 life): $${old546.perSec.toExponential(2)}/s x/÷ ${Math.exp(1.2816 * old546.sdLn).toFixed(1)} -> error x${Math.exp(sOld.err).toExponential(2)} (z ${sOld.z.toFixed(1)})`);
      c.note(`OLD (12:13, 4 BN1 lives x ScriptHackMoney): $${oldLater.perSec.toExponential(2)}/s x/÷ 159.3 -> error on the life x${Math.exp(sLater.err).toExponential(2)} (z ${sLater.z.toFixed(1)})`);
      c.note(`NEW (formula x error posterior, ${err.n} lives): $${pr.perSec.toExponential(2)}/s x/÷ ${Math.exp(1.2816 * pr.sd).toFixed(1)} (model $${pr.modelPerSec.toExponential(2)}/s) -> error x${Math.exp(sNew.err).toFixed(2)} (z ${sNew.z.toFixed(1)}); on the life x${Math.exp(sNewLife.err).toFixed(2)}`);
      if (!(Math.abs(sNew.err) < Math.abs(sOld.err) && Math.abs(sNewLife.err) < Math.abs(sLater.err))) c.fail("the formula prior must be nearer what the life earned than the lives-based prior it replaced");
      if (!(Math.abs(sNew.z) <= 1.2816)) c.fail(`the realised window must sit inside the formula prior's 80% interval (z ${sNew.z.toFixed(2)})`);
      void FE;
    }
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("FL5", "the exit's exp rate rising with the level: (L + 50) exactly, the round trip, and absent -> the old model");
    c.examined(5);
    // At a FIXED level the shaped rate is the constant one.
    const at = X.expRateShape(300, { scales: true, ref: 200, flat: 50 });
    if (!close(at(200), 300, 1e-12)) c.fail("at the reference level the shaped rate is today's rate");
    if (!close(at(450), 50 + 250 * (500 / 250), 1e-12)) c.fail("the scaled part goes as (L + 50), the flat part stays");
    // The climb: numeric vs the closed form of dE/dl for rate k (l + 50).
    const m = 0.7;
    const k = 0.3;
    const rate = (l) => k * (l + 50);
    const t = X.hoursToLevelShaped(2000, m, 0, rate);
    let ref = 0;
    for (let l = 1; l < 2000; l += 0.01) ref += (X.expForLevel(l + 0.01, m) - X.expForLevel(l, m)) / rate(l + 0.005);
    if (!close(t, ref / 3600, 0.01)) c.fail(`hoursToLevelShaped ${t} vs a fine integral ${ref / 3600}`);
    // Round trip: the exp after the climb's hours is the level's exp.
    const e = X.expAfterHours(0, t, m, rate);
    if (!close(e, X.expForLevel(2000, m), 0.01)) c.fail(`expAfterHours after the climb's hours: ${e} vs ${X.expForLevel(2000, m)}`);
    // Absent: bit-for-bit the old exit.
    const I = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-0140.json"), "utf8")).exitinputs.inputs;
    const a = X.exitHours({ ...I, installsFirst: 2 });
    const b = X.exitHours({ ...I, installsFirst: 2, expScalesWithLevel: false });
    if (a.hours !== b.hours) c.fail("expScalesWithLevel false must be the old exit exactly");
    const s = X.exitHours({ ...I, installsFirst: 2, expScalesWithLevel: true });
    c.note(`exit (BN9 01:40 inputs, 2 installs): constant exp ${a.hours?.toFixed(2)}h, level-shaped ${s.hours?.toFixed(2)}h; climb to 6000 ${a.legs?.find((l) => l.leg === "climb to exit level")?.hours?.toFixed(2)}h vs ${s.legs?.find((l) => l.leg === "climb to exit level")?.hours?.toFixed(2)}h (the rate at level 6000 is (6050 / 206) = x29 today's)`);
    if (!(Number.isFinite(s.hours) && s.hours > 0)) c.fail("the shaped exit must price");
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("FL6", "the formula's error is a posterior over lives: the stated prior, weights growing with lives, the node's own bias, outliers down-weighted, the running life once");
    c.examined(6);
    const none = B.formulaErrorPosterior([], "exp", { node: 9 });
    if (!(none.mean === 0 && none.weight === 0 && none.n === 0)) c.fail("no life: the stated prior (unbiased, no data weight)", JSON.stringify({ m: none.mean, w: none.weight }));
    const lives = (n, ln, node) => Array.from({ length: n }, (_, i) => ({ ln: ln + 0.05 * Math.sin(i), hours: 3, node, life: `${node}-${i}` }));
    const w1 = B.formulaErrorPosterior(lives(1, -0.8, 8), "exp", { node: 8 });
    const w5 = B.formulaErrorPosterior(lives(5, -0.8, 8), "exp", { node: 8 });
    if (!(w5.weight > w1.weight && Math.abs(w5.mean + 0.8) < Math.abs(w1.mean + 0.8))) c.fail("more own lives: more weight, nearer their bias", JSON.stringify({ w1: [w1.weight, w1.mean], w5: [w5.weight, w5.mean] }));
    // Another node's lives shrink a new node toward them only through the cross-node mean.
    const other = B.formulaErrorPosterior([...lives(6, -0.8, 8), ...lives(6, 0.4, 1), ...lives(6, 0, 10)], "exp", { node: 9 });
    if (!(other.own === 0 && other.mean < 0.4 && other.mean > -0.8)) c.fail("a node with no life takes the cross-node mean", JSON.stringify(other));
    // An unlike life is down-weighted.
    const out = B.formulaErrorPosterior([...lives(6, 0, 1), { ln: 6, hours: 3, node: 1, life: "x" }], "exp", { node: 1 });
    if (!(out.outliers >= 1 && out.mean < 0.6)) c.fail(`one life at x400 must be down-weighted, not moved to: mean ${out.mean}, outliers ${out.outliers}`);
    // The running life is excluded from the residuals; a ledger life that is a seed life is counted once.
    const seedKey = F.FRESH_CALIBRATION[F.FRESH_CALIBRATION.length - 1][0];
    const r1 = F.calibrationResiduals({ lives: { [String(seedKey + 60e3)]: { node: 9, exp: { ln: 5, hours: 2 } } } });
    const r2 = F.calibrationResiduals(null, { exclude: seedKey });
    if (r1.exp.some((x) => x.ln === 5)) c.fail("a ledger life within 15 min of a seed life is the same life, counted once");
    if (r2.exp.length !== F.FRESH_CALIBRATION.filter((x) => x[2] !== null).length - 1) c.fail("the excluded (running) life must not be in the residuals");
    c.note(`own lives 1 -> 5: weight ${(100 * w1.weight).toFixed(0)}% -> ${(100 * w5.weight).toFixed(0)}%; no own life: cross-node mean x${Math.exp(other.mean).toFixed(2)}; a x400 life: ${out.outliers} down-weighted, bias x${Math.exp(out.mean).toFixed(2)}`);
    checks.push(c);
  }

  // ---------------------------------------------------------------------
  {
    const c = new Check("FL7", "wiring: tel.js records the formula's inputs; progress.js prices income, exp, the count curve and the cadence on the priors; no 'need N lives' gate; the simulation is cached and cheap");
    const tel = code("tel.js");
    const prog = code("progress.js");
    const cp = code("countplan.js");
    const plan = code("plan.js");
    c.examined(10);
    if (!/L\.samples\.push\(\[Math\.round\(ageH \* 1e4\) \/ 1e4, Math\.round\(earned\), Math\.round\(hackEarned\), fin\(player\?\.exp\?\.hacking\)/.test(tel)) c.fail("tel.js must record the hacking exp beside the earnings");
    if (!/L\.inputs = \{ mults: \{ hacking: m\.hacking, hacking_exp: m\.hacking_exp/.test(tel)) c.fail("tel.js must record the life's multipliers once");
    if (!/formulaRatePrior\(fp\.pts, ageH, err\.income, \{ key: 'cum', what: 'income' \}\)/.test(prog)) c.fail("progress.js's income prior must be the formula's");
    if (/incomePrior\(\{/.test(prog)) c.fail("the lives-rescaled income prior must no longer be called");
    if (!/formulaRatePrior\(fp\.pts, ageH, err\.exp, \{ key: 'exp', what: 'exp' \}\)/.test(prog) || !/ratePosterior\(pr, obs, \{ what: 'exp'/.test(prog)) c.fail("the exp rate must be the formula prior updated by the measurement");
    if (!/expScalesWithLevel: true/.test(prog)) c.fail("the exit's exp rate must rise with the level");
    if (!/curve: countCurveOf\(ns, info, exitInputsOf\(/.test(prog)) c.fail("the count timing must price on the structural curve");
    if (/MIN_LIVES|need \$\{need\}/.test(cp)) c.fail("countplan must not gate on a count of lives");
    if (!/modelPrior: cadenceModelPriorOf\(ns, info\)/.test(prog) || !/o\.multGainPerCycle = Math\.exp\(d\.lnPerHour \* inputs\.cycleHours \* gm\)/.test(plan)) c.fail("the cadence draws must come from the posterior on the purchase model's prior");
    if (!/FRESH_PRIOR_FILE/.test(prog) || !/cached\?\.key === key/.test(prog)) c.fail("the simulation must be cached by its inputs (a pass re-runs it only when they change)");
    // CPU: one simulation well inside a pacer slice (40ms).
    const bn = bitNodeMults(9);
    const L2 = CAL.lives.find((l) => l.node === 9);
    let worst = 0;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      F.simulateFreshLife({ bn, mults: L2.mults, intelligence: 125, homeGB: 3900, farmShare: 0.12, horizonH: 24 });
      worst = Math.max(worst, i ? performance.now() - t0 : 0);
    }
    if (!(worst < 40)) c.fail(`one fresh-life simulation took ${worst.toFixed(1)}ms — past a pacer slice`);
    c.note(`one 24h simulation ${worst.toFixed(1)}ms (after JIT); cached in /tel/freshprior.txt by its inputs`);
    checks.push(c);
  }

  return checks;
}
