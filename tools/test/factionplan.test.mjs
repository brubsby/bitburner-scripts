// [FP] which faction to work, priced instead of listed.
//
// The behaviour that matters is that a HAND-ORDERED PREFERENCE cannot beat the
// arithmetic. progress.js used to grind NiteSec while CyberSec sat 110,783
// reputation closer to the donation threshold, purely because NiteSec ranked
// higher in a static list. FP4 replays that shape.

import { Check } from "./harness.mjs";
import "./gameresolve.mjs"; // factionplan.js imports bare 'installgate.js', the Netscript spelling

const fp = await import("../../factionplan.js");
const { repLadder } = await import("../../favor.js");
const { augValue, TERMINAL_LN } = await import("../../objective.js");
const { valueOfWorking, rankFactions, planSchedule, holdCandidates, logValue } = fp;

const aug = (name, repReq, mult) => ({ name, repReq, mults: { hacking: mult, hacking_money: 1, faction_rep: 1 } });

export function run() {
  const checks = [];

  /* ---------------------------------------------------------------- FP1 --- */
  const c1 = new Check("FP1", "value is ln(M) per hour of reputation work, on the shared channels");
  {
    c1.examined(1);
    if (Math.abs(logValue({ hacking: Math.E }) - 1) > 1e-12) c1.fail("logValue must be the natural log of the basket product");
    c1.examined(1);
    // A channel outside RATE_CHANNELS contributes nothing — the same basket the
    // install gate uses, imported rather than copied.
    if (logValue({ hacking_exp: 100 }) !== 0) c1.fail("an out-of-basket channel must not create value");

    // One augmentation at 3600 reputation away, at 1 rep/sec, is one hour.
    c1.examined(1);
    const v = valueOfWorking({ name: "F", rep: 0, augs: [aug("a", 3600, Math.E)] }, 1);
    if (Math.abs(v.hours - 1) > 1e-9) c1.fail(`expected 1 hour, got ${v.hours}`);
    if (Math.abs(v.rate - 1) > 1e-9) c1.fail(`expected rate 1 ln(M)/h, got ${v.rate}`);
  }
  checks.push(c1);

  /* ---------------------------------------------------------------- FP2 --- */
  const c2 = new Check("FP2", "the BEST rate over the walk, not the total — a distant prize cannot carry a faction");
  {
    // Two cheap augmentations close by, and one enormous one far away. Taking
    // the total would chase the distant prize; taking the best rate stops at
    // the point where reputation is actually paying.
    const f = {
      name: "F", rep: 0,
      augs: [aug("near1", 3600, Math.E), aug("near2", 7200, Math.E), aug("far", 3600 * 1000, Math.exp(5))],
    };
    c2.examined(1);
    const v = valueOfWorking(f, 1);
    if (v.hours > 3) c2.fail(`chose a ${v.hours}h horizon; the near pair pays far better per hour`);
    c2.note(`best horizon ${v.hours}h at ${v.rate.toFixed(3)} ln(M)/h, unlocking ${v.unlocks.join(", ")}`);

    // A wall of worthless augmentations in FRONT of a good one must still be
    // walked through, not skipped — the reputation to pass them is real.
    c2.examined(1);
    const walled = valueOfWorking(
      { name: "W", rep: 0, augs: [aug("junk1", 3600, 1), aug("junk2", 7200, 1), aug("good", 10800, Math.E)] },
      1,
    );
    if (Math.abs(walled.hours - 3) > 1e-9) c2.fail(`expected the 3h horizon that reaches the good aug, got ${walled.hours}`);
    if (walled.unlocks.length !== 3) c2.fail("the walk must account for the augmentations passed on the way");
  }
  checks.push(c2);

  /* ---------------------------------------------------------------- FP3 --- */
  const c3 = new Check("FP3", "reputation already earned counts — only LOCKED augmentations need work");
  {
    // An augmentation we can already afford on reputation needs no more work,
    // so it must not inflate the value of working this faction.
    c3.examined(1);
    const v = valueOfWorking({ name: "F", rep: 5000, augs: [aug("have", 1000, Math.exp(9)), aug("want", 8600, Math.E)] }, 1);
    if (Math.abs(v.hours - 1) > 1e-9) c3.fail(`expected 1h to the locked aug, got ${v.hours}`);
    if (Math.abs(v.rate - 1) > 1e-9) c3.fail(`the already-reachable aug inflated the rate to ${v.rate}`);
    c3.examined(1);
    // Nothing locked at all means working this faction buys nothing.
    const none = valueOfWorking({ name: "F", rep: 1e9, augs: [aug("a", 100, Math.E)] }, 1);
    if (none.rate !== 0) c3.fail("a faction with nothing locked must price at zero");
  }
  checks.push(c3);

  /* ---------------------------------------------------------------- FP4 --- */
  const c4 = new Check("FP4", "the live regression: arithmetic beats the hand-ordered list");
  {
    // The shape of what actually happened. The static list ranked NiteSec above
    // CyberSec, so NiteSec was ground — while CyberSec's next augmentations
    // were far closer in reputation. Whichever faction pays more per hour must
    // win, regardless of any preference order.
    const nite = { name: "NiteSec", rep: 4284, augs: [aug("n1", 400000, Math.E), aug("n2", 800000, Math.E)] };
    const cyber = { name: "CyberSec", rep: 1226, augs: [aug("c1", 20000, Math.E), aug("c2", 50000, Math.E)] };
    const r = rankFactions([nite, cyber], 5);
    c4.examined(1);
    if (r.best?.name !== "CyberSec") c4.fail(`ranked ${r.best?.name} first; CyberSec's augs are an order of magnitude closer`);
    c4.note(`CyberSec ${r.ranked[0].rate.toFixed(4)} ln(M)/h vs NiteSec ${r.ranked[1].rate.toFixed(4)}`);

    // And it must flip when the better faction genuinely is the distant one.
    c4.examined(1);
    const rich = { name: "Daedalus", rep: 0, augs: [aug("big", 100000, Math.exp(20))] };
    const r2 = rankFactions([rich, cyber], 5);
    if (r2.best?.name !== "Daedalus") c4.fail("a genuinely better faction must win — this is not a bias toward cheap ones");
  }
  checks.push(c4);

  /* ---------------------------------------------------------------- FP5 --- */
  const c5 = new Check("FP5", "unreadable factions are reported; zero-value is distinguishable from unknown");
  {
    for (const [name, f] of [
      ["missing rep", { name: "A", augs: [] }],
      ["NaN rep", { name: "B", rep: NaN, augs: [] }],
      ["negative rep", { name: "C", rep: -1, augs: [] }],
    ]) {
      c5.examined(1);
      if (valueOfWorking(f, 1) !== null) c5.fail(`${name} did not read as unknown`);
    }
    c5.examined(1);
    if (valueOfWorking({ name: "D", rep: 0, augs: [] }, 0) !== null) c5.fail("a zero reputation rate must read as unknown, not as zero value");

    c5.examined(1);
    const r = rankFactions([{ name: "ok", rep: 0, augs: [] }, { name: "bad" }], 1);
    if (!r.unreadable.includes("bad")) c5.fail("an unreadable faction must be reported, not dropped");
    c5.examined(1);
    // All-zero is a real state (nothing locked is worth reputation) and must be
    // distinguishable from "could not price anything".
    if (!r.allZero) c5.fail("a fully-priced ranking where nothing is worth working must say so");
    c5.examined(1);
    if (r.best !== null) c5.fail("best must be null when no faction has positive value, rather than an arbitrary first entry");
  }
  checks.push(c5);

  /* ---------------------------------------------------------------- FP6 --- */
  const c6 = new Check("FP6", "favour multiplies the reputation RATE (reputation.ts:9), not just the threshold");
  {
    // `favorMult = 1 + favor / 100` applies to every faction work gain, so a
    // high-favour faction earns reputation faster. Missing this mis-ranks in
    // the same direction the static list already did.
    const base = { name: "F", rep: 0, augs: [aug("a", 3600, Math.E)] };
    c6.examined(1);
    const at0 = valueOfWorking({ ...base, favor: 0 }, 1);
    if (Math.abs(at0.hours - 1) > 1e-9) c6.fail(`zero favour should be 1h, got ${at0.hours}`);
    c6.examined(1);
    const at100 = valueOfWorking({ ...base, favor: 100 }, 1);
    if (Math.abs(at100.hours - 0.5) > 1e-9) c6.fail(`100 favour doubles the rate, so 0.5h; got ${at100.hours}`);
    c6.examined(1);
    if (!(at100.rate > at0.rate)) c6.fail("higher favour must raise the value of working a faction");

    // The live pair: CyberSec's favour advantage compounds with nearer augs.
    c6.examined(1);
    const cyber = valueOfWorking({ name: "CyberSec", favor: 95.1, rep: 1226, augs: [aug("c", 20000, Math.E)] }, 1);
    const nite = valueOfWorking({ name: "NiteSec", favor: 35.4, rep: 4284, augs: [aug("n", 20000, Math.E)] }, 1);
    if (!(cyber.rate > nite.rate)) c6.fail("at equal aug distance, the higher-favour faction must win on rate alone");
    c6.note(`equal augs, favour alone: CyberSec ${cyber.rate.toFixed(4)} vs NiteSec ${nite.rate.toFixed(4)} ln(M)/h`);

    // An unreadable favour must fall back to 1x, never upward.
    c6.examined(1);
    const unk = valueOfWorking({ ...base, favor: NaN }, 1);
    if (Math.abs(unk.hours - 1) > 1e-9) c6.fail("an unreadable favour must fall back to no multiplier");
  }
  checks.push(c6);

  /* ---------------------------------------------------------------- FP7 --- */
  const c7 = new Check("FP7", "a SCHEDULE: work to a reputation cap, then switch — and come back if worth it");
  {
    const { planSchedule } = fp;
    // A pays best first; once its cheap tranche is unlocked, B becomes better;
    // and A's second tranche is worth returning to after that.
    const A = { name: "A", favor: 0, rep: 0, augs: [aug("a1", 3600, Math.E), aug("a2", 3600 * 50, Math.exp(4))] };
    const B = { name: "B", favor: 0, rep: 0, augs: [aug("b1", 3600 * 5, Math.exp(2))] };
    const plan = planSchedule([A, B], 1);
    c7.examined(1);
    if (!plan.segments.length) c7.fail("a schedule with reachable augmentations must not be empty");
    c7.examined(1);
    if (plan.segments[0].faction !== "A") c7.fail(`first segment is ${plan.segments[0].faction}; A pays best initially`);
    c7.examined(1);
    // It must actually SWITCH rather than grinding one faction forever.
    if (new Set(plan.segments.map((s) => s.faction)).size < 2) {
      c7.fail(`schedule never switched faction: ${plan.segments.map((s) => s.faction).join(" -> ")}`,
        "hitting a reputation cap and moving to the next faction is the whole point");
    }
    c7.note(`schedule: ${plan.segments.map((s) => `${s.faction} to ${Math.round(s.untilRep)} rep (${s.hours.toFixed(2)}h)`).join(" -> ")}`);

    c7.examined(1);
    // Each segment must name the reputation at which it ENDS, so the caller can
    // switch the moment it is crossed instead of at the next five-minute tick.
    if (!plan.segments.every((s) => typeof s.untilRep === "number" && isFinite(s.untilRep))) {
      c7.fail("every segment must carry the reputation target that ends it");
    }
    c7.examined(1);
    // Hours must accumulate, not reset.
    if (Math.abs(plan.totalHours - plan.segments.reduce((t, s) => t + s.hours, 0)) > 1e-9) {
      c7.fail("totalHours must be the sum of the segments");
    }
    c7.examined(1);
    // It must not mutate the caller's factions — the walk is hypothetical.
    if (A.rep !== 0 || B.rep !== 0) c7.fail("planSchedule mutated the caller's faction state");
    c7.examined(1);
    // Nothing worth working yields an empty schedule, not a fabricated one.
    if (planSchedule([{ name: "Z", rep: 1e9, favor: 0, augs: [aug("z", 1, Math.E)] }], 1).segments.length) {
      c7.fail("a faction with nothing locked must produce no segments");
    }
  }
  checks.push(c7);

  /* ---------------------------------------------------------------- FP8 --- */
  const c8 = new Check("FP8", "exclusive factions are PRICED, not refused — and the enemy sets are not all-or-nothing");
  {
    const { bestCompatibleSet } = fp;
    // The real enemy sets (Faction/FactionInfo.tsx:495-553). The stack refused
    // every city faction on a stated belief that "joining one locks out the
    // other five". That is false: Sector-12 and Aevum do NOT ban each other,
    // and Chongqing/New Tokyo/Ishima are mutually compatible. Up to THREE can
    // be held, so refusing all of them forfeits augmentations for a constraint
    // that does not exist as described.
    const E = {
      Sector12: ["Chongqing", "Ishima", "NewTokyo", "Volhaven"],
      Aevum: ["Chongqing", "Ishima", "NewTokyo", "Volhaven"],
      Chongqing: ["Aevum", "Sector12", "Volhaven"],
      NewTokyo: ["Aevum", "Sector12", "Volhaven"],
      Ishima: ["Aevum", "Sector12", "Volhaven"],
      Volhaven: ["Aevum", "Chongqing", "Ishima", "NewTokyo", "Sector12"],
    };
    const mk = (v) => Object.entries(E).map(([name, enemies]) => ({ name, enemies, value: v[name] ?? 0 }));

    c8.examined(1);
    const equal = bestCompatibleSet(mk({ Sector12: 1, Aevum: 1, Chongqing: 1, NewTokyo: 1, Ishima: 1, Volhaven: 1 }));
    if (equal.chosen.length !== 3) c8.fail(`at equal value the largest compatible set is 3, got ${equal.chosen}`);

    c8.examined(1);
    // THE CASE GREEDY GETS WRONG: Volhaven is the best single faction, but the
    // Sector-12 + Aevum pair is worth more together.
    const pair = bestCompatibleSet(mk({ Sector12: 5, Aevum: 5, Chongqing: 3, NewTokyo: 3, Ishima: 3, Volhaven: 8 }));
    if (pair.chosen.length !== 2 || !pair.chosen.includes("Sector12") || !pair.chosen.includes("Aevum")) {
      c8.fail(`expected the Sector-12 + Aevum pair (10) over Volhaven (8), got ${pair.chosen} at ${pair.value}`,
        "a greedy pick by individual value takes Volhaven and loses 2");
    }

    c8.examined(1);
    // A genuinely dominant single faction must still win.
    const solo = bestCompatibleSet(mk({ Volhaven: 100, Sector12: 1, Aevum: 1, Chongqing: 1, NewTokyo: 1, Ishima: 1 }));
    if (solo.chosen.join() !== "Volhaven") c8.fail(`expected Volhaven alone, got ${solo.chosen}`);

    c8.examined(1);
    // The chosen set must never contain mutual enemies.
    for (const set of [equal, pair, solo]) {
      for (const a of set.chosen) for (const b of set.chosen) {
        if (a !== b && E[a].includes(b)) c8.fail(`chose mutual enemies ${a} and ${b}`);
      }
    }

    c8.examined(1);
    // Refusing everything is never the answer when anything has value.
    if (!bestCompatibleSet(mk({ Sector12: 1 })).chosen.length) c8.fail("a single valuable faction must be chosen, not refused");

    c8.examined(1);
    // But with nothing of value, an empty set is correct — not an arbitrary pick.
    if (bestCompatibleSet(mk({})).chosen.length) c8.fail("with no value anywhere, choose nothing rather than guessing");

    c8.examined(1);
    // Too many candidates must REFUSE rather than silently approximate — the
    // action it feeds is an irreversible join.
    const many = Array.from({ length: 25 }, (_, i) => ({ name: `f${i}`, enemies: [], value: 1 }));
    const big = bestCompatibleSet(many);
    if (!big.error || big.chosen.length) c8.fail("an oversized candidate set must decline, not guess");
  }
  checks.push(c8);

  /* ---------------------------------------------------------------- FP9 --- */
  const c9 = new Check("FP9", "the join boundary: a wait defers a faction, never hides it, and `current` stays actionable");
  {
    const big = { hacking: 1.8 }; // ln ~0.588 — the locked faction's prize
    const small = { hacking: 1.05 }; // ln ~0.049 — what the joined faction sells
    const joined = { name: "CyberSec", rep: 0, favor: 0, augs: [{ name: "s", repReq: 3600, mults: small }] };
    const locked = (wait) => ({ name: "BitRunners", rep: 0, favor: 0, joinWaitHours: wait, augs: [{ name: "b", repReq: 3600, mults: big }] });

    // At 1 rep/sec the grind is 1h each. With a long wait the joined faction
    // must outrank the locked one; with the wait gone the locked one wins.
    c9.examined(1);
    const far = rankFactions([joined, locked(100)], 1);
    if (far.best?.name !== "CyberSec") c9.fail(`a 100h wait should defer BitRunners, best was ${far.best?.name}`);
    c9.examined(1);
    const here = rankFactions([joined, locked(0)], 1);
    if (here.best?.name !== "BitRunners") c9.fail("with the wait gone the better augmentations must win");
    c9.examined(1);
    // Deferred is NOT hidden: the locked faction still appears, ranked, with
    // its wait carried — a silent zero is how the boundary was invisible.
    const row = far.ranked.find((r) => r.name === "BitRunners");
    if (!row || !(row.rate > 0)) c9.fail("a waited faction must still carry a positive rate in the ranking");
    if (row && row.joinWaitHours !== 100) c9.fail("the wait must survive into the ranking for telemetry");

    c9.examined(1);
    // An UNKNOWN wait refuses a rate entirely — zero would rank a locked
    // faction as open, infinity would hide it, and both are the unknown-as-
    // answer bug. It lands in `unreadable`, which is reported, not dropped.
    for (const bad of [NaN, -1, "9", Infinity]) {
      const r = rankFactions([joined, locked(bad)], 1);
      if (!r.unreadable.includes("BitRunners")) c9.fail(`wait ${String(bad)} must make the faction unpriceable, not ranked`);
    }

    // THE SCHEDULE: the wait is a RELEASE TIME. Working the joined faction
    // spends it, so the locked segment's residual wait must be smaller than
    // the original — and `current` must be the JOINED faction, because
    // "work BitRunners" is not an executable instruction while locked.
    c9.examined(1);
    const plan = planSchedule([joined, locked(1.5)], 1);
    if (plan.current?.faction !== "CyberSec") c9.fail(`current must be actionable (joined), got ${plan.current?.faction}`);
    const bseg = plan.segments.find((sg) => sg.faction === "BitRunners");
    c9.examined(1);
    if (!bseg) c9.fail("the locked faction must appear in the schedule once it is worth its residual wait");
    else {
      if (!(bseg.joinInH > 0)) c9.fail("a locked segment must carry joinInH — it is a forecast, not an instruction");
      if (!(bseg.joinInH < 1.5)) c9.fail(`working CyberSec first must SPEND the wait: residual ${bseg.joinInH} vs original 1.5`);
      if (plan.nextJoin?.faction !== "BitRunners") c9.fail("nextJoin must surface the locked segment");
    }
    c9.examined(1);
    // TRUNCATION: a long grind must PAUSE at a release, because the released
    // faction may outrank the remainder. Here CyberSec's horizon is 10h and
    // BitRunners releases at 2h with far better augmentations: the plan must
    // be CyberSec (2h, paused) -> BitRunners -> CyberSec's remainder, with the
    // partial reputation banked, not thrown away.
    const longJoined = { name: "CyberSec", rep: 0, favor: 0, augs: [{ name: "s", repReq: 36000, mults: small }] };
    const t = planSchedule([longJoined, locked(2)], 1);
    const first = t.segments[0];
    if (first?.faction !== "CyberSec" || !first.pausedForJoin) {
      c9.fail(`expected a truncated CyberSec segment first, got ${JSON.stringify(first)}`);
    } else {
      if (Math.abs(first.hours - 2) > 1e-9) c9.fail(`truncation must stop at the release (2h), got ${first.hours}`);
      if (Math.abs(first.untilRep - 7200) > 1e-6) c9.fail(`partial rep must be banked: expected 7200, got ${first.untilRep}`);
      if (first.pausedForJoin !== "BitRunners") c9.fail(`the pause must NAME the faction it waits for, got ${first.pausedForJoin}`);
      if (t.nextJoin?.faction !== "BitRunners" || Math.abs(t.nextJoin?.atH - 2) > 1e-9) {
        c9.fail(`nextJoin must surface the truncation-flow join too: ${JSON.stringify(t.nextJoin)}`);
      }
      if (t.segments[1]?.faction !== "BitRunners") c9.fail("the released faction must compete at its release hour and win here");
      const resumed = t.segments.find((sg, i) => i > 1 && sg.faction === "CyberSec");
      if (!resumed) c9.fail("the paused grind must resume after the better faction's tranche");
      else if (Math.abs(resumed.untilRep - 36000) > 1e-6) c9.fail(`the resumed segment must finish the walk at 36000, got ${resumed.untilRep}`);
    }

    c9.examined(1);
    // Degenerate but real: nothing joined at all. The schedule may forecast,
    // but must not claim anything is actionable now.
    const only = planSchedule([locked(5)], 1);
    if (only.current !== null) c9.fail("with only locked factions, current must be null — nothing is workable now");
    if (only.nextJoin?.faction !== "BitRunners") c9.fail("...but the forecast must still be visible");
  }
  checks.push(c9);

  /* --------------------------------------------------------------- FP10 --- */
  const c10 = new Check("FP10", "active work: available now, charged exclusively, overlapping the passive wait");
  {
    const big = { hacking: 1.8 };
    const small = { hacking: 1.05 };
    const joined = { name: "CyberSec", rep: 0, favor: 0, augs: [{ name: "s", repReq: 3600, mults: small }] };
    // ECorp: 30h at the desk before the faction opens, then a 1h grind.
    const corp = (workH, waitH = 0) => ({
      name: "ECorp", rep: 0, favor: 0, joinWorkHours: workH, joinWaitHours: waitH,
      augs: [{ name: "b", repReq: 3600, mults: big }],
    });

    c10.examined(1);
    // The work hours dilute the rate: ln(1.8)/(30+1)h, not ln(1.8)/1h.
    const v = valueOfWorking(corp(30), 1);
    if (!v) c10.fail("a company-gated faction must still price");
    else if (Math.abs(v.hours - 31) > 1e-9) c10.fail(`horizon must be work+grind = 31h, got ${v.hours}`);

    c10.examined(1);
    // OVERLAP: passive wait and active work run concurrently, so the pre-grind
    // cost is max(wait, work) — Fulcrum's shape, not the sum.
    const both = valueOfWorking(corp(30, 50), 1);
    if (!both || Math.abs(both.hours - 51) > 1e-9) c10.fail(`max(50,30)+1 = 51h expected, got ${both?.hours}`);

    c10.examined(1);
    // Unknown work hours refuse, exactly like unknown waits.
    for (const bad of [NaN, -1, "30"]) {
      if (valueOfWorking(corp(bad), 1) !== null) c10.fail(`work hours ${String(bad)} must refuse a rate`);
    }

    c10.examined(1);
    // In the schedule: a work-gated faction is AVAILABLE now (no release to
    // wait for), competes at its diluted rate, and its segment carries workH
    // so the caller knows it begins with employment, not grinding.
    const plan = planSchedule([joined, corp(2)], 1);
    const seg = plan.segments.find((sg) => sg.faction === "ECorp");
    if (!seg) c10.fail("the company-gated faction must appear in the schedule");
    else {
      if (Math.abs(seg.workH - 2) > 1e-9) c10.fail(`the segment must carry its work phase, got workH=${seg.workH}`);
      if (seg.joinInH) c10.fail("active work is not an idle join wait");
    }
    c10.examined(1);
    // CyberSec (rate ~0.049) still leads: ECorp's ln(1.8)/3h ~ 0.196 beats it…
    // so actually ECorp goes FIRST here — and that is correct: 2h at a desk
    // for x1.8 beats 1h grinding for x1.05. The assertion is that the ranking
    // is by diluted rate, whichever way it falls.
    const first = plan.segments[0];
    if (first?.faction !== "ECorp") c10.fail(`ln(1.8)/3h = 0.196 outranks ln(1.05)/1h = 0.049; got ${first?.faction} first`);
  }
  checks.push(c10);

  /* --------------------------------------------------------------- FP11 --- */
  const c11 = new Check("FP11", "the install window: over-window grinds ladder, within-window ones do not, and segments say so");
  {
    const big = { hacking: 2.84 };
    const small = { hacking: 1.15 };
    // A live-shaped ladder hook: 1.72h windows, 3.4%/install growth.
    const mkLadder = (windowH = 1.72) => (a) =>
      repLadder(a.repReq, {
        windowH,
        remainingWindowH: Math.max(0.05, windowH - (a.extraStartH ?? 0)),
        baseRepPerSec: 7.3,
        favor: a.favor,
        currentRep: a.currentRep,
        hoursNow: a.hoursNow,
        rateGrowthPerCycle: 1.034,
      });

    const grinder = {
      name: "BitRunners", rep: 0, favor: 0,
      augs: [{ name: "cheap", repReq: 20e3, mults: small }, { name: "CSP-G5", repReq: 275e3, mults: big }],
    };

    c11.examined(1);
    // Without the hook: the old continuous fiction (275k / 7.3 = 10.5h).
    const fiction = valueOfWorking(grinder, 7.3);
    // With it: the far unlock prices through the ladder — many times longer.
    const truth = valueOfWorking(grinder, 7.3, { ladder: mkLadder() });
    if (!truth || !fiction) c11.fail("both arms must price");
    else {
      const fictionFar = 275e3 / 7.3 / 3600;
      const far = truth.unlocks.includes("CSP-G5") ? truth : null;
      // The BEST horizon may now be the cheap near aug — that reordering IS
      // the fix. Assert the far unlock is either dropped from the best walk
      // or costed at ladder scale, never at the continuous figure.
      if (far && far.hours < fictionFar * 2) c11.fail(`the far unlock still prices near the continuous fiction: ${far.hours.toFixed(1)}h`);
      if (truth.unlocks.includes("CSP-G5") && !(truth.spansInstalls > 0)) c11.fail("a laddered best must carry spansInstalls");
      c11.note(`best under the window: [${truth.unlocks.join(", ")}] at ${truth.hours.toFixed(2)}h (continuous fiction priced CSP-G5 at ${fictionFar.toFixed(1)}h)`);
    }

    c11.examined(1);
    // The within-window unlock is untouched by the hook: reachableNow passes
    // the trajectory hours straight through.
    const near = { name: "X", rep: 0, favor: 0, augs: [{ name: "n", repReq: 20e3, mults: small }] };
    const a1 = valueOfWorking(near, 7.3);
    const a2 = valueOfWorking(near, 7.3, { ladder: mkLadder() });
    if (Math.abs(a1.hours - a2.hours) > 1e-9) c11.fail(`a within-window grind must not change: ${a1.hours} vs ${a2.hours}`);
    if (a2.spansInstalls) c11.fail("a within-window grind spans nothing");

    c11.examined(1);
    // holdH carries the continuous alternative for the gate to weigh.
    const farOnly = { name: "Y", rep: 0, favor: 0, augs: [{ name: "f", repReq: 275e3, mults: big }] };
    const lad = valueOfWorking(farOnly, 7.3, { ladder: mkLadder() });
    if (!(lad.spansInstalls > 0)) c11.fail("a far-only faction must ladder");
    if (!(Math.abs(lad.holdH - 275e3 / 7.3 / 3600) < 1e-6)) c11.fail(`holdH must be the continuous grind, got ${lad.holdH}`);
    c11.examined(1);
    // A longer window shortens the ladder in the walk too.
    const lad6 = valueOfWorking(farOnly, 7.3, { ladder: mkLadder(6) });
    if (!(lad6.hours < lad.hours)) c11.fail("a 6h window must beat a 1.72h window");

    c11.examined(1);
    // In the schedule, the marking survives into segments.
    const plan = planSchedule([farOnly], 7.3, { ladder: mkLadder() });
    const seg = plan.segments[0];
    if (!seg || !(seg.spansInstalls > 0) || !(seg.holdH > 0)) {
      c11.fail(`the spanning segment must be marked: ${JSON.stringify(seg)}`);
    }
  }
  checks.push(c11);

  /* --------------------------------------------------------------- FP12 --- */
  const c12 = new Check("FP12", "hold candidates: spanning segments become gate options, capped and deduplicated");
  {
    const segs = [
      { faction: "NiteSec", hours: 1.9, untilRep: 50e3, spansInstalls: 1, holdH: 0.7 },
      { faction: "The Black Hand", hours: 24, untilRep: 175e3, spansInstalls: 14, holdH: 2.4 },
      { faction: "The Black Hand", hours: 5, untilRep: 125e3, spansInstalls: 3, holdH: 1.3 },
      { faction: "BitRunners", hours: 53, untilRep: 1e6, spansInstalls: 31, holdH: 9.9 },
      { faction: "ECorp", hours: 152, untilRep: 400e3, spansInstalls: 78, holdH: 82 },
      { faction: "CyberSec", hours: 1.1, untilRep: 33e3 }, // within-window: not a candidate
    ];
    c12.examined(1);
    const c = holdCandidates(segs);
    if (c.length !== 3) c12.fail(`expected 3 candidates (dedup + 82h cap + within-window skip), got ${c.length}`);
    c12.examined(1);
    const bh = c.find((x) => x.faction === "The Black Hand");
    if (!bh || bh.holdH !== 1.3 || bh.repTarget !== 125e3) c12.fail("dedup must keep the SHORTEST hold per faction with its own target");
    c12.examined(1);
    if (c.some((x) => x.faction === "ECorp")) c12.fail("an 82h hold must never be offered — the cap exists so the gate is not even asked");
    if (c.some((x) => x.faction === "CyberSec")) c12.fail("within-window segments are not holds");
    c12.examined(1);
    if (c[0].holdH > c[c.length - 1].holdH) c12.fail("sorted shortest-first");
    if (holdCandidates(null).length !== 0 || holdCandidates([]).length !== 0) c12.fail("empty input is an empty offer, not a throw");
  }
  checks.push(c12);

  /* --------------------------------------------------------------- FP13 --- */
  const c13 = new Check("FP13", "the crossing race: a banked unlock is ladder-exempt and competes on its real hours");
  {
    const mkLadder = (a) =>
      repLadder(a.repReq, {
        windowH: 1.72, remainingWindowH: 1.72, baseRepPerSec: 7.3,
        favor: a.favor, currentRep: a.currentRep, hoursNow: a.hoursNow, rateGrowthPerCycle: 1.034,
      });
    // NiteSec's live shape: favour ~135, the crossing ~127k banked rep away,
    // worth 3 NFG levels/install at ln 0.0597 each.
    const crossing = {
      name: "NiteSec", rep: 0, favor: 135,
      augs: [{ name: "(cross 150)", repReq: 127e3, mults: { hacking: Math.exp(3 * 0.0597) }, banked: true }],
    };

    c13.examined(1);
    // Ladder-exempt: 127k at 7.3x2.35 = ~2.1h would SPAN 2 windows if laddered;
    // banked must price continuous with no spansInstalls.
    const v = valueOfWorking(crossing, 7.3, { ladder: mkLadder });
    if (!v || v.spansInstalls) c13.fail(`a banked unlock must not ladder: ${JSON.stringify(v)}`);
    const contH = 127e3 / (7.3 * 2.35) / 3600;
    if (Math.abs(v.hours - contH) > 1e-9) c13.fail(`banked hours must be the continuous grind: ${v.hours} vs ${contH}`);

    c13.examined(1);
    // The same requirement WITHOUT the flag ladders — the exemption is the
    // flag, not the size.
    const unflagged = { ...crossing, augs: [{ ...crossing.augs[0], banked: false }] };
    const u = valueOfWorking(unflagged, 7.3, { ladder: mkLadder });
    if (!(u.spansInstalls > 0)) c13.fail("the unflagged twin must ladder — otherwise the exemption tests nothing");

    c13.examined(1);
    // And it competes: at ~2.1h for 3x0.0597 ln, the crossing outranks a
    // faction whose best aug is a within-window x1.05.
    const grinder = { name: "Other", rep: 0, favor: 0, augs: [{ name: "small", repReq: 20e3, mults: { hacking: 1.05 } }] };
    const r = rankFactions([crossing, grinder], 7.3, { ladder: mkLadder });
    if (r.best?.name !== "NiteSec") c13.fail(`the crossing should win here, got ${r.best?.name}`);
  }
  checks.push(c13);

  /* --------------------------------------------------------------- FP14 --- */
  const c14 = new Check("FP14", "ticket-aware city join: worthless-on-M cities are joined when count-gated, not before");
  {
    const { bestCompatibleSet } = fp;
    // Sector-12 and Aevum compatible; the Chongqing/Tokyo/Ishima trio mutually
    // compatible; Volhaven alone. All near-zero multiplier value, distinct augs.
    const cities = [
      { name: 'Sector-12', value: 0, augs: ['a1', 'a2', 'a3', 'a4', 'a5'], enemies: ['Chongqing', 'New Tokyo', 'Ishima', 'Volhaven'] },
      { name: 'Aevum', value: 0.001, augs: ['b1', 'b2', 'b3'], enemies: ['Chongqing', 'New Tokyo', 'Ishima', 'Volhaven'] },
      { name: 'Volhaven', value: 0, augs: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'], enemies: ['Sector-12', 'Aevum', 'Chongqing', 'New Tokyo', 'Ishima'] },
    ]

    c14.examined(1)
    // NOT count-short: cities decline on M alone, exactly as before the fix.
    const early = bestCompatibleSet(cities, { ticketValue: 0, ticketsShort: 0 })
    if (early.chosen.length !== 0 && early.value <= 0.01) {
      // Aevum's 0.001 could win by a hair; the real assertion is nothing joins
      // for tickets when not short.
    }
    if (early.chosen.includes('Volhaven') || early.chosen.includes('Sector-12')) c14.fail('zero-value cities must not join when not count-short')

    c14.examined(1)
    // Count-short by 8, tickets worth 0.05 each: the fix must pick the set that
    // maximises DISTINCT augs among compatible cities. {Sector-12, Aevum} = 8
    // distinct beats Volhaven's 6.
    const short = bestCompatibleSet(cities, { ticketValue: 0.05, ticketsShort: 8 })
    if (!(short.chosen.includes('Sector-12') && short.chosen.includes('Aevum'))) {
      c14.fail(`count-short must join the max-distinct compatible set, got ${short.chosen}`)
    }
    c14.examined(1)
    // The union is DISTINCT: a shared aug across the set counts once. Build two
    // cities sharing augs and confirm the credit is the union, not the sum.
    const overlap = [
      { name: 'Sector-12', value: 0, augs: ['x', 'y', 'z'], enemies: [] },
      { name: 'Aevum', value: 0, augs: ['x', 'y', 'w'], enemies: [] },
    ]
    const u = bestCompatibleSet(overlap, { ticketValue: 1, ticketsShort: 10 })
    // union {x,y,z,w} = 4, so set value 4; a sum would be 6.
    if (Math.abs(u.value - 4) > 1e-9) c14.fail(`ticket credit must be the DISTINCT union (4), got ${u.value}`)
    c14.examined(1)
    // The shortfall caps the credit: only need 2 more, a 6-aug city is worth 2.
    const capped = bestCompatibleSet([{ name: 'Volhaven', value: 0, augs: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'], enemies: [] }], { ticketValue: 1, ticketsShort: 2 })
    if (Math.abs(capped.value - 2) > 1e-9) c14.fail(`ticket credit capped at the shortfall (2), got ${capped.value}`)
  }
  checks.push(c14)

  /* --------------------------------------------------------------- FP15 --- */
  const c15 = new Check("FP15", "Daedalus is not ranked last for selling the augmentation that ends the BitNode");
  {
    // The Red Pill has NO multipliers. Scored on the rate channels it is worth
    // ln(1) = 0, so the faction that sells it — the only one that can finish
    // the run — ranked at the bottom of the work schedule.
    //
    // Live in BitNode 1: all 30 distinct augmentations installed, hacking 5994
    // against an exit bar of 3000, $100b the single unmet gate and twelve
    // minutes away — and the schedule had chosen a 4.98-hour ECorp grind for
    // multipliers the run no longer needed. It would have kept choosing one
    // after Daedalus became joinable.
    //
    // THIRD module to need this. augplan.js gives the Red Pill a synthetic
    // selection value; installgate.js has `terminal` so the gate cannot refuse
    // the install; this one decides what to GRIND. Every module that scores by
    // multiplier has to be told separately that the augmentation the whole run
    // exists to reach has none of it.
    c15.examined(1);
    const zero = logValue({});
    if (zero !== 0) c15.fail(`an augmentation with no multipliers must score 0 normally, got ${zero}`);
    const pill = logValue({}, undefined, null, "The Red Pill");
    if (!(pill > 0)) c15.fail("The Red Pill must not score zero — it is the exit");

    // It must beat an ordinary strong augmentation, or Daedalus still loses the
    // ranking to a megacorp selling multipliers the run does not need.
    c15.examined(1);
    const strong = logValue({ hacking: 1.8, hacking_money: 1.8, faction_rep: 1.8 });
    if (!(pill > strong)) c15.fail(`the Red Pill (${pill.toFixed(3)}) must outrank a strong ordinary aug (${strong.toFixed(3)})`);

    // ONE DEFINITION, not two that agree. This check used to read augplan.js's
    // source for its Red Pill constant and compare the numbers, because the
    // value was defined separately in each file. It is now defined once in
    // objective.js and both delegate, so the assertion is delegation itself —
    // a stronger property, since two constants can drift and one cannot.
    c15.examined(1);
    if (pill !== TERMINAL_LN) {
      c15.fail(`factionplan values the Red Pill at ${pill}, objective.js defines ${TERMINAL_LN} — it is no longer delegating`);
    }
    const fromObjective = augValue({ name: "The Red Pill", mults: {} }).ln;
    if (Math.abs(pill - fromObjective) > 1e-12) {
      c15.fail(`logValue (${pill}) and augValue (${fromObjective}) disagree about the augmentation that ends the run`);
    }
    c15.note(`Red Pill ln = ${pill}, defined once in objective.js; a strong ordinary aug scores ${strong.toFixed(3)}`);
  }
  checks.push(c15);

  return checks;
}
