// [OW] the derived objective — channel weights computed, not assumed.
//
// The weights replace the decision core's last hand-tuned constant, so what
// gets pinned here is the ARITHMETIC and its refusal semantics; the two
// elasticities feeding it are measured live by progress.js from the actual
// purchase optimiser, which no offline fixture can fake honestly.

import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const { deriveWeights, pathGainWeight, augValue, bindingGate, TERMINAL_LN, TICKET_LN, oneoffValue, ONEOFF_EFFECTS, PROGRAM_PRICE, POST_INSTALL_MONEY, moneyLn, homeLn } = await import("../../objective.js");
const { rootScripts, source, load } = await import("./ram.mjs");
await load();
const { progressFactor, RATE_CHANNELS, shouldInstall } = await import("../../installgate.js");

const H = 3600000;
const EXP = 1e9;

export async function run() {
  const checks = [];

  // The live shape at the time of writing: ~68 windows to the exit at the
  // measured 3.4%/install, elasticities near 1 and 0.6, batcher saturated.
  const live = { remainingWindows: 68, eBudget: 0.02, eRep: 0.012, hackingMult: 3.08, level: 813, chanceObs: 1, growShare: 0.45 };

  /* ---------------------------------------------------------------- OW1 --- */
  const c1 = new Check("OW1", "the weight arithmetic, hand-computed, hacking pinned to exactly 1");
  {
    const d = deriveWeights(live);
    c1.examined(1);
    if (!d) { c1.fail("the live shape must derive"); checks.push(c1); return checks; }
    const indirect = 68 * (0.02 + 0.012);
    const wH = 1 + indirect;
    c1.examined(1);
    if (d.weights.hacking !== 1) c1.fail("hacking is the exit axis — its weight is DEFINITIONALLY 1, keeping M's meaning");
    for (const [ch, expect] of [
      ["hacking_money", (68 * 0.02) / wH],
      ["hacking_speed", (68 * 0.02) / wH],
      ["hacking_chance", 0], // saturated batcher: chanceObs 1 -> a chance mult does nothing
      ["hacking_grow", (0.45 * 68 * 0.02) / wH],
      ["faction_rep", (68 * 0.012) / wH],
      ["hacking_exp", (Math.min(1, (32 * 3.08) / 813) * indirect) / wH],
    ]) {
      c1.examined(1);
      if (Math.abs(d.weights[ch] - expect) > 1e-12) c1.fail(`${ch}: ${d.weights[ch]}, hand-computed ${expect}`);
    }
    c1.note(
      `live shape: money/speed ${d.weights.hacking_money.toFixed(3)}, faction_rep ${d.weights.faction_rep.toFixed(3)}, ` +
        `grow ${d.weights.hacking_grow.toFixed(3)}, chance ${d.weights.hacking_chance.toFixed(3)}, exp ${d.weights.hacking_exp.toFixed(3)} — per unit of hacking`,
    );
  }
  checks.push(c1);

  /* ---------------------------------------------------------------- OW2 --- */
  const c2 = new Check("OW2", "the weights move the way the flywheel says they must");
  {
    const d = deriveWeights(live);
    c2.examined(1);
    // A longer remaining run values ACCELERATION more relative to direct progress.
    const longer = deriveWeights({ ...live, remainingWindows: 200 });
    if (!(longer.weights.hacking_money > d.weights.hacking_money)) c2.fail("more remaining windows must raise income weights");
    c2.examined(1);
    // An unsaturated batcher makes chance worth something again.
    const shaky = deriveWeights({ ...live, chanceObs: 0.8 });
    if (!(shaky.weights.hacking_chance > 0)) c2.fail("chanceObs 0.8 must give chance a positive weight");
    if (Math.abs(shaky.weights.hacking_chance - 0.2 * shaky.weights.hacking_money) > 1e-12) {
      c2.fail("chance transmits exactly its unsaturated fraction of the money weight");
    }
    c2.examined(1);
    // Rep elasticity rising (donations opening) raises faction_rep's weight.
    const donating = deriveWeights({ ...live, eRep: 0.05 });
    if (!(donating.weights.faction_rep > d.weights.faction_rep)) c2.fail("a bigger measured rep elasticity must lift faction_rep");
    c2.examined(1);
    // hacking_exp: the log-curve share, shrinking as level outgrows the mult.
    const higher = deriveWeights({ ...live, level: 2500 });
    if (!(higher.weights.hacking_exp < d.weights.hacking_exp)) c2.fail("exp's share must shrink as level grows");
  }
  checks.push(c2);

  /* ---------------------------------------------------------------- OW3 --- */
  const c3 = new Check("OW3", "refusal and the flat fallback: no guessed weight can reach a purchase");
  {
    c3.examined(1);
    for (const bad of [
      {},
      { ...live, remainingWindows: 0 },
      { ...live, eBudget: NaN },
      { ...live, eRep: -1 },
      { ...live, chanceObs: undefined },
      { ...live, growShare: 1.5 },
      { ...live, level: 0 },
    ]) {
      if (deriveWeights(bad) !== null) c3.fail(`unreadable inputs must refuse: ${JSON.stringify(bad).slice(0, 60)}`);
    }
    c3.examined(1);
    // progressFactor with null weights IS the flat basket — bit-identical.
    const stats = [{ hacking: 1.2, hacking_money: 1.5, faction_rep: 1.3 }];
    if (progressFactor(stats, RATE_CHANNELS, null) !== progressFactor(stats)) c3.fail("null weights must be the flat basket exactly");
    c3.examined(1);
    // With weights: exponents apply; a missing per-channel weight falls to 1,
    // never 0 — zeroing a channel silently is the two-day HiveMind bug.
    const w = { hacking: 1, hacking_money: 0.5 };
    const got = progressFactor(stats, RATE_CHANNELS, w);
    const expect = 1.2 * Math.pow(1.5, 0.5) * 1.3;
    if (Math.abs(got - expect) > 1e-12) c3.fail(`weighted factor ${got}, expected ${expect} (faction_rep missing a weight must exponent at 1)`);
    c3.examined(1);
    // Weight 0 is a real value (chance, saturated) and must zero the channel.
    const z = progressFactor([{ hacking_chance: 2 }], RATE_CHANNELS, { hacking_chance: 0 });
    if (z !== 1) c3.fail("an explicit zero weight must nullify the channel");
  }
  checks.push(c3);

  /* ---------------------------------------------------------------- OW4 --- */
  const c4 = new Check("OW4", "path-gain weights: charisma priced by what the desk option gains, zero when it gains nothing");
  {
    c4.examined(1);
    // Hand-computed: a x1.5 charisma probe lifts the desk path 0.05 ln/h past
    // the incumbent, 60 windows x 1.6h remain, hacking's raw is 3.2.
    const w = pathGainWeight({ rateGain: 0.05, lnK: Math.log(1.5), remainingHours: 96, rawHacking: 3.2 });
    const expect = (0.05 / Math.log(1.5)) * (96 / 3.2);
    if (Math.abs(w - expect) > 1e-12) c4.fail(`weight ${w}, hand-computed ${expect}`);
    c4.examined(1);
    // THE FLOOR IS THE POINT: charisma bought for a path never taken buys
    // nothing — a probe that fails to beat the incumbent prices at exactly 0,
    // a real answer distinct from null's refusal.
    if (pathGainWeight({ rateGain: -0.2, lnK: 0.4, remainingHours: 96, rawHacking: 3.2 }) !== 0) {
      c4.fail("a losing probe must weight 0, not negative");
    }
    if (pathGainWeight({ rateGain: 0, lnK: 0.4, remainingHours: 96, rawHacking: 3.2 }) !== 0) c4.fail("zero gain is zero weight");
    c4.examined(1);
    for (const bad of [
      {},
      { rateGain: 0.05, lnK: 0, remainingHours: 96, rawHacking: 3.2 },
      { rateGain: 0.05, lnK: 0.4, remainingHours: NaN, rawHacking: 3.2 },
      { rateGain: 0.05, lnK: 0.4, remainingHours: 96, rawHacking: 0 },
    ]) {
      if (pathGainWeight(bad) !== null) c4.fail(`unreadable inputs must refuse: ${JSON.stringify(bad)}`);
    }
  }
  checks.push(c4);

  /* ---------------------------------------------------------------- OB1 --- */
  const c5 = new Check("OB1", "valuation has ONE owner: nothing outside objective.js scores an augmentation");
  {
    // THE ANTI-DRIFT INVARIANT, and the reason it is structural rather than
    // behavioural.
    //
    // Three modules used to answer "what is this augmentation worth" —
    // augplan.valueOf, factionplan.logValue, progress.heldM — each calling
    // progressFactor directly, each individually correct, each with its own
    // passing tests. Every exception then had to be taught three times, and it
    // never was:
    //
    //   - The Red Pill (no multipliers, ends the node) was taught to augplan
    //     and installgate but NOT factionplan, so Daedalus scored ln(1) = 0 and
    //     ranked last among factions while the schedule picked a 4.98-hour
    //     ECorp grind for multipliers the run no longer needed.
    //   - progress.heldM used the FLAT basket while plan.M used the DERIVED
    //     weights, then multiplied them together into the number the install
    //     gate, rho and the lifetimes ledger all consume.
    //
    // No single-module test could catch either: the bug was never inside a
    // module, it was BETWEEN them. The invariant that expresses it is not
    // "each scorer is right" but "there is only one scorer" — and that is a
    // property of the source, so this checks the source.
    const OWNER = "objective.js";
    const offenders = [];
    for (const name of rootScripts()) {
      if (name === OWNER || name === "installgate.js") continue; // owner, and the primitive's home
      const code = (source(name) ?? "")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
      if (/\bprogressFactor\s*\(/.test(code)) offenders.push(name);
    }
    c5.examined(1);
    if (offenders.length) {
      c5.fail(`${offenders.length} module(s) score augmentations directly: ${offenders.join(", ")}`,
        "call objective.augValue instead. A local scorer is a second definition of the objective, and every exception " +
        "then has to be taught to it separately — which is how the augmentation that ENDS the BitNode came to be worth " +
        "zero to the faction ranking.");
    }
    c5.note(`progressFactor is called only by ${OWNER} (and defined in installgate.js)`);

    // CONFORMANCE: the hard cases, and what every consumer must agree they are
    // worth. A table rather than assertions scattered per module, so adding a
    // case teaches all of them at once.
    c5.examined(1);
    const flat = { hacking: 1.5 };
    for (const [label, aug, ctx, want] of [
      ["an ordinary augmentation", { name: "X", mults: flat }, {}, Math.log(1.5)],
      ["one with no multipliers", { name: "X", mults: {} }, {}, 0],
      ["THE RED PILL — no multipliers, ends the node", { name: "The Red Pill", mults: {} }, {}, TERMINAL_LN],
      ["a ticket while the count gate binds", { name: "X", mults: {} }, { countShort: 5, isTicket: true }, TICKET_LN],
      ["the same ticket once the count is met", { name: "X", mults: {} }, { countShort: 0, isTicket: true }, 0],
      ["a ticket the caller did not nominate", { name: "X", mults: {} }, { countShort: 5 }, 0],
    ]) {
      const got = augValue(aug, ctx);
      if (Math.abs(got.ln - want) > 1e-12) c5.fail(`${label}: ln ${got.ln}, expected ${want}`);
    }

    // THE SPLIT IS LOAD-BEARING. A synthetic value that reaches a reported M
    // contaminates rho, the install gate and the lifetimes ledger — all of
    // which spend real hours against that number.
    c5.examined(1);
    const pill = augValue({ name: "The Red Pill", mults: {} });
    if (pill.real !== 0 || pill.synthetic !== TERMINAL_LN || pill.kind !== "terminal") {
      c5.fail(`the Red Pill must report real 0 and synthetic ${TERMINAL_LN}: ${JSON.stringify(pill)}`);
    }
    const tick = augValue({ name: "X", mults: flat }, { countShort: 5, isTicket: true });
    if (Math.abs(tick.real - Math.log(1.5)) > 1e-12 || tick.synthetic !== TICKET_LN) {
      c5.fail(`a ticket keeps its REAL value and carries the dominance separately: ${JSON.stringify(tick)}`);
    }
    if (Math.abs(tick.ln - (tick.real + tick.synthetic)) > 1e-12) c5.fail("ln must be real + synthetic, always");
  }
  checks.push(c5);

  /* ---------------------------------------------------------------- OB2 --- */
  const c6 = new Check("OB2", "bindingGate: installs are refused while they would destroy the gate the exit waits on");
  {
    const base = { countShort: 0, joinMoneyShort: 0, terminalShort: 0, exitLevelReached: true };

    // THE MULTIPLIER BRANCH OUTRANKS EVERYTHING, and it is what keeps this rule
    // from deadlocking: if the exit level is not reachable, installing is
    // exactly how that gets fixed, so nothing may hold it.
    c6.examined(1);
    for (const extra of [{}, { joinMoneyShort: 100e9 }, { terminalShort: 598e9 }, { countShort: 9 }]) {
      const g = bindingGate({ ...base, ...extra, exitLevelReached: false });
      if (g.gate !== "multiplier" || g.destroyedByInstall) c6.fail(`unreachable exit level must never hold an install: ${JSON.stringify(g)}`);
    }

    // The two gates an install DESTROYS. Money resets to $1262, reputation to
    // zero, and faction membership with them — so each is re-entered every life.
    c6.examined(1);
    const join = bindingGate({ ...base, joinMoneyShort: 100e9 });
    if (join.gate !== "money" || !join.destroyedByInstall) c6.fail(`the $100b join must hold installs: ${JSON.stringify(join)}`);

    // THE ONE TRACED FROM SOURCE RATHER THAN OBSERVED. Once Daedalus is joined
    // the join claim goes to zero and this gate read `none` — while the run
    // still needed ~$598b for the donation that buys the augmentation ending
    // the node, at an install cadence of 0.13-0.16h. Seven installs would fire
    // inside that window, each wiping money, reputation AND membership: hold to
    // $100b, join, install, lose it, repeat, forever.
    c6.examined(1);
    const terminal = bindingGate({ ...base, terminalShort: 598e9 });
    if (terminal.gate !== "terminal" || !terminal.destroyedByInstall) {
      c6.fail(`the terminal purchase must hold installs too: ${JSON.stringify(terminal)}`);
    }

    // Count still ranks above both, and does NOT hold — an install is how the
    // count advances, when the plan carries an augmentation.
    c6.examined(1);
    const count = bindingGate({ ...base, countShort: 9, joinMoneyShort: 100e9, terminalShort: 598e9 });
    if (count.gate !== "count" || count.destroyedByInstall) c6.fail(`count must outrank and must not hold: ${JSON.stringify(count)}`);

    // Nothing outstanding: no opinion, no hold.
    c6.examined(1);
    const none = bindingGate(base);
    if (none.gate !== "none" || none.destroyedByInstall) c6.fail(`a satisfied exit must not hold installs: ${JSON.stringify(none)}`);

    // UNREADABLE IS "NO OPINION", never "nothing binds" — the whole failure
    // being fixed is an objective that confidently scored the wrong thing.
    c6.examined(1);
    for (const bad of [{}, { ...base, countShort: NaN }, { ...base, terminalShort: -1 }, { ...base, exitLevelReached: "yes" }]) {
      const g = bindingGate(bad);
      if (g.gate !== null || g.destroyedByInstall) c6.fail(`unreadable exit state must yield no opinion: ${JSON.stringify(bad)}`);
    }

    // And the gate obeys it, including the override that must survive it: the
    // terminal augmentation IS the exit, so buying it can never be held back.
    c6.examined(1);
    const held = shouldInstall({ ageMs: 8 * H, M: 1.9, queued: 6, exp: EXP, prev: { ageMs: 7 * H, M: 1.5 }, futures: [], binding: terminal });
    if (held.install) c6.fail(`installgate ignored a destructive binding gate: ${held.why}`);
    if (!/DESTROY/.test(held.why)) c6.fail(`the hold must name what it protects: ${held.why}`);
    const pill = shouldInstall({ ageMs: 8 * H, M: 1, queued: 1, exp: EXP, futures: [], binding: terminal, terminal: true });
    if (!pill.install) c6.fail("the terminal install must override its own binding gate — buying the exit IS the exit");
    c6.note("holds on join money and on the terminal purchase, never on an unreachable exit level, never over the Red Pill");
  }
  checks.push(c6);

  // ---------------------------------------------------------------------
  const cOne = new Check("OB3", "augmentations whose value is not in their multipliers are priced, not scored zero");
  {
    // progressFactor reads RATE_CHANNELS off aug.mults. CashRoot Starter Kit
    // has none of them — its value is $1m at every install plus BruteSSH.exe —
    // so it scored M = 1, ln 0, and was never bought at any price. Same family
    // as The Red Pill, which already had an override for exactly this reason.
    const ctx = { eBudget: 0.25, remainingWindows: 4, money: POST_INSTALL_MONEY, ownedPrograms: new Set() };

    cOne.examined(1);
    const cash = oneoffValue({ name: "CashRoot Starter Kit" }, ctx);
    if (!(cash.ln > 0)) cOne.fail(`CashRoot must price above zero when money is scarce, got ln=${cash.ln}`);
    const expect = 4 * 0.25 * Math.log((1262 + 1e6 + 500e3) / 1262);
    if (Math.abs(cash.ln - expect) > 1e-9) cOne.fail(`CashRoot ln ${cash.ln} != derived ${expect}`);

    // AND IT MUST FADE. The grant is priced against the LIVE budget, because
    // eBudget is a local elasticity: referencing the $1262 opening while rich
    // extrapolates that slope across three orders of magnitude and was what
    // priced CashRoot at ln 7.08 — fourteen install cycles — in the first cut.
    cOne.examined(2);
    const rich = oneoffValue({ name: "CashRoot Starter Kit" }, { ...ctx, money: 50e9 });
    if (!(rich.ln < cash.ln)) cOne.fail("the same grant must be worth LESS against a larger budget");
    if (!(rich.ln < 0.01)) cOne.fail(`$1.5m against $50b must price as noise, got ln=${rich.ln}`);
    cOne.note(`CashRoot: ln ${cash.ln.toFixed(3)} at $1262 -> ln ${rich.ln.toExponential(1)} at $50b — ${cash.reason}`);

    // A program already owned is not a grant. This is what stops the same
    // program being paid for twice across a plan.
    cOne.examined(2);
    const dup = oneoffValue({ name: "PCMatrix" }, { ...ctx, ownedPrograms: new Set(["DeepscanV1.exe", "AutoLink.exe"]) });
    if (dup.ln !== 0) cOne.fail(`granting programs already owned must be worth 0, got ${dup.ln}`);
    if (!dup.reason) cOne.fail("a zero must carry its reason");

    // REFUSAL, not a guess. Without a measured elasticity there is no honest
    // way to turn dollars into ln, and a fabricated coefficient here would be
    // the exact mistake CLAUDE.md names twice.
    cOne.examined(3);
    for (const [label, bad] of [
      ["no eBudget", { remainingWindows: 4 }],
      ["no window count", { eBudget: 0.25 }],
      ["negative eBudget", { eBudget: -1, remainingWindows: 4 }],
    ]) {
      const r = oneoffValue({ name: "CashRoot Starter Kit" }, bad);
      if (r.ln !== 0) cOne.fail(`${label}: must refuse with ln 0, got ${r.ln}`);
      if (!r.reason) cOne.fail(`${label}: a refusal must say why`);
    }

    // The focus-penalty implant is a RATE effect, not a budget one, and is
    // worth exactly zero while the run works focused — which it does. Zero for
    // a stated reason is the right answer, not a missing feature.
    cOne.examined(4);
    const focused = oneoffValue({ name: "Neuroreceptor Management Implant" }, ctx);
    if (focused.ln !== 0) cOne.fail(`focused work: the implant buys nothing, got ${focused.ln}`);
    if (!/focused/.test(String(focused.reason))) cOne.fail("must say why it is worth nothing");
    const unfocused = oneoffValue({ name: "Neuroreceptor Management Implant" }, { ...ctx, unfocused: true });
    const want = Math.log(progressFactor([{ faction_rep: 1 / 0.8 }], RATE_CHANNELS, null));
    if (Math.abs(unfocused.ln - want) > 1e-12) cOne.fail(`unfocused: ln ${unfocused.ln} != faction_rep x1.25 (${want})`);
    cOne.note(`focus implant: 0 focused, ${unfocused.ln.toFixed(4)} unfocused (= faction_rep x1/0.8)`);

    // An ordinary augmentation must be untouched by any of this.
    cOne.examined(5);
    const plain = oneoffValue({ name: "Neural Accelerator" }, ctx);
    if (plain.ln !== 0 || plain.kind !== null) cOne.fail("an ordinary augmentation must not acquire a one-off value");


    // AND IT MUST REACH THE PLANNER. oneoffValue being correct is useless if
    // augValue — the single scorer every ranking goes through — does not add
    // it. Neurolink is the case that proves it composes rather than replaces:
    // real hacking multipliers AND two granted port programs.
    cOne.examined(7);
    const poor = { ...ctx, money: POST_INSTALL_MONEY };
    const neuro = { name: "BitRunners Neurolink", mults: { hacking: 1.15 } };
    const scored = augValue(neuro, poor);
    const multOnly = Math.log(progressFactor([neuro.mults], RATE_CHANNELS, null));
    if (!(scored.ln > multOnly)) {
      cOne.fail(`augValue must add the program grant on top of the multipliers: ${scored.ln} vs ${multOnly}`);
    }
    if (Math.abs(scored.real - multOnly) > 1e-12) cOne.fail("`real` must stay the multiplier-only value");
    if (!(scored.synthetic > 0)) cOne.fail("the grant must be reported as synthetic, not folded into real");
    cOne.note(`Neurolink at $1262: mults ln ${multOnly.toFixed(4)} + grant ${scored.synthetic.toFixed(3)} = ${scored.ln.toFixed(3)}`);

    // An ordinary augmentation must score exactly as before this existed.
    cOne.examined(8);
    const before = Math.log(progressFactor([{ hacking: 1.1 }], RATE_CHANNELS, null));
    const after = augValue({ name: "Neural Accelerator", mults: { hacking: 1.1 } }, poor);
    if (Math.abs(after.ln - before) > 1e-12) cOne.fail(`ordinary augmentation changed value: ${after.ln} vs ${before}`);
    if (after.synthetic !== 0) cOne.fail("an ordinary augmentation must carry no synthetic value");

    // The table is DATA read out of game source; every program it grants must
    // have a price, or the valuation silently drops part of the grant.
    cOne.examined(6);
    for (const [name, eff] of Object.entries(ONEOFF_EFFECTS)) {
      for (const prog of eff.programs ?? []) {
        if (!(prog in PROGRAM_PRICE)) cOne.fail(`${name} grants ${prog}, which has no price in PROGRAM_PRICE`);
      }
    }
    cOne.note(`${Object.keys(ONEOFF_EFFECTS).length} one-off augmentations priced; every granted program has a darkweb price`);
  }
  checks.push(cOne);


  // ---------------------------------------------------------------------
  const cJoin = new Check("OB4", "the exit money gate binds until MEMBERSHIP, not until the money is affordable");
  {
    // joinMoneyShort is a BUDGET HOLD — "how much must I keep back" — and is
    // correctly 0 once the balance covers it. Read as a state signal it
    // inverts: having the money made bindingGate report 'none' ("no exit gate
    // is outstanding"), which freed the install gate to spend it.
    //
    // Live in BitNode 5, six times in three hours: $6,267b / $6,317b / $7,479b
    // / $29,614b / $30,678b accumulated against a $100b requirement, and an
    // install every time, resetting to $1262 without ever joining Daedalus.
    // Distinct augmentations stayed at 36 throughout, so the installs were not
    // advancing the count gate either.
    const base = { countShort: 0, terminalShort: 0, exitLevelReached: true };

    cJoin.examined(1);
    const short = bindingGate({ ...base, joinMoneyShort: 91e9 });
    if (short.gate !== "money" || !short.destroyedByInstall) cJoin.fail("being short must bind the money gate destructively");

    // THE REGRESSION THIS EXISTS FOR.
    cJoin.examined(2);
    const afforded = bindingGate({ ...base, joinMoneyShort: 0, exitFactionJoined: false, exitFactionMoneyReq: 100e9 });
    if (afforded.gate !== "money") cJoin.fail(`money in hand but NOT joined must still bind the money gate, got '${afforded.gate}'`);
    if (!afforded.destroyedByInstall) cJoin.fail("an install there destroys the money without ever using it — must be destructive");
    if (!/ALREADY IN HAND/.test(String(afforded.why))) cJoin.fail("the verdict must distinguish 'afforded but unjoined' from 'short'");

    // Once joined the gate must RELEASE, or the run can never install again.
    cJoin.examined(3);
    const joined = bindingGate({ ...base, joinMoneyShort: 0, exitFactionJoined: true, exitFactionMoneyReq: 100e9 });
    if (joined.gate === "money") cJoin.fail("after joining, the money gate must release");

    // Unknown membership falls back to the shortfall test. Binding on an
    // unreadable signal would block every install for ever — a deadlock, which
    // is the exact failure this ladder was built to avoid.
    cJoin.examined(4);
    const unknown = bindingGate({ ...base, joinMoneyShort: 0, exitFactionMoneyReq: 100e9 });
    if (unknown.gate === "money") cJoin.fail("unknown membership must NOT bind — that is a deadlock, not caution");
    cJoin.note("short -> bind; afforded+unjoined -> bind (the fix); joined -> release; unknown -> old behaviour");
  }
  checks.push(cJoin);

  // ---------------------------------------------------------------------
  const cHome = new Check("OB5", "homeLn: a home GB earns income x deltaGB / ramTotal per second every remaining window, priced by moneyLn at the probe budget; any unreadable input holds the claim");
  {
    cHome.examined(1);
    const o = { incomePerSec: 1e5, deltaGB: 512, ramTotal: 1024, windowH: 2, cost: 1e9, eBudget: 0.4, remainingWindows: 5, budget: 5e8, join: { claim: 0, valueLn: 10, money: 1e8 } };
    const h = homeLn(o);
    const dollars = (1e5 * 512 * 2 * 3600) / 1024; // 3.6e8 per window
    if (Math.abs(h.dollarsPerWindow - dollars) > 1e-6) cHome.fail("dollars per window is income x deltaGB / ramTotal x window seconds");
    const expect = moneyLn(dollars, { money: 5e8, eBudget: 0.4, remainingWindows: 5 }).ln;
    if (Math.abs(h.ln - expect) > 1e-12) cHome.fail("ln is moneyLn of those dollars at the probe budget");
    if (Math.abs(h.lnPerDollar - expect / 1e9) > 1e-21) cHome.fail("ln per dollar divides by the upgrade cost");
    for (const k of ["incomePerSec", "deltaGB", "ramTotal", "windowH", "cost"]) {
      cHome.examined(1);
      const r = homeLn({ ...o, [k]: null });
      if (r.ln !== null || r.lnPerDollar !== null || !r.reason) cHome.fail(`${k} unreadable must be null with a reason`);
    }
    cHome.examined(1);
    const noE = homeLn({ ...o, eBudget: null });
    if (noE.ln !== null || !/elasticity/.test(noE.reason)) cHome.fail("without the elasticity the reason names it");
    if (h.lnJoin !== 0 || h.lnPlan !== expect) cHome.fail("a join claim of 0 is a known nothing: lnJoin 0, lnPlan carries the whole figure");
    cHome.note("hand-checked against moneyLn; six refusal shapes");
  }
  checks.push(cHome);

  const cHomeJoin = new Check("OB6", "homeLn's join channel: home's extra income before the exit faction's requirement is met, priced at the join rival's valueLn/claim; capped at one window; with eBudget 0 home beats the join hold exactly when it pays back before the join");
  {
    const base = { incomePerSec: 1e5, deltaGB: 512, ramTotal: 1024, windowH: 2, cost: 1e9, eBudget: 0, remainingWindows: 5, budget: 5e8 };
    cHomeJoin.examined(1);
    // Join 5e9 away at 1e5/s -> 5e4 s to the join, inside a 7200 s window? No: capped at the window.
    const far = homeLn({ ...base, join: { claim: 100e9, valueLn: 10, money: 95e9 } });
    const rate = (1e5 * 512) / 1024; // extra income per second
    const expectFar = rate * 7200 * (10 / 100e9);
    if (Math.abs(far.lnJoin - expectFar) > 1e-18) cHomeJoin.fail(`join channel capped at one window: ${far.lnJoin} != ${expectFar}`);
    if (far.lnPlan !== 0 || Math.abs(far.ln - expectFar) > 1e-18) cHomeJoin.fail("with eBudget 0 the plan channel is 0 and the join channel is the whole figure");
    cHomeJoin.examined(1);
    // Join 1e8 away at 1e5/s -> 1000 s, inside the window: the channel runs 1000 s only.
    const near = homeLn({ ...base, join: { claim: 100e9, valueLn: 10, money: 100e9 - 1e8 } });
    if (Math.abs(near.lnJoin - rate * 1000 * (10 / 100e9)) > 1e-18) cHomeJoin.fail("join channel runs only until the join");
    cHomeJoin.examined(1);
    // Payback test against the rival budget.js prices the join at (valueLn/claim per dollar):
    // home wins iff rate x min(T, window) > cost. Here 5e4 x 7200 = 3.6e8 < 1e9 -> home loses.
    const rival = 10 / 100e9;
    if (!(far.lnPerDollar < rival)) cHomeJoin.fail("a block that does not pay back before the join loses to the join rival");
    const cheap = homeLn({ ...base, cost: 1e8, join: { claim: 100e9, valueLn: 10, money: 95e9 } });
    if (!(cheap.lnPerDollar > rival)) cHomeJoin.fail("a block that pays back inside the window beats the join rival");
    cHomeJoin.examined(1);
    for (const j of [undefined, null, 5, { claim: null, valueLn: 10, money: 1 }, { claim: 1e9, valueLn: null, money: 1 }, { claim: 1e9, valueLn: 10, money: null }, { claim: -1, valueLn: 10, money: 1 }]) {
      const r = homeLn({ ...base, join: j });
      if (r.ln !== null || r.lnPerDollar !== null || !r.reason) cHomeJoin.fail(`join input ${JSON.stringify(j)} unreadable must refuse with a reason`);
    }
    cHomeJoin.note("window cap, join cap, payback boundary both sides, seven refusal shapes");
  }
  checks.push(cHomeJoin);

  const c7 = new Check("OB7", "combat multipliers are priced by the karma they buy, and only while a gang is actually pending");
  {
    const { karmaValue } = await import("../../objective.js");
    const bp = await import("../../bodyplan.js");
    // RATE_CHANNELS carries no combat channel, so this aug is worth exactly
    // nothing to progressFactor — which is the hole this function fills.
    const aug = { name: "Wired Reflexes", mults: { strength: 1.05, dexterity: 1.05 } };
    const { RATE_CHANNELS, progressFactor } = await import("../../installgate.js");
    c7.examined(1);
    if (RATE_CHANNELS.some((c) => ["strength", "defense", "dexterity", "agility"].includes(c))) {
      c7.fail("RATE_CHANNELS now has a combat channel — karmaValue may be double-counting");
    }
    if (progressFactor([aug.mults], RATE_CHANNELS, null) !== 1) c7.fail("fixture: a combat-only aug must score M = 1 through the normal path");

    // A grind model that simply gets faster with a better multiplier.
    const grind = (m) => (m ? 36.4 / ((m.strength + m.defense + m.dexterity + m.agility) / 4) : 36.4);
    const base = { gangPending: true, gangIncomePerSec: 1e6, money: 1e9, eBudget: 0.3, remainingWindows: 20, grindHours: grind };

    c7.examined(1);
    const v = karmaValue(aug, base);
    if (!(v.ln > 0)) c7.fail(`a combat aug with a gang pending must price above zero, got ${JSON.stringify(v)}`);
    if (v.kind !== "karma:combat") c7.fail(`kind must name the channel, got ${v.kind}`);
    if (!(v.hoursSaved > 0)) c7.fail("hoursSaved must be reported");
    // The value IS the money bridge on the hours saved — no new constant.
    const { moneyLn } = await import("../../objective.js");
    const want = moneyLn(base.gangIncomePerSec * v.hoursSaved * 3600, base).ln;
    if (Math.abs(v.ln - want) > 1e-9) c7.fail(`value must be moneyLn of the earlier gang income: ${v.ln} vs ${want}`);

    // More multiplier, more value — the direction, not a knife-edge sign.
    c7.examined(1);
    const bigger = karmaValue({ name: "x", mults: { strength: 2, defense: 2, dexterity: 2, agility: 2 } }, base);
    if (!(bigger.ln > v.ln)) c7.fail(`a larger combat multiplier must be worth more: ${bigger.ln} vs ${v.ln}`);

    // Every refusal named, and distinguishable from "worth nothing".
    c7.examined(6);
    const cases = [
      [{ name: "n", mults: { hacking: 1.5 } }, base, null, "an aug with no combat multipliers is simply not this channel's business"],
      [aug, { ...base, gangPending: false }, /no gang pending/, "no gang pending"],
      [aug, { ...base, gangKarmaWaived: true }, /without karma/, "a node that waives the karma gate"],
      [aug, { ...base, gangIncomePerSec: null }, /gang income/, "no measured gang income"],
      [aug, { ...base, grindHours: undefined }, /grind model/, "no grind model"],
      [aug, { ...base, eBudget: null }, /elasticity/, "an unmeasured elasticity"],
    ];
    for (const [a, ctx, re, what] of cases) {
      const r = karmaValue(a, ctx);
      if (r.ln !== 0) c7.fail(`${what} must price at 0, got ${r.ln}`);
      if (re && !re.test(r.reason ?? "")) c7.fail(`${what} must say why, got ${JSON.stringify(r.reason)}`);
      if (!re && r.reason !== null) c7.fail(`${what} should carry no reason, got ${JSON.stringify(r.reason)}`);
    }
    // WIRED: augValue must actually consult it, or this is dead code — the
    // exact shape of the orphaned-capability bug B7.11 exists to catch.
    c7.examined(1);
    const { augValue } = await import("../../objective.js");
    const scored = augValue(aug, base);
    if (!(scored.ln > 0)) c7.fail(`augValue must pick up the karma channel, got ${JSON.stringify(scored)}`);
    if (!/karma:combat/.test(scored.kind ?? "")) c7.fail(`augValue must name the channel, got ${scored.kind}`);
    const unpriced = augValue(aug, { ...base, gangPending: false });
    if (unpriced.ln !== 0) c7.fail(`with no gang pending a combat-only aug is still worth nothing, got ${unpriced.ln}`);
    // Real multipliers AND combat: both, not one instead of the other.
    const both = augValue({ name: "mixed", mults: { hacking: 1.5, strength: 1.05, defense: 1.05, dexterity: 1.05, agility: 1.05 } }, base);
    const hackOnly = augValue({ name: "hack", mults: { hacking: 1.5 } }, base);
    if (!(both.ln > hackOnly.ln)) c7.fail(`an aug with hacking AND combat must beat hacking alone: ${both.ln} vs ${hackOnly.ln}`);
    if (Math.abs(both.real - hackOnly.real) > 1e-12) c7.fail("the real (multiplier) component must be unchanged by the karma channel");

    // A grind the aug does not shorten is zero WITH a reason, not unpriced.
    c7.examined(1);
    const flat = karmaValue(aug, { ...base, grindHours: () => 20 });
    if (flat.ln !== 0 || !/no hours saved/.test(flat.reason ?? "")) c7.fail(`an aug that saves nothing must say so: ${JSON.stringify(flat)}`);

    // The sawtooth itself: an install resets skills, so the grind across
    // cycles must be strictly worse than one continuous stretch.
    c7.examined(1);
    const person = {
      skills: { hacking: 283, strength: 156, defense: 81, dexterity: 81, agility: 81, charisma: 1, intelligence: 79 },
      exp: { hacking: 0, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0 },
      mults: Object.fromEntries(["strength", "defense", "dexterity", "agility", "charisma", "hacking"].flatMap((k) => [[k, 1], [`${k}_exp`, 1]]).concat([["crime_success", 1.586], ["crime_money", 1]])),
      karma: -6369, numPeopleKilled: 0, money: 38e6,
    };
    for (const st of ["strength", "defense", "dexterity", "agility"]) person.exp[st] = Math.exp((person.skills[st] + 200) / 32) - 534.6;
    const node = { CrimeSuccessRate: 1, CrimeMoney: 0.2, CrimeExpGain: 0.5 };
    const continuous = bp.crimeLeg({ karma: -54000 }, person, node, { focus: 1 });
    const sawtooth = bp.karmaGrindAcrossCycles(person, node, { karmaTarget: -54000, cycleHours: 1.5, focus: 1 });
    if (!continuous || !sawtooth) c7.fail("could not simulate the grind both ways");
    else {
      if (!(sawtooth.hours > continuous.hours)) c7.fail(`installs reset skills, so the sawtooth must cost more: ${sawtooth.hours} vs ${continuous.hours}`);
      const better = bp.karmaGrindAcrossCycles({ ...person, mults: { ...person.mults, strength: 2, defense: 2, dexterity: 2, agility: 2 } }, node, { karmaTarget: -54000, cycleHours: 1.5, focus: 1 });
      if (!(better.hours < sawtooth.hours)) c7.fail(`a combat multiplier must shorten the sawtooth: ${better.hours} vs ${sawtooth.hours}`);
      c7.note(`grind ${continuous.hours.toFixed(1)}h continuous vs ${sawtooth.hours.toFixed(1)}h across 1.5h install cycles; combat mult 2 brings it to ${better.hours.toFixed(1)}h`);
    }
  }
  checks.push(c7);

  const cew = new Check("OB-EXIT", "channel weights are the exit's own sensitivities per ln of the next batch, normalised to hacking");
  {
    const ob = await import("../../objective.js");
    const { bestExitPolicy, spendRuns } = await import("../../exitplan.js");
    cew.examined(5);
    const now = Date.now();
    const ladder = [0, 0.5, 1, 2].map((f) => ({ money: 1e10 * f, gains: { hacking: 1.5, rep: 1.2, income: 1.1, exp: 1.05 } }));
    const inputs = { money: 1e9, incomePerSec: 1e8, hacking: 800, hackingExp: 1e9, hackingMult: 1.5, expPerSec: 1e5, repPerSec: 30, exitRep: 0, exitFavor: 0, terminalRep: 2.5e6, exitLevel: 3000, joinMoney: 100e9, cycleHours: 4, multGainPerCycle: 1.1 };
    const rec = { at: new Date(now).toISOString(), lastAugReset: 1, W: 2, finalWindow: false, moneyAtW: 1e10, gainsByMoney: ladder, eRep: 0.2, eBudget: 0.1, inputs };
    const r = ob.exitWeights(rec, 1, bestExitPolicy, spendRuns, { chanceObs: 0.9, growShare: 0.3 }, now);
    if (!r) cew.fail("a fresh record must price the weights");
    else {
      if (r.weights.hacking !== 1) cew.fail("hacking is the unit");
      if (!(r.weights.faction_rep > 0)) cew.fail(`a ground rep leg must make faction_rep worth something: ${JSON.stringify(r.sensitivities)}`);
      if (Math.abs(r.weights.hacking_chance - 0.1 * r.weights.hacking_money) > 1e-12) cew.fail("chance carries the unsaturated share of the income weight");
    }
    if (ob.exitWeights({ ...rec, lastAugReset: 2 }, 1, bestExitPolicy, spendRuns, { chanceObs: 0.9, growShare: 0.3 }, now) !== null) cew.fail("another life's record refuses (deriveWeights is the named fallback)");
    if (ob.exitWeights({ ...rec, finalWindow: true }, 1, bestExitPolicy, spendRuns, { chanceObs: 0.9, growShare: 0.3 }, now) !== null) cew.fail("the final window has no next batch to weigh — refuse");
  }
  checks.push(cew);

  const ckx = new Check("OB-KARMA-EXIT", "a combat aug's value is the simulated exit its shorter karma grind saves, in hacking-ln");
  {
    const { karmaValue } = await import("../../objective.js");
    ckx.examined(3);
    const aug = { name: "x", mults: { strength: 1.5, defense: 1.5, dexterity: 1.5, agility: 1.5 } };
    const ctx = { gangPending: true, grindHours: (lift) => (lift ? 20 : 30), gangExitH: (H) => 50 + H, hoursPerLn: 5 };
    const v = karmaValue(aug, ctx);
    if (Math.abs(v.ln - (80 - 70) / 5) > 1e-12) ckx.fail(`ln must be the exit hours saved / hours per ln: ${JSON.stringify(v)}`);
    // No measured gang income is fine on the exit path (the gang's trajectory is simulated).
    if (!(karmaValue(aug, { ...ctx, gangIncomePerSec: null }).ln > 0)) ckx.fail("the exit path must not require measured gang income");
    // A grind that no longer changes the exit is worth nothing.
    if (karmaValue(aug, { ...ctx, gangExitH: () => 60 }).ln !== 0) ckx.fail("no exit hours saved, no value");
  }
  checks.push(ckx);

  const cmx = new Check("OB-MONEY-EXIT", "money arriving life by life (grants, gang hauls) is valued as the exit its batch lifts save, moneyLn only as fallback");
  {
    const ob = await import("../../objective.js");
    const gp = await import("../../gangplan.js");
    const { bestExitPolicy } = await import("../../exitplan.js");
    cmx.examined(4);
    const now = Date.now();
    const record = { at: new Date(now).toISOString(), lastAugReset: 1, eRep: 0.1, eBudget: 0.3, inputs: { money: 1e9, incomePerSec: 1e8, hacking: 800, hackingExp: 1e9, hackingMult: 1.5, expPerSec: 1e5, repPerSec: 30, exitRep: 0, exitFavor: 0, terminalRep: 0, exitLevel: 3000, joinMoney: 0, cycleHours: 4, multGainPerCycle: 1.1 } };
    const exit = { record, hoursPerLn: 10, bestExitPolicy, lastAugReset: 1 };
    const lifts = ob.exitLnOfInstallLifts([1, 1.1, 1.1, 1.1], exit, now);
    if (!(lifts > 0)) cmx.fail("lifting three later batches must save exit hours");
    if (ob.exitLnOfInstallLifts([1, 1.1], { ...exit, lastAugReset: 2 }, now) !== null) cmx.fail("another life's record refuses");
    const g = ob.oneoffValue({ name: "CashRoot Starter Kit" }, { money: 1e8, eBudget: 0.3, remainingWindows: 10, exit });
    if (!(g.ln > 0) || !/priced as the exit/.test(g.reason ?? "")) cmx.fail(`a starting-money grant must price through the exit: ${JSON.stringify(g)}`);
    const f = { samples: Array.from({ length: 25 }, (_, h) => ({ h, money: 1e7 * h * 3600, gross: 1 })), horizonH: 24 };
    const sc = gp.scoreTrajectory(f, { money: { eBudget: 0.3, remainingWindows: 5, budget: 1e10, windowH: 4, firstWindowH: 4, exit } });
    if (sc.moneyMode !== "exit" || !(sc.moneyValue > 0)) cmx.fail(`gang money must price through the exit: ${sc.moneyMode} ${sc.moneyValue}`);
  }
  checks.push(cmx);

  return checks;
}