// [B7] The stage-aware bootstrap: does boot.js's plan fit, earn, and grow at
// every home RAM a life will pass through, under every Source-File regime?
//
// WHY THIS IS A SEPARATE CHECK FROM [B2]
//
// [B2] asks whether a LIST of scripts fits a budget. That question has no good
// answer, because there is no single list that is right at 8GB, 32GB, 128GB and
// 16TB, and no single price for the ten root scripts whose RAM is a function of
// the Source-File 4 level (autobuy.js: 5.85GB inside BitNode 4, 65.85GB at
// SF4.1 elsewhere — RamCostGenerator.ts:82-96).
//
// So boot.js stopped declaring a list and started declaring a MANIFEST plus an
// ordering of value, and stack.js turns those into a plan. This check runs THAT
// PLANNER — the real one, the same module the game imports, not a
// reimplementation — over every home size and every regime, and asserts the
// properties that make a tiered design honest rather than merely green:
//
//   B7.1  the manifest is plain DATA, so every parser in this suite reads the
//         same thing (and no tier can hide behind a closure)
//   B7.2  every entry prices, in every regime
//   B7.3  every entry is admitted at SOME home size — deferring forever is how
//         a tiered design becomes a deletion with extra steps
//   B7.4  every deferral carries a reason
//   B7.5  the admitted home set + the launcher fits, at every home size and in
//         every regime
//   B7.6  MIN_OPS worker slots survive the plan, at every home size
//   B7.7  something that earns is admitted, at every home size
//   B7.8  the plan is MONOTONE: growing home never silently drops an entry.
//         An entry may only leave the plan through an explicit `until`.
//   B7.9  watchdog.js's WATCHED list and the manifest agree. The watchdog has
//         no budget of its own and retries every 30s, so anything it knows
//         about that the plan declined is an infinite "no host with NGB free".
//   B7.10 NO TERMINAL TIER: something admitted at each home size can RAISE
//         home RAM, and is actually launched. A tier that cannot reach the
//         next one is a fixed point, and the run stops there without a human.
//
// CALIBRATED: RAM comes from `ram.mjs`, which is the game's own
// Script/RamCalculations.ts, and [B2] reproduces the live game's calculateRam
// for a sample on every run. This file adds no arithmetic of its own.
//
// STAGED vs DEPLOYED: if the design is still under tools/staging/boot/ (which
// the RFA daemon does not deploy), this check reads it from there and says so,
// loudly, as a WARN. A green [B7] over a staged design does NOT mean the
// running game can bootstrap itself — [B2] against the root files is what says
// that.

import fs from "node:fs";
import path from "node:path";
import { Check, fmt } from "./harness.mjs";
import { load, asSave, source, priceOverlay, rootScripts, trackedFiles, REPO } from "./ram.mjs";
import { watchdogStack } from "./ram.test.mjs";

const STAGING = path.join(REPO, "tools/staging/boot");

/** SF4 pricing regimes. Same set [B2] uses; each is a real save state. */
const REGIMES = [
  { id: "BN4/noSF", bitNode: 4, sf: {}, why: "inside BitNode 4 — singularity at base price" },
  { id: "SF4.1", bitNode: 1, sf: { 4: 1 }, why: "SF4 level 1 outside BN4 — singularity costs 16x" },
  { id: "SF4.2", bitNode: 1, sf: { 4: 2 }, why: "SF4 level 2 — 4x" },
  { id: "SF4.3", bitNode: 1, sf: { 4: 3 }, why: "SF4 level 3 — 1x" },
  { id: "noSF4", bitNode: 1, sf: {}, why: "no SF4 at all — calls throw, RAM is still charged at 16x" },
];

/**
 * Home sizes to plan against.
 *
 * The first three are the only sizes a BitNode can START at
 * (Prestige.ts:242-248). The rest are purchased doublings, which arrive WITHIN
 * a life — home RAM survives an install (prestigeHomeComputer touches neither
 * maxRam nor cpuCores, Server/ServerHelpers.ts:226-239) — so the plan has to be
 * right at each of them too, not only at entry.
 */
const HOME_SIZES = [8, 16, 32, 64, 128, 256, 512, 1024, 4096, 16384];
const ENTRY_SIZES = new Set([8, 32, 128]);

/** Roles that count as "this home can earn money and hacking experience". */
const EARNERS = new Set(["hgw.js", "early.js", "auto.js", "batch.js", "hack.js"]);

export async function run() {
  await load();
  return [planCheck(), ...runB711()];
}

/**
 * Resolve boot.js / stack.js / the new helpers to whichever copy is real.
 * Root wins the moment it carries the tiered shape; until then the staged copy
 * is what there is to check.
 */
