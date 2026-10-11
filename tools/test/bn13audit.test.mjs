// [BA] THE BITNODE 13 EXIT-MODEL AUDIT (live BN13.1 2026-10-11, the user:
// "surely we're modeling something incorrectly"; telemetry as of 04:19Z).
//
//   BA1  THE FRESH-LIFE FORMULA ON ANOTHER NODE'S HOME. freshPriorOf took
//        max(homeup.txt, boot.txt) homeRam: homeup.txt was BitNode 12's
//        (2026-10-09, 1048576GB), boot.txt this node's 128GB, so the formula
//        priced BN13's fresh life on a 1PB home — $8.19e6/s at age 0.08h
//        (x0.72 cross-node -> the $5.92e6/s income prior that drove the
//        02:33Z install) against ~$5e3/s the batcher measured. homeRamOf
//        now drops a record stamped before the node's start, and every call
//        site goes through it.
//   BA2  THE CADENCE MEASURED THROUGH THE GIFT'S CHARGE. A life's gain is
//        ln(hackMult_next / hackMult) of the RAW multiplier, which carries
//        the gift's Hacking fragments at whatever charge they held at the
//        read — and the charge clears at every install. BN13 life 1 read
//        ln(1.9864 / 1.8935) = 0.048 (0.0169/h) where its batch (2 NFG,
//        Wired Reflexes: no hacking) bought ln 1.0201 = 0.020 (0.0070/h):
//        x2.4, the rest the gift's charge at two moments. The ledger now
//        records the gift's hacking factor (giftHack) and a life's gain is
//        the aug part when both ends know theirs.
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const src = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const PG = await import("../../progress.js");
const F = await import("../../freshlife.js");
const { bitNodeMults } = await import("../../bitNodeMultipliers.js");
const B = await import("../../bayes.js");
const S = await import("../../stanekplan.js");

// BN13.1's start (getResetInfo().lastNodeReset) and the two records as they stood.
const NODE_START = 1791675842569; // 2026-10-10T23:44:02Z
const HOMEUP_BN12 = { at: "2026-10-09T20:51:10.861Z", homeRam: 1048576, cores: 6 };
const BOOT_BN13 = { at: "2026-10-11T03:32:53.974Z", homeRam: 128 };
// The live player's hacking multipliers at 04:19Z (freshprior.txt inputs).
const MULTS = { hacking: 1.9864400909267244, hacking_exp: 1.9864400909267244, hacking_speed: 2.105604141222236, hacking_money: 1.2818692678433397, hacking_grow: 1.5954534092425237, hacking_chance: 1.2818692678433397 };

