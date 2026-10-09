// [RT] THE ROUTE PIN (routepin.js; wired in progress.js bladeRouteOf and
// endgame.js). The user (2026-10-09): play the next node on the HACKING exit
// — Daedalus, The Red Pill installed, the hidden 19x19 Go opponent, the World
// Daemon by hacking — even where the black ops price faster. BN9.2 showed the
// unpinned behaviour: the route read 'blade' (0.0h vs 65.7h) and the node was
// left without The Red Pill ever being bought.
//
//   RT1 PIN FILE     /route-pin.txt: 'hack', 'hack <node>', 'hack node=<n>';
//                    absent / wrong route / another node each say so
//   RT2 THE ROUTE    the live BN9.2 decision acts 'blade' without the pin and
//                    'hack' with it, with the forgone hours; the commitment
//                    rule sees the priced record (unpinnedOf)
//   RT3 WIRING       progress.js acts on and publishes the pinned record and
//                    reports `route` (route, priced, pinned, forgoneH); endgame.js
//                    does not leave by the black ops under the pin
//   RT4 NO NEW EXIT  only endgame.js calls destroyW0r1dD43m0n, after its hold
//
// CALIBRATION: none needed — routing, not a model. The fixture copies
// /tel/plan.txt decisions.bladeRoute at 2026-10-09T00:31Z.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const rp = await import("../../routepin.js");

const code = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const LIVE = { key: "blade", bladeH: 0, hackH: 65.696, held: false, why: "stays on blade", joined: true, blackOps: 21 };

