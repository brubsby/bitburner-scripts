// [GD] A graft refusal never drops the committed grafts; grafting nothing that
// cannot be priced is the dominated option, not a refusal.
//
// Live BN9 2026-09-29, every RE-DECIDING plan pass (held passes were fine):
// the graft search refused with "the exit could not be priced without
// grafting — nothing to compare against", published key null, and the carry
// (progress.js carriedGraftsOf) read key null as "no grafts". The install
// decision then priced the node without its 28 committed grafts (hacking
// x~14, plan.txt graftMemory) and its incumbent at ~26,000h:
//   13:41Z  install w4 at 219.6h (fixture-bn9-plancpu-1341: exitinputs carry
//           no finalGrafts; plan-grafts 4 steps = the refusal after the
//           baseline)
//   14:51Z  "switch committed -> w4: expected 26581.67h sooner net of a 0.05h
//           switch cost, better in 100% of 24 paired draws"
//           (fixture-bn9-graftdrop-1451)
// The exit swung 55h -> 66h (219h at 13:41) and the install timing flipped on
// a pricing artefact.
//
// Why the baseline was unpriceable: the committed install's batch (the inputs'
// installGains, hacking x1.41) cannot reach hacking 6000 without the grafts —
// the simulator's policy search is degenerate (null; 1.5e35h on the default
// policy). With the 28 grafts the same trajectory is ~53h; the w4 batch
// (hacking x1.69) reaches it without them (62h). So on the committed basis
// 'none' was infinitely bad — and was treated as "cannot decide".
//
//   GD1 THE BASELINE    on the 13:41 and 14:51 inputs, the committed basis
//                       without grafts is unpriceable and with the memory's 28
//                       is finite; chooseGrafts now returns the 28 (none
//                       dominated, withoutH null, unpricedNone), and refuses
//                       only when NOTHING can be priced
//   GD2 THE CARRY       committedGraftsOf: a refused / thrown / key-null
//                       decision keeps the committed set (kept, prev, prevAny,
//                       memory specs, memory names through the candidates); a
//                       decided 'none' carries nothing
//   GD3 THE 14:51 REPLAY the install decision on the live draws: without the
//                       grafts (the bug) it switches committed -> w4 by
//                       >10x the exit and is FLAGGED; with the kept 28 carried
//                       the incumbent is priced ~53h and there is no artefact
//   GD4 THE CHECKS      graftCarryCheckOf: GRAFTS DROPPED on the live 14:51
//                       record, ok with the set carried, 'none' expects
//                       nothing; switchSanityOf never changes a choice;
//                       planCheck fails loudly on both
//   GD5 WIRING          progress.js: the carry and the refusal path go through
//                       committedGraftsOf, the plan record publishes graftCarry

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const P = await import("../../plan.js");
const GP = await import("../../graftplan.js");

const F13 = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-plancpu-1341.json"), "utf8"));
const F14 = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-graftdrop-1451.json"), "utf8"));
const FC = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-grafts-1026.json"), "utf8"));
// The node's 28 committed grafts as the 14:16 pass carried them (specs and start balance).
const G28 = F13.exitinputs1416.finalGrafts;
const GS28 = F13.exitinputs1416.graftStartMoney;
const MEM = F14.graftMemory.names;
const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const noGrafts = (x) => {
  const b = { ...x };
  delete b.finalGrafts;
  delete b.graftStartMoney;
  return b;
};
const I13 = noGrafts({ ...F13.exitinputs, cadenceFrom: F13.exitinputs.cadenceFrom ?? "purchase model" });
const I14 = noGrafts(F14.exitinputs);
const NOW14 = Date.parse(F14.at);
// The committed install's remaining wait on each pass (13:41: w0.861 held at
// 13:31 -> ~0.69h; 14:51: w1 decided 14:16:45 -> ~0.42h), its batch the inputs'.
const basis13 = { kind: "wait", waitH: 0.69, gains: null };
const basis14 = { kind: "wait", waitH: (F14.committedPrev.installAt - NOW14) / 3.6e6, gains: null };

/** The 14:51 pass's posteriors, rebuilt from its published summary (as planperf does). */
function postOf(ps) {
  const c = ps.cadence;
  return {
    drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s },
    gymSdLn: 0.1,
    cadence: c ? { rate: { mean: Math.log(c.lnPerHour), sd: c.rateSdLn }, life: { mean: Math.log(c.cycleHours), sd: c.lifeSdLn }, own: { weight: c.ownWeight } } : null,
    expPost: ps.exp ? { perSec: ps.exp.perSec, sd: ps.exp.sdLn } : null,
    income: ps.income ? { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } : null,
  };
}