export async function run() {
  const checks = [];

  const c1 = new Check("BA1", "the fresh-life formula prices THIS node's home: a record from before the node's start is another home");
  {
    c1.examined(4);
    const got = PG.homeRamOf(HOMEUP_BN12, BOOT_BN13, NODE_START);
    if (got !== 128) c1.fail(`homeRamOf(BN12 homeup, BN13 boot, node start) = ${got}, want 128`);
    if (PG.homeRamOf({ ...HOMEUP_BN12 }, { at: "2026-10-09T21:00:00Z", homeRam: 2048 }, NODE_START) !== undefined) c1.fail("both records from before the node: nothing of this home is known (undefined), never another node's figure");
    if (PG.homeRamOf({ at: "2026-10-11T04:00:00Z", homeRam: 256 }, BOOT_BN13, NODE_START) !== 256) c1.fail("this node's fresher homeup.txt stands");
    if (PG.homeRamOf(HOMEUP_BN12, BOOT_BN13) !== 128) c1.fail("without a node start the fresher record stands (unchanged)");
    // Every call site goes through it, with the node's start.
    const pj = src("progress.js");
    c1.examined(1);
    if (/Math\.max\(readJson\(ns, '\/tel\/homeup\.txt'\)/.test(pj)) c1.fail("a call site still takes the MAX of homeup.txt and boot.txt (another node's 1PB wins)");
    const calls = pj.match(/homeRamOf\([^\n]*\)/g) ?? [];
    const bare = calls.filter((c) => !/lastNodeReset/.test(c) && !/^homeRamOf\(hu, boot, sinceMs/.test(c));
    if (calls.length < 4 || bare.length) c1.fail(`every homeRamOf call passes the node's start (${calls.length} calls; without it: ${bare.join(" | ")})`);
    // What it was worth: the formula's income at the live inputs, the stale home vs this node's.
    const bn = bitNodeMults(13, 1);
    const reserve = F.homeReserveGb(1);
    const sim = (homeGB) => F.simulateFreshLife({ bn, mults: MULTS, intelligence: 142, homeGB, farmShare: 0.25, horizonH: 24 }).pts;
    const ptsStale = sim(HOMEUP_BN12.homeRam - reserve);
    const ptsLive = sim(BOOT_BN13.homeRam - reserve);
    const stale = { hack: F.seriesAt(ptsStale, 0.08, "hackPerSec") };
    const live = { hack: F.seriesAt(ptsLive, 0.08, "hackPerSec") };
    const rate3 = F.windowRate(ptsLive, 2, 3, "cum");
    const lvl18 = F.seriesAt(ptsLive, 1.8, "level");
    // MEASURED (life 2, 25-40% money share): batch.js splitMeasure $3.1e3-$8.6e3/s; level 63 at 1.8h (history.jsonl).
    c1.note(`formula hacking income at age 0.08h: $${stale.hack.toExponential(2)}/s on the stale 1PB home vs $${live.hack.toExponential(2)}/s on 128GB. ON 128GB the formula still reads $${rate3?.toExponential(2)}/s over 2-3h and level ${Math.round(lvl18)} at 1.8h against ~$5e3/s and level 63 measured: x${(rate3 / 5e3).toFixed(0)} high — the formula's own BN13 error (openers on FRESH_PORTS' BN9 schedule, the whole network's RAM), which the formula-error posterior carries; not fixed here`);
    if (!(stale.hack > 1e6)) c1.fail(`the stale-home replay should reproduce the live $8.19e6/s scale: ${stale.hack}`);
    if (!(live.hack < 1e3)) c1.fail(`on this node's 128GB home a 5-minute-old life earns ~nothing by the formula: ${live.hack}`);
  }
  checks.push(c1);

  const c2 = new Check("BA2", "the install cadence measures the augmentations, not the gift's charge at two moments");
  {
    c2.examined(5);
    // Ledger: BN13 life 1 ended at raw 1.8935 with the gift's hacking factor 1.5075
    // (1.8935 / (1.9864 / 1.5503 / 1.0201)); life 2 reads raw 1.9864 with the gift at 1.5503.
    const ledger = [{ at: "2026-10-11T02:33:50.204Z", lifeH: 2.83, hackMult: 1.8934710318857293, giftHack: 1.5075, bitNode: 13 }];
    const lives = B.ledgerLives(ledger, { node: 13, hackMultNow: 1.9864400909267244, giftHackNow: 1.5503 });
    const g = lives[0]?.g;
    c2.note(`life 1's gain: ln ${g?.toFixed(4)} (${(g / 2.83).toFixed(4)}/h) with both ends' gift divided out; raw ${Math.log(1.9864400909267244 / 1.8934710318857293).toFixed(4)}; its batch bought ln ${Math.log(1.0201).toFixed(4)} (2 NFG)`);
    if (!(Math.abs(g - Math.log(1.0201)) < 0.002)) c2.fail(`the aug part of the gain is ln 1.0201 = 0.0199: got ${g}`);
    // A record without the field keeps the raw pairing (units consistent at both ends).
    const old = B.ledgerLives([{ ...ledger[0], giftHack: undefined }], { node: 13, hackMultNow: 1.9864400909267244, giftHackNow: 1.5503 });
    if (!(Math.abs(old[0].g - Math.log(1.9864400909267244 / 1.8934710318857293)) < 1e-9)) c2.fail(`a record without giftHack pairs raw with raw: ${old[0].g}`);
    // Two finished lives, both with the field.
    const two = B.ledgerLives([{ ...ledger[0] }, { at: "2026-10-11T07:00:00Z", lifeH: 3, hackMult: 2.2, giftHack: 1.6, bitNode: 13 }], { node: 13 });
    const want = Math.log(2.2 / 1.6 / (1.8934710318857293 / 1.5075));
    if (!(Math.abs(two[0].g - want) < 1e-9)) c2.fail(`finished lives pair their aug parts: ${two[0].g} vs ${want}`);
    // The gift's hacking factor from stanek.txt: the product of the Hacking fragments' effects, this life only.
    const rec = { node: 13, lastAugReset: 7, fragments: [{ type: "Hacking", effect: 1.2451212382378496 }, { type: "Hacking", effect: 1.2451212382378496 }, { type: "HackingSpeed", effect: 1.29 }, { type: "Booster", effect: 1 }] };
    const gh = S.giftHackOf?.(rec, 7);
    if (!(Math.abs(gh - 1.2451212382378496 ** 2) < 1e-9)) c2.fail(`giftHackOf = the Hacking fragments' product (1.5503): ${gh}`);
    if (S.giftHackOf?.(rec, 8) !== null) c2.fail("another life's stanek record is no reading (null)");
    // The publishers: the install ledger and the cadence's inputs carry it.
    const pj = src("progress.js");
    c2.examined(2);
    if (!/giftHack: giftHackOf\(/.test(pj)) c2.fail("the lifetimes ledger records giftHack (giftHackOf) at the install");
    if (!/const giftHackNow = ns \? giftHackOf\(readJson\(ns, STANEK_FILE\), info\?\.lastAugReset\)/.test(pj) || !/hackMultNow: player\?\.mults\?\.hacking \?\? null, giftHackNow,/.test(pj)) c2.fail("cadenceOptsOf passes giftHackNow (giftHackOf) beside hackMultNow");
    const all = (pj.match(/cadenceOptsOf\(/g) ?? []).length;
    const withNs = (pj.match(/cadenceOptsOf\((?:ns\.getPlayer\(\)|player), info, ns\)/g) ?? []).length;
    if (all < 4 || withNs !== all - 1) c2.fail(`every cadenceOptsOf call passes ns (the gift's reading): ${withNs} of ${all - 1} calls`);
    if (!/giftHackNow/.test(src("exitplan.js"))) c2.fail("exitplan.installCadence passes giftHackNow through to the posterior");
  }
  checks.push(c2);
  return checks;
}
