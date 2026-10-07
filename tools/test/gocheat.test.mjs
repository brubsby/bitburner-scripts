// [GC] The Go cheat channel: crime_success (Slum Snakes' bonus) priced by the
// cheat-on farm's rate gain (goplan cheatGain, mechanistic; chooseOpponent o.cheat).
//
//   GC1 cheatElasticity: positive on a rising segment of the table, 0 on a
//       falling one and outside it.
//   GC2 chooseOpponent: with cheats on and crime_success below the table's
//       knee, Slum Snakes (no exit weight of its own) is chosen at 0 node
//       power; at/above the knee it is not; with no o.cheat it is skipped BY
//       NAME, never priced as 0 silently.
import { Check } from "./harness.mjs";

export async function run() {
  const g = await import("../../goplan.js");
  const c1 = new Check("GC1", "the mechanistic cheat gain: availability rises with crime and with SF14.3; gain and elasticity are smooth and positive, small past the knee");
  {
    const a1 = g.cheatAvailability(1.5872), a2 = g.cheatAvailability(4), a3 = g.cheatAvailability(1.5872, { sf14: 3 });
    const e = (a) => a.reduce((x, y) => x + y, 0);
    c1.examined(6);
    if (!(e(a2) > e(a1))) c1.fail(`more crime must mean more cheats: ${e(a1).toFixed(2)} -> ${e(a2).toFixed(2)}`);
    if (!(e(a3) > e(a1))) c1.fail("SF14.3's +0.25 must mean more cheats");
    const gs = [1.2, 1.5872, 2.5, 4, 10, 25].map((c) => g.cheatGain(c));
    for (let i = 1; i < gs.length; i++) if (!(gs[i] >= gs[i - 1] - 1e-9)) c1.fail(`gain must not fall with crime: ${gs.map((x) => x.toFixed(3))}`);
    const el = [1.5872, 2.5, 10, 40].map((c) => g.cheatElasticity(c));
    if (!(el[0] > 0 && el[1] > 0 && el[2] > 0)) c1.fail(`elasticity must stay positive past the old table's end: ${el.map((x) => x.toFixed(4))}`);
    if (!(el[0] > el[2])) c1.fail("elasticity must fall as cheats saturate");
    if (g.cheatElasticity(0) !== 0) c1.fail("no crime: elasticity 0");
    c1.note(`gain at 1.2/1.59/2.5/4/10/25: ${gs.map((x) => x.toFixed(3)).join(" ")}; elasticity at 1.59/2.5/10/40: ${el.map((x) => x.toFixed(4)).join(" ")}`);
  }
  const c2 = new Check("GC2", "chooseOpponent prices Slum Snakes through the cheat channel, and only then");
  {
    const base = { weights: { combat: 1, faction_rep: 0.2, hacking_speed: 0.1, hacking_money: 0.1 }, windowH: 10, incumbent: "Tetrads", goPower: 4, sf14: 2 };
    const np = { Tetrads: 20000, SlumSnakes: 0, Daedalus: 20000, Illuminati: 20000, TheBlackHand: 20000, Netburners: 20000 };
    const low = g.chooseOpponent({ ...base, nodePower: np, cheat: { on: ["Tetrads"], crime: 1.5872, lifeLeftH: 8 } });
    // A very short life left: the warm-up cannot pay back.
    const atKnee = g.chooseOpponent({ ...base, nodePower: np, cheat: { on: ["Tetrads"], crime: 1.5872, lifeLeftH: 0.001 } });
    const none = g.chooseOpponent({ ...base, nodePower: np });
    c2.examined(3);
    if (low.opponent !== "SlumSnakes") c2.fail(`below the knee with cheats on, Slum Snakes must be chosen at 0 node power: ${low.opponent} (${low.why.slice(0, 200)})`);
    if (atKnee.opponent === "SlumSnakes") c2.fail("with ~no life left Slum Snakes cannot pay back and must not be chosen (horizon-aware)");
    if (!/SlumSnakes \(crime_success/.test(none.why)) c2.fail("with no cheat input Slum Snakes must be skipped by name", none.why.slice(-300));
    c2.note(`low: ${low.why.slice(0, 160)}`);
  }
  const c3 = new Check("GC3", "with arms (Thompson), the cheat channel prices Slum Snakes on 5x5 only — never a bigger board");
  {
    const base = { weights: { combat: 1, faction_rep: 0.2, hacking_speed: 0.1, hacking_money: 0.1 }, windowH: 10, incumbent: "Tetrads", goPower: 4, sf14: 2 };
    const np = { Tetrads: 20000, SlumSnakes: 0, Daedalus: 20000, Illuminati: 20000, TheBlackHand: 20000, Netburners: 20000 };
    // SlumSnakes@9 drawn wildly optimistic (a thin posterior): it must still get no cheat value.
    const arms = { "Tetrads@5": { pph: 24000, p: 0.99 }, "SlumSnakes@5": { pph: 20000, p: 0.98 }, "SlumSnakes@9": { pph: 400000, p: 0.99 }, "SlumSnakes@7": { pph: 300000, p: 0.99 } };
    const r = g.chooseOpponent({ ...base, nodePower: np, arms, incumbentArm: "Tetrads@5", cheat: { on: ["Tetrads"], crime: 1.5872, lifeLeftH: 8 } });
    c3.examined(2);
    if (r.arm !== "SlumSnakes@5") c3.fail(`the cheat channel must pick SlumSnakes@5, got ${r.arm}`, r.why.slice(0, 300));
    if (!/SlumSnakes@9 \(crime_success: the cheat channel is priced on 5x5 only\)/.test(r.why)) c3.fail("SlumSnakes@9 must be skipped by name", r.why.slice(-400));
  }
  const c4 = new Check("GC4", "the cheat horizon: a forecast's REMAINING hours are not reduced by the life's age (live shape: life started 14:43Z, exit 11.82h away, no install)");
  {
    const lastAugReset = Date.parse("2026-10-06T14:43:00Z");
    const now = Date.parse("2026-10-07T01:01:00Z"); // 10.3h into the life
    const blade = g.weightsFor({ lastAugReset, objective: { goWeights: { weights: { combat: 1 }, windowH: 11.82, remainingH: 11.82, asOf: now } } }, lastAugReset, {});
    const l1 = g.lifeLeftHOf(blade, { now, lastAugReset });
    const later = g.lifeLeftHOf(blade, { now: now + 1.5 * 3.6e6, lastAugReset });
    const full = g.lifeLeftHOf({ source: "goWeights", windowH: 14, remainingH: null }, { now, lastAugReset });
    const early = g.lifeLeftHOf({ source: "early", windowH: 8 }, { now, lastAugReset });
    c4.examined(4);
    if (!(Math.abs(l1.h - 11.82) < 1e-6)) c4.fail(`a fresh blade forecast of 11.82h left must read 11.82h, got ${l1.h} (${l1.source})`);
    if (!(Math.abs(later.h - 10.32) < 1e-6)) c4.fail(`1.5h after the pass it must read 10.32h, got ${later.h}`);
    if (!(Math.abs(full.h - 3.7) < 1e-6)) c4.fail(`a FULL 14h window 10.3h into the life leaves 3.7h, got ${full.h}`);
    if (!(early.h === 0.25 && /ASSUMED/.test(early.source))) c4.fail(`the early placeholder window must be named ASSUMED and floored: ${JSON.stringify(early)}`);
    c4.note(`${l1.h.toFixed(2)}h (${l1.source}); full window: ${full.h.toFixed(2)}h; early: ${early.h}h (${early.source})`);
  }
  return [c1, c2, c3, c4];
}
