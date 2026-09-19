#!/usr/bin/env node
// Runs the STAGED batch.js's real main() against a simulated game.
//
//   node tools/staging/selfcal/smoke.mjs
//   node tools/staging/selfcal/smoke.mjs --hours 3 --nocal
//
// verify-selfcal.mjs exercises the pure pieces. This exercises the wiring: the
// actual loop, the actual sampler call site, the actual status write. A
// ReferenceError from a bad edit in this file's main() is the single most
// expensive failure shape in this repo — it once hid in batch.js for 23 minutes
// looking exactly like a hang — and it is not detectable by importing the
// module, only by running it.
//
// The world is NOT a reimplementation of the game's economics: hack fraction,
// hack chance, hack time and grow are the real exported functions out of
// ~/Repos/bitburner under the live BitNode's multipliers (game.mjs::setBitNode).
// What is simulated is only what the game couples to React and its worker
// runtime — a clock, per-host RAM, and an event queue that computes an
// operation's duration at LAUNCH and its effect at LANDING, which is the gap
// the whole batcher exists to exploit.
//
// CALIBRATION: the world is seeded from the live save and its uncorrected
// income is compared with /tel/batch.txt's before any A/B number below it is
// used.

import "../../sim/env.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  setBitNode,
  calculatePercentMoneyHacked,
  calculateHackingChance,
  calculateHackingTime,
  calculateGrowMoney,
  getWeakenEffect,
  currentNodeMults,
} from "../../sim/game.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const HOURS = Number(arg("hours", 2));

