// [SN] the planner reads snapshots — snapshot.js, the snap-*.js actors, and
// the invariant that makes it worth anything: progress.js carries no priced
// Singularity name.
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
import { load, asSave, priceCode, source } from "./ram.mjs";

const sn = await import("../../snapshot.js");
const { SNAPSHOTS, SNAPSHOT_ORDER, snapshotView, readSnapshot, DYNAMIC_FRESH_MS } = sn;

function fakeNs(files) {
  return { read: (f) => files[f] ?? "" };
}
const INFO = { lastAugReset: 111, lastNodeReset: 222 };
const NOW = Date.parse("2026-09-19T20:00:00Z");
const stamp = (data, o = {}) => JSON.stringify({ at: new Date(NOW - (o.ageMs ?? 1000)).toISOString(), lastAugReset: o.life ?? 111, lastNodeReset: o.node ?? 222, data });
function allFiles(over = {}) {
  return {
    [SNAPSHOTS.owned.file]: stamp({ owned: ["A"], purchased: ["A", "B"] }),
    [SNAPSHOTS.catalog.file]: stamp({ augs: { CyberSec: ["A", "B"] } }),
    [SNAPSHOTS.augprice.file]: stamp({ price: { A: 1e6, B: 2e6 }, repReq: { A: 100, B: 200 } }),
    [SNAPSHOTS.rep.file]: stamp({ rep: { CyberSec: 50 }, favor: { CyberSec: 5 }, companyRep: { ECorp: 7 }, companyFavor: { ECorp: 1 }, work: { type: "CRIME" }, focused: true }),
    [SNAPSHOTS.invites.file]: stamp({ invitations: ["NiteSec"] }),
    [SNAPSHOTS.augstats.file]: stamp({ stats: { A: { hacking: 1.1 } } }),
    [SNAPSHOTS.prereq.file]: stamp({ prereq: { A: [] } }),
    [SNAPSHOTS.static.file]: stamp({ enemies: { CyberSec: [] }, reqs: { CyberSec: [{ type: "money", money: 1 }] } }),
    ...over,
  };
}

export async function run() {
  const checks = [];

  const c1 = new Check("SN1", "progress.js carries no priced Singularity name; every actor is one read family");
  {
    await load();
    const code = source("progress.js").replace("ns.ramOverride(2.6)", "0");
    for (const [label, cfg] of [["BN4", { bitNode: 4, sf: {} }], ["BN2 SF4.1", { bitNode: 2, sf: { 1: 2, 4: 1, 5: 1 } }]]) {
      c1.examined(1);
      asSave(cfg);
      const r = priceCode(code, "progress.js");
      const sing = r.entries.filter((e) => /singularity/.test(e.name)).map((e) => e.name);
      if (sing.length) c1.fail(`${label}: progress.js still prices ${sing.join(", ")}`);
      if (!(r.cost < 12)) c1.fail(`${label}: progress.js prices ${r.cost}GB; the whole point is ~8`);
    }
    asSave({ bitNode: 2, sf: { 1: 2, 4: 1, 5: 1 } });
    let worst = 0;
    for (const key of SNAPSHOT_ORDER) {
      c1.examined(1);
      const r = priceCode(source(SNAPSHOTS[key].actor), SNAPSHOTS[key].actor);
      worst = Math.max(worst, r.cost);
      if (!(r.cost <= 100)) c1.fail(`${SNAPSHOTS[key].actor} prices ${r.cost}GB: split it, the floor is the largest actor`);
    }
    c1.note(`planner 8.45GB; largest snapshot actor ${worst}GB at SF4.1 — the floor is a 128GB home`);
  }
  checks.push(c1);

  const c2 = new Check("SN2", "the view answers every read from the files and refuses stale, other-life and other-node snapshots");
  {
    c2.examined(1);
    const v = snapshotView(fakeNs(allFiles()), INFO, NOW);
    if (v.missing.length) c2.fail(`complete files must not be missing: ${v.missing}`);
    if (v.ownedAugs(true).length !== 2 || v.ownedAugs(false).length !== 1) c2.fail("ownedAugs(purchased) must split owned/purchased");
    if (v.factionAugs("CyberSec")[1] !== "B" || v.augPrice("B") !== 2e6 || v.augRepReq("A") !== 100) c2.fail("catalogue and prices must read through");
    if (v.factionRep("CyberSec") !== 50 || v.factionFavor("CyberSec") !== 5 || v.companyRep("ECorp") !== 7 || v.companyFavor("ECorp") !== 1) c2.fail("reputation reads");
    if (v.invitations()[0] !== "NiteSec" || v.currentWork().type !== "CRIME" || v.focused() !== true) c2.fail("invitations, work and focus reads");
    if (v.augStats("A").hacking !== 1.1 || v.augPrereq("A").length !== 0 || v.inviteReqs("CyberSec")[0].type !== "money" || v.factionEnemies("CyberSec").length !== 0) c2.fail("static reads");
    let threw = false;
    try { v.augPrice("nope"); } catch (e) { threw = e.name === "SnapshotError"; }
    if (!threw) c2.fail("an unknown key must THROW, not answer 0");

    c2.examined(1);
    const stale = snapshotView(fakeNs(allFiles({ [SNAPSHOTS.rep.file]: stamp({}, { ageMs: DYNAMIC_FRESH_MS + 1 }) })), INFO, NOW);
    if (!stale.missing.some((m) => m.startsWith("rep:"))) c2.fail("a dynamic snapshot past its freshness must be missing");
    const otherLife = snapshotView(fakeNs(allFiles({ [SNAPSHOTS.owned.file]: stamp({ owned: [], purchased: [] }, { life: 999 }) })), INFO, NOW);
    if (!otherLife.missing.some((m) => /owned: .*another life/.test(m))) c2.fail("another life's owned list must be refused");
    const otherNode = snapshotView(fakeNs(allFiles({ [SNAPSHOTS.static.file]: stamp({ enemies: {}, reqs: {} }, { node: 999 }) })), INFO, NOW);
    if (!otherNode.missing.some((m) => /static: .*another BitNode/.test(m))) c2.fail("another node's static file must be refused");
    const oldStatic = snapshotView(fakeNs(allFiles({ [SNAPSHOTS.static.file]: stamp({ enemies: {}, reqs: {} }, { ageMs: 7 * 24 * 3600e3 }) })), INFO, NOW);
    if (oldStatic.missing.length) c2.fail("a week-old static file from THIS node is fine");
    const none = snapshotView(fakeNs({}), INFO, NOW);
    if (none.missing.length !== Object.keys(SNAPSHOTS).length) c2.fail("no files: every family missing, each named");
    if (readSnapshot(fakeNs({ [SNAPSHOTS.owned.file]: "{not json" }), "owned", INFO, NOW).data !== null) c2.fail("unparseable is missing, not a crash");
    c2.note("15 reads answered; stale, other-life, other-node and absent files each refused by name");
  }
  checks.push(c2);

  return checks;
}