export async function run() {
  const checks = [];

  {
    const c = new Check("GD1", "THE BASELINE: grafting nothing unpriceable on the committed basis (13:41, 14:51) is the dominated option — the search returns the node's 28, and refuses only when nothing is priced");
    c.examined(6);
    for (const [name, I, basis] of [["13:41", I13, basis13], ["14:51", I14, basis14]]) {
      const t = P.trajectoryOf(basis);
      const none = t(I);
      const with28 = t({ ...I, finalGrafts: G28, graftStartMoney: GS28 });
      c.note(`${name}: committed basis (wait ${basis.waitH.toFixed(2)}h, the inputs' batch) — none ${none}, with the 28 ${with28?.toFixed?.(1)}h`);
      if (none !== null && Number.isFinite(none) && none < 1e4) c.fail(`${name}: the no-graft baseline must be unpriceable on the committed basis (that is the trigger): ${none}`);
      if (!(Number.isFinite(with28) && with28 < 150)) c.fail(`${name}: the 28 must price finite on the same basis: ${with28}`);
      const r = GP.chooseGrafts({ candidates: FC.candidates, priceExit: (x) => t(x), base: I, intelligence: FC.intelligence, ownedNames: FC.owned, seeds: [MEM], budgetMs: 0, now: () => 1 });
      c.note(`${name}: chooseGrafts -> ${r.grafts ? `${r.grafts.length} grafts, withH ${r.withH?.toFixed(1)}h, withoutH ${r.withoutH}, unpricedNone ${r.unpricedNone}` : `REFUSED: ${r.why}`}`);
      if (!r.grafts) c.fail(`${name}: an unpriceable 'none' must not be a refusal: ${r.why}`);
      else {
        // The seed is the START: every seeded name is in the result, or the
        // prune dropped it because the exit was shorter without it (graftplan
        // prune, r.pruned) — never lost to the search.
        const got = new Set(r.grafts.map((g) => g.name));
        const lost = MEM.filter((n) => !got.has(n) && !(r.pruned ?? []).includes(n));
        if (r.seededFrom !== 0 || lost.length) c.fail(`${name}: the seeded 28 must be the start (seededFrom ${r.seededFrom}; lost without a prune: ${lost.join(", ") || "none"})`);
        if ((r.pruned ?? []).length) c.note(`${name}: pruned ${r.pruned.join(", ")}`);
        if (r.withoutH !== null || r.unpricedNone !== true) c.fail(`${name}: grafting nothing must be published unpriced (withoutH null, unpricedNone): ${r.withoutH} ${r.unpricedNone}`);
        if (!(Number.isFinite(r.withH) && r.withH < 150)) c.fail(`${name}: withH must be the 28's finite exit: ${r.withH}`);
        if (JSON.stringify(r).includes("Infinity") || !/unpriceable/.test(r.why)) c.fail(`${name}: the record must carry no Infinity and say 'unpriceable': ${r.why}`);
      }
    }
    // Infinity (a number past any horizon) is the same as null.
    const rInf = GP.chooseGrafts({ candidates: FC.candidates, priceExit: (x) => (x.finalGrafts?.length ? 100 - x.finalGrafts.length : Infinity), base: I14, intelligence: FC.intelligence, ownedNames: FC.owned, seeds: [MEM.slice(0, 3)], budgetMs: 0, now: () => 1 });
    if (!rInf.grafts?.length) c.fail(`an Infinity baseline must be dominated, not refused: ${rInf.why}`);
    // A real refusal: nothing priced with or without.
    const rNo = GP.chooseGrafts({ candidates: FC.candidates, priceExit: () => null, base: I14, intelligence: FC.intelligence, ownedNames: FC.owned, seeds: [MEM], budgetMs: 1e9, now: () => 1 });
    c.note(`nothing priceable at all -> ${rNo.grafts === null ? `refused: ${rNo.why}` : "not refused"}`);
    if (rNo.grafts !== null) c.fail("with nothing priceable (with or without) the search must refuse");
    // A priceable baseline still decides 'none' when nothing beats it.
    const rNone = GP.chooseGrafts({ candidates: FC.candidates, priceExit: (x) => (x.finalGrafts?.length ? 200 : 100), base: I14, intelligence: FC.intelligence, ownedNames: FC.owned, seeds: [MEM], budgetMs: 1e9, now: () => 1 });
    if (!(Array.isArray(rNone.grafts) && rNone.grafts.length === 0 && rNone.withoutH === 100)) c.fail(`a priced baseline no graft beats must still be 'none': ${JSON.stringify({ g: rNone.grafts?.length, w: rNone.withoutH })}`);
    checks.push(c);
  }

  {
    const c = new Check("GD2", "THE CARRY: a refused / thrown / key-null graft decision keeps the committed set; only a decided 'none' carries nothing");
    const refused = F14.grafts; // the live 14:51 record: key null, the memory beside it
    const committed = { key: "grafts", grafts: G28, startMoney: GS28 };
    const names = (r) => (r?.grafts ?? []).map((g) => g.name);
    const cases = [
      ["live 14:51 (refused, memory names only, candidates)", { cur: refused, prev: refused, prevAny: refused, memory: refused.memory, candidates: FC.candidates, intelligence: FC.intelligence }, 28],
      ["live 14:51 at pass start (no candidates yet)", { cur: null, prev: refused, prevAny: refused, memory: refused.memory }, null],
      ["refused this pass, committed last pass", { cur: refused, prev: committed, prevAny: committed, memory: refused.memory }, 28],
      ["refused this pass, committed in an earlier life", { cur: refused, prev: null, prevAny: committed }, 28],
      ["a throw (key null, error)", { cur: { key: null, error: true, why: "grafts decision threw" }, prev: committed }, 28],
      ["key null with the priced set kept", { cur: { key: null, kept: { grafts: G28.slice(0, 5), startMoney: 1 } }, prev: committed }, 5],
      ["memory with specs", { cur: refused, memory: { names: MEM, grafts: G28, startMoney: GS28 } }, 28],
      ["decided 'none' this pass", { cur: { key: "none", grafts: [] }, prev: committed, memory: { names: MEM, grafts: G28 } }, 0],
      ["decided 'grafts' this pass", { cur: { key: "grafts", grafts: G28.slice(0, 7), startMoney: 0 }, prev: committed }, 7],
      ["installed names dropped", { cur: committed, installed: new Set(MEM.slice(0, 4)) }, 24],
    ];
    c.examined(cases.length);
    for (const [what, o, want] of cases) {
      const r = GP.committedGraftsOf(o);
      const got = r ? names(r).length : null;
      c.note(`${what}: ${got === null ? "nothing" : `${got} (${r.from})`}`);
      if (got !== want) c.fail(`${what}: carried ${got}, expected ${want}`);
    }
    const r = GP.committedGraftsOf({ cur: refused, memory: refused.memory, candidates: FC.candidates, intelligence: FC.intelligence });
    if (r && names(r).join() !== MEM.join()) c.fail("the memory's names must be walked in order");
    checks.push(c);
  }

  {
    const c = new Check("GD3", "THE 14:51 REPLAY: without the grafts the install decision switches committed -> w4 by >10x the exit and is flagged; with the kept 28 carried the incumbent is ~53h and no artefact");
    const post = postOf(F14.posteriors);
    const draws = P.makeDraws(post, P.PLAN.N, P.seedOf(F14.lastAugReset, 9));
    const g4 = F14.install.gains;
    const prev = { key: "w1", installAt: F14.committedPrev.installAt, gains: I14.installGains, spec: { kind: "wait", installAt: F14.committedPrev.installAt, waitH: 1, gains: I14.installGains }, decidedAt: F14.committedPrev.decidedAt, why: "fixture", meanH: F14.committedPrev.meanH, commitment: { key: "w0.499", meanH: F14.committedPrev.meanH, at: "2026-09-29T14:46:46.331Z" } };
    const decideOn = (inputs) => {
      const H = (spec) => P.trajectoryOf(spec)(inputs);
      const point = { waits: [{ waitH: 4, hours: H({ kind: "wait", waitH: 4, gains: g4 }), installGains: g4 }], committedGains: I14.installGains };
      return P.decideInstall({ inputs, point, prev, draws, redecide: true, now: NOW14, sameLife: true });
    };
    const bug = decideOn(I14);
    const kept = GP.committedGraftsOf({ cur: F14.grafts, prev: F14.grafts, prevAny: F14.grafts, memory: F14.graftMemory, candidates: FC.candidates, intelligence: FC.intelligence });
    const fixedIn = { ...I14, finalGrafts: kept.grafts, graftStartMoney: GS28 };
    const fixed = decideOn(fixedIn);
    const opt = (d, k) => d.options?.find((o) => o.key === k);
    c.examined(2);
    c.note(`live 14:51: ${F14.install.why} (w4 ${F14.install.meanH}h; committed ${opt(F14.install, "committed")?.meanH}h)`);
    c.note(`replay without the grafts: ${bug.key} — ${bug.why}`);
    c.note(`replay with the kept ${kept.grafts.length} carried: ${fixed.key} ${fixed.meanH}h — ${fixed.why} (committed ${opt(fixed, "committed")?.meanH}h, w4 ${opt(fixed, "w4")?.meanH}h)`);
    // Live the re-planned committed batch left the incumbent feasible in 83% of
    // draws at ~26,648h (a >10x gain); on the inputs' batch replayed here it is
    // infeasible outright. Either way the switch is the artefact, and flagged.
    // Live, w4 reached the exit without the grafts only because these inputs'
    // 0.5h lives compounded the batch lift every half hour (exitplan
    // liftShare, 2026-09-29 19:32Z): priced now, no option is feasible without
    // the grafts and nothing is switched to. Either way a switch made without
    // the grafts must be flagged, never taken silently.
    if (bug.switched && (bug.switchSanity?.ok !== false || !/^SWITCH ARTEFACT/.test(bug.why))) c.fail(`a switch without the grafts must be flagged as a pricing artefact: ${bug.key} ${JSON.stringify(bug.switchSanity)}`);
    if (!bug.switched && bug.key !== null) c.fail(`without the grafts the replay must not hold a priced incumbent: ${bug.key} ${bug.why}`);
    const art = P.switchSanityOf({ from: "committed", to: "w4", gainH: 26581.67, exitH: 66.236, fromH: 26647.957, prevH: F14.committedPrev.meanH });
    if (art?.ok !== false) c.fail("the live 14:51 switch must read as a SWITCH ARTEFACT");
    if (fixed.switchSanity) c.fail(`with the grafts carried there must be no artefact: ${fixed.switchSanity.why}`);
    const cm = opt(fixed, "committed")?.meanH;
    if (!(Number.isFinite(cm) && cm < 80)) c.fail(`with the grafts carried the incumbent must price near the 28's ~53h: ${cm}`);
    if (fixed.switched && fixed.gainH > 10 * fixed.meanH) c.fail("with the grafts carried no 10x switch may happen");
    checks.push(c);
  }

  {
    const c = new Check("GD4", "THE CHECKS: GRAFTS DROPPED on the live 14:51 record; switchSanityOf flags, never changes a choice; planCheck fails loudly on both");
    const inst = { key: F14.install.key, meanH: F14.install.meanH };
    const dropped = P.graftCarryCheckOf({ install: inst, installInputs: I14, grafts: F14.grafts, memory: F14.graftMemory });
    const carried = P.graftCarryCheckOf({ install: inst, installInputs: { ...I14, finalGrafts: G28 }, grafts: F14.grafts, memory: F14.graftMemory });
    const noneDecided = P.graftCarryCheckOf({ install: inst, installInputs: I14, grafts: { key: "none", grafts: [] }, memory: F14.graftMemory });
    const committedDropped = P.graftCarryCheckOf({ install: inst, installInputs: { ...I14, finalGrafts: G28.slice(0, 12) }, grafts: { key: "grafts", grafts: G28 }, memory: F14.graftMemory });
    const flipped = P.graftCarryCheckOf({ install: inst, installInputs: { ...I14, finalGrafts: G28 }, grafts: { key: "none", grafts: [], flippedOnRebase: "grafts -> none" } });
    const installed = P.graftCarryCheckOf({ install: inst, installInputs: { ...I14, finalGrafts: G28.slice(3) }, grafts: F14.grafts, memory: F14.graftMemory, installed: MEM.slice(0, 3) });
    c.examined(6);
    c.note(`live 14:51: ${dropped.why}`);
    c.note(`carried: ${carried.why}; none decided: ${noneDecided.why}; flipped: ${flipped.why}`);
    if (dropped.ok !== false || !/^GRAFTS DROPPED/.test(dropped.why) || dropped.expected !== 28 || dropped.carried !== 0) c.fail(`the live 14:51 record must read GRAFTS DROPPED 28 -> 0: ${JSON.stringify(dropped)}`);
    if (carried.ok !== true) c.fail(`the 28 carried must be ok: ${carried.why}`);
    if (noneDecided.ok !== true) c.fail(`a decided 'none' expects no grafts: ${noneDecided.why}`);
    if (committedDropped.ok !== false || committedDropped.missing.length !== 16) c.fail(`a partial carry must fail naming 16 missing: ${committedDropped.why}`);
    if (flipped.ok !== null) c.fail(`a flip on rebase is a note, not a failure: ${flipped.why}`);
    if (installed.ok !== true) c.fail(`installed grafts are dropped from both sides: ${installed.why}`);

    // Switch sanity: flags the live switch, not a legitimate one, and never changes the choice.
    const s1 = P.switchSanityOf({ from: "committed", to: "w4", gainH: F14.install.gainH, exitH: F14.install.meanH });
    const s2 = P.switchSanityOf({ from: "w1", to: "w4", gainH: 5, exitH: 60 });
    if (s1?.ok !== false) c.fail("the live 26581.67h switch onto 66.2h must be flagged");
    if (s2 !== null) c.fail("a 5h switch on a 60h exit must not be flagged");
    const samples = { a: Array(24).fill(5000), b: Array(24).fill(50) };
    const d = P.decide({ samples, committed: "a" });
    if (d.choice !== "b" || !d.switched || d.switchSanity?.ok !== false) c.fail(`a flagged switch must still be taken: ${d.choice} ${d.why}`);
    // decideAmong carries it on held passes of the same decision.
    const held = P.decideAmong({ options: [{ key: "b", sim: () => 50 }, { key: "a", sim: () => 5000 }], prev: { key: "b", decidedAt: "x", why: d.why, switchSanity: d.switchSanity }, draws: [{ i: 0 }, { i: 1 }], redecide: false });
    if (held.switchSanity?.ok !== false) c.fail("a held pass of a flagged decision must keep the flag");

    // planCheck on the live record, as the healthcheck reads it.
    const planRec = { at: new Date().toISOString(), lastAugReset: F14.lastAugReset, health: "ok", decisions: { install: { ...F14.install, switchSanity: s1 }, grafts: F14.grafts }, graftCarry: dropped };
    const pc = P.planCheck(planRec, { now: Date.now() });
    const whats = pc.fails.map((f) => f.what);
    c.note(`planCheck: ${whats.map((w) => w.slice(0, 90)).join(" | ")}`);
    if (!whats.some((w) => /^GRAFTS DROPPED/.test(w))) c.fail("planCheck must fail GRAFTS DROPPED");
    if (!whats.some((w) => /^SWITCH ARTEFACT/.test(w))) c.fail("planCheck must fail SWITCH ARTEFACT");
    const ok = P.planCheck({ ...planRec, decisions: { install: F14.install, grafts: F14.grafts }, graftCarry: carried }, { now: Date.now() });
    if (ok.fails.some((f) => /GRAFTS DROPPED|SWITCH ARTEFACT/.test(f.what))) c.fail("a carried set and an unflagged switch must not fail");
    checks.push(c);
  }

  {
    const c = new Check("GD5", "WIRING: progress.js carries and keeps grafts through committedGraftsOf, and publishes graftCarry on the plan record");
    const p = code("progress.js");
    c.examined(5);
    if (!/function carriedGraftsOf[\s\S]{0,400}committedGraftsOf\(/.test(p)) c.fail("carriedGraftsOf must go through committedGraftsOf (a refusal keeps the committed set)");
    if (!/if \(!r\.grafts\) \{[\s\S]{0,300}committedGraftsOf\(/.test(p)) c.fail("a refused search must keep the committed set / memory (committedGraftsOf)");
    if (!/if \(!kept\?\.grafts\?\.length\) return \{ key: null/.test(p) || !/specs = kept\.grafts\n/.test(p)) c.fail("a refused search returns key null ONLY with nothing kept, and otherwise prices the kept set");
    if (/if \(!r\.grafts\) return \{ key: null/.test(p)) c.fail("a refused search must not return key null while a set is kept");
    if (!/graftCarryCheckOf\(\{ install: pcx\.decisions\.install/.test(p)) c.fail("the pass must check the install decision's inputs against the graft set");
    if (!/graftCarry: pc\.graftCarryCheck \?\? null/.test(p)) c.fail("the plan record must publish graftCarry");
    checks.push(c);
  }
  return checks;
}
