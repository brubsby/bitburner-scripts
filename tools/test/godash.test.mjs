// [GD] The live Go dashboard (tools/godash.mjs, served by the daemon at /go).
//
//   GD1 /go.json's shape from today's go.txt (opponent-only Thompson arms):
//       every top-level key, one arm per opponent with a Beta that reproduces
//       the published mean/sd, the draw attached, the chosen arm marked.
//   GD2 The per-(opponent x board size) arms go.js is about to publish light
//       up whatever their shape: composite keys, nested by size, a list, with
//       alpha/beta, powerPerHour, per-arm draws, a chosen object and a pick
//       history.
//   GD3 History: a W/L change becomes a pick attributed to the arm that was in
//       play; a counter reset is a new baseline, not a game; the same `at` is
//       not double-counted; samples are thinned and trimmed to the window.
//   GD4 Over real HTTP: /go serves the page, /go.json reads the game live,
//       falls back to the disk mirror when not connected and says so, and a
//       go.txt that does not parse is reported, never rendered as empty-and-fine.
//   GD5 Wiring: the daemon routes /go* to the hot-reloaded module, and the page
//       polls the endpoint the module serves.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { Check } from "./harness.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

// A trimmed copy of the live /tel/go.txt of 2026-10-04 (field names verbatim).
const TODAY = {
  at: "2026-10-04T18:13:46.513Z",
  health: "ok",
  opponent: "Tetrads",
  opponentWhy: "Tetrads (combat) marginal 2.539e-1/h ... [Thompson: win rate drawn 0.983]; runners-up Daedalus 0.00e+0/h @n=194",
  pinned: "TheBlackHand",
  goPower: 4,
  boardSize: 5,
  sf14: 0,
  thompson: {
    draw: { Daedalus: 0.996, Illuminati: 0.468, TheBlackHand: 0.905, SlumSnakes: 1, Netburners: 0.999, Tetrads: 0.983, w0r1d_d43m0n: 0.162 },
    arms: {
      Daedalus: { mean: 0.988, sd: 0.014, games: 725 },
      Illuminati: { mean: 0.399, sd: 0.079, games: 40 },
      TheBlackHand: { mean: 0.929, sd: 0.033, games: 352 },
      SlumSnakes: { mean: 0.983, sd: 0.039, games: 0 },
      Netburners: { mean: 0.998, sd: 0.006, games: 679 },
      Tetrads: { mean: 0.986, sd: 0.015, games: 5415 },
      w0r1d_d43m0n: { mean: 0.5, sd: 0.289, games: 0 },
    },
  },
  modelAsked: 4005,
  modelAnswered: 3960,
  ponderHits: 2932,
  turnTiming: { moves: 4005, askMs: 285, playMs: 1031, loopMs: 1329 },
  solverMode: "session",
  gamesThisProcess: 368,
  processStartedAt: "2026-10-04T16:44:18.919Z",
  wins: 1536,
  losses: 25,
  winStreak: 98,
  highestWinStreak: 244,
  bonuses: { Daedalus: 22.585, "The Black Hand": 35.77, Tetrads: 206.564, Netburners: 87.071 },
  errors: [],
};

const TOP_KEYS = ["v", "now", "source", "error", "at", "ageMs", "ok", "go", "arms", "armsBy", "chosen", "picks", "picksSource", "derivedPicks", "history", "summary"];
const ARM_KEYS = ["key", "opponent", "size", "mean", "sd", "games", "a", "b", "draw", "powerPerHour", "eligible", "chosen"];
const SUMMARY_KEYS = ["wins", "losses", "winStreak", "highestWinStreak", "boardSize", "solverMode", "ponderHits", "modelAnswered", "ponderRate", "turnTiming", "gamesThisProcess", "processStartedAt", "bonuses", "nodePower", "errors"];

const missing = (obj, keys) => keys.filter((k) => !(k in (obj ?? {})));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function getText(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: p }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body: Buffer.concat(chunks).toString() }));
    }).on("error", reject);
  });
}

