// [GL] THE GIFT'S CHARGE REGROWS EVERY LIFE: THE LIFE LENGTH PRICES IT.
//
// Live BN13.1 2026-10-11 (fixture-bn13-giftlife.json, one pass ~02:44Z after
// the 02:34:22Z install; mkfix in tools/sim/exitjump/mkfix-bn13-giftlife.mjs):
// Stanek's fragment charges clear at every install (StaneksGift.ts
// prestigeAugmentation) and regrow — effect ~ ln(highestCharge + 1) x
// ((numCharge + 1)/5)^0.07, numCharge accumulating every second of the life.
// The life length decision (lifeLengthDecisionOf -> lifeplan.lifeInputsOf on
// one base per pass; lifeTableGen's money and reputation per L) priced every
// option L0.5..L24 on ONE gift factor — the measured rates — so a longer life
// got no credit for spending more of itself at a higher charge, and the
// stanek decision priced the gift's life-average at the committed L only.
// Now stanekplan.giftLifeInputsOf moves the base from the gift's life-average
// at the committed length (refL) to the life-average at each option's L, in
// both the table and lifeInputsOf (one builder).
//
//   GL1 THE MODEL     the gift's life-average multipliers (chargeLnOf at the
//                     charger's f on the live layout and fleet) rise with L on
//                     every channel the exit reads; the batcher's RAM loss does
//                     not depend on L
//   GL2 THE OPTIONS   on the live pass: lifeInputsOf with `giftLife` prices a
//                     longer life on a stronger life-average gift (income,
//                     exp, rep, hacking strictly rising in L), the committed
//                     L is the measured inputs exactly, and without
//                     `giftLife` (or a constant gift) nothing moves — the RED
//   GL3 THE TABLE     what a life of L buys (lifeTable) is bought at the
//                     life-average reputation and money of L: rows at L > refL
//                     buy no less than the constant-gift rows, rows below no more
//   GL4 THE DECISION  the life length decision on the live pass, constant gift
//                     vs the gift's regrowth (reported: the chosen length and its
//                     exit, both on the same draws)
//   GL5 WIRING        progress.js attaches `giftLife` to the base inputs before
//                     the purchase table (exitInputsGen -> giftLifeNow), on the
//                     committed length, at the charger's allocation
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const E = await import("../../exitplan.js");
const LP = await import("../../lifeplan.js");
const SP = await import("../../stanekplan.js");
const BM = await import("../../bitNodeMultipliers.js");

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn13-giftlife.json"), "utf8"));
const PASS = F.passes[0];
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const covOf = (n) => {
  const m = n === 12 ? BM.bitNodeMults(12, 1) : BM.bitNodeMults(n);
  return m ? Math.log(m.AugmentationMoneyCost * m.AugmentationRepCost) : 0;
};
const drawsPostOf = (ps) => {
  const c = ps?.cadence;
  const t = ps?.trader;
  return {
    drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
    gymSdLn: 0.1,
    cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
    expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
    income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
    trader: t && Number.isFinite(t.mean) ? { perSec: { mean: t.mean, sd: t.sd }, ...(Number.isFinite(t.Wstar) ? { lnWstar: { mean: Math.log(t.Wstar), sd: t.lnWstarSd ?? 0.3 } } : {}), rho: t.rho ?? 0 } : null,
  };
};
// The charger's allocation the live pass ran (decisions.stanek.f), the committed length as refL.
const L0 = PASS.inputs.cycleHours;
const F_LIVE = PASS.plan.decisions.stanek?.f ?? SP.DEFAULT_F;
const CTX = SP.giftLifeCtxOf(PASS.stanek, { node: PASS.node, f: F_LIVE, refL: L0 });
const { giftLife: _drop, ...BASE } = PASS.inputs;
void _drop;
const WITH = { ...BASE, giftLife: CTX };

