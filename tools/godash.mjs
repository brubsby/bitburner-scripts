// The live Go dashboard: http://localhost:12526/go (page) and /go.json (data).
//
// SERVED BY THE RFA DAEMON, BUT HOT. tools/rfa-daemon.mjs re-imports this file
// whenever its mtime changes (loadGoDash there), and reads tools/godash.html
// fresh on every request, so the page and this module can be iterated on
// without restarting the daemon — a restart drops the game's websocket and
// needs a manual Options -> Remote API reconnect. The daemon owns `ctx.store`,
// so the in-memory history survives a hot reload of this module.
//
// SOURCES. go.js publishes /tel/go.txt. The daemon's own mirror of /tel only
// refreshes every SAVE_POLL_MS (30s), too slow to watch games go by, so
// /go.json reads tel/go.txt straight from the game over the RFA (one getFile of
// a few KB, at most once per FRESH_MS however many tabs poll), falling back to
// the mirrored .telemetry/go.txt when the game is not connected. The JSON says
// which it used and how old the data is: a frozen number is never presented as
// a live one.
//
// HISTORY. Every observation of go.txt (each /go.json fetch, and the daemon's
// 30s telemetry poll even with no page open) goes through sample():
//   - a game boundary (wins+losses moved) becomes a pick: who, what size, won;
//   - a coarse sample (streak, W/L, bonus % and node power per channel) is
//     kept at most every SAMPLE_MS, for HISTORY_MS.
// Both are persisted to .telemetry/go-dash-history.json (small; written at most
// once a minute) so a daemon restart does not blank the charts.
//
// FIELD TOLERANCE. The per-(opponent x board size) Thompson arms are being
// added to go.txt; until then `thompson.arms` is keyed by opponent alone.
// normalizeArms() accepts every plausible shape (see its doc) and the page
// renders whatever arms come out, so the new fields light up without a change
// here — and with one at worst in this hot-reloaded file.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OPPONENTS, nodePowerFromBonus, keyOfGame } from "../goplan.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HTML_FILE = path.join(HERE, "godash.html");
export const FRESH_MS = 2_000;
export const SAMPLE_MS = 20_000;
export const HISTORY_MS = 6 * 3600_000;
export const MAX_PICKS = 400;
const PERSIST_MS = 60_000;

const num = (x) => typeof x === "number" && Number.isFinite(x);
const SIZE_RE = /^(.+?)\s*(?:@|×|x|:|\/|_|-|\s)\s*(\d{1,2})(?:x\d{1,2})?$/;

/** A fresh store; the daemon keeps one for its whole life. */
export function newStore() {
  return { samples: [], picks: [], last: null, lastRaw: null, lastFetchAt: 0, savedAt: 0, loaded: false, source: null };
}

