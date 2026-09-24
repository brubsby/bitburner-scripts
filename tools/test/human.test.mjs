// [HU] focus is taken only when no human is at the game window — human.js.
//
// Every focus-taker (upkeep.js's Focus click, progress.js's setFocus order,
// act-focus.js, and every work actor's focus flag) dragged a human who had
// unfocused work to look at the game straight back to the work screen within
// 15 seconds. Pinned: the verdict (unknown still focuses — 20% of all rep is
// not traded for an annoyance), and that no focus-taker in the repo bypasses it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "./harness.mjs";
const h = await import("../../human.js");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const src = (f) => strip(fs.readFileSync(path.join(REPO, f), "utf8"));

export async function run() {
  const checks = [];

  const c1 = new Check("HU1", "the verdict: recent real input = at the window; idle, hidden or unknown = focus");
  {
    const now = Date.parse("2026-09-24T10:00:00Z");
    const rec = (o) => ({ at: new Date(now - 5000).toISOString(), lastInputAt: now - 30000, visible: true, work: "unfocused", ...o });
    const cases = [
      [rec({}), true, "input 30s ago"],
      [rec({ lastInputAt: now - h.IDLE_MS - 1 }), false, "idle past IDLE_MS"],
      [rec({ visible: false }), false, "hidden tab"],
      [rec({ lastInputAt: null }), false, "never any input"],
      [rec({ at: new Date(now - h.STALE_MS - 1).toISOString() }), null, "stale record"],
      [null, null, "no record"],
    ];
    c1.examined(cases.length + 4);
    for (const [r, want, what] of cases) {
      const v = h.humanVerdict(r, now);
      if (v.atScreen !== want) c1.fail(`${what}: atScreen ${v.atScreen}, want ${want} (${v.why})`);
    }
    // startFocused: unknown and idle focus; at the window keeps the screen as it is.
    if (h.startFocused({ atScreen: null }) !== true) c1.fail("unknown must start focused");
    if (h.startFocused({ atScreen: false }) !== true) c1.fail("idle must start focused");
    if (h.startFocused({ atScreen: true, work: "unfocused" }) !== false) c1.fail("human looking at unfocused work: start unfocused");
    if (h.startFocused({ atScreen: true, work: "focused" }) !== true) c1.fail("human watching focused work: an unfocused start would jump them to the Terminal");
    // Synthetic clicks (the scripts' own) never count as a human.
    const listeners = {};
    const doc = { addEventListener: (t, f) => (listeners[t] = f), visibilityState: "visible" };
    const st = h.watchInput({}, doc);
    listeners.mousedown({ isTrusted: false });
    if (st.lastInputAt !== 0) c1.fail("an untrusted event marked the human present");
    listeners.keydown({ isTrusted: true });
    if (!(st.lastInputAt > 0)) c1.fail("a trusted keydown was not recorded");
  }
  checks.push(c1);

  const c2 = new Check("HU2", "no script starts work with a literal focus=true or takes focus without asking human.js");
  {
    const START = /\b(workForFaction|workForCompany|commitCrime|gymWorkout|universityCourse)\s*\(([^;\n]*)\)/g;
    const files = fs.readdirSync(REPO).filter((f) => /^act-.*\.js$/.test(f));
    let starts = 0;
    for (const f of files) {
      const s = src(f);
      for (const m of s.matchAll(START)) {
        starts++;
        if (/,\s*true\s*\)?\s*$/.test(m[2])) c2.fail(`${f}: ${m[1]}(…, true) — starts focused whoever is looking`);
        if (!/startFocused\(humanAtScreen\(ns\)\)/.test(s)) c2.fail(`${f}: ${m[1]} focus flag not from startFocused(humanAtScreen(ns))`);
      }
      if (/setFocus\(/.test(s) && !/humanAtScreen\(ns\)/.test(s)) c2.fail(`${f}: setFocus without asking human.js`);
    }
    c2.examined(starts);
    if (starts < 5) c2.fail(`expected the five work actors, found ${starts} work starts`);

    // upkeep.js: the Focus click sits behind the human check.
    const up = src("upkeep.js");
    if (!/state === 'unfocused' && seen\.atScreen === true\)[\s\S]{0,200}\} else if \(state === 'unfocused'\)/.test(up)) {
      c2.fail("upkeep.js: the refocus branch is not preceded by the human-at-screen deferral");
    }
    if (!/EXPORT_CHECK && seen\.atScreen !== true/.test(up)) c2.fail("upkeep.js: the export claim navigates while a human is looking");
    // progress.js: the focus order sits behind the human check.
    const pr = src("progress.js");
    const i = pr.indexOf("order('focus'");
    if (i < 0) c2.fail("progress.js: no focus order found — the check examined nothing");
    else if (!/humanOnHome\(ns\)[\s\S]{0,300}atScreen === true/.test(pr.slice(Math.max(0, i - 500), i))) {
      c2.fail("progress.js: order('focus') is not gated on humanOnHome");
    }
  }
  checks.push(c2);

  const c3 = new Check("HU3", "nfg.js (the DOM route to NeuroFlux, which navigates the screen) is not launched where Singularity buys NFG");
  {
    const wd = src("watchdog.js");
    const at = wd.indexOf("script: 'nfg.js'");
    c3.examined(at < 0 ? 0 : 1);
    if (at < 0) c3.fail("watchdog.js has no nfg.js entry — the check examined nothing");
    else {
      const entry = wd.slice(at, wd.indexOf("\n  },", at));
      const trig = (entry.match(/trigger:\s*\(ns\)\s*=>([^\n]*)/) || [])[1] || "";
      if (!/&&\s*!canAccessFeature\(ns\.getResetInfo\(\),\s*4\)/.test(trig)) c3.fail(`nfg.js trigger does not refuse under Singularity: '${trig.trim()}'`);
    }
  }
  checks.push(c3);

  const c4 = new Check("HU4", "cmd.js waits for an idle human before the DOM path, and does not refocus over one");
  {
    const cm = src("cmd.js");
    // Every place main() reaches the screen: showTerminal()/submit() calls
    // outside their own definitions. Each must come after the wait.
    const main = cm.indexOf("export async function main");
    const sites = [...cm.matchAll(/\b(showTerminal|submit)\(/g)].map((m) => m.index).filter((i) => i > main);
    const loop = cm.search(/for \(let waited = 0, seen = humanOnHome\(ns\); seen\.atScreen === true;/);
    c4.examined(sites.length);
    if (!sites.length) c4.fail("cmd.js: no DOM call in main() found — the check examined nothing");
    for (const i of sites) if (loop < 0 || loop > i) c4.fail(`cmd.js: a DOM call at offset ${i} is not preceded by the wait on humanOnHome`);
    if (!/r\.via !== 'ns'\) && humanOnHome\(ns\)\.atScreen !== true\) restoreFocus\(\)/.test(cm)) c4.fail("cmd.js: restoreFocus() clicks Focus over a human at the window");
  }
  checks.push(c4);

  return checks;
}
