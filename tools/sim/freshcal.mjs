// THE FRESH-LIFE FORMULA PRIOR AGAINST THE LIVES WE HAVE — its error, per life,
// and held out.
//
//   node tools/sim/freshcal.mjs                 print the table
//   node tools/sim/freshcal.mjs --write <file>  also write the per-life fixture
//
// freshlife.js simulates a fresh life from the game's formulas; this replays it
// on every recorded life with THAT life's own inputs (home RAM, purchased
// servers and rooted network over its own ages from .telemetry/history.jsonl,
// its multipliers from its installed augmentations and Source-Files, its
// intelligence) and compares it with what the life realised at the same ages:
//
//   exp      history.jsonl exp.hacking (all sources — faction hacking work
//            included, which the model does not simulate: part of its error)
//   income   tel.js's earnings ledger, the HACKING stream (the third sample
//            element; lives before the split reconstructed per window by
//            bayes.legacyHackingWindow, or excluded where inseparable)
//
// Per life the residual is the hour-weighted mean over 0.5h windows of
// ln(realised / model). LEAVE-ONE-OUT: each life's prior is the formula times
// the structural-error posterior fitted on every OTHER life
// (bayes.formulaErrorPosterior), and its error is scored on the life it did
// not see — the table docs/bayes.md carries.
//
// MULTIPLIERS: the save digest has no player multipliers, so each life's are
// rebuilt: Source-File bonuses (applySourceFile.ts) x the installed
// augmentations' mults (the game bundle's Augmentations) x NeuroFlux^k, with k
// solved from the life's own (level, exp) pairs (skill.ts is exact, so the
// hacking multiplier is pinned to ~0.5%) and applied to every hacking
// multiplier (NeuroFlux raises all six by the same 1.01). Printed per life.
//
// THE FARM: batch.js's exp farm exists from 2026-09-25 13:39Z (a231e3f) in
// exp mode (BN8: the whole fleet) and from 2026-09-29 01:52Z (6ff9090) by
// verdict in other nodes; its share of the fleet then is the one measurement
// batch.txt gives (heldGB / (heldGB + reservedForPipelines) = 0.12, live BN9
// 2026-09-29 12:13). STATED — an input the record does not carry per age.
//
// CALIBRATION: this IS the calibration of freshlife.js; its output is the
// error the plan carries. It reproduces live quantities by construction
// (history.jsonl, earnings.txt) and prints every residual, pass or fail.

import "../test/gameresolve.mjs";
import "./env.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const g = await import("./game.bundle.mjs");
const F = await import(path.join(ROOT, "freshlife.js"));
const B = await import(path.join(ROOT, "bayes.js"));
const { bitNodeMults } = await import(path.join(ROOT, "bitNodeMultipliers.js"));

const args = process.argv.slice(2);
const writeTo = args.includes("--write") ? args[args.indexOf("--write") + 1] : null;

const HACK_KEYS = ["hacking", "hacking_exp", "hacking_speed", "hacking_money", "hacking_grow", "hacking_chance"];
const NFG = "NeuroFlux Governor";
const NFG_STEP = g.Augmentations[NFG].mults.hacking;
const BATCHER_ERA = Date.parse("2026-09-12T00:01:22Z"); // c7fd07f: the HWGW batcher
const FARM_EXP_MODE = Date.parse("2026-09-25T13:39:30Z"); // a231e3f
const FARM_VERDICT = Date.parse("2026-09-29T01:52:15Z"); // 6ff9090
const FARM_SHARE_MEASURED = 0.12; // batch.txt 2026-09-29 12:13: 504 / (504 + 3608)
const OTHER_HOME_GB = 64; // the resident stack besides progress.js's raise (stated)

// --- source files (applySourceFile.ts) -------------------------------------
function sfMults(sfList, node) {
  const m = Object.fromEntries(HACK_KEYS.map((k) => [k, 1]));
  for (const [bn, lvl] of sfList) {
    const sum = (base) => {
      let s = 0;
      for (let i = 0; i < lvl; i++) s += base / Math.pow(2, i);
      return 1 + s / 100;
    };
    if (bn === 1) for (const k of HACK_KEYS) m[k] *= sum(16);
    if (bn === 5) for (const k of HACK_KEYS) m[k] *= sum(8);
    if (bn === 8) m.hacking_grow *= sum(12);
  }
  return m;
}
function sfLevel(sfList, n) {
  return (sfList.find(([bn]) => bn === n) ?? [n, 0])[1];
}

