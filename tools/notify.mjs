// STALL ALERTS THAT NEED NO SESSION (backlog 22). BN11.2 and BN3.1 each stalled
// ~15h unseen: tools/watch-run.sh only wakes a Claude session that is awake, and
// its alert reached the user when they next typed. This runs from a systemd user
// timer (bitburner-notify.timer, every 5 min) and puts a desktop notification on
// puter's screen. It depends on no session, no usage governor and no game.
//
//   node tools/notify.mjs check          the timer's job (exit 0 ok, 3 a send failed)
//   node tools/notify.mjs test           send ONE notification labelled as a test
//   node tools/notify.mjs status         print the dedup state
//
// THE CHANNEL is the one ~/Repos/autogtnh already uses for its session-free laptop
// alerts (server/escalate-wake.sh): org.freedesktop.Notifications.Notify over the
// user's D-Bus session, via busctl (puter has no notify-send). No account, no
// secret, nothing leaves the machine. It is NOT a phone push: autogtnh has none.
//
// WHAT ALERTS: only the STALL classes (the watcher's 'minimal' set), plus two the
// healthcheck cannot see from inside the daemon: the systemd service being down,
// and the game socket disconnected for more than 10 min. One alert per class per
// RATE_H hours while it lasts, and one "resolved" when an alerted class clears.
// The healthcheck runs at most every HEALTH_EVERY_MIN; between runs its last
// classes carry forward, so a cheap-only run never reads as "resolved".
//
// FAIL CLOSED: a healthcheck that does not answer is itself an alert class, and
// a notification that cannot be sent exits 3 (the unit shows failed) and stays
// pending, so the next run sends it again.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RATE_H = 3; // one alert per class per this many hours while it lasts
export const HEALTH_EVERY_MIN = 14; // the timer fires every 5 min; the healthcheck ~every 15
export const DISCONNECT_MIN = 10;

// The stall classes. Matched against classOf(what): the text before the first ':',
// numbers -> '#', upper-cased, commas dropped ("EXIT READY, NOT TAKEN").
export const STALL_CLASSES = [
  "DAEMON CONTROL PORT UNREACHABLE",
  "PLAYER IDLE",
  "NO INSTALL",
  "PLANNER IDLE",
  "HEALTHCHECK DID NOT ANSWER",
  "EXIT READY NOT TAKEN",
  "EXIT NOT APPROACHING",
  "NO RANK PROGRESS",
  "NEXT NODE ENTRY UNPRICED",
  // the two this file observes itself
  "DAEMON SERVICE DOWN",
  "GAME DISCONNECTED",
];
const MIN_AGE_MIN = { "GAME DISCONNECTED": DISCONNECT_MIN };

export const classOf = (what) =>
  String(what ?? "")
    .split(":")[0]
    .replace(/[-+]?[0-9][0-9.e+-]*/g, "#")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
export const isStall = (cls) => STALL_CLASSES.includes(cls);

// Healthcheck JSON (or null when it did not answer) -> [{cls, what, detail}], stalls only.
export function healthClasses(json) {
  if (!json || !Array.isArray(json.problems)) return [{ cls: "HEALTHCHECK DID NOT ANSWER", what: "HEALTHCHECK DID NOT ANSWER", detail: json?.__error ?? null }];
  const out = new Map();
  for (const p of json.problems) {
    const cls = classOf(p.what);
    if (isStall(cls) && !out.has(cls)) out.set(cls, { cls, what: String(p.what), detail: p.detail ?? null });
  }
  return [...out.values()];
}

// This run's observed stall classes. `health` is null when the healthcheck did not
// run THIS time: the last run's classes then carry forward (no false "resolved").
export function observedOf({ cheap, health, state }) {
  const h = health ?? state.lastHealth?.classes ?? [];
  const m = new Map();
  for (const o of [...cheap, ...h]) if (!m.has(o.cls)) m.set(o.cls, o);
  return [...m.values()];
}

// Pure. Returns the messages to send; the state only records an alert as sent in
// markSent(), so a failed send is retried on the next run.
export function decide(state, observed, nowMs, { rateH = RATE_H } = {}) {
  const classes = (state.classes ??= {});
  const msgs = [];
  const seen = new Set();
  for (const o of observed) {
    seen.add(o.cls);
    const s = (classes[o.cls] ??= { active: false, alerted: false, lastAlertAt: null });
    if (!s.active) Object.assign(s, { active: true, alerted: false, firstSeen: nowMs });
    Object.assign(s, { lastSeen: nowMs, what: o.what, detail: o.detail ?? null });
    if ((nowMs - s.firstSeen) / 60e3 < (MIN_AGE_MIN[o.cls] ?? 0)) continue;
    if (s.lastAlertAt === null || nowMs - s.lastAlertAt >= rateH * 3600e3) msgs.push({ kind: s.alerted ? "still" : "new", cls: o.cls, what: o.what, detail: o.detail ?? null, sinceMs: s.firstSeen });
  }
  for (const [cls, s] of Object.entries(classes)) {
    if (seen.has(cls)) continue;
    if (s.active) s.active = false;
    if (s.alerted) msgs.push({ kind: "resolved", cls, what: s.what });
    else if (s.lastAlertAt === null || nowMs - s.lastAlertAt >= rateH * 3600e3) delete classes[cls];
  }
  return msgs;
}

export function markSent(state, msgs, nowMs) {
  for (const m of msgs) {
    const s = state.classes[m.cls];
    if (!s) continue;
    if (m.kind === "resolved") s.alerted = false;
    else Object.assign(s, { alerted: true, lastAlertAt: nowMs });
  }
}