/** go.txt text -> object, or null when unreadable. */
export function parseGo(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    const o = JSON.parse(text);
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** Beta(a, b) from a stated alpha/beta, else from mean/sd by moments. Null when neither works. */
export function betaParams(arm) {
  const a = arm?.alpha ?? arm?.a;
  const b = arm?.beta ?? arm?.b;
  if (num(a) && num(b) && a > 0 && b > 0) return { a, b };
  const m = arm?.mean;
  const sd = arm?.sd;
  if (!num(m) || !num(sd) || m <= 0 || m >= 1 || sd <= 0) return null;
  const k = (m * (1 - m)) / (sd * sd) - 1;
  if (!(k > 0)) return null;
  return { a: m * k, b: (1 - m) * k };
}

function splitKey(key) {
  if (OPPONENTS[key] || keyOfGame(key)) return { opponent: keyOfGame(key) ?? key, size: null };
  const m = SIZE_RE.exec(String(key));
  if (m && (OPPONENTS[m[1]] || keyOfGame(m[1]))) return { opponent: keyOfGame(m[1]) ?? m[1], size: Number(m[2]) };
  if (m) return { opponent: m[1], size: Number(m[2]) };
  return { opponent: String(key), size: null };
}

const armKey = (opponent, size) => (size ? `${opponent}@${size}` : opponent);

function looksLikeArm(v) {
  return v && typeof v === "object" && (num(v.mean) || num(v.alpha) || num(v.games) || num(v.sd));
}

/**
 * Every Thompson arm in go.txt as a flat list:
 *   { key, opponent, size, mean, sd, games, a, b, draw, powerPerHour, chosen }
 * Accepted shapes of thompson.arms (or a top-level `arms`):
 *   { Tetrads: {mean, sd, games} }                       opponent only (today)
 *   { "Tetrads@7": {...} } / "Tetrads x7" / "Tetrads:7"  composite keys
 *   { Tetrads: { 5: {...}, 7: {...} } }                  nested by size
 *   [ { opponent, size|boardSize, mean, sd, ... } ]      a list
 * The last draw is the arm's own `draw`/`drawn`/`lastDraw`, else thompson.draw
 * under the same key (or the opponent's key for an opponent-only draw map).
 */
export function normalizeArms(go) {
  const t = go?.thompson ?? {};
  const raw = t.arms ?? go?.arms ?? null;
  const out = [];
  const push = (opponent, size, v, key) => {
    if (!looksLikeArm(v)) return;
    const sz = num(v.size) ? v.size : num(v.boardSize) ? v.boardSize : size;
    const opp = keyOfGame(v.opponent ?? opponent) ?? v.opponent ?? opponent;
    const k = armKey(opp, sz);
    const ab = betaParams(v);
    const drawMap = t.draw ?? t.draws ?? {};
    const draw = [v.draw, v.drawn, v.lastDraw, v.last, drawMap[key], drawMap[k], sz ? undefined : drawMap[opp]].find(num);
    out.push({
      key: k,
      opponent: opp,
      size: sz ?? null,
      mean: num(v.mean) ? v.mean : ab ? ab.a / (ab.a + ab.b) : null,
      sd: num(v.sd) ? v.sd : null,
      games: num(v.games) ? v.games : num(v.n) ? v.n : null,
      a: ab?.a ?? null,
      b: ab?.b ?? null,
      draw: draw ?? null,
      powerPerHour: [v.powerPerHour, v.pph, v.pphEstimate, v.rate].find(num) ?? null,
      eligible: v.eligible ?? null,
      chosen: false,
    });
  };
  if (Array.isArray(raw)) {
    for (const v of raw) push(v?.opponent ?? v?.name ?? "?", null, v, v?.key ?? armKey(v?.opponent, v?.size ?? v?.boardSize));
  } else if (raw && typeof raw === "object") {
    for (const [key, v] of Object.entries(raw)) {
      if (looksLikeArm(v)) {
        const { opponent, size } = splitKey(key);
        push(opponent, size, v, key);
      } else if (v && typeof v === "object") {
        for (const [sk, sv] of Object.entries(v)) {
          const size = Number(String(sk).replace(/x\d+$/, ""));
          push(keyOfGame(key) ?? key, Number.isFinite(size) && size > 0 ? size : null, sv, `${key}@${sk}`);
        }
      }
    }
  }
  const ch = chosenOf(go);
  for (const a of out) a.chosen = a.opponent === ch.opponent && (a.size === null || ch.size === null || a.size === ch.size);
  return out;
}

/** The arm in play and why: thompson.chosen if go.js publishes one, else opponent/boardSize/opponentWhy. */
export function chosenOf(go) {
  const t = go?.thompson ?? {};
  const c = t.chosen ?? t.pick ?? go?.chosen ?? null;
  let opponent = go?.opponent ?? null;
  let size = num(go?.boardSize) ? go.boardSize : null;
  let why = go?.opponentWhy ?? null;
  if (typeof c === "string") {
    const s = splitKey(c);
    opponent = s.opponent;
    size = s.size ?? size;
  } else if (c && typeof c === "object") {
    opponent = c.opponent ?? c.name ?? opponent;
    size = num(c.size) ? c.size : num(c.boardSize) ? c.boardSize : size;
    why = c.why ?? why;
  }
  why = t.chosenWhy ?? t.why ?? why;
  return { opponent: keyOfGame(opponent) ?? opponent, size, why, pinned: go?.pinned ?? null };
}

/** go.js's own pick history, when it publishes one (thompson.history / picks / pickHistory), normalised. */
export function publishedPicks(go) {
  const t = go?.thompson ?? {};
  const raw = [t.history, t.picks, t.pickHistory, go?.picks, go?.pickHistory].find(Array.isArray);
  if (!raw) return null;
  return raw
    .map((p) => {
      if (typeof p === "string") return { t: null, ...splitKey(p) };
      if (!p || typeof p !== "object") return null;
      const at = p.t ?? p.at ?? p.time ?? null;
      const tms = num(at) ? at : at ? Date.parse(at) : null;
      const arm = p.arm ? splitKey(p.arm) : {};
      return {
        t: Number.isFinite(tms) ? tms : null,
        opponent: keyOfGame(p.opponent ?? arm.opponent) ?? p.opponent ?? arm.opponent ?? null,
        size: [p.size, p.boardSize, arm.size].find(num) ?? null,
        won: typeof p.won === "boolean" ? p.won : p.result === "win" ? true : p.result === "loss" ? false : null,
        draw: [p.draw, p.drawn, p.value].find(num) ?? null,
        why: p.why ?? null,
      };
    })
    .filter(Boolean);
}

/** { channel opponent: nodePower } from go.txt's bonuses (keyed by the game's names). */
export function nodePowers(go) {
  const out = {};
  for (const [name, pct] of Object.entries(go?.bonuses ?? {})) {
    const k = keyOfGame(name) ?? name;
    const meta = OPPONENTS[k];
    const np = meta ? nodePowerFromBonus(pct, meta.power, num(go.goPower) ? go.goPower : 1, go.sf14 ?? 0) : null;
    out[k] = num(np) ? Math.round(np) : null;
  }
  return out;
}

const tsOf = (go, now) => {
  const t = Date.parse(go?.at);
  return Number.isFinite(t) ? t : now;
};

/**
 * Fold one observation of go.txt into the store. Idempotent on the same `at`.
 * Returns true when something new was recorded.
 */
export function sample(store, go, now = Date.now()) {
  if (!go) return false;
  const t = tsOf(go, now);
  const prev = store.lastRaw;
  if (prev && prev.t === t) return false;
  const w = num(go.wins) ? go.wins : null;
  const l = num(go.losses) ? go.losses : null;
  const cur = { t, w, l, opponent: keyOfGame(go.opponent) ?? go.opponent ?? null, size: num(go.boardSize) ? go.boardSize : null, streak: go.winStreak ?? null };
  if (prev && w !== null && l !== null && prev.w !== null && prev.l !== null) {
    const dw = w - prev.w;
    const dl = l - prev.l;
    // A go.js restart can reset the counters: a negative delta is a new baseline, not a game.
    if (dw >= 0 && dl >= 0 && dw + dl > 0) {
      // Attribute to the arm in play at the previous observation (the game that just ended).
      store.picks.push({ t, opponent: prev.opponent, size: prev.size, games: dw + dl, won: dw, lost: dl, streak: cur.streak });
      if (store.picks.length > MAX_PICKS) store.picks.splice(0, store.picks.length - MAX_PICKS);
    }
  }
  store.lastRaw = cur;
  const last = store.samples.at(-1);
  const changed = !last || last.opponent !== cur.opponent || last.size !== cur.size || last.l !== l;
  if (!last || t - last.t >= SAMPLE_MS || changed) {
    store.samples.push({
      t,
      w,
      l,
      streak: go.winStreak ?? null,
      best: go.highestWinStreak ?? null,
      opponent: cur.opponent,
      size: cur.size,
      bonuses: go.bonuses ?? {},
      np: nodePowers(go),
    });
  }
  trim(store, now);
  return true;
}

function trim(store, now) {
  const cut = now - HISTORY_MS;
  let i = 0;
  while (i < store.samples.length && store.samples[i].t < cut) i++;
  if (i) store.samples.splice(0, i);
  i = 0;
  while (i < store.picks.length && store.picks[i].t < cut) i++;
  if (i) store.picks.splice(0, i);
}

/** Load the persisted history once into the store. */
export function loadHistory(store, file, now = Date.now()) {
  if (store.loaded) return;
  store.loaded = true;
  try {
    const o = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(o.samples)) store.samples = o.samples.concat(store.samples);
    if (Array.isArray(o.picks)) store.picks = o.picks.concat(store.picks);
    trim(store, now);
  } catch {
    /* none yet */
  }
}