// --- the lives in history.jsonl ----------------------------------------------
function livesFromHistory(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  const lives = [];
  for (const l of lines) {
    let j;
    try {
      j = JSON.parse(l);
    } catch {
      continue;
    }
    if (!Number.isFinite(j.playtimeSinceLastAug) || !j.exp || !j.skills) continue;
    const last = lives[lives.length - 1];
    if (!last || j.bitNode !== last.node || j.playtimeSinceLastAug < last.lastPt - 60e3) {
      lives.push({ node: j.bitNode, startMs: Date.parse(j.at) - j.playtimeSinceLastAug, recs: [], lastPt: 0 });
    }
    const L = lives[lives.length - 1];
    L.lastPt = j.playtimeSinceLastAug;
    L.recs.push(j);
  }
  return lives;
}

/** The hacking multiplier a life's (level, exp) pairs pin: the intersection of the per-record brackets. */
function levelMultOf(recs) {
  let lo = 0;
  let hi = Infinity;
  for (const r of recs) {
    const L = r.skills.hacking;
    const base = 32 * Math.log(r.exp.hacking + 534.6) - 200;
    if (!(L >= 2 && base > 1)) continue;
    lo = Math.max(lo, L / base);
    hi = Math.min(hi, (L + 1) / base);
  }
  return lo > 0 && hi >= lo ? { m: (lo + hi) / 2, spread: (hi - lo) / ((lo + hi) / 2) } : null;
}

function multsOf(life) {
  const first = life.recs[0];
  const sf = first.sourceFiles?.data ?? [];
  const m = sfMults(sf, life.node);
  let missing = 0;
  for (const name of first.augmentations ?? []) {
    const a = g.Augmentations[name];
    if (!a) {
      missing++;
      continue;
    }
    if (name === NFG) continue;
    for (const k of HACK_KEYS) m[k] *= a.mults[k] ?? 1;
  }
  const bn = bitNodeMults(life.node);
  const lm = levelMultOf(life.recs);
  if (!lm) return null;
  const raw = lm.m / bn.HackingLevelMultiplier;
  // NeuroFlux (and entropy, which scales all six alike) closes the gap.
  const kf = Math.log(raw / m.hacking) / Math.log(NFG_STEP);
  const k = Math.max(0, Math.round(kf));
  const nf = Math.pow(NFG_STEP, k);
  for (const k2 of HACK_KEYS) m[k2] *= nf;
  const resid = raw / m.hacking;
  for (const k2 of HACK_KEYS) m[k2] *= resid; // any leftover (entropy, rounding), applied to all six
  return { mults: m, nfg: k, nfgFrac: kf, levelMult: lm.m, pin: lm.spread, missingAugs: missing, sf4: sfLevel(sf, 4) };
}

