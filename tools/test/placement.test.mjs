// [B5] A planned allocation must be placeable on a SINGLE host.
//
// `ns.exec` cannot spread one operation's threads across machines. N threads of
// h.js need N * 1.7GB *contiguous on one server*. batch.js sizes its batch
// against the whole fleet —
//
//     const share = totalRam / Math.max(1, targets.length)   // batch.js:841
//     const plan  = planBatch(t, ram, share / 4, largestBlock)  // batch.js:842
//
// — and `totalRam` is the sum of every host's maxRam (batch.js:571-578).
// Nothing between planBatch and `place()` checks that the hack block it chose
// exists anywhere as one free region.
//
// On a 26PB fleet the two never collide, which is the fleet every measurement
// in this repo was taken on. On the opening fleet of a new BitNode they always
// do. Observed live on 2026-09-13:
//
//     fleet: home 32GB + rooted 16GB hosts + n00dles 4GB  = ~148GB total
//     plan:  h=11 g=2 w1=2 w2=2, gb=29
//     h=11 x 1.7GB = 18.7GB contiguous, and the largest non-home host is 16GB
//     result: placeFails 7274, batches 0, opsDispatched 2, earned $0.00 in 27min
//
// It never threw and its telemetry looked structurally fine. It reported
// `health: stalled` and silently earned nothing for the entire opening.
//
// This is the same lesson boot.js already carries for share.js ("take a
// fraction of the largest free block, not of the fleet") applied in one place
// and not the other. A comment generalises nothing; this does.
//
// CALIBRATION: the fleet and the per-target money/security come from
// `.telemetry/status.txt` — the live game's own readout — not from invented
// servers. A five-target synthetic server list has already produced one
// entirely fictional validation result in this repo. Per-server growth comes
// from the game's `Server/data/servers.ts`. If telemetry is unavailable the
// check says UNCALIBRATED and runs the fixed fleets only.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Check, fmt } from "./harness.mjs";
import { load, REPO } from "./ram.mjs";
import { OUT } from "./build-ram.mjs";

/**
 * Import a root Netscript file under plain node.
 *
 * Netscript resolves `import { x } from 'status.js'` against the *server's*
 * file list; node resolves a bare specifier against node_modules and throws
 * ERR_MODULE_NOT_FOUND. batch.js happened to have no imports when this test was
 * written, so `await import(path)` worked by accident — and the moment it
 * gained one (status.js, invariant C1) this module threw at load and the whole
 * of [B5] silently stopped running. A check that vanishes is worse than one
 * that fails, so resolve the specifiers the way the game does instead: any
 * import naming a file that exists in the repo becomes that file's absolute
 * file: URL, which node accepts from a data: module.
 *
 * Only the specifier text changes; the code being measured is byte-identical,
 * which is the whole point of importing the shipped file rather than a copy.
 */