export function render(msgs, nowMs) {
  const alerts = msgs.filter((m) => m.kind !== "resolved");
  const resolved = msgs.filter((m) => m.kind === "resolved");
  const ago = (t) => `${((nowMs - t) / 3600e3).toFixed(1)}h`;
  const title = alerts.length
    ? `Bitburner STALL: ${alerts[0].cls}${alerts.length > 1 ? ` (+${alerts.length - 1})` : ""}`
    : `Bitburner resolved: ${resolved.map((m) => m.cls).join(", ")}`;
  const lines = [
    ...alerts.map((m) => `${m.kind === "still" ? "STILL " : ""}${m.what.slice(0, 160)} (for ${ago(m.sinceMs)})`),
    ...resolved.map((m) => `resolved: ${m.cls}`),
  ];
  return { title, body: lines.join("\n"), urgent: alerts.length > 0 };
}

// The channel autogtnh/server/escalate-wake.sh uses: D-Bus Notify via busctl.
export function sendDesktop(title, body, { urgent = true } = {}) {
  const r = spawnSync(
    "busctl",
    ["--user", "call", "org.freedesktop.Notifications", "/org/freedesktop/Notifications", "org.freedesktop.Notifications", "Notify",
      "susssasa{sv}i", "bitburner", "0", "dialog-warning", title, body, "0", "1", "urgency", "y", urgent ? "2" : "1", "0"],
    { encoding: "utf8", timeout: 20000 },
  );
  return r.status === 0 ? { ok: true } : { ok: false, err: (r.error?.message ?? r.stderr ?? "").trim() || `busctl exit ${r.status}` };
}

/* ------------------------------------------------------------- the CLI */
const STATE_PATH = process.env.BB_NOTIFY_STATE ?? path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local/state"), "bitburner-notify.json");
const LOG_PATH = path.join(os.homedir(), ".cache/bitburner-notify.log");
const log = (line) => {
  const l = `${new Date().toISOString()} ${line}`;
  console.log(l);
  try { fs.appendFileSync(LOG_PATH, l + "\n"); } catch {}
};
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return {}; } };
const saveState = (s) => { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 1)); };

async function cheapChecks() {
  const out = [];
  const sc = spawnSync("systemctl", ["--user", "is-active", "bitburner-daemon"], { encoding: "utf8", timeout: 15000 });
  const st = (sc.stdout ?? "").trim();
  if (st !== "active") out.push({ cls: "DAEMON SERVICE DOWN", what: `DAEMON SERVICE DOWN: bitburner-daemon is '${st || sc.error?.message || "unknown"}'`, detail: "systemctl --user status bitburner-daemon" });
  try {
    const res = await fetch(`http://127.0.0.1:${process.env.CTL_PORT ?? 12526}/status`, { signal: AbortSignal.timeout(15000) });
    const j = await res.json();
    if (j.connected === false) out.push({ cls: "GAME DISCONNECTED", what: "GAME DISCONNECTED: the game's Remote File API socket is not connected to the daemon", detail: "reconnect in game (CLAUDE.md)" });
  } catch {
    // unreachable port: the healthcheck's 'daemon control port unreachable' and DAEMON SERVICE DOWN cover it
  }
  return out;
}

function runHealthcheck() {
  // its own movement baseline, so the session's watch-run.sh keeps a real 15-min interval on the shared one
  const env = { ...process.env, HEALTHCHECK_STATE: path.join(ROOT, ".telemetry/healthcheck-last-notify.json") };
  const r = spawnSync("node", [path.join(ROOT, "tools/healthcheck.mjs"), "--json"], { cwd: ROOT, env, encoding: "utf8", timeout: 200000, maxBuffer: 64 << 20 });
  try { return JSON.parse(r.stdout); } catch { return { __error: `exit ${r.status}${r.error ? ` ${r.error.message}` : ""}: ${String(r.stderr ?? "").trim().slice(-200)}` }; }
}

async function main(cmd) {
  if (cmd === "status") return console.log(JSON.stringify(loadState(), null, 1)), 0;
  if (cmd === "test") {
    const r = sendDesktop("Bitburner notifier TEST", "TEST ONLY, nothing is wrong. bitburner-notify.timer can reach this screen; real alerts look like this with 'Bitburner STALL:' in the title.", { urgent: false });
    log(r.ok ? "TEST notification sent" : `TEST notification FAILED: ${r.err}`);
    return r.ok ? 0 : 3;
  }
  if (cmd !== "check") return console.error("usage: node tools/notify.mjs check|test|status"), 2;
  const now = Date.now();
  const state = loadState();
  let health = null;
  if (!state.lastHealth || (now - state.lastHealth.at) / 60e3 >= HEALTH_EVERY_MIN) {
    health = healthClasses(runHealthcheck());
    state.lastHealth = { at: now, classes: health };
  }
  const observed = observedOf({ cheap: await cheapChecks(), health, state });
  const msgs = decide(state, observed, now);
  let code = 0;
  if (msgs.length) {
    const { title, body, urgent } = render(msgs, now);
    const r = sendDesktop(title, body, { urgent });
    if (r.ok) { markSent(state, msgs, now); log(`SENT ${title} | ${body.replace(/\n/g, " | ")}`); }
    else { log(`SEND FAILED (will retry next run): ${r.err} | ${title}`); code = 3; }
  }
  state.at = now;
  saveState(state);
  console.log(`observed: ${observed.map((o) => o.cls).join(", ") || "no stall"}${health ? " (healthcheck ran)" : ""}`);
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv[2]));
