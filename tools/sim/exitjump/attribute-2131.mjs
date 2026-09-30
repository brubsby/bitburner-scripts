// EXIT JUMP AT INSTALL — live BN9 2026-09-30, the 21:31:41Z install.
//
//   node tools/sim/exitjump/attribute-2131.mjs [fixture.json]
//
// The install actor priced 'now' at 4.571h (plan mean 4.496h); the new life
// priced point 7.267h / mean 7.419h at 0.076h (EXIT JUMP +2.8h against a
// 1.09h tolerance). This starts from the pre-install inputs (21:31:05Z, the
// pass the actor's price came from) and moves the groups one at a time —
// cumulatively — to what the install actually left, then prices the new
// life's own inputs with the one input it had wrong.
//
// THE OLD MODEL is emulated on the current exitplan.js: it counted the exit
// faction's rep in hand after an install at today's favor, which is exactly
// terminalRep - exitRep from 0 rep at exitFavor with nothing converted.
//
// CALIBRATION: the CHECK lines reproduce the actor's 4.571h point from the
// pre inputs (old model) and the new life's 7.267h default-policy point from
// the post inputs before anything is attributed.
import "../../test/gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../../test/gameresolve.mjs";

const X = await import(path.join(REPO_ROOT, "exitplan.js"));
const F = await import(path.join(REPO_ROOT, "favor.js"));

const FX = JSON.parse(fs.readFileSync(process.argv[2] ?? path.join(REPO_ROOT, "tools/test/fixture-bn9-exitjump-2131.json"), "utf8"));
const PRE = FX.pre.inputs;
const POST = FX.post.inputs;
const g = FX.pre.install.batchGains;
const ELAPSED = FX.post.exitJump.first.elapsedH;
const f3 = (x) => x.toFixed(3);
const sg = (x) => (x >= 0 ? "+" : "") + x.toFixed(3);

const pricePre = (over = {}) => X.bestExitPolicy({ ...PRE, firstInstallH: 0, installGains: g, nextInstallGain: g.hacking, ...over }, 400, 1).best;
const pricePost = (over = {}) => X.bestExitPolicy({ ...POST, ...over }).best;
const OLD = { terminalRep: PRE.terminalRep - PRE.exitRep, exitRep: 0 };

const b0 = pricePre(OLD);
const p0 = pricePost();
console.log(`CHECK pre 'now' point (old model) ${f3(b0.hours)}h vs the actor's ${FX.pre.install.pointH}h; post point ${f3(p0.hours)}h vs the new life's ${FX.post.exitJump.first.pointH}h`);
console.log(`the jump replayed: post ${f3(p0.hours)}h vs pre ${f3(b0.hours)}h less ${ELAPSED}h: ${sg(p0.hours - b0.hours + ELAPSED)}h (recorded ${FX.post.exitJump.first.checks[0].diffH}h)`);

const omni = PRE.lifeGrafts.find((x) => x.name === "OmniTek InfoLoad");
const ucm = POST.lifeGrafts.find((x) => x.name === "Unstable Circadian Modulator");
const favAfter = F.addRepToFavor(PRE.exitFavor, PRE.exitRep);
const GO = FX.pre.goBonusPct;
const steps = [
  ["(a)  the life-1 graft lands after the install: OmniTek life 1 -> 2", { lifeGrafts: [{ ...omni, life: 2 }] }],
  ["(a') the graft set chosen fresh: + Unstable Circadian Modulator", { lifeGrafts: [{ ...ucm, life: 2 }, { ...omni, life: 2 }] }],
  ["(b)  Daedalus re-join after the install: $100b + hacking 2500", { rejoinMoney: POST.joinMoney, rejoinLevel: POST.joinLevel }],
  [`(b') the ${Math.round(PRE.exitRep)} rep in hand is lost at the install`, { terminalRep: PRE.terminalRep, exitRep: 0 }],
  [`(b") ...and banked as favor: ${PRE.exitFavor.toFixed(1)} -> ${favAfter.toFixed(1)}`, { exitFavor: favAfter }],
  [`(c)  rep carry: the +${GO.toFixed(1)}% IPvGO faction_rep the install zeroes (floor: no regrowth)`, { preInstallRepMult: 1 + GO / 100 }],
  [`(c') exp carry: the install's carried ${Math.round(FX.pre.carry.exp.perSec)}/s for ${Math.round(PRE.expPerSec)}/s`, { expPerSec: FX.pre.carry.exp.perSec }],
];
let acc = { ...OLD };
let prev = b0.hours;
console.log(`\n${"group (cumulative, pre inputs, 'now')".padEnd(78)} ${"point".padStart(7)} ${"delta".padStart(7)} installs`);
for (const [name, over] of steps) {
  acc = { ...acc, ...over };
  const b = pricePre(acc);
  console.log(`${name.padEnd(78)} ${f3(b.hours).padStart(7)} ${sg(b.hours - prev).padStart(7)} ${b.installsFirst}`);
  prev = b.hours;
}
console.log(`\nthe pre side moved to what the install left: ${f3(prev)}h, less ${ELAPSED}h = ${f3(prev - ELAPSED)}h`);
const pF = pricePost({ exitFavor: FX.post.daedalusFavor });
const pW = pricePost({ exitFavor: FX.post.daedalusFavor, firstInstallH: 0 });
console.log(`post side as published (exitFavor 0: not a member)            ${f3(p0.hours)}h`);
console.log(`(d)  with Daedalus's favor ${FX.post.daedalusFavor.toFixed(1)} (it survives the install)  ${f3(pF.hours)}h (${sg(pF.hours - p0.hours)}h)`);
console.log(`(e)  and the first install at the grafts' end, not the 3h cadence ${f3(pW.hours)}h (${sg(pW.hours - pF.hours)}h) — the default policy of a life with no committed install`);
console.log(`residual, post (d) vs the pre side moved: ${sg(pF.hours - prev + ELAPSED)}h; post (d)+(e): ${sg(pW.hours - prev + ELAPSED)}h`);

// THE FIX (exitplan: the install resets the exit faction and zeroes the IPvGO
// rep bonus; progress.js: the favor published member or not, the re-join
// requirement, the bonus). The post side's own bonus 5 min into the life was
// not recorded (installgate goBonusPct null): priced at 1 (none), a floor.
const fixedPre = pricePre({ rejoinMoney: FX.pre.rejoinMoney, rejoinLevel: FX.pre.rejoinLevel, preInstallRepMult: 1 + GO / 100 });
console.log(`\nFIXED: pre 'now' ${f3(fixedPre.hours)}h (old ${f3(b0.hours)}h); post ${f3(pF.hours)}h: jump ${sg(pF.hours - fixedPre.hours + ELAPSED)}h`);
for (const l of fixedPre.legs) console.log(`  pre  ${l.leg.padEnd(30)} ${l.hours.toFixed(2).padStart(6)}h  ${(l.detail ?? "").slice(0, 100)}`);
for (const l of pF.legs) console.log(`  post ${l.leg.padEnd(30)} ${l.hours.toFixed(2).padStart(6)}h  ${(l.detail ?? "").slice(0, 100)}`);