// ONE PASS AS progress.js BUILDS IT (purchaseCadenceGen -> exitInputsGen ->
// lifeLengthDecisionOf), as lifegrowth.test.mjs: the table's money calibrated
// to the published row at the committed L, the cadence posterior at it.
function build(I) {
  const nfgLevel0 = I.cadence?.afterBatch?.nfgLevels ?? 0;
  const C = LP.catalogueFromOffers(PASS.offers, PASS.owned);
  const rph = I.repPerSec * 3600;
  const pub = I.cadence.table.find((r) => r.L === L0);
  const raw = LP.lifeTable({ inputs: I, catalogue: C, favor: C.favor, owned: PASS.owned, repPerHour0: rph, grid: [L0], nfgLevel0, withGrowth: false, shapeH: 0 })[0];
  const moneyScale = pub.money / raw.money;
  const table = LP.lifeTable({ inputs: I, catalogue: C, favor: C.favor, owned: PASS.owned, repPerHour0: rph, moneyScale, nfgLevel0 });
  const rec = { table, moneyScale, afterBatch: I.cadence.afterBatch };
  const row = table.find((r) => r.L === L0);
  const post = E.installCadence(PASS.ledger, PASS.node, { covOf, modelPrior: { lnPerHour: row.lnMean / L0, cycleHours: L0 } }).posterior;
  const opts = [];
  for (const r of table) {
    const x = LP.lifeInputsOf(I, rec, r.L, post);
    if (x) opts.push({ L: r.L, inputs: x, cad: LP.lifeCadenceAt(r, post) });
  }
  return { table, post, opts };
}
const decideOn = (opts) =>
  P.decideLifeLength({ options: opts, basis: null, prev: PASS.plan.decisions.lifeLength, draws: P.makeDraws(drawsPostOf(PASS.plan.posteriors), P.PLAN.N, P.seedOf(PASS.lastAugReset, PASS.node)), redecide: true, now: Date.parse(PASS.plan.at), budgetMs: 1e9, reachSd: PASS.plan.posteriors?.s ?? null });
const fx = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

