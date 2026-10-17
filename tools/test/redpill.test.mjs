// [RP] The Red Pill's timing and the hidden IPvGO opponent's bonus in the exit.
//
// THE MECHANIC (asserted against the game source in RP1):
//   Go/Enums.ts:9                          GoOpponent.w0r1d_d43m0n = "????????????"
//   Go/effects/netscriptGoImplementation.ts:359  resetBoardState refuses it unless
//       hasAugmentation(TheRedPill, true): INSTALLED, not queued
//   Go/effects/effect.ts:95-96             its bonus multiplies mults.hacking (the skill)
//   Go/Constants.ts:62-68                  bonusPower 2, komi 9.5
//   Go/Go.ts:34-47                         prestigeAugmentation zeroes nodePower at EVERY
//                                          install: the bonus regrows from 0 each life
//   Augmentation/Augmentations.ts:1953-1959  The Red Pill: 2.5m rep, moneyCost 0, Daedalus
//   Server/ServerHelpers.ts:342            w0r1d_d43m0n exists only with it installed
//
//   RP1 THE GAME      the lines above, in source
//   RP2 THE CHOICE    exitplan prices The Red Pill m lives early (redPillEarly) as its own
//                     trajectory on the SAME inputs; redPillEarlyMax is exactly the min of
//                     the explicit runs and says which; on BN10.3-shaped inputs (the
//                     Covenant's $1e17, Daedalus's hacking 2500) the terminal install wins,
//                     and with the join level left out the early one hides the Covenant's
//                     hoard behind the farmed climb and wins — the option is in the pricing
//   RP3 THE BONUS     the hidden opponent's farm on the climb (o.go.w0) shortens the exit,
//                     after the terminal install and from an early Red Pill's window alike
//   RP4 HELD          The Red Pill installed (redPillInstalled): no join, no reputation, no
//                     terminal install — the climb from this life's exp, the bonus banked
//                     this life (W0) shortening it; priced as before, it climbed from exp 0
//   RP5 THE LIFE ARM  goLifePlansOf's w0 arm lifts a life's level (mults.hacking x effect),
//                     and the lives after an early Red Pill carry it (go.life.postRedPill)
//   RP6 THE INPUTS    goplan.goExitInputsOf feeds the record's own games/h and the bonus
//                     banked this life; go.js publishes the games/h; progress.js the flag

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";
import { GAME } from "./build-ram.mjs";
import "./gameresolve.mjs";

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const game = (rel) => fs.readFileSync(path.join(GAME, rel), "utf8");

// BN10.3's fresh entry (hackexit.freshInputs at the SFs on entry 2026-10-17, g 0.0398 —
// the g at which the terminal plan prices the gameplan's ~62h), the final window's income
// BN10.1's measured $2.48e12/s, Daedalus's join gates (FactionInfo.tsx:141-145), the
// hidden opponent at the live record (16,974/h, 20.5 games/h, GoPower 1, SF14.3) and
// the 5th Covenant sleeve. Frozen here so the check needs no game bundle.
const BN10_3 = {
  money: 1262, installCash: 1262, incomePerSec: 2.48e12, flatIncomePerSec: 2.48e12,
  hacking: 1, hackingExp: 0, hackingMult: 0.48384, expPerSec: 503258805.50383556,
  cycleHours: 2.6296563352826507, multGainPerCycle: Math.exp(0.0398 * 2.6296563352826507),
  exitLevel: 6000, joinMoney: 100e9, joinLevel: 2500, rejoinLevel: 2500, rejoinMoney: 100e9,
  terminalRep: 5e6, donationCost: 3.90625e12, favorToDonate: 150, exitFavor: 150,
  capitalReturnPerSec: 0.000157, capitalCap: 5.76e12,
  go: { w0: { powerPerH: 16974, gamesPerH: 20.5, bonusPower: 2, goPower: 1, sf14: 3 } },
  covenant: { cost: 1e17, joinMoney: 75e9, combatH: 2.4, member: false, sleeveExpPerSec: 0 },
};

