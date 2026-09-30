#!/usr/bin/env python3
# Builds tools/test/fixture-bn9-exitjump-2131.json from the records captured in
# /tmp/fx/incident2131 (the 21:20-21:45Z snapshots and the live install-last,
# snap-rep reads). Kept beside attribute-2131.mjs so the fixture can be rebuilt.
import json, os, sys

D = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fx/incident2131"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "test", "fixture-bn9-exitjump-2131.json")


def ld(prefix):
    f = next(x for x in sorted(os.listdir(D)) if x.startswith(prefix))
    return json.load(open(os.path.join(D, f)))


pre = ld("exitinputs.txt.213130")
prep = ld("plan.txt.213130")
post = ld("exitinputs.txt.213632")
postp = ld("plan.txt.213632")
ig = ld("installgate.txt.213130")
il = ld("live-install-last.json")
snap = ld("live-snap-rep.json")
ua, uap = ld("exitinputs.txt.215642"), ld("plan.txt.215642")
ub, ubp = ld("exitinputs.txt.220144"), ld("plan.txt.220144")
i = prep["decisions"]["install"]
inst = {k: i.get(k) for k in ["key", "install", "installAt", "waitH", "pointH", "meanH", "q10", "q90", "batchGains", "noiseKey", "commitment", "decidedAt"]}
g = prep["decisions"]["grafts"]
fx = {
    "note": "Live BN9 2026-09-30, the 21:31:41Z install (tools/sim/exitjump/attribute-2131.mjs, tools/test/exitjump2131.test.mjs). pre: /tel/exitinputs.txt and plan.txt of the 21:31:05Z pass (the install actor priced on it), installgate goBonusPct; post: the first pass of the new life (21:36:15Z); installLast: /tel/install-last.txt; post.daedalusFavor: /tel/snap-rep.txt 21:43Z (a faction's favor is constant between installs); rejoin*: /tel/snap-static.txt reqs.Daedalus.",
    "pre": {"at": pre["at"], "lastAugReset": pre["lastAugReset"], "inputs": pre["inputs"], "install": inst, "grafts": {"key": g["key"], "grafts": g.get("grafts"), "lifeNow": g.get("lifeNow")}, "exit": prep["exit"], "ver": prep["ver"], "goBonusPct": ig["goBonusPct"], "carry": il["carry"], "rejoinMoney": 100e9, "rejoinLevel": 2500},
    "post": {"at": post["at"], "lastAugReset": post["lastAugReset"], "inputs": post["inputs"], "exit": postp["exit"], "exitJump": postp["exitJump"], "ver": postp["ver"], "daedalusFavor": snap["data"]["favor"]["Daedalus"]},
    "installLast": {k: il[k] for k in ["at", "lastAugReset", "batchAt", "why", "terminal", "planInstall", "exits", "carry", "results"]},
    # EXIT UNSTABLE 21:56:15Z -> 22:01:15Z (6.389h -> 4.328h, no event): Daedalus re-joined between the passes.
    "unstable": {
        "a": {"at": ua["at"], "inputs": ua["inputs"], "exit": uap["exit"], "install": uap["decisions"].get("install")},
        "b": {"at": ub["at"], "inputs": ub["inputs"], "exit": ubp["exit"], "install": ubp["decisions"].get("install"), "exitStability": ubp.get("exitStability")},
        "prevInstall": ld("plan.txt.215140")["decisions"].get("install"),
    },
}
s = json.dumps(fx, separators=(",", ":"))
open(OUT, "w").write(s)
print(OUT, len(s))