async function loadScript(file) {
  const src = fs
    .readFileSync(file, "utf8")
    .replace(/(^\s*import[^'"]*['"])([^'"]+)(['"])/gm, (all, head, spec, tail) => {
      const target = path.join(REPO, spec.replace(/^\.?\//, ""));
      return fs.existsSync(target) ? head + pathToFileURL(target).href + tail : all;
    });
  return import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
}

const LIVE = JSON.parse(fs.readFileSync(path.join(HERE, "live-servers.json"), "utf8"));
setBitNode(LIVE.bitNode, 1);

const FLEET = [
  ["home", 512, 1],
  ["fulcrumtech", 1024, 9],
  ["blade", 256, 12],
  ["helios", 256, 11],
  ["omnitek", 128, 11],
  ["univ-energy", 128, 9],
  ["lexo-corp", 128, 6],
  ["global-pharm", 64, 4],
  ["unitalife", 64, 5],
  ["catalyst", 64, 4],
  ["silver-helix", 64, 2],
  ["millenium-fitness", 64, 6],
  ["rothman-uni", 64, 5],
  ["phantasy", 32, 3],
];
const TARGETS = ["phantasy"];

const FORTIFY = 0.002;
const WEAKEN_PER_THREAD = 0.05;
const coreBonus = (c) => 1 + (Math.max(1, c) - 1) / 16;

class World {
  constructor() {
    this.t = 0;
    this.ev = [];
    this.hosts = new Map();
    for (const [h, ram, cores] of FLEET) this.hosts.set(h, { ram, cores, used: 0 });
    this.srv = new Map();
    for (const name of TARGETS) {
      const s = LIVE.servers[name];
      this.srv.set(name, { ...s, money: s.moneyMax * 0.25, sec: s.minDifficulty * 3 });
    }
    this.person = { skills: { hacking: LIVE.hacking, intelligence: LIVE.intelligence ?? 0 }, mults: LIVE.mults };
    this.earned = 0;
    this.hacks = 0;
    this.succ = 0;
    this.seed = 987654321;
  }
  rnd() {
    return ((this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  }
  view(name) {
    const s = this.srv.get(name);
    return { ...s, hostname: name, hasAdminRights: true, hackDifficulty: s.sec, baseDifficulty: s.minDifficulty, moneyAvailable: s.money };
  }
  hackTime(name) {
    return calculateHackingTime(this.view(name), this.person) * 1000;
  }
  launch(op, host, threads, target, pad) {
    const gb = { hack: 1.7, grow: 1.75, weaken: 1.75 }[op] * threads;
    const H = this.hosts.get(host);
    if (!H || H.used + gb > H.ram + 1e-9) return 0;
    H.used += gb;
    const base = this.hackTime(target);
    const dur = op === "hack" ? base : op === "grow" ? base * 3.2 : base * 4;
    this.ev.push({ at: this.t + dur + Number(pad || 0), op, host, threads, target, gb });
    return 1;
  }
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      let i = -1;
      for (let j = 0; j < this.ev.length; j++) if (this.ev[j].at <= end && (i < 0 || this.ev[j].at < this.ev[i].at)) i = j;
      if (i < 0) break;
      const e = this.ev.splice(i, 1)[0];
      this.t = Math.max(this.t, e.at);
      this.hosts.get(e.host).used -= e.gb;
      this.apply(e);
    }
    this.t = end;
  }
  apply(e) {
    const s = this.srv.get(e.target);
    // CORES, not a core bonus. calculateGrowMoney's fourth parameter is the
    // executing host's core COUNT and it calls getCoreBonus itself
    // (Server/formulas/grow.ts:25,37); passing a bonus here silently under-grew
    // by up to 1.6x on a 12-core host and made the target sit at 81% of max,
    // which read exactly like a batcher defect. Same class of bug as the one
    // being fixed: a plausible value in the wrong units, never checked.
    const cores = this.hosts.get(e.host).cores;
    if (e.op === "weaken") {
      s.sec = Math.max(s.minDifficulty, s.sec - getWeakenEffect(e.threads, cores));
      return;
    }
    if (e.op === "grow") {
      const before = s.money;
      const after = Math.min(s.moneyMax, calculateGrowMoney(this.view(e.target), e.threads, this.person, cores));
      s.money = after;
      // processSingleServerGrowth caps the fortify at the threads actually used.
      const used = before >= s.moneyMax ? 0 : e.threads;
      s.sec = Math.min(100, s.sec + 2 * FORTIFY * used);
      return;
    }
    // hack
    this.hacks++;
    const chance = calculateHackingChance(this.view(e.target), this.person);
    const pct = calculatePercentMoneyHacked(this.view(e.target), this.person);
    if (this.rnd() < chance) {
      this.succ++;
      const drain = Math.min(s.money, s.money * pct * e.threads);
      s.money -= drain;
      this.earned += drain;
      s.sec = Math.min(100, s.sec + FORTIFY * Math.min(e.threads, Math.ceil(1 / pct)));
    }
  }
}

function mockNs(w, files, flagArgs) {
  const exits = new Map();
  const ns = {
    args: flagArgs,
    flags(defs) {
      const out = {};
      for (const [k, v] of defs) out[k] = v;
      for (let i = 0; i < flagArgs.length; i++) {
        const a = String(flagArgs[i]);
        if (!a.startsWith("--")) continue;
        const k = a.slice(2);
        const def = defs.find((d) => d[0] === k);
        if (!def) continue;
        if (typeof def[1] === "boolean") out[k] = true;
        else out[k] = flagArgs[++i];
      }
      return out;
    },
    disableLog() {},
    print() {},
    tprint() {},
    atExit(fn, id) {
      exits.set(id ?? "default", fn);
    },
    getHostname: () => "home",
    scan: (h) => (h === "home" ? FLEET.map((f) => f[0]).filter((x) => x !== "home") : []),
    hasRootAccess: () => true,
    getServerNumPortsRequired: () => 0,
    nuke: () => true,
    brutessh: () => {},
    ftpcrack: () => {},
    relaysmtp: () => {},
    httpworm: () => {},
    sqlinject: () => {},
    fileExists: (f) => files.has(f),
    getScriptRam: (f) => ({ "h.js": 1.7, "g.js": 1.75, "w.js": 1.75 })[f] ?? 0,
    ps: () => [],
    kill: () => true,
    scp: () => true,
    getHackingLevel: () => w.person.skills.hacking,
    getHackingMultipliers: () => ({
      chance: w.person.mults.hacking_chance,
      speed: w.person.mults.hacking_speed,
      money: w.person.mults.hacking_money,
      growth: w.person.mults.hacking_grow,
    }),
    getPlayer: () => ({ factions: [], skills: { ...w.person.skills }, mults: { ...w.person.mults } }),
    getServerRequiredHackingLevel: (h) => w.srv.get(h)?.requiredHackingSkill ?? 1e9,
    getServerMinSecurityLevel: (h) => w.srv.get(h)?.minDifficulty ?? 1,
    getServerMaxMoney: (h) => w.srv.get(h)?.moneyMax ?? 0,
    getServerSecurityLevel: (h) => w.srv.get(h)?.sec ?? 1,
    getServerMoneyAvailable: (h) => w.srv.get(h)?.money ?? 0,
    getServerGrowth: (h) => w.srv.get(h)?.serverGrowth ?? 0,
    getHackTime: (h) => w.hackTime(h),
    getServerMaxRam: (h) => w.hosts.get(h)?.ram ?? 0,
    getServerUsedRam: (h) => w.hosts.get(h)?.used ?? 0,
    getServer: (h) => ({ cpuCores: w.hosts.get(h)?.cores ?? 1 }),
    exec: (script, host, opts, target, pad) => {
      const op = { "h.js": "hack", "g.js": "grow", "w.js": "weaken" }[script];
      return w.launch(op, host, opts.threads, target, pad) ? Math.floor(Math.random() * 1e6) + 1 : 0;
    },
    write: (f, body) => files.set(f, body),
    read: (f) => files.get(f) ?? "",
    async sleep(ms) {
      w.advance(ms);
      if (w.t > HOURS * 3600 * 1000) throw { __done: true };
      return true;
    },
  };
  return { ns, exits };
}

async function run(label, flagArgs, files = new Map()) {
  const w = new World();
  const { ns, exits } = mockNs(w, files, flagArgs);
  const realNow = Date.now;
  // batch.js schedules on Date.now(); point it at the virtual clock so the
  // controller and the world share one timeline.
  const base = realNow();
  Date.now = () => base + Math.round(w.t);
  const B = await loadScript(path.join(HERE, "batch.js"));
  let err = null;
  try {
    await B.main(ns);
  } catch (e) {
    if (!e || !e.__done) err = e;
  } finally {
    Date.now = realNow;
  }
  for (const fn of exits.values()) {
    try {
      fn();
    } catch (e) {
      err = err ?? e;
    }
  }
  const status = JSON.parse(files.get("/tel/batch.txt") || "{}");
  return { label, w, err, status, files };
}

let fails = 0;
const ok = (c, t) => {
  if (!c) fails++;
  console.log(`  ${c ? "ok  " : "FAIL"} ${t}`);
};

console.log(`smoke: the staged batch.js main() against a simulated BitNode ${LIVE.bitNode}, ${HOURS}h\n`);

const off = await run("--nocal", ["--nocal", "--quiet"]);
ok(!off.err, `--nocal: main() ran ${HOURS}h with no throw${off.err ? ` — ${off.err.stack ?? off.err}` : ""}`);
const on = await run("calibrating", ["--quiet", "--nocalrestore"]);
ok(!on.err, `calibrating: main() ran ${HOURS}h with no throw${on.err ? ` — ${on.err.stack ?? on.err}` : ""}`);

const secs = HOURS * 3600;
console.log(`\n  uncorrected : $${Math.round(off.w.earned).toLocaleString()} over ${HOURS}h = $${Math.round(off.w.earned / secs).toLocaleString()}/s, ${off.status.totals?.batches} batches`);
console.log(`  calibrated  : $${Math.round(on.w.earned).toLocaleString()} over ${HOURS}h = $${Math.round(on.w.earned / secs).toLocaleString()}/s, ${on.status.totals?.batches} batches`);
console.log(`  ratio       : ${(on.w.earned / off.w.earned).toFixed(2)}x\n`);

const row = (r) => {
  const T = r.status.targets?.[0] ?? {};
  return (
    `  ${r.label.padEnd(12)} batches ${String(T.batches).padStart(4)}  period ${String(T.periodSec).padStart(6)}s  plan h=${T.plan?.h} f=${T.plan?.fPct}% gb=${T.plan?.gb}  money@${T.moneyPct}%  ` +
    `drains ${T.drains} placeFails ${T.placeFails} unsafeSkips ${T.unsafeSkips} execFails ${T.execFails}  util ${r.status.ram?.utilPct}%` +
    (T.cal ? `  planVsReal ${T.cal.planVsReal} hits ${T.cal.calHits ?? T.cal.landings} skipped ${T.cal.skipped}` : "")
  );
};
console.log(row(off));
console.log(row(on));
console.log("");

const c = on.status.calibration;
console.log(`  calibration: ${JSON.stringify(c, null, 2).split("\n").join("\n  ")}\n`);
ok(c && c.enabled === true, "calibration is published in /tel/batch.txt");
ok(c && Math.abs(c.y - currentNodeMults.ScriptHackMoney) / currentNodeMults.ScriptHackMoney < 0.05, `the applied y (${c?.y}) is ScriptHackMoney (${currentNodeMults.ScriptHackMoney}) within 5%`);
ok(c && c.verdict === "ok", `verdict is ${JSON.stringify(c?.verdict)}`);
ok(c && c.samples >= 12, `it collected ${c?.samples} samples`);
ok(c && c.spread !== null && c.spread < 0.05, `sample spread ${c?.spread} — a clean stream should be ~0, since every sample is an exact reading of the same constant`);
const pt = on.status.targets?.[0]?.cal;
const moneyFrac = (on.status.targets?.[0]?.moneyPct ?? 0) / 100;
ok(
  pt && Math.abs(pt.planVsReal - moneyFrac) < 0.08,
  `plan-vs-realised over landed batches is ${pt?.planVsReal}, and the only term left in it is the balance at landing (${moneyFrac}) — it was 0.32 uncorrected, where the missing factor was the multiplier`,
);
ok(pt && Math.abs(pt.chanceObs - pt.chanceModel) < 0.1, `observed hack chance ${pt?.chanceObs} vs the model's ${pt?.chanceModel} — measured separately and never folded into y`);
ok(on.w.earned > off.w.earned * 1.5, `the calibrated run earned ${(on.w.earned / off.w.earned).toFixed(2)}x the uncorrected one`);
ok(off.status.calibration?.enabled === false, "--nocal publishes `enabled: false` and says what that costs, rather than omitting the field");

// The persisted value and its fence.
const saved = JSON.parse(on.files.get("/tel/batch-cal.txt") || "null");
ok(saved && Math.abs(saved.y - currentNodeMults.ScriptHackMoney) / currentNodeMults.ScriptHackMoney < 0.1, `persisted ${JSON.stringify(saved?.y)} to /tel/batch-cal.txt with fingerprints ${JSON.stringify(saved?.fp)}`);
const warm = await run("restored", ["--quiet"], new Map([["/tel/batch-cal.txt", on.files.get("/tel/batch-cal.txt")]]));
ok(!warm.err, "a restart that restores the persisted value runs with no throw");
ok(warm.status.calibration?.source === "restored" || warm.status.calibration?.source === "measured", `and adopts it (source=${warm.status.calibration?.source}, first status y=${warm.status.calibration?.y})`);
console.log(row(warm));
ok(warm.w.earned >= off.w.earned * 1.5, `a restarted run earns ${(warm.w.earned / off.w.earned).toFixed(2)}x the uncorrected baseline and ${(warm.w.earned / on.w.earned).toFixed(2)}x the cold-started corrected one`);
const bad = new Map([["/tel/batch-cal.txt", JSON.stringify({ y: 0.02, n: 99, fp: ["ghost:1:1:1"] })]]);
const stale = await run("stale", ["--quiet"], bad);
ok(
  (stale.status.calibration?.notes ?? []).some((n) => n.includes("IGNORED")),
  "a persisted value whose server fingerprints no longer exist is REFUSED and says so in the status",
);

console.log(`\n${fails ? `FAIL: ${fails} checks failed` : "PASS"}`);
process.exit(fails ? 1 : 0);
