// [GF] The favor an IPvGO win streak gives a faction — priced on the exit, in
// the opponent choice, and against the donation threshold.
//
// THE MECHANIC (each line asserted against the game source in GF1):
//   Go/boardAnalysis/scoring.ts:66-78  a win that leaves the streak EVEN, for a
//       MEMBER of the opponent's faction, while the opponent's node total
//       stats.rep < getMaxRep(): setFavor(addRepToFavor(favor, getMaxRep()/200)),
//       stats.rep += getMaxRep()/200 — favor on the spot, no install.
//   Go/effects/effect.ts:30-43  getMaxRep() = 100k, or 200k/300k/400k at
//       activeSourceFileLvl(14) 1/2/3 — the level HELD, so BN14.3 is played at
//       300k and only nodes after it at 400k.
//   Go/Go.ts:25-47  prestigeAugmentation clears every stat EXCEPT rep;
//       prestigeSourceFile clears all — the cap is once per NODE per opponent,
//       never refilled by an install.
//   Faction.ts:68-79  favor survives installs, reset at the node's end.
//   FactionRoot.tsx:104 / donation.ts:16-18  donating reads faction.favor >=
//       150 x FavorToDonateToFaction: Go favor counts exactly as banked favor.
//   favor.ts  addRepToFavor adds in rep space, so order does not matter: the
//       stream alone reaches repToFavor(cap) = 81.3/111.0/129.5/143.1 < 150.
//
//   GF1 THE GAME     the lines above, in source
//   GF2 THE CROSSING crossGoFavorH: the stream's hours to the threshold, the
//                    favor it needs banked first, null past the cap
//   GF3 THE EXIT     exitplan prices the crossing as a TRAJECTORY beside the
//                    grind: the default is exactly the sooner of repRoute
//                    'cross' and 'ground'; a cheap donation crosses, a cap that
//                    cannot reach 150 is not offered; the crossing never makes
//                    the exit later than the grind with the same stream
//   GF4 THE PRICE    goweights favor: final window = stream vs none, earlier
//                    life = banked now vs the plan's stream; zero for a
//                    non-member or a spent cap, refused when membership unread
//   GF5 THE CHOICE   chooseOpponent: the favor term flips the arm to the exit
//                    faction while its cap is left, never past it, and goMaxRepOf
//                    is getMaxRep; go.js/progress.js wire it
//   GF6 LIVE         the live save's Go favor (.telemetry): a capped opponent's
//                    rep is getMaxRep at the save's SF14 and its faction's favor
//                    is repToFavor of it (skipped, said so, with no telemetry)

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";
import { GAME } from "./build-ram.mjs";
import "./gameresolve.mjs";

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const game = (rel) => fs.readFileSync(path.join(GAME, rel), "utf8");