export async function run() {
  const checks = [];

  {
    const c = new Check("GL1", "THE MODEL: the gift's life-average multipliers at the charger's f on the live layout and fleet rise with the life length on every channel the exit reads; the RAM loss is L-independent");
    try {
      if (!CTX) throw new Error("giftLifeCtxOf returned null on the live stanek record");
      const rows = LP.LIFE_GRID.map((L) => ({ L, ...SP.giftLifeLnOf(CTX, L) }));
      c.examined(rows.length);
      c.note(`live f=${F_LIVE} of ${CTX.fleetGB}GB (${CTX.hosts.length} hosts), refL ${L0}h: ${rows.map((r) => `L${r.L} inc ${fx(r.lnIncome, 3)} rep ${fx(r.lnRep, 3)} hack ${fx(r.lnHack, 3)}`).join("; ")}`);
      for (let k = 1; k < rows.length; k++) {
        for (const ch of ["lnIncome", "lnExp", "lnRep", "lnHack"]) if (!(rows[k][ch] > rows[k - 1][ch])) c.fail(`${ch} must rise from L${rows[k - 1].L} to L${rows[k].L}: ${rows[k - 1][ch]} -> ${rows[k][ch]}`);
        if (rows[k].batchLoss !== rows[0].batchLoss) c.fail("the batcher's RAM loss must not depend on L");
      }
    } catch (e) {
      c.fail(`threw: ${e?.stack ?? e}`);
    }
    checks.push(c);
  }

  let BUILT = null;
  {
    const c = new Check("GL2", "THE OPTIONS: lifeInputsOf with the gift's regrowth prices a longer life on a stronger life-average gift; the committed L is the measured inputs; a constant gift (no giftLife) is the RED");
    try {
      BUILT = { gift: build(WITH), flat: build(BASE) };
      const o = BUILT.gift.opts;
      c.examined(o.length);
      c.note(`live options (rate per s): ${o.map((x) => `L${x.L} inc ${fx(x.inputs.incomePerSec, 1)} rep ${fx(x.inputs.repPerSec)} hackMult ${fx(x.inputs.hackingMult)}`).join("; ")}`);
      if (o.length < 4) c.fail(`the live pass must price several lengths (${o.length})`);
      for (let k = 1; k < o.length; k++) for (const ch of ["incomePerSec", "expPerSec", "repPerSec", "hackingMult"]) if (!(o[k].inputs[ch] > o[k - 1].inputs[ch])) c.fail(`L${o[k].L} must price a stronger life-average gift than L${o[k - 1].L} on ${ch}: ${o[k - 1].inputs[ch]} -> ${o[k].inputs[ch]} (the gift factor held constant across L)`);
      const at0 = o.find((x) => x.L === L0);
      for (const ch of ["incomePerSec", "expPerSec", "repPerSec", "hackingMult"]) if (at0 && at0.inputs[ch] !== BASE[ch]) c.fail(`the committed L${L0} must be the measured ${ch} exactly: ${at0.inputs[ch]} vs ${BASE[ch]}`);
      const f = BUILT.flat.opts;
      if (new Set(f.map((x) => x.inputs.repPerSec)).size !== 1) c.fail("without giftLife the options must carry the measured rates unchanged (the base is not the gift's)");
    } catch (e) {
      c.fail(`threw: ${e?.stack ?? e}`);
    }
    checks.push(c);
  }

  {
    const c = new Check("GL3", "THE TABLE: what a life of L buys is bought at the life-average reputation and money of L — above refL no less than the constant gift, below no more, at refL the same");
    try {
      const g = BUILT.gift.table;
      const f = BUILT.flat.table;
      c.examined(g.length);
      c.note(`ln gain a life (constant -> regrowing gift): ${g.map((r) => `L${r.L} ${fx(f.find((x) => x.L === r.L)?.lnMean)}->${fx(r.lnMean)} $${(f.find((x) => x.L === r.L)?.money / 1e6).toFixed(1)}m->$${(r.money / 1e6).toFixed(1)}m`).join("; ")}`);
      let moved = 0;
      for (const r of g) {
        const q = f.find((x) => x.L === r.L);
        if (!q) continue;
        if (r.L > L0 && !(r.money > q.money)) c.fail(`L${r.L} > refL: its life must earn more money under the stronger gift (${q.money} -> ${r.money})`);
        if (r.L < L0 && !(r.money < q.money)) c.fail(`L${r.L} < refL: its life must earn less money under the weaker gift (${q.money} -> ${r.money})`);
        if (r.L === L0 && r.money !== q.money) c.fail(`refL L${r.L}: the table row must be the constant gift's (${q.money} vs ${r.money})`);
        if (r.L > L0 && r.lnMean < q.lnMean - 1e-12) c.fail(`L${r.L}: a stronger gift must not buy less (${q.lnMean} -> ${r.lnMean})`);
        if (r.L < L0 && r.lnMean > q.lnMean + 1e-12) c.fail(`L${r.L}: a weaker gift must not buy more (${q.lnMean} -> ${r.lnMean})`);
        if (r.money !== q.money) moved++;
      }
      if (moved < 2) c.fail(`the gift must move the table off refL (${moved} rows moved)`);
    } catch (e) {
      c.fail(`threw: ${e?.stack ?? e}`);
    }
    checks.push(c);
  }

  {
    const c = new Check("GL4", "THE DECISION on the live pass: the chosen life length and its exit with a constant gift vs the gift's regrowth (same draws) — reported");
    try {
      const a = decideOn(BUILT.flat.opts);
      const b = decideOn(BUILT.gift.opts);
      c.examined(2);
      const tb = (d) => (d.table ?? []).map((t) => `${t.L}:${t.pointH ?? "-"}`).join(" ");
      c.note(`constant gift: ${a.key} (mean ${fx(a.meanH, 1)}h, point ${fx(a.pointH, 1)}h) | points ${tb(a)}`);
      c.note(`gift regrowth: ${b.key} (mean ${fx(b.meanH, 1)}h, point ${fx(b.pointH, 1)}h) | points ${tb(b)}`);
      c.note(`published: ${PASS.plan.decisions.lifeLength?.key} (${String(PASS.plan.decisions.lifeLength?.why ?? "").slice(0, 140)})`);
      if (!b.key) c.fail(`the regrowing gift must leave a length priced: ${b.why}`);
    } catch (e) {
      c.fail(`threw: ${e?.stack ?? e}`);
    }
    checks.push(c);
  }

  {
    const c = new Check("GL5", "WIRING: progress.js carries giftLife on the base inputs before the purchase table, at the committed length and the charger's allocation; lifeplan prices it in lifeInputsOf and lifeTableGen");
    const pr = code("progress.js");
    const lp = code("lifeplan.js");
    const want = [
      [pr, /const gl = giftLifeNow\(ns, info, committedLifeL\(ns, info\)\?\.L \?\? out\.cycleHours\)\s+if \(gl\) out\.giftLife = gl\s+const pc = Array\.isArray\(cOffers\)/, "progress.js: giftLife on the base before purchaseCadenceGen"],
      [pr, /giftLifeCtxOf\(readJson\(ns, STANEK_FILE\), \{ node: info\?\.currentNode, f, refL \}\)/, "progress.js: the context from stanek.js's record"],
      [pr, /giftLife\.f\}@\$\{base\.giftLife\.refL/, "progress.js: the table memo keyed on the gift"],
      [lp, /const gb = giftLifeInputsOf\(base, L\)/, "lifeplan.js: lifeInputsOf at the gift's life-average"],
      [lp, /const inputsAt = \(L\) => giftLifeInputsOf\(inputs, L\)/, "lifeplan.js: the table at the gift's life-average"],
    ];
    c.examined(want.length);
    for (const [src, re, what] of want) if (!re.test(src)) c.fail(`missing: ${what}`);
    checks.push(c);
  }

  return checks;
}