// --- the earnings ledgers (live + fixtures), merged by life key --------------
function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
function earningsLives() {
  const out = {};
  const add = (e) => {
    for (const [k, L] of Object.entries(e?.lives ?? {})) {
      const cur = out[k];
      if (!cur || (L.samples?.length ?? 0) > (cur.samples?.length ?? 0)) out[k] = L;
    }
  };
  const tel = path.join(ROOT, ".telemetry");
  add(readJson(path.join(tel, "earnings.txt")));
  const T = path.join(ROOT, "tools/test");
  for (const f of fs.readdirSync(T).filter((f) => f.startsWith("fixture-") && f.endsWith(".json"))) {
    const j = readJson(path.join(T, f));
    if (j?.earnings) add(j.earnings);
    if (j?.lives && j?.lives && typeof j.lives === "object" && !Array.isArray(j.lives)) add(j);
  }
  return out;
}
function ledgerAll() {
  const out = [];
  const seen = new Set();
  const add = (arr) => {
    for (const e of Array.isArray(arr) ? arr : []) {
      const key = `${e?.at}|${e?.bitNode}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
  };
  add(readJson(path.join(ROOT, ".telemetry/lifetimes.txt")));
  const T = path.join(ROOT, "tools/test");
  for (const f of fs.readdirSync(T).filter((f) => f.startsWith("fixture-") && f.endsWith(".json"))) add(readJson(path.join(T, f))?.lifetimes);
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// --- one life replayed (freshlife.replayLife: the same code progress.js runs) --
function replay(life, mk, earn) {
  const bn = bitNodeMults(life.node);
  const world = F.worldOf(bn);
  const byPorts = [...world].sort((a, b) => a.ports - b.ports || b.ram - a.ram);
  const netGBof = (n) => byPorts.slice(0, Math.max(0, n)).reduce((a, s) => a + s.ram, 0);
  // THINNED to one record per ~5 minutes BEFORE the replay, so the fixture
  // (which carries this track) reproduces every residual exactly.
  const recs5 = life.recs.filter((r, i, a) => i === 0 || i === a.length - 1 || Math.floor((Date.parse(r.at) - life.startMs) / 3e5) !== Math.floor((Date.parse(a[i - 1].at) - life.startMs) / 3e5));
  const track = recs5.map((r) => {
    const ps = (r.purchasedServers ?? []).filter((s) => !/^hacknet-/.test(s.hostname));
    const netCount = (r.servers?.rooted ?? 0) - 1 - (r.purchasedServers ?? []).length;
    return [(Date.parse(r.at) - life.startMs) / 3.6e6, r.exp.hacking, r.home?.ram ?? 0, ps.reduce((a, s) => a + (s.ram ?? 0), 0), netGBof(netCount), r.skills.hacking, r.skills.intelligence ?? 0];
  });
  const sing = life.node === 4 ? 1 : mk.sf4 <= 1 ? 16 : mk.sf4 === 2 ? 4 : 1;
  const reserve = 13 + 6.25 * sing + OTHER_HOME_GB;
  const farmShare = (h) => {
    const t = life.startMs + h * 3.6e6;
    if (bn.ScriptHackMoneyGain === 0) return t >= FARM_EXP_MODE ? 1 : 0;
    return t >= FARM_VERDICT ? FARM_SHARE_MEASURED : 0;
  };
  const r = F.replayLife({
    bn,
    mults: mk.mults,
    intelligence: track[0][6],
    reserveGB: reserve,
    track,
    earnings: earn?.samples ?? null,
    farmShare,
    legacy: { windowFn: B.legacyHackingWindow, bounds: B.PRIORS.legacyNonHack, lifeSd: B.PRIORS.incomeLifeSdLn },
  });
  return { ...r, reserve, track };
}

// --- main ---------------------------------------------------------------------
const lives = livesFromHistory(path.join(ROOT, ".telemetry/history.jsonl"));
const earn = earningsLives();
const out = [];
const lastLife = lives[lives.length - 1];
for (const life of lives) {
  const recs = life.recs;
  if (life.startMs < BATCHER_ERA) continue;
  // A fresh start in the record: its first exp near zero (the LEVEL at exp 0
  // is the multiplier, ~8 in BN1 at x8 — not a test of freshness).
  if (recs[0].exp.hacking > 1e4 || (Date.parse(recs[0].at) - life.startMs) / 3.6e6 > 0.1) continue;
  const endH = (Date.parse(recs[recs.length - 1].at) - life.startMs) / 3.6e6;
  if (endH < 0.5) continue;
  const mk = multsOf(life);
  if (!mk) continue;
  // the earnings-ledger life whose key (lastAugReset) is this life's start (+-15 min)
  const ek = Object.keys(earn).find((k) => Math.abs(Number(k) - life.startMs) < 15 * 60e3 && earn[k].node === life.node) ?? null;
  const rp = replay(life, mk, ek ? earn[ek] : null);
  const expR = rp.exp;
  const incR = rp.income;
  out.push({
    key: String(Math.round(life.startMs)),
    // The running life (the last in the record) is not complete: its own
    // measurement enters the plan through the within-life posterior, so it is
    // never part of the seed (it would count twice).
    complete: life !== lastLife,
    earnKey: ek,
    node: life.node,
    start: new Date(life.startMs).toISOString(),
    endH: +rp.endH.toFixed(3),
    nfg: mk.nfg,
    nfgFrac: +mk.nfgFrac.toFixed(2),
    levelMult: +mk.levelMult.toFixed(4),
    pin: +mk.pin.toFixed(4),
    mults: Object.fromEntries(Object.entries(mk.mults).map(([k, v]) => [k, +v.toFixed(4)])),
    reserve: rp.reserve,
    exp: expR && { ln: +expR.ln.toFixed(4), hours: +expR.hours.toFixed(2), windows: expR.windows },
    income: incR && { ln: +incR.ln.toFixed(4), hours: +incR.hours.toFixed(2), windows: incR.windows, kinds: [...new Set((rp.incomeWindows ?? []).map((x) => x.kind))] },
    // [ageH, hackExp, homeRam, pservGB, netGB, level, int] every ~5 min: enough to replay the life
    track: rp.track.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[6]]),
    earnings: ek ? earn[ek].samples : null,
    sf4: mk.sf4,
    windows: rp.expWindows.map((w) => [w.a0, +w.expReal.toFixed(3), +(w.expModel ?? 0).toFixed(3), w.covered ? 1 : 0]),
    incomeWindows: (rp.incomeWindows ?? []).map((w) => [w.a0, w.a1, w.incReal === null ? null : +w.incReal.toExponential(4), +(w.incModel ?? 0).toExponential(4), w.kind, +w.weight.toFixed(3)]),
  });
}

// --- held out ------------------------------------------------------------------
// Two held-out scores per life: LEAVE-ONE-OUT (every other life, this node's
// included) and THEN (only the lives that had finished when this one began —
// what the prior would actually have said at its install).
function heldOut(kind) {
  const rows = [];
  for (const L of out) {
    const r = L[kind];
    if (!r) continue;
    const res = (o) => ({ ln: o[kind].ln, hours: o[kind].hours, life: o.key, node: o.node });
    const loo = B.formulaErrorPosterior(out.filter((o) => o !== L && o[kind]).map(res), kind, { node: L.node });
    const then = B.formulaErrorPosterior(out.filter((o) => o !== L && o[kind] && Date.parse(o.start) + o.endH * 3.6e6 <= Date.parse(L.start) + 60e3).map(res), kind, { node: L.node });
    const row = (post) => ({ prior: post.mean, sd: post.sd, err: r.ln - post.mean, in80: Math.abs((r.ln - post.mean) / post.sd) <= 1.2816, own: post.own });
    rows.push({ key: L.key, node: L.node, start: L.start, endH: L.endH, raw: r.ln, loo: row(loo), then: row(then) });
  }
  return rows;
}
const fmt = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
const tables = {};
for (const kind of ["exp", "income"]) {
  const rows = heldOut(kind);
  tables[kind] = rows;
  console.log(`\n=== ${kind.toUpperCase()}: realised / formula per life (ln; x = e^ln). THEN = the prior from lives finished before it; LOO = every other life ===`);
  console.log("node start             endH   raw formula      THEN prior  sd   err (x)         in80 | LOO err (x)       in80");
  for (const r of rows) console.log(`BN${String(r.node).padEnd(3)} ${r.start.slice(0, 16)} ${r.endH.toFixed(2).padStart(5)}  ${fmt(r.raw).padStart(6)} (x${Math.exp(r.raw).toFixed(2).padStart(6)})  ${fmt(r.then.prior).padStart(6)} ${r.then.sd.toFixed(2)}  ${fmt(r.then.err).padStart(6)} (x${Math.exp(r.then.err).toFixed(2).padStart(6)}) ${r.then.in80 ? "yes " : "NO  "} | ${fmt(r.loo.err).padStart(6)} (x${Math.exp(r.loo.err).toFixed(2).padStart(6)}) ${r.loo.in80 ? "yes" : "NO"}`);
  if (rows.length) {
    const rms = (f) => Math.sqrt(rows.reduce((a, r) => a + f(r) ** 2, 0) / rows.length);
    const cov = (k) => rows.filter((r) => r[k].in80).length / rows.length;
    console.log(`CHECK ${kind}: ${rows.length} lives; raw formula rms ln error ${rms((r) => r.raw).toFixed(2)} (x${Math.exp(rms((r) => r.raw)).toFixed(2)}); held out THEN rms ${rms((r) => r.then.err).toFixed(2)} (x${Math.exp(rms((r) => r.then.err)).toFixed(2)}), 80% covers ${(100 * cov("then")).toFixed(0)}%; LOO rms ${rms((r) => r.loo.err).toFixed(2)} (x${Math.exp(rms((r) => r.loo.err)).toFixed(2)}), 80% covers ${(100 * cov("loo")).toFixed(0)}%`);
  }
  for (const n of [...new Set(out.filter((o) => o[kind]).map((o) => o.node))]) {
    const full = B.formulaErrorPosterior(out.filter((o) => o[kind]).map((o) => ({ ln: o[kind].ln, hours: o[kind].hours, life: o.key, node: o.node })), kind, { node: n });
    console.log(`  BN${n}: ${full.why}`);
  }
}
if (args.includes("--seed")) {
  const rows = out.filter((o) => o.complete && (o.exp || o.income)).map((o) => [Number(o.key), o.node, o.exp ? o.exp.ln : null, o.exp ? o.exp.hours : null, o.income ? o.income.ln : null, o.income ? o.income.hours : null]);
  console.log(`\n// freshcal.mjs --seed ${new Date().toISOString().slice(0, 16)}Z: ${rows.length} completed lives [startMs, node, expLn, expHours, incomeLn, incomeHours]`);
  console.log("export const FRESH_CALIBRATION = [\n" + rows.map((r) => "  " + JSON.stringify(r) + ",").join("\n") + "\n]");
}
if (writeTo) {
  fs.writeFileSync(writeTo, JSON.stringify({ note: `freshcal.mjs ${new Date().toISOString()}: per-life replay of freshlife.js against history.jsonl (exp) and the earnings ledger (hacking income)`, lives: out, heldOut: tables }, null, 0));
  console.log(`\nwrote ${writeTo} (${out.length} lives)`);
}
process.exit(0);