export async function run() {
  const D = await import("../godash.mjs");
  const out = [];

  // ------------------------------------------------------------------ GD1
  {
    const c = new Check("GD1", "/go.json shape from today's go.txt: opponent-only arms, Beta fits, draw, chosen");
    const store = D.newStore();
    const now = Date.parse(TODAY.at) + 5000;
    const j = D.buildGoJson(TODAY, store, { now, source: "game" });
    const m = missing(j, TOP_KEYS);
    if (m.length) c.fail("/go.json is missing top-level keys", m.join(", "));
    if (JSON.stringify(JSON.parse(JSON.stringify(j))) !== JSON.stringify(j)) c.fail("/go.json does not round-trip through JSON");
    if (j.ageMs !== 5000) c.fail(`ageMs ${j.ageMs}, expected 5000 (now - go.txt at)`);
    if (j.armsBy !== "opponent") c.fail(`armsBy '${j.armsBy}' on opponent-only arms`);
    if (j.arms.length !== 7) c.fail(`${j.arms.length} arms from 7 opponents`);
    for (const a of j.arms) {
      c.examined(1);
      const mk = missing(a, ARM_KEYS);
      if (mk.length) c.fail(`arm ${a.key} missing ${mk.join(", ")}`);
      if (a.size !== null) c.fail(`arm ${a.key} has size ${a.size} from an opponent-only key`);
      const src = TODAY.thompson.arms[a.opponent];
      if (!src) { c.fail(`arm ${a.key} does not map back to an opponent`); continue; }
      // The Beta recovered by moments must reproduce the published mean and sd.
      const mean = a.a / (a.a + a.b);
      const sd = Math.sqrt((a.a * a.b) / ((a.a + a.b) ** 2 * (a.a + a.b + 1)));
      if (!near(mean, src.mean, 1e-9) || !near(sd, src.sd, 1e-9)) c.fail(`Beta for ${a.key} gives ${mean}/${sd}, published ${src.mean}/${src.sd}`);
      if (a.draw !== TODAY.thompson.draw[a.opponent]) c.fail(`draw for ${a.key} ${a.draw}, published ${TODAY.thompson.draw[a.opponent]}`);
    }
    const w0 = j.arms.find((a) => a.opponent === "w0r1d_d43m0n");
    if (!w0 || !near(w0.a, 1, 0.02) || !near(w0.b, 1, 0.02)) c.fail("the uniform-prior arm (mean .5, sd .289) should come out Beta(1,1)", JSON.stringify(w0));
    const chosen = j.arms.filter((a) => a.chosen).map((a) => a.key);
    if (chosen.join() !== "Tetrads") c.fail(`chosen arms ${chosen}, expected Tetrads`);
    if (j.chosen.opponent !== "Tetrads" || j.chosen.size !== 5 || !j.chosen.why?.startsWith("Tetrads")) c.fail("chosen {opponent,size,why} wrong", JSON.stringify(j.chosen));
    const ms = missing(j.summary, SUMMARY_KEYS);
    if (ms.length) c.fail("summary missing", ms.join(", "));
    if (!near(j.summary.ponderRate, 2932 / 3960, 1e-12)) c.fail(`ponderRate ${j.summary.ponderRate}`);
    // Node power: keyed by OUR opponent key, inverted from the bonus.
    const np = j.summary.nodePower;
    if (!(np.TheBlackHand > 0) || !(np.Tetrads > np.Daedalus)) c.fail("nodePower not inverted per channel (keyed by our key)", JSON.stringify(np));
    if (j.go !== TODAY) c.fail("go.txt is not passed through verbatim");
    const empty = D.buildGoJson(null, store, { now, source: null, error: "no mirror: ENOENT" });
    if (empty.ok !== false || empty.arms.length || empty.summary !== null || empty.error !== "no mirror: ENOENT") c.fail("a missing go.txt must read as not-ok with its error", JSON.stringify(empty).slice(0, 300));
    if (missing(empty, TOP_KEYS).length) c.fail("the not-ok body drops keys", missing(empty, TOP_KEYS).join(", "));
    c.note(`7 arms; Tetrads Beta(${j.arms.find((a) => a.key === "Tetrads").a.toFixed(0)}, ${j.arms.find((a) => a.key === "Tetrads").b.toFixed(1)}); nodePower ${JSON.stringify(np)}`);
    out.push(c);
  }

  // ------------------------------------------------------------------ GD2
  {
    const c = new Check("GD2", "per-(opponent x size) arms in every plausible shape, plus chosen + published picks");
    const base = { ...TODAY, boardSize: 7 };
    const arm = (mean, games, extra = {}) => ({ mean, sd: 0.02, games, ...extra });
    const shapes = {
      composite: { arms: { "Tetrads@5": arm(0.98, 100), "Tetrads@7": arm(0.9, 30, { draw: 0.93 }), "The Black Hand@5": arm(0.95, 50), "Daedalus x9": arm(0.5, 3) } },
      nested: { arms: { Tetrads: { 5: arm(0.98, 100), 7: arm(0.9, 30, { lastDraw: 0.93 }) }, TheBlackHand: { "5x5": arm(0.95, 50) }, Daedalus: { 9: arm(0.5, 3) } } },
      list: { arms: [{ opponent: "Tetrads", size: 5, ...arm(0.98, 100) }, { opponent: "Tetrads", boardSize: 7, ...arm(0.9, 30, { drawn: 0.93 }) }, { opponent: "The Black Hand", size: 5, ...arm(0.95, 50) }, { opponent: "Daedalus", size: 9, ...arm(0.5, 3) }] },
    };
    for (const [name, t] of Object.entries(shapes)) {
      c.examined(1);
      const arms = D.normalizeArms({ ...base, thompson: t });
      const keys = arms.map((a) => a.key).sort().join(",");
      if (keys !== "Daedalus@9,Tetrads@5,Tetrads@7,TheBlackHand@5") c.fail(`${name}: keys ${keys}`);
      const t7 = arms.find((a) => a.key === "Tetrads@7");
      if (t7?.draw !== 0.93) c.fail(`${name}: Tetrads@7 per-arm draw ${t7?.draw}`);
      const chosen = arms.filter((a) => a.chosen).map((a) => a.key).join();
      if (chosen !== "Tetrads@7") c.fail(`${name}: chosen ${chosen}, expected Tetrads@7 (opponent Tetrads, boardSize 7)`);
    }
    // alpha/beta win over mean/sd; powerPerHour; draw from a composite-keyed draw map.
    const rich = {
      ...base,
      thompson: {
        arms: { "Illuminati@5": { alpha: 41, beta: 61, games: 100, powerPerHour: 101929 } },
        draw: { "Illuminati@5": 0.44 },
        chosen: { opponent: "Illuminati", size: 5, why: "highest draw x power/h" },
        history: [{ at: "2026-10-04T18:00:00Z", arm: "Illuminati@5", won: true, draw: 0.44 }, { t: 1, opponent: "The Black Hand", boardSize: 7, result: "loss" }, "Tetrads@9"],
      },
    };
    const j = D.buildGoJson(rich, D.newStore(), { now: Date.parse(rich.at) });
    const il = j.arms[0];
    c.examined(1);
    if (!(il && il.a === 41 && il.b === 61 && near(il.mean, 41 / 102, 1e-12) && il.powerPerHour === 101929 && il.draw === 0.44 && il.chosen)) c.fail("alpha/beta/powerPerHour/draw-map/chosen not carried", JSON.stringify(il));
    if (j.armsBy !== "opponent x size") c.fail(`armsBy ${j.armsBy}`);
    if (j.chosen.opponent !== "Illuminati" || j.chosen.size !== 5 || j.chosen.why !== "highest draw x power/h") c.fail("thompson.chosen not used", JSON.stringify(j.chosen));
    if (j.picksSource !== "go.txt" || j.picks.length !== 3) c.fail(`published history not used (${j.picksSource}, ${j.picks.length})`);
    const [p0, p1, p2] = j.picks;
    if (p0.opponent !== "Illuminati" || p0.size !== 5 || p0.won !== true || p0.t !== Date.parse("2026-10-04T18:00:00Z")) c.fail("pick 0", JSON.stringify(p0));
    if (p1.opponent !== "TheBlackHand" || p1.size !== 7 || p1.won !== false) c.fail("pick 1 (game name, boardSize, result)", JSON.stringify(p1));
    if (p2.opponent !== "Tetrads" || p2.size !== 9) c.fail("pick 2 (bare string)", JSON.stringify(p2));
    // A string `chosen` is split the same way.
    const sc = D.chosenOf({ opponent: "Daedalus", boardSize: 5, thompson: { chosen: "Netburners@13" } });
    if (sc.opponent !== "Netburners" || sc.size !== 13) c.fail("string thompson.chosen", JSON.stringify(sc));
    c.note(`3 arm shapes + alpha/beta + chosen object/string + 3 pick shapes`);
    out.push(c);
  }

  // ------------------------------------------------------------------ GD3
  {
    const c = new Check("GD3", "history: picks from W/L changes, reset baseline, idempotent, thinned and trimmed");
    const s = D.newStore();
    const t0 = Date.parse("2026-10-04T12:00:00Z");
    const at = (ms) => new Date(t0 + ms).toISOString();
    const obs = (ms, w, l, opp = "Tetrads", size = 5, streak = w) => ({ ...TODAY, at: at(ms), wins: w, losses: l, opponent: opp, boardSize: size, winStreak: streak });
    D.sample(s, obs(0, 10, 1), t0);
    D.sample(s, obs(3000, 11, 1, "Daedalus", 7), t0 + 3000); // game ended (Tetrads 5x5 won), switched
    if (D.sample(s, obs(3000, 11, 1, "Daedalus", 7), t0 + 3000) !== false) c.fail("same `at` sampled twice");
    D.sample(s, obs(6000, 11, 2, "Daedalus", 7, 0), t0 + 6000); // Daedalus 7x7 lost
    D.sample(s, obs(9000, 0, 0, "Daedalus", 7, 0), t0 + 9000); // go.js restarted: counters reset
    D.sample(s, obs(12000, 2, 0, "Daedalus", 7, 2), t0 + 12000); // two games in one gap
    c.examined(s.picks.length);
    const want = [
      { opponent: "Tetrads", size: 5, games: 1, won: 1, lost: 0 },
      { opponent: "Daedalus", size: 7, games: 1, won: 0, lost: 1 },
      { opponent: "Daedalus", size: 7, games: 2, won: 2, lost: 0 },
    ];
    const got = s.picks.map(({ opponent, size, games, won, lost }) => ({ opponent, size, games, won, lost }));
    if (JSON.stringify(got) !== JSON.stringify(want)) c.fail("derived picks wrong", `got  ${JSON.stringify(got)}\nwant ${JSON.stringify(want)}`);
    // Thinning: 3s observations with no change keep one sample per SAMPLE_MS.
    const s2 = D.newStore();
    for (let k = 0; k <= 200; k++) D.sample(s2, obs(k * 3000, 100 + k, 1), t0 + k * 3000);
    // One kept per first observation >= SAMPLE_MS after the last: every ceil(SAMPLE_MS/3000) observations.
    const expect = Math.floor(200 / Math.ceil(D.SAMPLE_MS / 3000)) + 1;
    const thinned = s2.samples.length;
    if (thinned !== expect) c.fail(`${thinned} samples kept over 600s of 3s observations, expected ${expect} at one per ${D.SAMPLE_MS}ms`);
    if (s2.picks.length !== 200) c.fail(`${s2.picks.length} picks from 200 games`);
    const smp = s2.samples.at(-1);
    for (const k of ["t", "w", "l", "streak", "best", "opponent", "size", "bonuses", "np"]) if (!(k in smp)) c.fail(`sample missing ${k}`);
    // A loss is always kept as a sample, so the streak chart can mark it.
    const s3 = D.newStore();
    D.sample(s3, obs(0, 5, 0), t0);
    D.sample(s3, obs(1000, 5, 1), t0 + 1000);
    if (s3.samples.length !== 2) c.fail("a loss inside SAMPLE_MS was thinned away");
    // Trim to HISTORY_MS.
    D.sample(s2, obs(D.HISTORY_MS + 700_000, 999, 1), t0 + D.HISTORY_MS + 700_000);
    if (s2.samples[0].t < t0 + 700_000 || s2.picks[0].t < t0 + 700_000) c.fail("history not trimmed to HISTORY_MS");
    // Persisted history loads once and merges ahead of live samples.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "godash-"));
    const f = path.join(dir, "h.json");
    fs.writeFileSync(f, JSON.stringify({ samples: [{ t: t0 - 1000, w: 1 }], picks: [{ t: t0 - 1000, opponent: "Tetrads" }] }));
    const s4 = D.newStore();
    D.loadHistory(s4, f, t0);
    D.loadHistory(s4, f, t0);
    if (s4.samples.length !== 1 || s4.picks.length !== 1) c.fail(`persisted history loaded ${s4.samples.length}/${s4.picks.length} (expected once)`);
    fs.rmSync(dir, { recursive: true, force: true });
    c.note(`picks ${JSON.stringify(got)}; ${thinned} samples / 600s`);
    out.push(c);
  }

  // ------------------------------------------------------------------ GD4
  {
    const c = new Check("GD4", "over HTTP: /go page, /go.json live, mirror fallback, unparseable go.txt reported");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "godash-"));
    fs.writeFileSync(path.join(dir, "go.txt"), JSON.stringify({ ...TODAY, opponent: "Daedalus" }));
    let rpcCalls = 0;
    let liveText = JSON.stringify(TODAY);
    const ctx = {
      TEL_DIR: dir,
      connected: () => true,
      rpc: async (method, params) => {
        rpcCalls++;
        if (method !== "getFile" || params.filename !== "tel/go.txt" || params.server !== "home") throw new Error(`unexpected rpc ${method} ${JSON.stringify(params)}`);
        return liveText;
      },
      store: D.newStore(),
    };
    const srv = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (!(await D.handle(req, url, res, ctx))) {
        res.writeHead(404);
        res.end("nope");
      }
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    try {
      const page = await getText(port, "/go");
      c.examined(1);
      if (page.status !== 200 || !/text\/html/.test(page.type) || !page.body.includes("<title>")) c.fail(`/go served ${page.status} ${page.type}`);
      const a = await getText(port, "/go.json");
      c.examined(1);
      const j = JSON.parse(a.body);
      if (a.status !== 200 || !/application\/json/.test(a.type)) c.fail(`/go.json served ${a.status} ${a.type}`);
      if (j.source !== "game" || j.chosen.opponent !== "Tetrads" || missing(j, TOP_KEYS).length) c.fail("live read not used", JSON.stringify({ source: j.source, chosen: j.chosen }));
      await getText(port, "/go.json");
      if (rpcCalls !== 1) c.fail(`${rpcCalls} game reads for two polls inside FRESH_MS (expected 1)`);
      // Not connected: the mirror, labelled as such.
      ctx.connected = () => false;
      ctx.store.lastFetchAt = 0;
      const m = JSON.parse((await getText(port, "/go.json")).body);
      c.examined(1);
      if (m.source !== "mirror" || m.chosen.opponent !== "Daedalus") c.fail("mirror fallback not used/labelled", JSON.stringify({ source: m.source, chosen: m.chosen }));
      // Live read garbage: reported, not empty-and-fine.
      ctx.connected = () => true;
      ctx.store.lastFetchAt = 0;
      liveText = "{not json";
      const bad = JSON.parse((await getText(port, "/go.json")).body);
      c.examined(1);
      if (bad.ok !== false || !/did not parse/.test(bad.error ?? "")) c.fail("an unparseable go.txt must say so", JSON.stringify({ ok: bad.ok, error: bad.error }));
      const nf = await getText(port, "/gox");
      if (nf.status !== 404) c.fail(`/gox answered ${nf.status}: handle() claimed a path it does not serve`);
      // History persisted next to the mirror.
      ctx.store.savedAt = 0;
      ctx.store.lastFetchAt = 0;
      liveText = JSON.stringify(TODAY);
      await getText(port, "/go.json");
      if (!fs.existsSync(path.join(dir, "go-dash-history.json"))) c.fail("history not persisted to go-dash-history.json");
    } finally {
      srv.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
    out.push(c);
  }

  // ------------------------------------------------------------------ GD5
  {
    const c = new Check("GD5", "daemon routes /go* to the hot-reloaded module; the page polls go.json");
    const daemon = read("tools/rfa-daemon.mjs");
    const html = read("tools/godash.html");
    c.examined(2);
    if (!/import\(`\$\{pathToFileURL\(GODASH\)\.href\}\?v=\$\{mtime\}`\)/.test(daemon)) c.fail("the daemon does not re-import godash.mjs by mtime (hot reload)");
    if (!/url\.pathname === "\/go"[^\n]*startsWith\("\/go\."\)/.test(daemon) || !/m\.handle\(req, url, res, goDashCtx\)/.test(daemon)) c.fail("the daemon does not route /go and /go.json to godash.handle");
    if (!/onTelemetry\?\.\(goDashCtx\)/.test(daemon)) c.fail("the daemon's telemetry poll does not feed godash history");
    if (!/fetch\("go\.json"/.test(html)) c.fail("godash.html does not poll go.json (relative, so it works on the daemon and on godash-serve)");
    if (/<script[^>]+src=|<link[^>]+href="http/.test(html)) c.fail("godash.html loads an external resource");
    out.push(c);
  }

  return out;
}