function resolve() {
  const staged = fs.existsSync(STAGING) ? fs.readdirSync(STAGING).filter((f) => f.endsWith(".js")) : [];
  const overlay = {};
  const from = {};
  const rootBoot = source("boot.js") ?? "";
  const deployed = /\brank:\s*\d/.test(rootBoot) && /planStack/.test(rootBoot);
  for (const f of staged) {
    const rootSrc = source(f);
    if (deployed && rootSrc != null) {
      from[f] = "root";
    } else {
      overlay[f] = fs.readFileSync(path.join(STAGING, f), "utf8");
      from[f] = "staged";
    }
  }
  // Anything at root that staging does not replace is already visible to
  // priceOverlay, so it needs no entry here.
  return { overlay, from, deployed };
}

/**
 * Pull `const STACK = [...]` out of boot.js and evaluate it.
 *
 * It is required to be plain data — no arrow functions, no `function`, no `ns`
 * — which is B7.1 and is not a stylistic preference. Three different parsers in
 * this suite read that array (this one, [B2]'s bootStack, [C1]'s entriesOf),
 * and a manifest that has to be *executed* to be understood is a manifest they
 * will disagree about.
 */
function manifestOf(src, c) {
  const start = src.indexOf("const STACK = [");
  if (start < 0) return { error: "no `const STACK = [` in boot.js" };
  const open = src.indexOf("[", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return { error: "unterminated STACK array" };
  const text = src.slice(open, end);
  // Comments and string literals blanked: a `why` is allowed to contain the
  // word "function" or an `ns.` reference — it is prose about the entry. What
  // is forbidden is executable code in the manifest itself.
  const bare = text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  for (const forbidden of ["=>", "function", "ns."]) {
    if (bare.includes(forbidden)) {
      return { error: `STACK contains \`${forbidden}\` — the manifest must be plain data, not code` };
    }
  }
  try {
    // eslint-disable-next-line no-new-func
    return { entries: new Function(`return ${text}`)() };
  } catch (e) {
    return { error: `STACK does not evaluate as data: ${e.message}` };
  }
}

function planCheck() {
  const c = new Check("B7", "stage-aware bootstrap — the plan fits, earns and grows at every home size (invariants B2, B6)");
  const { overlay, from, deployed } = resolve();

  const stagedNames = Object.keys(from).filter((f) => from[f] === "staged");
  if (!Object.keys(from).length && !deployed) {
    c.note("no tools/staging/boot/ and no tiered boot.js at root — nothing for this check to plan with");
    return c;
  }
  if (stagedNames.length) {
    c.note(`SOURCE: tools/staging/boot/ — ${stagedNames.join(", ")}`);
    c.warn(
      "the stage-aware bootstrap is STAGED, not deployed",
      `${stagedNames.join(", ")} live under tools/staging/boot/, which tools/rfa-daemon.mjs does not push.\n` +
        "Everything below is a property of that design, NOT of the running game. [B2] against the root files is\n" +
        "what says whether the game can bootstrap itself today, and it is the check to read until these are deployed.",
    );
  } else {
    c.note("SOURCE: repo root — the tiered launcher is deployed");
  }

  const bootSrc = overlay["boot.js"] ?? source("boot.js");
  const parsed = manifestOf(bootSrc, c);
  if (parsed.error) {
    c.fail("B7.1 boot.js's manifest could not be read as data", parsed.error);
    return c;
  }
  const manifest = parsed.entries;
  c.note(`manifest: ${manifest.length} entries, plain data (no arrow functions, no \`function\`, no \`ns.\`)`);
  c.examined(manifest.length);

  /* -- B7.1: shape ------------------------------------------------------- */
  const ranks = new Set();
  for (const e of manifest) {
    const missing = ["script", "where", "tier", "rank", "why"].filter((k) => e[k] == null);
    if (missing.length) c.fail(`B7.1 manifest entry ${e.script ?? "<unnamed>"} is missing ${missing.join(", ")}`, "every entry states what it is, when it is worth its RAM, and why");
    if (e.where !== "home" && e.where !== "anywhere") c.fail(`B7.1 ${e.script}: where must be 'home' or 'anywhere'`, `got ${JSON.stringify(e.where)}`);
    if (ranks.has(e.rank)) c.fail(`B7.1 duplicate rank ${e.rank} at ${e.script}`, "rank IS the value ordering; a tie makes the admitted set depend on array order");
    ranks.add(e.rank);
    if (e.until != null && e.until <= e.tier) c.fail(`B7.1 ${e.script}: until ${e.until} <= tier ${e.tier}`, "an entry retired before it is admitted can never run");
    if (e.until != null && !e.retire) c.fail(`B7.1 ${e.script} is retired at ${e.until}GB with no \`retire\` reason`, "a retirement with no reason is a deletion with extra steps");
    if (typeof e.why === "string" && e.why.length < 40) c.warn(`B7.1 ${e.script}'s \`why\` is ${e.why.length} characters`, "the tier is a judgement; the reason is what makes it reviewable");
  }

  /* -- the planner itself, imported rather than reimplemented ------------- */
  let planStack, MIN_OPS;
  try {
    const stackPath = from["stack.js"] === "staged" ? path.join(STAGING, "stack.js") : path.join(REPO, "stack.js");
    const mod = require_(stackPath);
    planStack = mod.planStack;
    MIN_OPS = mod.MIN_OPS;
  } catch (e) {
    c.fail("B7 could not import stack.js's planner", `${e.message}\nstack.js must stay free of ns and free of imports so it can be run under plain node`);
    return c;
  }
  if (typeof planStack !== "function") {
    c.fail("B7 stack.js does not export planStack", "this check runs the shipped planner; there is nothing to run");
    return c;
  }

  /* -- B7.2: everything prices, in every regime --------------------------- */
  const price = new Map(); // regime -> script -> GB|null
  for (const reg of REGIMES) {
    asSave(reg);
    const row = new Map();
    for (const e of manifest) row.set(e.script, priceOf(overlay, e.script));
    row.set("boot.js", priceOf(overlay, "boot.js"));
    row.set("w.js", priceOf(overlay, "w.js"));
    row.set("retire.js", priceOf(overlay, "retire.js"));
    price.set(reg.id, row);
  }
  asSave(REGIMES[0]);
  for (const e of manifest) {
    const missing = REGIMES.filter((r) => price.get(r.id).get(e.script) == null).map((r) => r.id);
    if (missing.length) {
      c.fail(`B7.2 ${e.script} does not price in ${missing.join(", ")}`, "a manifest entry that cannot be priced cannot be budgeted — boot.js will silently skip it forever");
    }
  }
  if (price.get("BN4/noSF").get("retire.js") == null) {
    c.fail("B7.2 retire.js does not price", "boot.js exec's it to stop a superseded entry; without it a tier transition leaves the old stack running alongside the new one");
  }
  c.examined(manifest.length * REGIMES.length);

  const bootRam = price.get("BN4/noSF").get("boot.js");
  c.note(`launcher boot.js ${fmt.gb(bootRam)} (MIN_OPS ${MIN_OPS} worker slots reserved off the top of every plan)`);

  // The spawn claim has to be true in the SOURCE, not just in the planner's
  // arithmetic. stack.js sizes the worker without the launcher's RAM on the
  // grounds that ns.spawn kills the caller before starting the new script
  // (NetscriptFunctions.ts:644-650). If boot.js ever goes back to ns.exec for
  // the worker, every worker thread count below is over-stated by
  // ceil(bootRam / workerRam) — which at 8GB is the difference between four
  // threads and one, i.e. between a batch and nothing.
  if (!/\bns\.spawn\(/.test(bootSrc)) {
    c.fail(
      "B7.5 boot.js does not call ns.spawn, but stack.js sizes the worker as if it did",
      "the launcher's RAM is excluded from the worker's thread count only because ns.spawn terminates the caller " +
        "first. With ns.exec the worker is launched into a home that still holds the launcher, and the plan is wrong " +
        "by exactly that much at the tier that can least afford it.",
    );
  }

  /* -- B7.3..B7.8: plan every home size, in every regime ------------------ */
  const admittedSomewhere = new Set();
  const previous = new Map(); // regime -> Set(scripts admitted at the last, smaller home)

  for (const home of HOME_SIZES) {
    for (const reg of REGIMES) {
      const row = price.get(reg.id);
      const costOf = (s) => row.get(s) ?? priceOfIn(overlay, s, reg);
      const plan = planStack(manifest, { homeRam: home, costOf, bootRam: costOf("boot.js"), minOps: MIN_OPS });
      c.examined(1);
      const tag = `${home}GB / ${reg.id}`;

      const homeAdmit = plan.admit.filter((e) => e.where === "home");
      // A one-shot exits in seconds and holds no steady-state RAM, so it counts
      // in the transient peak below and not in the resident total.
      const steady = homeAdmit.filter((e) => e.kind !== "oneshot");
      const homeCost = steady.reduce((s, e) => s + e.cost * (e.threads || 1), 0);
      const resident = Math.round(homeCost * 100) / 100;

      // B7.5a — STEADY STATE. Everything the plan leaves running on home, once
      // the launcher is gone and the one-shots have exited, has to fit home.
      if (resident > home) {
        c.fail(
          `B7.5 ${tag}: the plan does not fit the home it was planned for`,
          `${steady.length} home-pinned entries total ${fmt.gb(homeCost)}, over ${home}GB by ${fmt.gb(resident - home)}:\n` +
            steady.map((e) => `  ${e.script.padEnd(14)} ${fmt.gb(e.cost).padStart(9)}${e.threads > 1 ? ` x${e.threads}` : ""}`).join("\n"),
        );
      }

      // B7.5b — TRANSIENT PEAK. The launcher is resident while it exec's every
      // daemon and one-shot, so the peak is those plus the launcher itself.
      // This is the failure the old boot.js had at every tier: 7.90GB resident
      // on an 8GB home, and it reported "no host with NGB free" ten times.
      // The worker is excluded because it is SPAWNED, which kills the launcher
      // first (NetscriptFunctions.ts:644-650) — a claim checked against
      // boot.js's own source above, not assumed.
      const execCost = homeAdmit.filter((e) => e.role !== "worker").reduce((s, e) => s + e.cost, 0);
      const peak = Math.round((execCost + costOf("boot.js")) * 100) / 100;
      if (peak > home) {
        c.fail(
          `B7.5 ${tag}: the launcher cannot start its own plan`,
          `the daemons and one-shots it exec's total ${fmt.gb(execCost)} and boot.js holds ${fmt.gb(costOf("boot.js"))} ` +
            `while it does = ${fmt.gb(peak)}, over ${home}GB by ${fmt.gb(peak - home)}`,
        );
      }

      // B7.6 — MIN_OPS worker slots survive. Either the plan runs that many
      // threads of a self-threaded worker, or it leaves that much free for a
      // controller (batch.js) to place h/g/w into.
      const worker = plan.admit.find((e) => e.role === "worker");
      const slots = worker ? worker.threads : Math.floor((home - resident) / (costOf("w.js") || 1.75));
      if (slots < MIN_OPS) {
        c.fail(
          `B7.6 ${tag}: only ${slots} worker slot(s) survive the plan, need ${MIN_OPS}`,
          `one HGW batch is ${MIN_OPS} concurrent operations (batch.js:365-366). Below that the pipeline the whole ` +
            `collection is built around does not exist.\n` +
            (worker
              ? `worker ${worker.script} ${fmt.gb(worker.cost)} x${worker.threads}`
              : `no self-threaded worker at this tier; ${fmt.gb(home - resident)} free for h/g/w at ${fmt.gb(costOf("w.js") || 1.75)} each`),
        );
      }

      // B7.7 — something earns.
      const earning = plan.admit.filter((e) => EARNERS.has(e.script));
      if (!earning.length) {
        c.fail(
          `B7.7 ${tag}: nothing in the plan earns money or hacking experience`,
          "no hacking driver was admitted. A life that cannot hack cannot do anything else either — every other " +
            "capability in this collection is downstream of money and hacking level.",
        );
      }

      // B7.10 — NO TERMINAL TIER. Something admitted here must be able to
      // raise home RAM toward the next tier, and must actually be LAUNCHED.
      //
      // B7.7 asks whether the plan can earn. This asks whether the plan can
      // SPEND what it earns on the resource the tiering is keyed to — and those
      // are different questions, which is how the gap survived. At 32GB every
      // other invariant in this file passed: every entry priced (B7.2), was
      // admitted somewhere (B7.3), fitted (B7.5), kept its worker slots (B7.6)
      // and earned (B7.7). The plan was correct in every respect except that it
      // could not reach the next plan, so money accumulated with no sink and
      // home stayed at 32GB for as long as nobody typed anything.
      //
      // `kind: 'job'` is budgeted here but launched by watchdog.js, so an
      // advancer that is a job only counts when the job runner is admitted too.
      // That conjunction IS the bug: homeup.js and watchdog.js were both tier
      // 64, so each was waiting on the other's rung.
      // EVERY home size, with NO floor and no exemption. The project's standing
      // requirement is a headless playthrough from a virgin save to the end of
      // the game, and a virgin BitNode entry with neither SF1 nor SF9.2 is an
      // 8GB home (Prestige.ts:242-248). A bootstrap that needs a human for the
      // first upgrade cannot speedrun anything, so 8GB is not a tolerable
      // exception — it is the starting line.
      //
      // An earlier version of this check exempted 8GB and 16GB on the grounds
      // that the launcher (6.20GB) plus MIN_OPS worker slots (8.00GB) leave no
      // room for a 4.45GB buyer. That arithmetic was right and the conclusion
      // was wrong: it assumed the advancer had to be home-resident. It does
      // not — homeup.js drives the Alpha Enterprises DOM, and the DOM is
      // reachable from any host, so `where: 'anywhere'` puts it on a free
      // 0-port server and the home budget pays nothing. seed.js had been making
      // exactly that argument two entries above it the whole time.
      //
      // The exemption is deleted rather than kept-and-satisfied, because a
      // conditional that no longer fires is a loophole waiting for the next
      // edit to fall through it.
      const advancers = plan.admit.filter((e) => e.advances === "homeRam");
      const runnerAdmitted = plan.admit.some((e) => e.script === "watchdog.js");
      const launched = advancers.filter((e) => e.kind !== "job" || runnerAdmitted);
      if (!launched.length) {
        c.fail(
          `B7.10 ${tag}: terminal tier — nothing admitted here can raise home RAM`,
          advancers.length
            ? `${advancers.map((e) => e.script).join(", ")} declares advances:'homeRam' but is kind:'job' and its runner ` +
              `(watchdog.js) is not admitted at this home size, so nobody launches it. A job whose runner is on a higher ` +
              `tier than the job is a rung gated on the rung above it.`
            : `no admitted entry declares advances:'homeRam'. This home size can earn money forever and never convert it ` +
              `into the next tier, so the plan is a fixed point and the run stalls here until a human intervenes.`,
        );
      }

      // B7.4 — every deferral explains itself.
      for (const d of plan.defer) {
        if (!d.why || String(d.why).length < 20) {
          c.fail(`B7.4 ${tag}: ${d.script} is deferred with no usable reason`, `why = ${JSON.stringify(d.why)}`);
        }
      }
      for (const a of plan.admit) admittedSomewhere.add(a.script);

      // B7.8 — monotone: growing home may only drop an entry through `until`.
      const now = new Set(plan.admit.map((e) => e.script));
      const before = previous.get(reg.id);
      if (before) {
        for (const gone of before) {
          if (now.has(gone)) continue;
          const entry = manifest.find((e) => e.script === gone);
          if (!entry || entry.until == null || home < entry.until) {
            c.fail(
              `B7.8 ${tag}: ${gone} was admitted on a SMALLER home and is not admitted here`,
              "growing home must never take a capability away. If this is a deliberate retirement it needs an " +
                "`until` and a `retire` reason in the manifest; otherwise the budget ordering is unstable.",
            );
          }
        }
      }
      previous.set(reg.id, now);

      // The deliverable: a tier table, printed pass or fail.
      if (reg.id === "BN4/noSF" && (ENTRY_SIZES.has(home) || home === 64 || home === 1024)) {
        c.note(
          `  ${String(home).padStart(5)}GB ${ENTRY_SIZES.has(home) ? "(entry)" : "(bought)"}  ` +
            `boot ${fmt.gb(costOf("boot.js"))} + home ${fmt.gb(homeCost)} = ${fmt.gb(resident)}; ` +
            `${slots} worker slot(s); ${plan.admit.length} admitted, ${plan.defer.length} deferred`,
        );
        for (const e of plan.admit) {
          c.note(
            `        ${e.where === "home" ? "home    " : "anywhere"} ${e.script.padEnd(13)} ${fmt.gb(e.cost).padStart(9)}` +
              (e.threads ? ` x${e.threads}` : "") +
              (e.kind === "job" ? "   (budgeted, launched by the watchdog)" : ""),
          );
        }
      }
    }
  }

  /* -- B7.3: nothing is deferred forever ---------------------------------- */
  for (const e of manifest) {
    if (!admittedSomewhere.has(e.script)) {
      c.fail(
        `B7.3 ${e.script} is in the manifest and is never admitted at any home size up to ${HOME_SIZES.at(-1)}GB`,
        "a tier that is never reached is a deletion with extra steps. Either give it a tier a life actually gets to, " +
          "or take it out of the manifest and say in its own header that it is not part of the stack.",
      );
    }
  }

  /* -- B7.9: the watchdog watches what the plan admits --------------------- */
  const watched = watchdogStack();
  const known = new Set(manifest.map((e) => e.script));
  const unknown = watched.filter((s) => !known.has(s));
  c.examined(watched.length);
  if (unknown.length) {
    c.fail(
      `B7.9 watchdog.js watches ${unknown.length} script(s) the manifest does not declare: ${unknown.join(", ")}`,
      "the watchdog restarts on a 30s timer and has no RAM budget of its own, so anything it knows about that\n" +
        "boot.js's plan declined becomes a permanent \"no host with NGB free\" loop — which is exactly what\n" +
        "invariant B2 row 5 describes for autobuy.js. Every watched script needs a tier in the manifest.",
    );
  } else {
    c.note(`watchdog.js watches ${watched.length} script(s); all of them carry a tier in the manifest`);
  }

  /* -- B7.12: the action slot survives the worker --------------------------
   *
   * act.js places a one-shot actor (act-crime.js and friends) on any rooted
   * host with room, and the worker takes "what is left" of home. On a small
   * home that is nothing, and the fleet fills every other host too, so act.js
   * decides correctly and cannot execute. Live in BitNode 4 at 15:41 it chose
   * to stop gym training and commit crime, found no free block bigger than
   * 5.3GB for a 7.25GB actor, and left the gym running for 35 minutes — to
   * MINUS $1.4m, because a Singularity action keeps charging with or without
   * anything left to manage it. A worker thread is elastic; an action is not.
   */
  {
    const reg = REGIMES.find((r) => r.id === "BN4/noSF") ?? REGIMES[0];
    asSave(reg);
    const costOf = (script) => priceOf(overlay, script) ?? 0;
    const actors = trackedFiles().map((f) => f.remote).filter((f) => /^act-[^/]*\.js$/.test(f));
    const actionRam = Math.max(0, ...actors.map(costOf));
    c.examined(actors.length);
    if (!actors.length) c.fail("B7.12 no act-*.js actors found to size the action slot against");
    if (!(actionRam > 0)) c.fail("B7.12 the largest actor prices at 0GB — the slot would be empty");

    for (const homeRam of [32, 64, 128]) {
      const withSlot = planStack(manifest, { homeRam, costOf, bootRam: costOf("boot.js"), minOps: MIN_OPS, actionRam });
      const free = homeRam - withSlot.homeUsed;
      if (withSlot.action !== Math.round(actionRam * 100) / 100) {
        c.fail(`B7.12 the plan does not report the action slot at ${homeRam}GB: ${withSlot.action} vs ${actionRam}`);
      }
      // The whole point: an actor must FIT once the plan is resident.
      if (!(free >= actionRam - 1e-9)) {
        c.fail(
          `B7.12 a ${homeRam}GB home leaves ${free.toFixed(2)}GB after the plan, below the ${actionRam}GB actor it must place`,
          "act.js would decide correctly and never execute — the BitNode 4 gym drain",
        );
      }
    }
    // Absent the slot the old behaviour is unchanged, so this is opt-in.
    const none = planStack(manifest, { homeRam: 32, costOf, bootRam: costOf("boot.js"), minOps: MIN_OPS });
    if (none.action !== 0) c.fail(`B7.12 no actionRam must mean no slot, got ${none.action}`);
    const slot32 = planStack(manifest, { homeRam: 32, costOf, bootRam: costOf("boot.js"), minOps: MIN_OPS, actionRam });
    c.note(
      `action slot ${actionRam}GB (largest of ${actors.length} act-*.js) — a 32GB home keeps ` +
        `${(32 - slot32.homeUsed).toFixed(2)}GB free and still runs ` +
        `${slot32.admit.find((e) => e.role === "worker")?.threads ?? 0} worker threads ` +
        `(${none.admit.find((e) => e.role === "worker")?.threads ?? 0} without the slot)`,
    );
  }

  return c;
}

/* ------------------------------------------------------------------ helpers */

function priceOf(overlay, name) {
  const r = priceOverlay(overlay, name);
  return r.error ? null : r.cost;
}

function priceOfIn(overlay, name, reg) {
  asSave(reg);
  return priceOf(overlay, name);
}

/** Import a module by absolute path, synchronously enough for a check body. */
let CACHE = new Map();
function require_(p) {
  if (CACHE.has(p)) return CACHE.get(p);
  // stack.js is deliberately import-free and ns-free, so it can be evaluated as
  // an ES module body under plain node. Doing it this way rather than with a
  // dynamic import keeps this check synchronous and keeps the failure local.
  const code = fs.readFileSync(p, "utf8");
  const body = code.replace(/^\s*export\s+/gm, "");
  const names = [...code.matchAll(/^\s*export\s+(?:const|function|async function|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  // eslint-disable-next-line no-new-func
  const mod = new Function(`${body}\nreturn { ${names.join(", ")} }`)();
  CACHE.set(p, mod);
  return mod;
}

/* --------------------------------------------------------------- B7.11 --- */
/**
 * [B7.11] every root script is DECLARED somewhere — manifest or watchdog.
 *
 * B7.9 checks that the watchdog never watches a script the manifest does not
 * declare. That is one direction of a two-way correspondence, and the other
 * direction was never checked: a script declared in NEITHER place is not
 * mis-managed, it is unmanaged — it exists, it works, and nothing ever runs it.
 *
 * Found live, and it is the sharpest version of this session's recurring bug.
 * `hacknet.js` opens with "Buys hacknet capacity until the Netburners
 * invitation requirements are met, then stops", explains that Netburners is 5
 * distinct augmentations, that the hacknet API needs no Source-File, and that
 * "it is not trying to build a hacknet, it is buying an invitation" — while the
 * run sat nine augmentations short of Daedalus for hours. It had never
 * executed, because it was in neither list. The same was true of training.js
 * (25KB), crime.js (17KB), healer.js and infilhelper.js.
 *
 * Not a capability gap and not a pricing gap: fully-built capability that
 * nothing invokes. Exactly the shape a one-directional check cannot see.
 */
function runB711() {
  const c = new Check("B7.11", "no orphaned root scripts — everything is declared in boot.js or watchdog.js");
  const bootSrc = source("boot.js") ?? "";
  const parsed = manifestOf(bootSrc, c);
  if (parsed.error) {
    c.fail(`cannot read boot.js's manifest: ${parsed.error}`);
    return [c];
  }
  const manifest = new Set((parsed.entries ?? []).map((e) => e.script));
  const watched = new Set(watchdogStack());
  // Libraries, entry points that are deliberately hand-run, and the worker
  // scripts the batcher places itself are not daemons and are not expected in
  // either list. EXEMPT BY NAME, so adding one is a decision with a reason
  // rather than a silence.
  // EXEMPT BY NAME AND BY REASON, in three groups. Adding a name here is a
  // decision someone has to write down, which is the point — the failure this
  // check exists for was a script nobody had decided anything about.
  // B7.12 — a manifest entry whose script RAISES its RAM at runtime must be
  // placed against the raised figure. boot.js sizes placement from
  // `entry.cost`, which for an ns.ramOverride script is the declared FLOOR;
  // the raise that follows is denied silently on a host that cannot afford it
  // (NetscriptFunctions.ts:1210-1214 returns the old allocation), so the
  // script simply returns.
  //
  // Live on 2026-09-22: sleeve.js declares 2.60GB and raises to 41.15GB.
  // placeOff chose foodnstuff — the tightest 16GB fit for 2.60GB — the raise
  // failed, and it exited four seconds after boot started it. The run was in
  // BitNode 10, entered specifically for sleeves, with no sleeve driver.
  {
    const bootSrc2 = source("boot.js") ?? "";
    if (!/Math\.max\(entry\.cost, entry\.raisesTo/.test(bootSrc2)) {
      c.fail("boot.js places entries by entry.cost alone", "a script that raises its allocation must be placed against the RAISED figure or the raise is denied on arrival");
    }
    for (const name of rootScripts()) {
      const code = source(name) ?? "";
      const m = code.match(/RAISE_CEILING\s*=\s*\(?[^)]*\)?\s*=>\s*([0-9.]+)/);
      if (!m) continue;
      const declared = Number(m[1]);
      const entry = (parsed.entries ?? []).find((e) => e.script === name);
      if (!entry) continue; // not in the manifest: nothing places it
      // Only entries boot.js PLACES. A `kind: 'job'` is launched by
      // watchdog.js on its own host (home), and boot's placement loop skips it
      // outright — so raisesTo would be inert there. progress.js, faction.js
      // and endgame.js are all jobs, and flagging them made this check noise
      // on three entries it has no say over.
      if (entry.kind === "job" || entry.role === "worker") continue;
      if (entry.where === "home") continue; // home's budget is planned separately
      c.examined(1);
      if (!/raisesTo/.test(bootSrc2.slice(Math.max(0, bootSrc2.indexOf(`script: '${name}'`)), bootSrc2.indexOf(`script: '${name}'`) + 900))) {
        c.fail(`${name} raises to ${declared}GB but its manifest entry declares no raisesTo`, "boot.js would place it by its 2.6GB-class floor and the raise would be denied");
      }
    }
  }

  const HAND_RUN = new Set([
    // Launchers, workers and hand-run operations. boot.js is run by a human or
    // by an install callback; the h/g/w workers are placed by batch.js itself;
    // the rest are one-shot operator tools with no standing job.
    "boot.js", "retire.js", "findpath.js", "augbuy.js", "cmd.js",
    "hgw.js", "h.js", "g.js", "w.js", "early.js", "share.js", "seed.js", "tel.js",
    // Single-call Singularity actors: act.js execs one at a time on whichever
    // rooted host has the room and each exits after its call (actplan.js).
    "act-join.js", "act-work.js", "act-crime.js", "act-gym.js", "act-travel.js",
    "act-company.js", "act-course.js", "act-focus.js", "act-buyprogram.js", "act-donate.js", "act-buyaug.js", "act-install.js", "act-homeram.js",
    // act-stocksell.js: act.js runs it (ACTORS.stocksell) before a batch that spends.
    "act-stocksell.js",
    // act-graft.js is the same shape but a GRAFTING call, not a Singularity
    // one: 14GB flat, not SF4-scaled (RamCostGenerator.ts:466-472).
    "act-graft.js",
    // act-backdoor.js is launched by act.js from backdoor.js's /tel/backdoor-req.txt,
    // not through ACTORS: it runs for hacking time / 4 and is not waited on.
    "act-backdoor.js",
    // Snapshot readers, one Singularity read family each, run by act.js (snapshot.js).
    "snap-owned.js", "snap-catalog.js", "snap-augprice.js", "snap-augstats.js", "snap-prereq.js", "snap-rep.js", "snap-invites.js", "snap-static.js",
    "killall.js", "process.js", "eval.js", "steve.js", "ctscan.js", "ctsolve.js",
    "serverrank.js", "hash.js", "infiltration.js", "infilhelper.js",
    // Dual library/CLI: imported for their data, runnable for a readout.
    "common.js", "constants.js", "bitNodeMultipliers.js",
    // The Singularity half of autobuy.js, invoked BY autobuy.js rather than
    // scheduled independently.
    "autobuy-sing.js",
    // SOURCE-FILE GATED, and unmanaged here for that reason rather than by
    // oversight. Each needs a Source-File this save does not hold, so a
    // standing job would be a guaranteed no-op: bladeburner.js SF6/7,
    // go-cheat.js SF14.2, stock.js SF8. When one of those is earned, its
    // script moves OUT of this list and into the manifest.
    //
    // THAT USED TO DEPEND ON SOMEONE REMEMBERING. sleeve.js sat here fully
    // written, RAM-overridden and covered by [R1..R5] while nothing launched
    // it — and the run then travelled to BitNode 10 SPECIFICALLY for sleeves,
    // where it would have done nothing at all. gang.js had the opposite
    // problem: it reached the manifest and was left in this list too, so the
    // exemption was silently stale.
    //
    // SF_GATED below makes it automatic: own the Source-File and the exemption
    // expires, so the check fails until the script is wired in. Ownership is
    // read from live telemetry and an UNREADABLE save leaves the exemption
    // standing — unknown must not manufacture a failure, but it must not
    // manufacture a pass either, so that case is NOTED out loud.
    "bladeburner.js", "go-cheat.js", "stock.js",
    // Needs SF4 and is superseded on the autonomous path: progress.js buys
    // programs through torbuy.js/autobuy.js. Kept for hand use.
    "createProgram.js", "healer.js",
    // Capability scripts this session is WIRING IN — see the manifest. Listed
    // here only until that lands, and the entry above it in the manifest is
    // what removes them.
    "training.js", "crime.js",
  ]);

  // Which exemptions are conditional, and on what.
  const SF_GATED = { "bladeburner.js": [6, 7], "go-cheat.js": [14], "stock.js": [8], "sleeve.js": [10], "gang.js": [2] };
  // .telemetry/state.json, written by the daemon on every save poll
  // (rfa-daemon.mjs:412). NOT bn.txt: that file has no writer anywhere in this
  // repo and was frozen at BitNode 5 from 2026-09-19, so reading it looked
  // like a live check and was a stale one — which is precisely the silence
  // this whole block exists to remove. A source with no writer is worse than
  // no source, because it answers.
  const STATE = path.join(REPO, ".telemetry", "state.json");
  const ownedSF = (() => {
    try {
      const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
      const ageH = (Date.now() - Date.parse(st.at)) / 3600000;
      if (!Number.isFinite(ageH) || ageH > 24) return null;
      const out = new Map();
      // sourceFiles serialises as a JSONMap: {ctor, data: [[n, lvl], ...]}.
      const data = Array.isArray(st.sourceFiles) ? st.sourceFiles : (st.sourceFiles?.data ?? []);
      for (const [n, lvl] of data) out.set(Number(n), Number(lvl));
      // Being INSIDE a BitNode grants its capability even with no Source-File.
      if (Number.isFinite(st.bitNode)) out.set(Number(st.bitNode), Math.max(out.get(Number(st.bitNode)) ?? 0, 1));
      return out.size ? out : null;
    } catch {
      return null;
    }
  })();
  if (!ownedSF) {
    c.note("no fresh .telemetry/state.json — Source-File exemptions left standing, and NOT verified against a save");
  } else {
    for (const [script, sfs] of Object.entries(SF_GATED)) {
      const held = sfs.filter((n) => (ownedSF.get(n) ?? 0) > 0);
      if (!held.length) continue;
      HAND_RUN.delete(script);
      c.note(`${script}: Source-File ${held.join("/")} is held, so its exemption has expired — it must be in the manifest`);
    }
  }
  const orphans = [];
  for (const name of rootScripts()) {
    if (manifest.has(name) || watched.has(name) || HAND_RUN.has(name)) continue;
    const code = source(name) ?? "";
    // Only entry points: a library has no main() and is imported, not launched.
    if (!/export\s+(async\s+)?function\s+main\s*\(/.test(code)) continue;
    orphans.push(name);
  }
  c.examined(1);
  if (orphans.length) {
    c.fail(`${orphans.length} root script(s) are declared nowhere: ${orphans.join(", ")}`,
      "a script in neither boot.js's manifest nor watchdog.js's list never runs. It is not mis-managed, it is unmanaged — " +
      "and nothing in any telemetry file will ever say so. Declare it, or add it to HAND_RUN with a reason.");
  }
  c.note(`${manifest.size} declared in the manifest, ${watched.size} watched, ${HAND_RUN.size} exempt as hand-run/worker/library`);
  return [c];
}