async function importRootScript(name) {
  const src = fs.readFileSync(path.join(REPO, name), "utf8").replace(/(^\s*import[^'"]*['"])([^'"]+)(['"])/gm, (all, head, spec, tail) => {
    const target = path.join(REPO, spec.replace(/^\.?\//, ""));
    return fs.existsSync(target) ? head + pathToFileURL(target).href + tail : all;
  });
  return import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
}

const b = await importRootScript("batch.js");

/**
 * batch.js's OWN placer, lifted out of the shipped file rather than reproduced.
 *
 * `place()` is not exported (batch.js:396), and reimplementing it here would be
 * a fork that drifts — which is the failure mode CLAUDE.md documents most
 * often. Slicing the real function text keeps exactly one definition of the
 * placement rule in the repo, and means a change to `place()` changes this test
 * automatically.
 *
 * Note what it actually guarantees: only the HACK op needs a contiguous block.
 * grow and weaken are split across hosts by the loop at :415-429. So the
 * failure is specific to the hack block, which is what was observed.
 */
function shippedPlacer() {
  const src = fs.readFileSync(path.join(REPO, "batch.js"), "utf8");
  const start = src.indexOf("function place(free, ops, ram, cores = {})");
  if (start < 0) return { error: "batch.js no longer defines `function place(free, ops, ram, cores = {})` — this test cannot find the shipped placer" };
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end + 2);
  try {
    // coreBonus is the only free identifier in it (batch.js:130).
    return { place: new Function("coreBonus", `${body}; return place`)(b.coreBonus), text: body };
  } catch (e) {
    return { error: `could not evaluate batch.js's place(): ${e.message}` };
  }
}

/**
 * Fleets a run actually passes through, as {host: [maxRam, freeRam]}.
 *
 * The two columns are not decoration. batch.js computes its budget from
 * maxRam (`totalRam += max`, batch.js:573) and then places into `free`
 * (batch.js:581) — so the budget is optimistic about exactly the RAM the
 * placement cannot use. On home that gap is the whole resident stack plus
 * SETTINGS.homeReserve (4GB, batch.js:65) and selfReserve (6GB, :64).
 */
function fixedFleets(homeRam) {
  // What the boot stack leaves free on home: batch.js 11.2 + cmd.js 8.15 +
  // tel.js 4 + watchdog.js 7.8, then homeReserve 4 and selfReserve 6 on top.
  const homeFree = Math.max(0, homeRam - 11.2 - 8.15 - 4 - 7.8 - 4 - 6);
  const rooted = { "foodnstuff": [16, 16], "sigma-cosmetics": [16, 16], "joesguns": [16, 16], "hong-fang-tea": [16, 16], "nectar-net": [16, 16], "harakiri-sushi": [16, 16], "n00dles": [4, 4] };
  return [
    { id: `home-only ${homeRam}GB`, hosts: { home: [homeRam, homeFree] } },
    { id: `opening ${homeRam}GB + 6x16 + n00dles`, hosts: { home: [homeRam, homeFree], ...rooted } },
  ];
}

/** Hacking levels a run passes through. phi -> hack thread count -> block size. */
const LEVELS = [10, 30, 80, 200, 600];

const LATE_FLEETS = [
  { id: "mid 1TB home + 10x64", hosts: Object.fromEntries([["home", [1024, 984]], ...Array.from({ length: 10 }, (_, i) => [`pserv-${i}`, [64, 64]])]) },
  { id: "late 16TB home + 25x1PB", hosts: Object.fromEntries([["home", [16384, 16344]], ...Array.from({ length: 25 }, (_, i) => [`pserv-${i}`, [1048576, 1048576]])]) },
];

// Read the floor OUT OF batch.js's source. `SETTINGS` is not exported, so a
// `b.SETTINGS?.hackFloor ?? 20` fallback would silently keep using this file's
// own 20 after batch.js changed — two copies of a constant that must agree,
// which is the drift this repo has been bitten by repeatedly. Throwing when it
// cannot be found is better than testing a number nobody ships.
const HACK_FLOOR = (() => {
  const m = /hackFloor:\s*([0-9.]+)/.exec(fs.readFileSync(path.join(REPO, "batch.js"), "utf8"));
  if (!m) throw new Error("batch.js no longer declares `hackFloor:` — B5 cannot mirror the shipped call site");
  return Number(m[1]);
})();

export async function run() {
  const c = new Check("B5", "every planned batch is placeable on a real fleet, not just affordable in total");
  const G = await load();
  const placer = shippedPlacer();
  if (placer.error) {
    c.fail("cannot test the shipped placer", placer.error);
    return c;
  }
  const place = placer.place;

  // Per-thread worker RAM straight from the game's calculator, not the 1.7/1.75
  // literals — the simulator once priced threads 30% cheap by using stale ones.
  const { ramOf } = await import("./ram.mjs");
  const ram = { hack: ramOf("h.js").cost, grow: ramOf("g.js").cost, weaken: ramOf("w.js").cost };
  c.note(`worker RAM from the game's calculator: hack ${ram.hack} grow ${ram.grow} weaken ${ram.weaken}`);

  /* -- targets, from the live game where possible ------------------------ */
  const growthOf = Object.fromEntries(G.serverMetadata.map((s) => [s.hostname, typeof s.serverGrowth === "number" ? s.serverGrowth : (s.serverGrowth.min + s.serverGrowth.max) / 2]));
  let live = null;
  try {
    live = JSON.parse(fs.readFileSync(path.join(REPO, ".telemetry/status.txt"), "utf8"));
  } catch {
    /* handled below */
  }

  const fleets = [];
  let targetsSrc;
  if (live?.servers?.length) {
    c.note(`CALIBRATION: fleet and target stats read from .telemetry/status.txt at ${live.at} (hacking level ${live.hackingLevel})`);
    const hosts = Object.fromEntries(live.servers.map((s) => [s.host, [s.maxRam, Math.max(0, s.maxRam - s.usedRam)]]));
    const total = Object.values(hosts).reduce((a, x) => a + x[0], 0);
    c.note(`   live fleet (max/free): ${Object.entries(hosts).map(([h, r]) => `${h}:${r[0]}/${r[1].toFixed(1)}`).join(" ")}  (total max ${total}GB, largest free ${Math.max(...Object.values(hosts).map((r) => r[1])).toFixed(1)}GB)`);
    fleets.push({ id: `LIVE ${live.at.slice(0, 16)}`, hosts, live: true });
    targetsSrc = live.servers
      .filter((s) => s.maxMoney > 0 && s.hackLevel <= live.hackingLevel * 2)
      .map((s) => ({ host: s.host, maxMoney: s.maxMoney, minSec: s.minSecurity, required: s.hackLevel, growth: growthOf[s.host] ?? 20 }));
    c.note(`   live income ${live.incomePerSec}/s, health "${live.health}"`);
  } else {
    c.note("CALIBRATION: *** UNCALIBRATED *** — .telemetry/status.txt unreadable; using the game's own server table only");
    c.warn("placement test could not read the live fleet", "fixed fleets only; the observed failure shape is not reproduced from live data");
    targetsSrc = ["n00dles", "foodnstuff", "sigma-cosmetics", "joesguns", "nectar-net", "hong-fang-tea", "harakiri-sushi"].map((h) => {
      const m = G.serverMetadata.find((s) => s.hostname === h);
      return { host: h, maxMoney: typeof m.moneyAvailable === "number" ? m.moneyAvailable : m.moneyAvailable.max, minSec: (typeof m.hackDifficulty === "number" ? m.hackDifficulty : m.hackDifficulty.max) / 3, required: typeof m.requiredHackingSkill === "number" ? m.requiredHackingSkill : m.requiredHackingSkill.max, growth: growthOf[h] ?? 20 };
    });
  }

  for (const hr of [8, 32, 128]) fleets.push(...fixedFleets(hr));
  // The fleet the failure was actually observed on, kept as a regression
  // fixture so it stays tested after the live save grows past it.
  fleets.push({
    id: "observed 2026-09-13 (placeFails 7274, batches 0, $0 in 27min)",
    // home 32GB with the boot stack resident leaves under 1GB free, which is
    // why the largest free block was a 16GB rooted host and not home.
    hosts: { home: [32, 0.85], "foodnstuff": [16, 16], "sigma-cosmetics": [16, 16], "joesguns": [16, 16], "hong-fang-tea": [16, 16], "nectar-net": [16, 16], "harakiri-sushi": [16, 16], "zer0": [16, 16], "n00dles": [4, 4] },
  });
  fleets.push(...LATE_FLEETS);

  // No augmentations on the live save (state.json `augmentations: []`), so the
  // player multipliers really are 1 here. Also sweep an augmented player, since
  // the multipliers change phi and therefore the hack thread count.
  const MULTS = [
    { id: "fresh (no augs)", m: { chance: 1, speed: 1, money: 1, growth: 1 } },
    { id: "augmented", m: { chance: 1.6, speed: 1.6, money: 1.68, growth: 1.46 } },
  ];

  // Collected then summarised: the same structural bug fires for every
  // (level, target) pair on a fleet, and 200 identical FAIL lines is a report
  // nobody reads. One line per fleet, with the count and the worst case.
  const byFleet = new Map();

  for (const { id: mid, m: mults } of MULTS) {
    for (const fleet of fleets) {
      for (const level of fleet.live ? [live.hackingLevel] : LEVELS) {
        const targets = targetsSrc
          .map((s) => {
            const t = { ...s, sec: s.minSec, money: s.maxMoney, level, mults, hackTime: 1000 };
            t.phi = b.hackFraction(level, s.required, s.minSec, mults);
            t.chance = b.hackChance(level, s.required, s.minSec, mults);
            t.k = b.growthK(s.minSec, s.growth, mults);
            return t;
          })
          .filter((t) => t.required <= level && t.phi > 0)
          .sort((x, y) => b.targetScore(y) - b.targetScore(x))
          .slice(0, 99);
        if (!targets.length) continue;
        // batch.js picks its own target COUNT by argmax (batch.js:600-660), and
        // the count divides the budget. One count tests one point: at 4 targets
        // the budget is small and the plan is small; at 1 target it is four
        // times larger and the hack block is what stops fitting. The observed
        // failure was a 1-target fleet.
        for (const nTargets of [1, 2, 4]) {
        const chosen = targets.slice(0, nTargets);
        if (!chosen.length) continue;

        const hostRam = fleet.hosts;
        // Budget from MAX (batch.js:573), placement into FREE (batch.js:581).
        const totalRam = Object.values(hostRam).reduce((a, x) => a + x[0], 0);
        const freeMap = Object.fromEntries(Object.entries(hostRam).filter(([, r]) => r[1] >= ram.hack).map(([h, r]) => [h, r[1]]));
        if (!Object.keys(freeMap).length) continue;
        const biggest = Math.max(...Object.values(freeMap));
        const share = totalRam / chosen.length;

        for (const t of chosen) {
          c.examined(1);
          // Mirror the shipped call site exactly. batch.js floors the hack budget
          // at `hackFloor` threads, capped by what the fleet can EVER host —
          // see the limit-cycle note at its planBatch call site. Planning from
          // the instantaneous free block is a positive feedback loop that drove
          // plan.h from 132 down to 1 and then failed every placement for a
          // third of every cycle.
          //
          // SO THIS CHECKS CAPACITY, NOT THE CURRENT FREE LIST, and that is a
          // deliberate change to what B5 asserts. The property in
          // docs/invariants.md is "placeable on a SINGLE HOST, not merely
          // affordable against the fleet total" — i.e. the hack op must fit some
          // host that EXISTS. Its original evidence was a 148GB opening fleet
          // where every host was <=16GB, so free and capacity coincided and the
          // distinction never surfaced. They diverge now: capacity has two 512GB
          // hosts, so a 175GB hack op is placeable on a single host and simply
          // has to wait for one to drain.
          //
          // Testing against a saturated snapshot made this check fail whenever
          // the fleet was BUSY, which is the healthy steady state — and, worse,
          // it was green before only because the feedback loop kept shrinking
          // the plan until it fit. The invariant was certifying the pathology.
          // What it must still catch is the real failure it was written for: a
          // hack op larger than any host in existence, which places never and
          // earns nothing.
          // Read the floor OUT OF batch.js's source. `b.SETTINGS` is not
          // exported, so `b.SETTINGS?.hackFloor ?? 20` silently used this file's
          // own 20 and would have kept using it after batch.js changed — two
          // copies of a constant that must agree, which is the drift this repo
          // has been bitten by repeatedly. Failing loudly when it cannot be
          // found is better than testing a number nobody ships.
          const hackFloorGb = HACK_FLOOR * ram.hack;
          const capacityBiggest = Math.max(...Object.values(hostRam).map((r) => r[0]));
          const maxHackRam = Math.max(biggest, Math.min(hackFloorGb, capacityBiggest));
          const plan = b.planBatch(t, ram, share / 4, maxHackRam);
          if (!plan) continue; // declining to plan is a correct outcome
          const ops = [
            { op: "hack", threads: plan.h },
            { op: "weaken", threads: plan.w1 },
            { op: "grow", threads: plan.g },
            { op: "weaken", threads: plan.w2 },
          ];
          // Place against CAPACITY blocks (each host's max RAM), which is what
          // "placeable on a single host" means. A plan that fits here but not in
          // freeMap is merely waiting for RAM; a plan that fails here can never
          // run at all, and that is the failure B5 exists to catch.
          const capMap = Object.fromEntries(Object.entries(hostRam).map(([h, r]) => [h, r[0]]));
          if (place(new Map(Object.entries(capMap)), ops, ram, {})) continue;

          const hackBlock = plan.h * ram.hack;
          const rec = byFleet.get(fleet.id) ?? { n: 0, total: totalRam, biggest, hosts: freeMap, worst: null };
          rec.n++;
          const cand = {
            mid, level, nTargets, host: t.host, plan, hackBlock, share,
            overBudget: plan.gb > share / 4,
            contiguityFail: hackBlock > biggest,
            excess: Math.max(hackBlock - biggest, plan.gb - share / 4),
          };
          if (!rec.worst || cand.excess > rec.worst.excess) rec.worst = cand;
          byFleet.set(fleet.id, rec);
        }
        }
      }
    }
  }

  for (const [fleetId, rec] of byFleet) {
    const w = rec.worst;
    c.fail(
      `${fleetId}: ${rec.n} of the plans planBatch produced cannot be placed`,
      `worst case — hacking level ${w.level}, ${w.mid} multipliers, ${w.nTargets} target(s), target ${w.host}:\n` +
        `  plan h=${w.plan.h} g=${w.plan.g} w1=${w.plan.w1} w2=${w.plan.w2}, gb=${w.plan.gb.toFixed(1)}\n` +
        `  budget planBatch was given = totalRam/targets/4 = ${rec.total}/${w.nTargets}/4 = ${fmt.gb(w.share / 4)} (batch.js:841-842)` +
        `${w.overBudget ? `  <- the plan is ${fmt.gb(w.plan.gb)}, OVER its own budget` : ""}\n` +
        `  free blocks: ${Object.entries(rec.hosts).map(([h, r]) => `${h}:${(+r).toFixed(1)}`).join(" ")}  (largest ${fmt.gb(rec.biggest)}, fleet MAX total ${fmt.gb(rec.total)})\n` +
        (w.contiguityFail
          ? `  the hack block alone is ${fmt.gb(w.hackBlock)} (${w.plan.h} threads x ${ram.hack}GB) and no host has that much free\n`
          : `  the four ops do not pack into the free blocks\n`) +
        `batch.js's place() (batch.js:396) returns null, batch.js:869 counts a placeFail, and the loop retries every tick forever. ` +
        `Nothing throws; telemetry cannot distinguish it from "waiting for a safe window".\n` +
        `Root cause: planBatch returns \`best ?? build(1)\` (batch.js:381) — when nothing fits maxRam it returns a plan that ignores the budget rather than null. ` +
        `And maxRam itself is a share of the FLEET TOTAL, not of the largest free block. ` +
        `boot.js already applies the right rule to share.js ("a fraction of the largest free block, not of the fleet"); batch.js does not.`,
    );
  }

  if (!c.fails.length) {
    c.note("every plan placed — this check is only as strong as the fleet shapes and levels above");
  }
  return c;
}
