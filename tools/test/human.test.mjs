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
import "./gameresolve.mjs";
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

  const c5 = new Check("HU5", "with Singularity, home upgrades, TOR and backdoors take no screen; the backdoor helper refuses w0r1d_d43m0n");
  {
    // Behaviour of act-backdoor.js against a recording ns.
    const { main } = await import("../../act-backdoor.js");
    const mk = (sf4) => {
      const calls = [];
      const files = {};
      return {
        calls, files,
        ns: {
          args: [], disableLog() {}, write: (f, d) => (files[f] = d), getHostname: () => "home", scp: () => true,
          getResetInfo: () => ({ currentNode: 10, ownedSF: new Map(sf4 ? [[4, 1]] : []) }),
          singularity: {
            connect: (h) => (calls.push(`connect ${h}`), true),
            installBackdoor: async () => void calls.push("installBackdoor"),
          },
        },
      };
    };
    let t = mk(true);
    t.ns.args = ["zer0", "neo-net", "CSEC"];
    await main(t.ns);
    const want = "connect home,connect zer0,connect neo-net,connect CSEC,installBackdoor,connect home";
    if (t.calls.join(",") !== want) c5.fail(`route walk: got ${t.calls.join(",")}`);
    if (!JSON.parse(t.files["/tel/act-backdoor.txt"] || "{}").ok) c5.fail("a completed backdoor must publish ok");
    for (const args of [["w0r1d_d43m0n"], ["The-Cave", "W0R1D_D43M0N"]]) {
      t = mk(true);
      t.ns.args = args;
      await main(t.ns);
      if (t.calls.length) c5.fail(`w0r1d_d43m0n in ${args.join(" ")}: made ${t.calls.length} Singularity call(s) — must refuse before any`);
    }
    t = mk(false);
    t.ns.args = ["CSEC"];
    await main(t.ns);
    if (t.calls.length) c5.fail("without Singularity the helper must refuse, not throw mid-route");

    // Callers: the Singularity route is taken BEFORE any UI route.
    const order = (f, first, second, what) => {
      const x = src(f);
      const i = x.search(first), j = x.search(second);
      if (i < 0 || j < 0) c5.fail(`${f}: could not find ${i < 0 ? first : second} — examined nothing`);
      else if (i > j) c5.fail(`${f}: ${what}`);
    };
    order("homeup.js", /if \(canUseSingularity\(ns\.getResetInfo\(\)\)\) \{\s*viaActor = true/, /acquire\(ns, 'homeup'\)/, "takes the UI lock before handing the purchase to act.js");
    order("torbuy.js", /if \(singularityKnown\(ns\)\) \{\s*say\('ok'/, /acquire\(ns/, "navigates before standing down under Singularity");
    order("backdoor.js", /ns\.write\(BACKDOOR_REQ/, /ns\.write\(CMD_IN/, "queues the bridge before requesting the Singularity backdoor");
    order("act.js", /=== 'w0r1d_d43m0n'\)\) return \{ target: q\.target, ok: false/, /ns\.exec\(BACKDOOR_ACTOR/, "launches a requested backdoor before refusing w0r1d_d43m0n");
    if (!/const BACKDOOR_REQ = '\/tel\/backdoor-req\.txt'/.test(src("act.js")) || !/export const BACKDOOR_REQ = '\/tel\/backdoor-req\.txt'/.test(src("backdoor.js"))) c5.fail("backdoor.js and act.js disagree on the request path — requests would never be served");
    if (!/h\?\.blockedByCity \|\| h\?\.viaActor/.test(src("act.js"))) c5.fail("act.js: does not perform homeup's viaActor purchases — home would never upgrade");
    if (!/invariant: \(ns\) => !ns\.hasTorRouter\(\) && !canAccessFeature\(ns\.getResetInfo\(\), 4\)/.test(src("watchdog.js"))) c5.fail("watchdog.js: torbuy relaunched under Singularity");
    const { singularityKnown, SF_FILE } = await import("../../sfgate.js");
    const T = Date.parse("2026-09-24T10:00:00Z");
    const rd = (o) => ({ read: (f) => (f === SF_FILE && o ? JSON.stringify(o) : "") });
    if (singularityKnown(rd({ at: new Date(T - 30e3).toISOString(), singularity: true }), T) !== true) c5.fail("a fresh true must read true");
    if (singularityKnown(rd({ at: new Date(T - 10 * 60e3).toISOString(), singularity: true }), T) !== false) c5.fail("a stale true must read false (left BN4 without SF4)");
    if (singularityKnown(rd(null), T) !== false) c5.fail("a missing record must read false — the old DOM/bridge route");
    c5.examined(13);
  }
  checks.push(c5);

  const c6 = new Check("HU6", "act.js copies every module its actors import when it places one off home");
  {
    const imports = (f) => [...fs.readFileSync(path.join(REPO, f), "utf8").matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const closure = (f, seen = new Set()) => {
      for (const d of imports(f)) if (!seen.has(d)) { seen.add(d); closure(d, seen); }
      return seen;
    };
    const act = src("act.js");
    const listed = new Set(((act.match(/const ACTOR_DEPS = \[([^\]]*)\]/) || [])[1] || "").match(/[\w.-]+\.js/g) || []);
    if (!listed.size) c6.fail("act.js: no ACTOR_DEPS list found");
    const scps = [...act.matchAll(/ns\.scp\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => /actor/.test(a));
    for (const a of scps) if (!/\.\.\.ACTOR_DEPS/.test(a)) c6.fail(`act.js: an actor scp copies without ACTOR_DEPS: scp(${a})`);
    const actors = fs.readdirSync(REPO).filter((f) => /^(act|snap)-.*\.js$/.test(f));
    c6.examined(actors.length);
    for (const f of actors) for (const d of closure(f)) if (!listed.has(d)) c6.fail(`${f} imports ${d}, which act.js does not copy off home`);
  }
  checks.push(c6);

  return checks;
}