export async function run() {
  const checks = [];

  {
    const c = new Check("RT1", "PIN FILE: 'hack' / 'hack <node>' pin; absent, another route or another node never act and say why");
    const cases = [
      ["", 9, false, false],
      ["hack", 9, true, false],
      ["hack 9 user wants Go", 9, true, false],
      ["hack node=9", 9, true, false],
      ["HACK", 9, true, false],
      ["hack 12", 9, false, true],
      ["blade", 9, false, true],
    ];
    c.examined(cases.length);
    for (const [text, node, pinned, warns] of cases) {
      const p = rp.routePinOf(text, node);
      if (p.pinned !== pinned) c.fail(`'${text}' in BN${node}: pinned must be ${pinned}`, JSON.stringify(p));
      if (!!p.warn !== warns) c.fail(`'${text}' in BN${node}: ${warns ? 'must warn' : 'must not warn'}`, JSON.stringify(p));
      if (!p.why) c.fail(`'${text}': every state carries a reason`);
    }
    c.note(`another node: ${rp.routePinOf("hack 12", 9).warn}`);
    checks.push(c);
  }

  {
    const c = new Check("RT2", "THE ROUTE: the live BN9.2 decision acts 'blade' without the pin and 'hack' with it, forgone hours named");
    const off = rp.routePinOf("", 9);
    const on = rp.routePinOf("hack", 9);
    const without = rp.pinnedRouteOf(LIVE, off);
    const withPin = rp.pinnedRouteOf(LIVE, on);
    c.examined(2);
    c.note(`without the pin: '${without?.key}'; with it: '${withPin?.key}' — ${String(withPin?.why ?? "").slice(0, 150)}`);
    if (without?.key !== "blade") c.fail(`without the pin the acted route stays the priced 'blade', got '${without?.key}'`);
    if (withPin?.key !== "hack") c.fail(`with the pin the acted route must be 'hack', got '${withPin?.key}'`);
    if (withPin?.pin?.pricedKey !== "blade" || withPin?.pin?.forgoneH !== 65.696) c.fail("the pinned record names the priced key and the hours forgone (hackH - bladeH)", JSON.stringify(withPin?.pin));
    if (LIVE.key !== "blade") c.fail("pinnedRouteOf must not mutate the priced record");
    const back = rp.unpinnedOf(withPin);
    if (back?.key !== "blade" || "pin" in (back ?? {})) c.fail(`the commitment rule must see the priced key, got '${back?.key}'`);
    if (rp.unpinnedOf(LIVE) !== LIVE) c.fail("an unpinned record passes through unchanged");
    const rep = rp.routeReportOf(on, withPin);
    if (rep.route !== "hack" || rep.priced !== "blade" || rep.pinned !== true || rep.forgoneH !== 65.696) c.fail("the published `route` must read route 'hack', priced 'blade', pinned true, forgoneH", JSON.stringify(rep));
    const repOff = rp.routeReportOf(off, without);
    if (repOff.route !== "blade" || repOff.pinned !== false) c.fail("unpinned: route is the priced one, pinned false", JSON.stringify(repOff));
    const noDiv = rp.routeReportOf(on, null);
    if (noDiv.route !== "hack" || noDiv.pinned !== true) c.fail("a node without the division reads route 'hack', pinned true", JSON.stringify(noDiv));
    checks.push(c);
  }

  {
    const c = new Check("RT3", "WIRING: progress.js acts on the pinned route and publishes `route`; endgame.js does not leave by the black ops under the pin");
    const p = code("progress.js");
    c.examined(2);
    const at = p.indexOf("async function bladeRouteOf(");
    const fn = p.slice(at, at + 40000);
    if (!/const priced = await planDecide\(pc, 'bladeRoute'/.test(fn)) c.fail("bladeRouteOf must keep the priced decision to apply the pin to");
    if (!/const acted = pinnedRouteOf\(priced, pin\)\s*if \(acted !== priced\) pc\.decisions\.bladeRoute = acted\s*return acted/.test(fn)) c.fail("bladeRouteOf must return AND publish (pc.decisions.bladeRoute) the pinned record");
    if (!/prev: unpinnedOf\(pc\.prev\?\.decisions\?\.bladeRoute \?\? null\)/.test(fn)) c.fail("decideBladeRouteGen must compare against the unpinned record");
    if (!/routePinOf\(ns\.read\(ROUTE_PIN\), info\?\.currentNode \?\? null\)/.test(p)) c.fail("act() must read the pin (ns.read, 0GB) for this node");
    const call = p.indexOf("? await bladeRouteOf(ns, info, player");
    if (call < 0 || !/pin: routePin,/.test(p.slice(call, call + 1200))) c.fail("act() must hand the pin to bladeRouteOf");
    if (p.indexOf("const bladeOn = bladeRoute?.key === 'blade'") < call) c.fail("bladeOn must be read from the (pinned) route after bladeRouteOf");
    if ((p.match(/route: routeOut/g) ?? []).length < 3) c.fail("/tel/progress.txt must publish `route` on the report and the install paths");
    const e = code("endgame.js");
    if (!/const routePin = routePinOf\(ns\.read\(ROUTE_PIN\), resetB\?\.currentNode \?\? null\)/.test(e)) c.fail("endgame.js must read the route pin for this node");
    if (!/if \(blade\?\.done && routePin\.pinned\) blade = \{ \.\.\.blade, done: false,[^\n]*\n\s*if \(blade\?\.done\) \{/.test(e)) c.fail("endgame.js must not leave by the black ops while the hacking route is pinned (done cleared before the blade exit)");
    checks.push(c);
  }

  {
    const c = new Check("RT4", "NO NEW EXIT: only endgame.js destroys the node, after its /endgame-hold.txt read; routepin.js is pure");
    const root = fs.readdirSync(REPO_ROOT).filter((f) => f.endsWith(".js"));
    c.examined(root.length);
    const callers = root.filter((f) => /\.destroyW0r1dD43m0n\s*\(/.test(code(f)));
    if (callers.join() !== "endgame.js") c.fail(`only endgame.js may call destroyW0r1dD43m0n, found: ${callers.join(", ") || "none"}`);
    const e = code("endgame.js");
    const holdAt = e.indexOf("ns.read('/endgame-hold.txt')");
    const destroyAt = e.indexOf(".destroyW0r1dD43m0n(");
    if (holdAt < 0 || destroyAt < 0 || holdAt > destroyAt) c.fail("endgame.js must read /endgame-hold.txt before destroyW0r1dD43m0n");
    if (/\bns\./.test(code("routepin.js"))) c.fail("routepin.js must stay pure (no ns calls)");
    if (!/FORBIDDEN = 'w0r1d_d43m0n'/.test(code("act-backdoor.js")) || !/refused: w0r1d_d43m0n/.test(code("act.js"))) c.fail("act.js / act-backdoor.js must refuse a w0r1d_d43m0n backdoor");
    c.note(`destroyW0r1dD43m0n callers among ${root.length} root scripts: ${callers.join(", ")}`);
    checks.push(c);
  }

  return checks;
}