function persist(store, file, now) {
  if (now - store.savedAt < PERSIST_MS) return;
  store.savedAt = now;
  try {
    fs.writeFileSync(file + ".tmp", JSON.stringify({ samples: store.samples, picks: store.picks }));
    fs.renameSync(file + ".tmp", file);
  } catch {
    /* non-fatal */
  }
}

/** The /go.json body. Pure: everything it needs is passed in. */
export function buildGoJson(go, store, { now = Date.now(), source = null, error = null } = {}) {
  const arms = normalizeArms(go);
  const sized = arms.some((a) => a.size !== null);
  const published = publishedPicks(go);
  const at = tsOf(go, NaN);
  const tt = go?.turnTiming ?? null;
  return {
    v: 1,
    now,
    source,
    error,
    at: Number.isFinite(at) ? at : null,
    ageMs: Number.isFinite(at) ? now - at : null,
    ok: !!go,
    // `go` is go.txt verbatim, so a field the page does not know yet is still visible in raw view.
    go: go ?? null,
    arms,
    armsBy: sized ? "opponent x size" : "opponent",
    chosen: chosenOf(go),
    picks: published ?? store.picks.slice(-120),
    picksSource: published ? "go.txt" : "derived",
    derivedPicks: store.picks.slice(-120),
    history: store.samples,
    summary: go
      ? {
          wins: go.wins ?? null,
          losses: go.losses ?? null,
          winStreak: go.winStreak ?? null,
          highestWinStreak: go.highestWinStreak ?? null,
          boardSize: go.boardSize ?? null,
          phase: go.phase ?? null,
          health: go.health ?? null,
          solverMode: go.solverMode ?? null,
          ponderHits: go.ponderHits ?? null,
          modelAsked: go.modelAsked ?? null,
          modelAnswered: go.modelAnswered ?? null,
          ponderRate: num(go.ponderHits) && num(go.modelAnswered) && go.modelAnswered > 0 ? go.ponderHits / go.modelAnswered : null,
          solverShare: go.solverShare ?? null,
          turnTiming: tt,
          gamesThisProcess: go.gamesThisProcess ?? null,
          processStartedAt: go.processStartedAt ?? null,
          bonuses: go.bonuses ?? null,
          nodePower: nodePowers(go),
          errors: Array.isArray(go.errors) ? go.errors.slice(-5) : [],
        }
      : null,
  };
}

