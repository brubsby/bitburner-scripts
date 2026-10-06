// [GC] The Go cheat channel: crime_success (Slum Snakes' bonus) priced by the
// cheat-on farm's measured rate gain (goplan CHEAT_GAIN, chooseOpponent o.cheat).
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
  const c1 = new Check("GC1", "cheatElasticity follows the measured CHEAT_GAIN table");
  {
    const t = [[1, 1], [2, 1.2], [4, 1.1]];
    c1.examined(4);
    const e = g.cheatElasticity(1.5, t);
    const want = Math.log(1.2) / Math.log(2);
    if (!(Math.abs(e - want) < 1e-9)) c1.fail(`rising segment: ${e}, want ${want}`);
    if (g.cheatElasticity(3, t) !== 0) c1.fail("a falling segment must price 0");
    if (g.cheatElasticity(5, t) !== 0) c1.fail("beyond the table must price 0");
    if (g.cheatElasticity(0.5, t) !== 0) c1.fail("below the table must price 0");
    c1.note(`table elasticity at the live 1.5872: ${g.cheatElasticity(1.5872).toFixed(3)}`);
  }
  const c2 = new Check("GC2", "chooseOpponent prices Slum Snakes through the cheat channel, and only then");
  {
    const base = { weights: { combat: 1, faction_rep: 0.2, hacking_speed: 0.1, hacking_money: 0.1 }, windowH: 10, incumbent: "Tetrads", goPower: 4, sf14: 2 };
    const np = { Tetrads: 20000, SlumSnakes: 0, Daedalus: 20000, Illuminati: 20000, TheBlackHand: 20000, Netburners: 20000 };
    const knee = g.CHEAT_GAIN.reduce((best, [c, m]) => (m > best[1] ? [c, m] : best), [1, 0])[0];
    const low = g.chooseOpponent({ ...base, nodePower: np, cheat: { on: ["Tetrads"], crime: 1.5872, lifeLeftH: 8 } });
    const atKnee = g.chooseOpponent({ ...base, nodePower: np, cheat: { on: ["Tetrads"], crime: knee, lifeLeftH: 8 } });
    const none = g.chooseOpponent({ ...base, nodePower: np });
    c2.examined(3);
    if (low.opponent !== "SlumSnakes") c2.fail(`below the knee with cheats on, Slum Snakes must be chosen at 0 node power: ${low.opponent} (${low.why.slice(0, 200)})`);
    if (atKnee.opponent === "SlumSnakes") c2.fail(`at the knee (${knee}) Slum Snakes buys no cheat rate and must not be chosen`);
    if (!/SlumSnakes \(crime_success/.test(none.why)) c2.fail("with no cheat input Slum Snakes must be skipped by name", none.why.slice(-300));
    c2.note(`low: ${low.why.slice(0, 160)}`);
  }
  return [c1, c2];
}
