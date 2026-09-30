// [XM] MORE MONEY NEVER MAKES THE EXIT LATER.
//
// The player can always ignore income, so the true optimum is weakly
// decreasing in every money source; an exit simulator that rises with income
// has a policy (or a leg) the game does not force. Live BN9 2026-09-30 15:56Z
// (fixture-bn9-gangrespect-1556): a carried gang stream of $10m/s priced the
// exit at 9.627h and $400m/s at 9.698h ($1t/s 9.747h) — the ground
// reputation leg was priced from the join's level while the work slot was
// still grafting, and the window's slot total settled the overlap only
// against a window that included the climb (work the Red Pill install
// forbids). A sooner join started the grind at a lower level. Found once
// before by the hash audit ("a $1e12/s income in the final window makes the
// exit 0.26h longer"), and papered over in gangplan by pricing a stream as
// the best of its caps.
//
//   XM1 on every fixture's exit inputs (one record each), bestExitPolicy is
//       non-increasing in: the income (incomePerSec and its flat part) x k,
//       every carried stream x k, a carried $10m/s x k gang stream, the
//       trader's r0 x k — k in 0.5, 1, 2, 4, 10 — within EPS
//   XM2 the live 15:56Z sweep: $10m/s -> $1t/s of gang money is monotone,
//       and the ground leg waits for the grafts (it starts at the slot's
//       freeing, the "grafts finish" leg is gone)
//   XM3 THE ORDER: grafts first is the order chosen on the live inputs, and
//       'rep' first is simulated (and loses) only where the screen fails
//   XM4 the replay-only pre-queue switch (slotQueue: false, prequeue.mjs) is
//       set by no root script and still reproduces 0209b85's rising sweep
import "./gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const X = await import(path.join(REPO, "exitplan.js"));

// A deterministic simulator: the only noise is the discretisation (the rep
// leg's step is 1/REP_STEPS of the leg at its opening rate, the money legs
// land to LAND_HALVINGS) — well under a minute on these legs.
const EPS_H = 0.01;
const EPS_REL = 1e-4;
const KS = [0.5, 1, 2, 4, 10];

function recordOf(d) {
  let found = null;
  const walk = (x) => {
    if (found || !x || typeof x !== "object") return;
    if (x.inputs && typeof x.inputs === "object" && "exitLevel" in x.inputs && "incomePerSec" in x.inputs) {
      found = x;
      return;
    }
    for (const v of Object.values(x)) walk(v);
  };
  walk(d);
  return found;
}

export function fixtureRecords() {
  const out = [];
  for (const f of fs.readdirSync(HERE).filter((f) => f.startsWith("fixture-") && f.endsWith(".json")).sort()) {
    let d;
    try {
      d = JSON.parse(fs.readFileSync(path.join(HERE, f), "utf8"));
    } catch {
      continue;
    }
    const rec = recordOf(d);
    if (rec) out.push({ f, base: { ...rec.inputs, ...(rec.eRep !== undefined ? { eRep: rec.eRep } : {}), ...(rec.eBudget !== undefined ? { eBudget: rec.eBudget } : {}) } });
  }
  return out;
}

const scaleSteps = (steps, k) => (Array.isArray(steps) ? steps.map((s) => ({ ...s, perSec: typeof s?.perSec === "number" ? s.perSec * k : s?.perSec })) : steps);
export const LEVERS = {
  income: (b, k) => ({ ...b, incomePerSec: (b.incomePerSec ?? 0) * k, flatIncomePerSec: (b.flatIncomePerSec ?? 0) * k }),
  carried: (b, k) => (b.carriedIncome && Object.keys(b.carriedIncome).length ? { ...b, carriedIncome: Object.fromEntries(Object.entries(b.carriedIncome).map(([n, s]) => [n, scaleSteps(s, k)])) } : null),
  gang10m: (b, k) => ({ ...b, carriedIncome: { ...(b.carriedIncome ?? {}), gang: [{ atH: 0, perSec: 1e7 * k }] } }),
  r0: (b, k) => (typeof b.capitalReturnPerSec === "number" && b.capitalReturnPerSec > 0 ? { ...b, capitalReturnPerSec: b.capitalReturnPerSec * k } : null),
};