/** Read go.txt: live from the game when connected (at most once per FRESH_MS), else the disk mirror. */
async function readGo(ctx) {
  const store = ctx.store;
  const now = Date.now();
  if (store.last && now - store.lastFetchAt < FRESH_MS) return store.last;
  store.lastFetchAt = now;
  let text = null;
  let source = null;
  let error = null;
  if (ctx.connected?.()) {
    try {
      text = await ctx.rpc("getFile", { filename: "tel/go.txt", server: "home" });
      source = "game";
    } catch (e) {
      error = `live read failed: ${e.message ?? e}`;
    }
  }
  if (text === null) {
    try {
      text = fs.readFileSync(path.join(ctx.TEL_DIR, "go.txt"), "utf8");
      source = "mirror";
    } catch (e) {
      error = (error ? error + "; " : "") + `no mirror: ${e.code ?? e.message}`;
    }
  }
  const go = parseGo(text);
  if (text !== null && !go) error = (error ? error + "; " : "") + "go.txt did not parse";
  store.last = { go, source, error };
  if (go) sample(store, go, now);
  persist(store, path.join(ctx.TEL_DIR, "go-dash-history.json"), now);
  return store.last;
}

/** Daemon hook after each /tel mirror: keeps history even with no page open. */
export function onTelemetry(ctx) {
  const store = ctx.store;
  const file = path.join(ctx.TEL_DIR, "go-dash-history.json");
  loadHistory(store, file);
  try {
    const go = parseGo(fs.readFileSync(path.join(ctx.TEL_DIR, "go.txt"), "utf8"));
    if (go) sample(store, go);
  } catch {
    /* no go.txt */
  }
  persist(store, file, Date.now());
}

/** HTTP: returns true when it answered the request. */
export async function handle(req, url, res, ctx) {
  const p = url.pathname.replace(/\/+$/, "");
  if (p === "/go") {
    let html;
    try {
      html = fs.readFileSync(HTML_FILE, "utf8");
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`godash.html unreadable: ${e.message}`);
      return true;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
    return true;
  }
  if (p === "/go.json") {
    loadHistory(ctx.store, path.join(ctx.TEL_DIR, "go-dash-history.json"));
    const r = await readGo(ctx);
    const body = buildGoJson(r.go, ctx.store, { source: r.source, error: r.error });
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
    return true;
  }
  return false;
}