export async function run() {
  const checks = [];
  const FV = await import("../../favor.js");
  const X = await import("../../exitplan.js");
  const GP = await import("../../goplan.js");
  const { goWeights } = await import("../../goweights.js");
  const { goMaxRep } = await import("../sim/gameplan/go.mjs");

  /* ------------------------------------------------------------------ GF1 */
  {
    const c = new Check("GF1", "THE GAME: Go favor on an even win for a member under a per-node cap, given at once; the cap by SF14 held; kept through installs, cleared at the node's end; donations read faction.favor");
    const need = [
      ["src/Go/boardAnalysis/scoring.ts", /statusToUpdate\.winStreak % 2 === 0 &&\s*Player\.factions\.includes\(factionName\) &&\s*statusToUpdate\.rep < getMaxRep\(\)/, "award: even streak, member, under the cap"],
      ["src/Go/boardAnalysis/scoring.ts", /Factions\[factionName\]\.setFavor\(newFavor\);\s*statusToUpdate\.rep \+= repToAdd;/, "the favor is set on the spot (no install)"],
      ["src/Go/effects/effect.ts", /activeSourceFileLvl\(14\)[\s\S]*?=== 1\) \{\s*return 200_000;[\s\S]*?=== 2\) \{\s*return 300_000;[\s\S]*?>= 3\) \{\s*return 400_000;[\s\S]*?return 100_000;/, "getMaxRep 200k/300k/400k at SF14 1/2/3, else 100k"],
      ["src/PersonObjects/Player/PlayerObjectGeneralMethods.ts", /export function activeSourceFileLvl[\s\S]*?return this\.sourceFiles\.get\(n\) \?\? 0;/, "activeSourceFileLvl: the level held (the node being played adds nothing)"],
      ["src/Go/Go.ts", /Clear out stats except for reputation[\s\S]*?stats\.highestWinStreak = 0;/, "an install keeps stats.rep"],
      ["src/Go/Go.ts", /prestigeSourceFile\(\) \{[\s\S]*?this\.stats = \{\};/, "the node's end clears it"],
      ["src/Faction/Faction.ts", /prestigeSourceFile\(\) \{\s*\/\/ Reset favor[\s\S]*?this\.setFavor\(0\);/, "favor resets at the node's end"],
      ["src/Faction/ui/FactionRoot.tsx", /const canDonate = faction\.favor >= favorToDonate;/, "donating reads faction.favor"],
      ["src/Faction/formulas/favor.ts", /return repToFavor\(favorToRep\(favor\) \+ playerReputation\);/, "addRepToFavor adds in rep space"],
    ];
    for (const [f, re, what] of need) if (!re.test(game(f))) c.fail(`${what}: not found in ${f}`);
    for (const l of [0, 1, 2, 3]) if (GP.goMaxRepOf(l) !== goMaxRep(l)) c.fail(`goMaxRepOf(${l}) ${GP.goMaxRepOf(l)} vs go.mjs ${goMaxRep(l)}`);
    c.examined(need.length + 4);
    c.note(`the stream alone reaches favor ${[0, 1, 2, 3].map((l) => FV.repToFavor(GP.goMaxRepOf(l)).toFixed(1)).join(" / ")} at SF14 0/1/2/3 (donations need 150)`);
    checks.push(c);
  }

  /* ------------------------------------------------------------------ GF2 */
  {
    const c = new Check("GF2", "THE CROSSING: hours of stream to the threshold in rep space, the favor it needs banked first, null when the cap cannot carry it");
    const need = [0, 1, 2, 3].map((l) => FV.repToFavor(Math.max(0, FV.favorToRep(150) - GP.goMaxRepOf(l))));
    const want = [138.4, 123.3, 101.7, 63.3];
    need.forEach((f, i) => { if (Math.abs(f - want[i]) > 0.05) c.fail(`SF14.${i}: favor needed before the stream ${f.toFixed(2)} vs ${want[i]}`); });
    for (const l of [1, 2, 3]) {
      const cap = GP.goMaxRepOf(l);
      const at = FV.crossGoFavorH(need[l] + 0.01, 150, 1e5, cap);
      if (!(at > 0 && at <= cap / 1e5 + 1e-9)) c.fail(`SF14.${l}: just above the bar the stream crosses inside its cap (${at})`);
      if (FV.crossGoFavorH(need[l] - 0.5, 150, 1e5, cap) !== null) c.fail(`SF14.${l}: below the bar the cap cannot carry it — null`);
    }
    const h = FV.crossGoFavorH(124, 150, 159071, 200e3);
    const exact = (FV.favorToRep(150) - FV.favorToRep(124)) / 159071;
    if (!(Math.abs(h - exact) < 1e-12)) c.fail(`124 -> 150 at 159071/h: ${h} vs ${exact}`);
    if (FV.crossGoFavorH(150, 150, 1, 0) !== 0) c.fail("already at the bar: 0");
    if (FV.crossGoFavorH(100, 150, 0, 1e6) !== null) c.fail("no stream: null");
    c.examined(10);
    c.note(`favor banked before the stream for it to cross 150: ${need.map((f) => f.toFixed(1)).join(" / ")} at SF14 0/1/2/3; 124 -> 150 at the measured farm's SF14.1 rate: ${(h * 60).toFixed(0)} min`);
    checks.push(c);
  }

  /* ------------------------------------------------------------------ GF3 */
  {
    const c = new Check("GF3", "THE EXIT: the crossing is a trajectory beside the grind — the default is the sooner of 'cross' and 'ground'; offered only when the cap reaches the bar");
    const b = { money: 1e12, incomePerSec: 1e9, hacking: 3000, hackingExp: 1e12, hackingMult: 5, expPerSec: 1e7, repPerSec: 20, exitRep: 0, terminalRep: 2.5e6, exitLevel: 3000, joinMoney: 100e9, favorToDonate: 150 };
    const stream = { repPerH: 159071, capRep: 200e3 };
    const leg = (r) => r.legs?.find((l) => l.leg === "exit reputation");
    let n = 0;
    for (const don of [1e12, 1e14, 1e16]) {
      const o = { ...b, exitFavor: 124, favorStream: stream, donationCost: don };
      const d = X.exitHours(o);
      const cr = X.exitHours({ ...o, repRoute: "cross" });
      const gr = X.exitHours({ ...o, repRoute: "ground" });
      n++;
      if (!(Math.abs(d.hours - Math.min(cr.hours, gr.hours)) < 1e-9)) c.fail(`$${don}: the default ${d.hours} must be the sooner of cross ${cr.hours} and ground ${gr.hours}`);
      if (!(d.hours <= gr.hours + 1e-9)) c.fail(`$${don}: the crossing must never make the exit later than the grind with the same stream`);
      if (!/crossed 150/.test(leg(cr)?.detail ?? "")) c.fail(`$${don}: repRoute 'cross' must donate after the crossing: ${leg(cr)?.detail}`);
      const tc = FV.crossGoFavorH(124, 150, stream.repPerH, stream.capRep);
      if (!(leg(cr)?.hours >= tc - 1e-9)) c.fail(`$${don}: the donation cannot land before the crossing (${leg(cr)?.hours} < ${tc})`);
    }
    // A cheap donation crosses; the pre-fix pricing (no crossing) is the grind.
    const cheap = { ...b, exitFavor: 124, favorStream: stream, donationCost: 1e12 };
    const withX = X.exitHours(cheap);
    const noX = X.exitHours({ ...cheap, repRoute: "ground" });
    const noGo = X.exitHours({ ...b, exitFavor: 124, donationCost: 1e12 });
    if (!/crossed 150/.test(leg(withX)?.detail ?? "")) c.fail(`a $1e12 donation must win once the stream crosses: ${leg(withX)?.detail}`);
    if (!(withX.hours < noX.hours - 1)) c.fail(`the crossing must save hours over the grind here: ${withX.hours} vs ${noX.hours}`);
    if (!(noX.hours < noGo.hours)) c.fail(`the stream must shorten the grind: ${noX.hours} vs ${noGo.hours}`);
    // Below the bar for the cap (123.3 at 200k): no crossing is offered.
    const low = X.exitHours({ ...b, exitFavor: 120, favorStream: stream, donationCost: 1e12 });
    const lowG = X.exitHours({ ...b, exitFavor: 120, favorStream: stream, donationCost: 1e12, repRoute: "ground" });
    if (/crossed/.test(leg(low)?.detail ?? "") || Math.abs(low.hours - lowG.hours) > 1e-9) c.fail(`favor 120 + 200k cannot reach 150: no crossing (${leg(low)?.detail})`);
    c.examined(n * 4 + 4);
    c.note(`favor 124, SF14.1 stream, $1e12 donation: no Go ${noGo.hours.toFixed(2)}h, Go as a grind ${noX.hours.toFixed(2)}h, Go crossing ${withX.hours.toFixed(2)}h`);
    checks.push(c);
  }

  /* ------------------------------------------------------------------ GF4 */
  {
    const c = new Check("GF4", "THE PRICE: goweights favor = exit hours per rep-eq of the exit faction's cap left, simulated both ways; zero (named) for a non-member or a spent cap; refused when membership is unread");
    const { bestExitPolicy, spendRuns } = X;
    const now = Date.now();
    const stream = { repPerH: 159071, capRep: 200e3 };
    const inputs = { money: 1e9, incomePerSec: 1e8, hacking: 800, hackingExp: 1e9, hackingMult: 10, expPerSec: 1e7, repPerSec: 30, exitRep: 0, exitFavor: 124, terminalRep: 2.5e6, exitLevel: 3000, joinMoney: 100e9, cycleHours: 4, multGainPerCycle: 1.1, installGains: { hacking: 1, rep: 1, income: 1, exp: 1 }, persistBaseline: { hacking: 1, rep: 1, income: 1, exp: 1 }, favorToDonate: 150, donationCost: 1e12, favorStream: stream };
    const steps = [0, 0.25, 0.5, 1, 2].map((f) => ({ money: 1e12 * f, gains: { hacking: 1 + 0.3 * f, rep: 1.2, income: 1.1, exp: 1.05 } }));
    const rec = { at: new Date(now).toISOString(), lastAugReset: 1, W: 2, finalWindow: false, moneyAtW: 1e9 + 1e8 * 7200, gainsByMoney: steps, eRep: 0.2, eBudget: 0.1, inputs };
    const base = { lastAugReset: 1, now, bestExitPolicy, spendRuns, hackShare: 1, scriptExpPerSec: 5e4, ageH: 2, batchMoneyPerSec: 1e8 };
    const strip = (x) => ({ ...x, favorStream: null });
    let k = 0;
    for (const fin of [false, true]) {
      const r = { ...rec, finalWindow: fin };
      const runsF = spendRuns(r, 0);
      const TF = (x) => bestExitPolicy({ ...x, eRep: r.eRep, eBudget: r.eBudget }, runsF.max, runsF.min)?.best?.hours;
      const g = goWeights(r, { ...base, exitMember: true });
      const f = g?.favor;
      k++;
      if (!(f && typeof f.hoursPerRep === "number")) { c.fail(`${fin ? "final" : "earlier"}: no favor price (${JSON.stringify(f ?? g?.why)})`); continue; }
      // THE COMPARISON, re-simulated here on the same inputs (one draw: no plan draws given).
      const want = fin ? TF(strip(inputs)) - TF(inputs) : TF(inputs) - TF(strip({ ...inputs, exitFavor: FV.addRepToFavor(124, stream.capRep) }));
      if (!(Math.abs(f.savedH - want) < 1e-3)) c.fail(`${fin ? "final" : "earlier"}: savedH ${f.savedH} must be withoutH - withH = ${want}`);
      if (!(Math.abs(f.hoursPerRep - Math.max(0, want) / stream.capRep) < 1e-12)) c.fail(`${fin ? "final" : "earlier"}: hoursPerRep must be the saving over the cap left`);
      if (fin && !(f.hoursPerRep > 0)) c.fail(`final window at favor 124 + a 200k cap: the favor must be worth something (${f.why})`);
      c.note(`${f.why} -> ${f.hoursPerRep.toExponential(3)} h/rep`);
    }
    const nm = goWeights(rec, { ...base, exitMember: false })?.favor;
    if (!(nm && nm.hoursPerRep === 0 && /not a member/.test(nm.why))) c.fail(`a non-member's wins bank nothing: ${JSON.stringify(nm)}`);
    const un = goWeights(rec, { ...base })?.favor;
    if (!(un && un.hoursPerRep === null && /unread/.test(un.why))) c.fail(`unread membership must refuse by name: ${JSON.stringify(un)}`);
    const spent = goWeights({ ...rec, inputs: { ...inputs, favorStream: { ...stream, capRep: 0 } } }, { ...base, exitMember: true })?.favor;
    if (!(spent && spent.hoursPerRep === 0 && /spent/.test(spent.why))) c.fail(`a spent cap is a named zero: ${JSON.stringify(spent)}`);
    c.examined(k * 3 + 3);
    checks.push(c);
  }

  /* ------------------------------------------------------------------ GF5 */
  {
    const c = new Check("GF5", "THE CHOICE: the favor term moves the arm to the exit faction while its cap is left, never past it; go.js and progress.js wire it");
    // Illuminati's hacking_speed leads on the bonus alone; Daedalus feeds faction_rep.
    const weights = { hacking_money: 0, hacking_speed: 5, hacknet_node_money: 0, faction_rep: 0.5 };
    const arms = { "Illuminati@5": { pph: 125180, p: 0.977, gph: 270 }, "Daedalus@5": { pph: 27608, p: 0.992, gph: 322 } };
    const common = { weights, windowH: 4, incumbent: "Illuminati", incumbentArm: "Illuminati@5", nodePower: { Illuminati: 1e5, Daedalus: 1e5 }, arms, goPower: 1, sf14: 1, dwellH: 0.05 };
    const off = GP.chooseOpponent(common);
    const fav = { opponent: "Daedalus", hoursPerRep: 1e-5, maxRep: GP.goMaxRepOf(1), capLeft: 150e3 };
    const on = GP.chooseOpponent({ ...common, favor: fav });
    const spent = GP.chooseOpponent({ ...common, favor: { ...fav, capLeft: 0 } });
    if (off.opponent !== "Illuminati") c.fail(`without the favor Illuminati leads here: ${off.why}`);
    if (on.opponent !== "Daedalus") c.fail(`with 1e-5 h/rep of Daedalus favor left, Daedalus must lead: ${on.why}`);
    if (spent.opponent !== "Illuminati") c.fail(`a spent cap must change nothing: ${spent.why}`);
    const row = on.table?.find((s) => s.key === "Daedalus@5");
    const perH = 322 * (0.992 ** 2 / 1.992) * (GP.goMaxRepOf(1) / 200);
    if (!(row && Math.abs(row.favorPerH - perH) < 1e-6)) c.fail(`favor per hour must be games/h x p^2/(1+p) x maxRep/200 = ${perH}: ${row?.favorPerH}`);
    const fs0 = FV.goFavorStreamOf({ gamesPerHour: 322, pWin: 0.992, sf14: 1, banked: 0 });
    if (!(Math.abs(fs0.repPerH - perH) < 1e-6)) c.fail(`chooseOpponent and favor.goFavorStreamOf must agree: ${fs0.repPerH} vs ${perH}`);
    if (!/favor/.test(on.why)) c.fail(`the choice must say the favor priced it: ${on.why}`);
    // The dwell block counts the cap left only.
    const tiny = GP.chooseOpponent({ ...common, favor: { ...fav, capLeft: 1 }, dwellH: 10 });
    const rowT = tiny.table?.find((s) => s.key === "Daedalus@5");
    const rowO = off.table?.find((s) => s.key === "Daedalus@5");
    if (!(rowT && rowO)) c.fail("the table must carry Daedalus@5");
    // Wiring (source).
    const go = read("go.js");
    const pr = read("progress.js");
    if (!/favor \? \{ favor \} : \{\}/.test(go) || !/goMaxRepOf\(sf14\) - \(stats\?\.\[favW\.faction\]\?\.rep \?\? 0\)/.test(go)) c.fail("go.js must pass the favor (cap left from getStats rep) to chooseOpponent");
    if (!/wf\.source === 'goWeights'/.test(go)) c.fail("go.js must add the favor only to progress.js's exit-hour weights, never the early ranking");
    if (!/gph: d\.s > 0 \? 3600 \/ d\.s : null/.test(go)) c.fail("go.js arms must carry the drawn games per hour");
    if (!/exitMember: Array\.isArray\(player\?\.factions\)/.test(pr) || !/favor: gw\.favor \?/.test(pr)) c.fail("progress.js must pass exit-faction membership to goweights and publish its favor");
    if (!/favor: gw\.favor \?\? null/.test(read("goplan.js"))) c.fail("goplan.weightsFor must pass the published favor through");
    c.examined(12);
    c.note(`Illuminati-led basket: without favor ${off.opponent}; with 1e-5 h/rep x ${Math.round(perH)} rep-eq/h ${on.opponent}; cap spent ${spent.opponent}`);
    checks.push(c);
  }

  /* ------------------------------------------------------------------ GF6 */
  {
    const c = new Check("GF6", "LIVE: a capped opponent's Go rep is getMaxRep at the save's SF14 and its faction's favor is repToFavor of it");
    const tel = path.join(REPO, ".telemetry");
    const goTxt = path.join(tel, "go.txt");
    const stTxt = path.join(tel, "state.json");
    if (!fs.existsSync(goTxt) || !fs.existsSync(stTxt)) c.note("no live telemetry here (.telemetry/go.txt, state.json): NOT CHECKED");
    else {
      const go = JSON.parse(fs.readFileSync(goTxt, "utf8"));
      const st = JSON.parse(fs.readFileSync(stTxt, "utf8"));
      const sf = new Map(st.sourceFiles?.data ?? []);
      const cap = GP.goMaxRepOf(sf.get(14) ?? 0);
      let n = 0;
      for (const [name, rep] of Object.entries(go.favorRep ?? {})) {
        const f = st.factionRep?.[name];
        if (!f) continue;
        if (rep > cap) c.fail(`${name}: Go rep ${rep} above getMaxRep ${cap} at SF14.${sf.get(14) ?? 0}`);
        // A faction with no other source of favor this node (favor = the Go stream's) reads repToFavor(rep), floored by the save.
        if (rep === cap) {
          n++;
          const want = FV.repToFavor(rep);
          const err = f.favor - want;
          c.note(`${name}: Go rep ${rep} (cap ${cap}) -> model favor ${want.toFixed(2)}, live ${f.favor} (error ${err.toFixed(2)}; the save may round, and installs add their own)`);
          if (f.favor + 1 < want) c.fail(`${name}: live favor ${f.favor} below the Go stream's own ${want.toFixed(2)}`);
        }
      }
      c.examined(Math.max(1, n));
      if (!n) c.note("no opponent at its cap in the live save: the cap is not checked this run");
    }
    checks.push(c);
  }
  return checks;
}