export function sweep(base, lever) {
  const rows = [];
  for (const k of KS) {
    const inp = LEVERS[lever](base, k);
    if (!inp) return null;
    rows.push({ k, h: X.bestExitPolicy(inp).best?.hours ?? null });
  }
  return rows;
}

export function rises(rows) {
  const bad = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].h;
    const b = rows[i].h;
    if (typeof a !== "number" || typeof b !== "number") continue;
    // Past DEGENERATE_H an exit is "unreachable", not a duration.
    if (a >= X.DEGENERATE_H && b >= X.DEGENERATE_H) continue;
    if (b > a + EPS_H + EPS_REL * a) bad.push(`x${rows[i - 1].k} ${a.toFixed(3)}h -> x${rows[i].k} ${b.toFixed(3)}h`);
  }
  return bad;
}

export async function run() {
  const out = [];
  {
    const c = new Check("XM1", "on every fixture's exit inputs the exit is non-increasing in income x k, each carried stream x k, a carried gang stream x k and the trader's r0 x k (k 0.5..10)");
    const recs = fixtureRecords();
    let n = 0;
    let swept = 0;
    for (const { f, base } of recs) {
      for (const lever of Object.keys(LEVERS)) {
        const rows = sweep(base, lever);
        if (!rows) continue;
        swept++;
        n += rows.length;
        for (const b of rises(rows)) c.fail(`${f} ${lever}: the exit rises with money`, b);
      }
    }
    c.examined(n);
    c.note(`${recs.length} fixture(s), ${swept} sweep(s), ${n} exits`);
    if (recs.length < 20) c.fail("fewer fixtures with exit inputs than expected — the scan found too little", String(recs.length));
    out.push(c);
  }
  {
    const c = new Check("XM2", "the live 15:56Z gang sweep ($0 -> $1t/s) is monotone; the ground leg waits for the grafts on the slot");
    const d = JSON.parse(fs.readFileSync(path.join(HERE, "fixture-bn9-gangrespect-1556.json"), "utf8"));
    const ei = d.exitinputs;
    const base = { ...ei.inputs, eRep: ei.eRep, eBudget: ei.eBudget };
    const steps = base.carriedIncome.gang;
    const rows = [0, 1e6, 1e7, 3e7, 1e8, 4e8, 1e9, 1e10, 1e12].map((g) => {
      const b = X.bestExitPolicy({ ...base, carriedIncome: { ...base.carriedIncome, gang: steps.map((s) => ({ atH: s.atH, perSec: g })) } }).best;
      return { k: g, h: b?.hours ?? null, legs: b?.legs ?? [] };
    });
    c.examined(rows.length);
    for (const b of rises(rows)) c.fail("the exit rises with the gang's money", b);
    c.note(rows.map((r) => `$${r.k.toExponential(0)}/s ${r.h?.toFixed(3)}h`).join(", "));
    const top = rows[rows.length - 1];
    const leg = (name) => top.legs.find((l) => l.leg === name);
    const slot = leg("grafts")?.detail?.match(/slot until \+([\d.]+)h/);
    const rep = leg("exit reputation");
    const wait = leg("reputation waits for the slot");
    if (!slot || !rep || !wait) c.fail("the $1t/s policy has no graft, slot-wait or reputation leg", JSON.stringify(top.legs.map((l) => l.leg)));
    // $1t/s: the join is at the window's start, so the grind starts where the grafts free the slot.
    else if (!(Math.abs(wait.hours - +slot[1]) < 0.02)) c.fail("the ground leg must wait for the grafts (it starts where the slot frees)", `waits ${wait.hours.toFixed(3)}h from the join, grafts hold the slot until +${slot[1]}h`);
    if (leg("grafts finish")) c.fail("the grind follows the grafts: nothing is left to wait for before the climb", leg("grafts finish").detail);
    if (leg("work slot binds")) c.fail("the slot is a queue: grafts then the grind cannot bind past the climb", leg("work slot binds").detail);
    out.push(c);
  }
  {
    const c = new Check("XM3", "the order on the work slot: grafts first on the live inputs (the screen holds), 'rep' first simulated and slower; the auto choice is the better of the two where the screen fails");
    const d = JSON.parse(fs.readFileSync(path.join(HERE, "fixture-bn9-gangrespect-1556.json"), "utf8"));
    const ei = d.exitinputs;
    const base = { ...ei.inputs, eRep: ei.eRep, eBudget: ei.eBudget };
    const auto = X.bestExitPolicy(base).best?.hours;
    const g = X.bestExitPolicy({ ...base, slotOrder: "grafts" }).best?.hours;
    const r = X.bestExitPolicy({ ...base, slotOrder: "rep" }).best?.hours;
    c.examined(3);
    c.note(`auto ${auto?.toFixed(3)}h, grafts first ${g?.toFixed(3)}h, rep first ${r?.toFixed(3)}h`);
    if (!(auto === g)) c.fail("the screen holds on the live set: auto must be grafts first", `${auto} vs ${g}`);
    if (!(r > g)) c.fail("rep first must be slower on the live set", `${r} vs ${g}`);
    // A set whose entropy outweighs it (rep x0.9, hacking x1): both simulated, the better kept.
    const weak = { ...base, finalGrafts: base.finalGrafts.map((x) => ({ ...x, hacking: 1, rep: 0.9, exp: 0.98 })) };
    const wa = X.bestExitPolicy(weak).best?.hours;
    const wg = X.bestExitPolicy({ ...weak, slotOrder: "grafts" }).best?.hours;
    const wr = X.bestExitPolicy({ ...weak, slotOrder: "rep" }).best?.hours;
    c.examined(3);
    c.note(`entropy-only set: auto ${wa?.toFixed(3)}h, grafts first ${wg?.toFixed(3)}h, rep first ${wr?.toFixed(3)}h`);
    if (!(Math.abs(wa - Math.min(wg, wr)) < 1e-9)) c.fail("where the screen fails the auto order must be the better of the two", `${wa} vs ${wg} / ${wr}`);
    out.push(c);
  }
  {
    const c = new Check("XM4", "the pre-queue accounting (slotQueue: false) is for replays only: no root script sets it, and on it the live 15:56Z sweep still rises (the defect, kept visible)");
    const setters = fs.readdirSync(REPO).filter((f) => f.endsWith(".js") && f !== "exitplan.js").filter((f) => /slotQueue/.test(fs.readFileSync(path.join(REPO, f), "utf8")));
    c.examined(1);
    if (setters.length) c.fail("a root script mentions slotQueue: the replay switch must never reach live pricing", setters.join(", "));
    const d = JSON.parse(fs.readFileSync(path.join(HERE, "fixture-bn9-gangrespect-1556.json"), "utf8"));
    const ei = d.exitinputs;
    const base = { ...ei.inputs, eRep: ei.eRep, eBudget: ei.eBudget, slotQueue: false };
    const hAt = (g) => X.bestExitPolicy({ ...base, carriedIncome: { ...base.carriedIncome, gang: [{ atH: 0, perSec: g }] } }).best?.hours;
    const h10 = hAt(1e7);
    const h400 = hAt(4e8);
    c.examined(2);
    c.note(`pre-queue: $10m/s ${h10?.toFixed(3)}h, $400m/s ${h400?.toFixed(3)}h (0209b85 published 9.627h / 9.698h)`);
    if (!(Math.abs(h10 - 9.627) < 0.001 && Math.abs(h400 - 9.698) < 0.001)) c.fail("the replay switch must reproduce 0209b85's numbers", `${h10} / ${h400}`);
    out.push(c);
  }
  return out;
}