export async function run() {
  const checks = [];
  const X = await import("../../exitplan.js");
  const GP = await import("../../goplan.js");
  const best = (o) => X.bestExitPolicy(o).best;

  /* ------------------------------------------------------------------ RP1 */
  {
    const c = new Check("RP1", "THE GAME: the hidden opponent needs The Red Pill INSTALLED, multiplies the hacking skill at bonusPower 2, and its node power is zeroed at every install");
    const need = [
      ["src/Go/Enums.ts", /w0r1d_d43m0n = "\?{12}"/],
      ["src/Go/effects/netscriptGoImplementation.ts", /opponent === GoOpponent\.w0r1d_d43m0n && !Player\.hasAugmentation\(AugmentationName\.TheRedPill, true\)/],
      ["src/Go/effects/effect.ts", /case GoOpponent\.w0r1d_d43m0n:\s*mults\.hacking \*= effect/],
      ["src/Go/Constants.ts", /\[GoOpponent\.w0r1d_d43m0n\]: \{\s*komi: 9\.5,[\s\S]{0,200}bonusPower: 2/],
      ["src/Go/Go.ts", /prestigeAugmentation\(\)[\s\S]*stats\.nodePower = 0/],
      ["src/Augmentation/Augmentations.ts", /\[AugmentationName\.TheRedPill\]: \{\s*repCost: 2\.5e6,\s*moneyCost: 0,/],
      ["src/Server/ServerHelpers.ts", /hasAugmentation\(AugmentationName\.TheRedPill, true\) \|\| baseServer\.hostname !== SpecialServers\.WorldDaemon/],
    ];
    for (const [f, re] of need) {
      c.examined(1);
      if (!re.test(game(f))) c.fail(`${f}: the mechanic this pricing rests on is not in the source`, String(re));
    }
    checks.push(c);
  }

  /* ------------------------------------------------------------------ RP2 */
  {
    const c = new Check("RP2", "THE CHOICE: The Red Pill m lives early is its own trajectory on the same inputs; redPillEarlyMax is the min of the explicit runs; BN10.3's gates keep the terminal install, and the option wins where it should");
    const at = (o, m) => best({ ...o, redPillEarly: m });
    const t0 = at(BN10_3, 0);
    const t1 = at(BN10_3, 1);
    const t2 = at(BN10_3, 2);
    const s = best({ ...BN10_3, redPillEarlyMax: 2 });
    c.examined(4);
    c.note(`BN10.3 shape: terminal ${t0.hours.toFixed(2)}h (${t0.installsFirst} installs), 1 life early ${t1.hours.toFixed(2)}h (${t1.installsFirst}), 2 early ${t2.hours.toFixed(2)}h; searched ${s.hours.toFixed(2)}h early ${s.redPill?.early}`);
    const mn = Math.min(t0.hours, t1.hours, t2.hours);
    if (Math.abs(s.hours - mn) > 1e-6) c.fail("redPillEarlyMax is not the min of the explicit trajectories", `${s.hours} vs ${mn}`);
    const argmin = [t0, t1, t2].findIndex((r) => Math.abs(r.hours - mn) < 1e-9);
    if (s.redPill?.early !== argmin) c.fail("redPillEarlyMax names the wrong timing", `${s.redPill?.early} vs ${argmin}`);
    if (!Array.isArray(s.redPill?.tried) || s.redPill.tried.length !== 3) c.fail("the search does not publish every timing it priced", JSON.stringify(s.redPill));
    // The verdict at BN10.3's gates: the Daedalus join (hacking 2500) needs a multiplier the
    // hidden opponent cannot help with before The Red Pill — the terminal plan joins inside
    // the Covenant's hoard; an early one pays it in the Red Pill's own life.
    if (!(t0.hours < t1.hours)) c.fail("BN10.3 shape: the early Red Pill no longer loses to the terminal install", `${t1.hours} vs ${t0.hours}`);
    const rpl = t1.legs.find((l) => l.leg === "Red Pill life");
    if (!rpl || !(t1.redPill?.life >= 1) || !/climb to join level/.test(t1.redPill?.legs ?? "")) c.fail("the early trajectory's Red Pill life does not carry the join", JSON.stringify(t1.redPill));
    if (t1.legs.some((l) => l.leg === "exit reputation" || l.leg === "hoard join money")) c.fail("an early Red Pill's final window still joins / buys reputation", t1.legs.map((l) => l.leg).join(", "));
    // ...and where the join is free (the level left out) the early one hides the hoard: the option is priced.
    const free = { ...BN10_3, joinLevel: 0, rejoinLevel: 0 };
    const f0 = at(free, 0);
    const f1 = at(free, 1);
    c.note(`join level unpriced: terminal ${f0.hours.toFixed(2)}h, 1 early ${f1.hours.toFixed(2)}h (the Covenant's 11.2h hoard hidden behind the farmed climb)`);
    if (!(f1.hours < f0.hours - 5)) c.fail("with the join free, the early Red Pill does not hide the Covenant's hoard behind the climb", `${f1.hours} vs ${f0.hours}`);
    checks.push(c);
  }

  /* ------------------------------------------------------------------ RP3 */
  {
    const c = new Check("RP3", "THE BONUS: the hidden opponent's farm shortens the exit after the terminal install and from an early Red Pill's window");
    const noW0 = { ...BN10_3, go: null };
    const a = best({ ...BN10_3, redPillEarly: 0 });
    const b = best({ ...noW0, redPillEarly: 0 });
    const a1 = best({ ...BN10_3, redPillEarly: 1 });
    const b1 = best({ ...noW0, redPillEarly: 1 });
    c.examined(4);
    c.note(`terminal: ${a.hours.toFixed(2)}h with the farm, ${b.hours.toFixed(2)}h without; 1 early: ${a1.hours.toFixed(2)}h / ${b1.hours.toFixed(2)}h`);
    if (!(a.hours < b.hours - 1)) c.fail("the farm on the post-Red-Pill climb no longer shortens the terminal exit", `${a.hours} vs ${b.hours}`);
    if (!(a1.hours < b1.hours - 1)) c.fail("the farm from an early Red Pill's window no longer shortens its exit", `${a1.hours} vs ${b1.hours}`);
    const climb = a.legs.find((l) => l.leg === "climb to exit level");
    if (!/w0r1d_d43m0n farmed from The Red Pill/.test(climb?.detail ?? "")) c.fail("the terminal climb does not name the hidden opponent's farm", climb?.detail);
    checks.push(c);
  }

  /* ------------------------------------------------------------------ RP4 */
  {
    const c = new Check("RP4", "HELD: with The Red Pill installed the hold prices no join, no reputation, no terminal install — the climb from this life's exp, the banked bonus shortening it");
    // A late life: hacking 4000 at mult 4 (exp from skill.ts inverted), the bonus not yet farmed.
    const mult = 4;
    const exp = X.expForLevel(4000, mult);
    const live = { ...BN10_3, covenant: null, money: 2e12, hacking: 4000, hackingExp: exp, hackingMult: mult, incomePerSec: 2.48e12, flatIncomePerSec: 2.48e12, joinMoney: 100e9 };
    const notHeld = X.exitHours({ ...live }, 0);
    const held = X.exitHours({ ...live, redPillInstalled: true }, 0);
    const heldW = X.exitHours({ ...live, redPillInstalled: true, go: { w0: { ...live.go.w0, W0: 2 } } }, 0);
    c.examined(3);
    c.note(`hold: as before ${notHeld.hours.toFixed(3)}h (${notHeld.legs.map((l) => l.leg).join(", ")}); installed ${held.hours.toFixed(3)}h; with x2 banked ${heldW.hours.toFixed(3)}h`);
    if (held.legs.some((l) => /join|reputation/.test(l.leg))) c.fail("an installed Red Pill still joins or buys reputation", held.legs.map((l) => l.leg).join(", "));
    const cl = held.legs.find((l) => l.leg === "climb to exit level");
    if (!/from this life's exp/.test(cl?.detail ?? "")) c.fail("the held climb does not start from this life's exp", cl?.detail);
    // From level 4000 the held climb is shorter than a climb from exp 0 at the same multiplier.
    if (!(held.hours < notHeld.hours)) c.fail("the held exit is not shorter than a fresh climb after one more install", `${held.hours} vs ${notHeld.hours}`);
    if (!(heldW.hours < held.hours)) c.fail("the bonus banked this life does not shorten the held climb", `${heldW.hours} vs ${held.hours}`);
    // A hold already at the level: 0h (the climb is done).
    const done = X.exitHours({ ...live, hacking: 6100, hackingExp: X.expForLevel(6100, mult), redPillInstalled: true }, 0);
    c.examined(1);
    if (!(done.hours < 1e-9)) c.fail("held at the exit level, the exit is not now", `${done.hours}h: ${done.legs.map((l) => `${l.leg} ${l.hours}`).join(", ")}`);
    // ...and it never searches an early Red Pill it already has.
    const s = X.exitHours({ ...live, redPillInstalled: true, redPillEarlyMax: 2 }, 2);
    if (s.redPill) c.fail("an installed Red Pill is searched for an earlier timing", JSON.stringify(s.redPill));
    checks.push(c);
  }

  /* ------------------------------------------------------------------ RP5 */
  {
    const c = new Check("RP5", "THE LIFE ARM: the w0 arm lifts a life's level (mults.hacking x effect) and the lives after an early Red Pill carry it");
    const f = { goPower: 1, sf14: 3, arms: { Illuminati: { powerPerH: 125180, bonusPower: 0.7, channel: "hacking_speed" } }, hackShare: 0.25, ramShare: 0 };
    const ctx = { L: 4, mult: 2, expF: 0, expS: 0, expK: 5e3, fleet: [], flatPerSec: 0, incomeAtLevel1: 1e6 };
    const without = X.goLifePlansOf(f, ctx);
    const withW = X.goLifePlansOf({ ...f, arms: { ...f.arms, [X.W0_ARM]: { powerPerH: 16974, bonusPower: 2, channel: "hacking" } } }, ctx);
    const w0only = withW.find((p) => p.plan === X.W0_ARM);
    c.examined(withW.length);
    c.note(`a 4h life: Illuminati Km ${without[0].Km.toFixed(3)} Kr ${without[0].Kr.toFixed(3)}; w0 alone Km ${w0only?.Km.toFixed(3)} Kr ${w0only?.Kr.toFixed(3)}`);
    if (!w0only || !(w0only.Kr > 1.5) || !(w0only.Km > 1.5)) c.fail("the w0 arm does not lift the life's level (rep and level-scaled income)", JSON.stringify(w0only));
    // The lives after a 2-early Red Pill on a live-shaped fixture carry the arm.
    const fx = JSON.parse(read("tools/test/fixture-bn13-lifelength-2103.json"));
    const ei = fx.exitinputs ?? fx;
    const base = { ...ei.inputs, eRep: ei.eRep ?? ei.inputs.eRep, eBudget: ei.eBudget ?? ei.inputs.eBudget };
    const r = X.exitHours({ ...base, redPillEarly: 2 }, 10);
    const pr = r.go?.life?.postRedPill;
    c.examined(1);
    if (!pr || !(pr.ln > r.go.life.ln)) c.fail("the lives after an early Red Pill do not price the hidden opponent's arm above the others", JSON.stringify(pr ?? null).slice(0, 200));
    else c.note(`BN13 fixture, the life after the Red Pill: ${pr.now.plan} ln ${pr.ln.toFixed(4)} vs ${r.go.life.ln.toFixed(4)}`);
    checks.push(c);
  }

  /* ------------------------------------------------------------------ RP6 */
  {
    const c = new Check("RP6", "THE INPUTS: the record's games/h and the bonus banked this life reach the exit; go.js publishes gph; progress.js the installed flag");
    const tel = { w0: { rate: { pph: 16974, ref: 1, source: "measured, 14 games", gph: 20.8 } }, bonuses: { "????????????": 140.1 } };
    const g = GP.goExitInputsOf({ goPower: 1, sf14: 3, goTel: tel });
    c.examined(2);
    if (Math.abs(g.go.w0.gamesPerH - 20.8) > 1e-9) c.fail("the measured games/h is not the exit's", String(g.go.w0.gamesPerH));
    if (Math.abs(g.go.w0.W0 - 2.401) > 1e-9) c.fail("the bonus banked this life is not the exit's W0", String(g.go.w0.W0));
    const prior = GP.goExitInputsOf({ goPower: 1, sf14: 3, goTel: null });
    if (prior.go.w0.gamesPerH !== GP.W0_GAMES_PER_H || "W0" in prior.go.w0) c.fail("without a record the prior games/h and no W0", JSON.stringify(prior.go.w0));
    const goSrc = read("go.js");
    if (!/gph: t\.games \/ t\.hours/.test(goSrc)) c.fail("go.js does not publish the record's games/h (w0RateOf gph)");
    const pSrc = read("progress.js");
    if (!/redPillInstalled: w0Eligible\(info\)\.eligible === true/.test(pSrc)) c.fail("progress.js does not tell the exit The Red Pill is installed");
    checks.push(c);
  }

  return checks;
}
