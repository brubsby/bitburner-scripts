// Adaptive think time, scored OFFLINE against a full-budget control.
//
//   node tools/staging/go/trace-report.mjs res/D-*.jsonl
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS RATHER THAN ONE LIVE RUN PER THRESHOLD
//
// go-lab.mjs's `diag` arm records, for every move, what the search WOULD have
// answered as a function of think time: every ~50ms it snapshots the current
// most-visited root child, its visit count, the runner-up's visit count and
// the leader's win rate. So a candidate early-exit rule can be replayed over
// recorded searches and scored on the only question that matters — **would it
// have returned a different move from the one the full 800ms returned, and how
// much clock would it have saved** — without spending a game per threshold.
//
// This is an upper bound on the harm, not a simulation of it: a rule that
// changes a move might change it for the better. Treated as harm, it is
// conservative in the right direction.
//
// THE THREE PITFALLS, and where each is handled
//
// 1. "Confidence is self-fulfilling at low visit counts." After a handful of
//    iterations one child trivially holds most of the visits. Every rule below
//    carries a MINIMUM LEADER VISIT COUNT and the sweep reports what that floor
//    had to be, rather than assuming one.
//
// 2. "Keep the safety filters at every budget." Nothing here touches them.
//    Early exit only shortens golib.js's UCT loop; `legal()`'s own-eye filter,
//    `tryPlay`'s self-atari rejection and the root filter through the game's
//    getValidMoves all run identically at 50ms and at 800ms. Cutting search
//    skips deliberation, not filtering.
//
// 3. "'Winning by a ton' is an estimate, not a fact." The decided-position
//    trigger reads the SAME UCT root win rate that is about to be given less
//    time, so it degrades exactly where it is acted on. That is why this file
//    also prints CALIBRATION OF THE SIGNAL: for each bucket of root win rate,
//    the fraction of those games that were actually won. If the estimate does
//    not track the outcome, the decided-position trigger is not usable and the
//    obvious-move trigger stands on its own.

import fs from "node:fs";

const FILES = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!FILES.length) {
  console.error("usage: node tools/staging/go/trace-report.mjs <D-*.jsonl>...");
  process.exit(1);
}

const games = [];
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.kind === "game" && o.diag?.length) games.push(o);
  }
}
if (!games.length) {
  console.error("no traced games in input");
  process.exit(1);
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

// Every traced move, flattened. tr rows are [t, idx, v1, v2, mean, passMean].
const moves = [];
for (const g of games) {
  for (const d of g.diag) {
    if (!d.tr?.length) continue;
    const last = d.tr[d.tr.length - 1];
    moves.push({ won: g.won, ply: d.ply, margin: d.margin, tr: d.tr, finalIdx: last[1], finalMean: last[4], finalT: last[0], passMean: d.passMean, passVisits: d.passVisits });
  }
}

console.log(`traced: ${games.length} games, ${moves.length} moves, ${mean(moves.map((m) => m.tr.length)).toFixed(1)} checkpoints/move\n`);

// --- CALIBRATION OF THE SIGNAL --------------------------------------------
// Does the UCT root win rate at a move actually predict the game's result?
// Without this the decided-position trigger is a number that feels like a
// probability. Bucketed over every traced move at full budget.
console.log("CALIBRATION OF THE ROOT WIN ESTIMATE  (does it predict the actual result?)");
console.log("  rootWinRate    moves   games actually won");
const buckets = [
  [0, 0.3],
  [0.3, 0.5],
  [0.5, 0.7],
  [0.7, 0.9],
  [0.9, 0.98],
  [0.98, 1.01],
];
for (const [lo, hi] of buckets) {
  const inB = moves.filter((m) => m.finalMean !== null && m.finalMean >= lo && m.finalMean < hi);
  if (!inB.length) continue;
  const won = inB.filter((m) => m.won).length;
  console.log(
    `  ${lo.toFixed(2)}-${hi.toFixed(2)}    ${String(inB.length).padStart(5)}   ` +
      `${((100 * won) / inB.length).toFixed(1)}%   (n=${inB.length})`,
  );
}
console.log(
  "  NOTE: this is a per-MOVE tally, so a long game contributes many rows with the same outcome.\n" +
    "  It answers 'is the estimate directionally honest', not 'is it a calibrated probability'.\n",
);

// --- EARLY-EXIT RULE SWEEP -------------------------------------------------
// A rule fires at the first checkpoint t >= floor where its condition holds.
// It is scored on saved clock and on whether the move it would have returned
// differs from the full-budget move.
function scoreRule(name, fire, floorMs) {
  let totalFull = 0;
  let totalRule = 0;
  let changed = 0;
  let fired = 0;
  for (const m of moves) {
    totalFull += m.finalT;
    let stop = null;
    for (const row of m.tr) {
      const [t, idx, v1, v2, mn] = row;
      if (t < floorMs) continue;
      if (fire({ t, idx, v1, v2, mean: mn })) {
        stop = row;
        break;
      }
    }
    if (stop) {
      fired++;
      totalRule += stop[0];
      if (stop[1] !== m.finalIdx) changed++;
    } else {
      totalRule += m.finalT;
    }
  }
  return {
    name,
    floorMs,
    firedPct: (100 * fired) / moves.length,
    changedPct: (100 * changed) / moves.length,
    changedOfFired: fired ? (100 * changed) / fired : 0,
    msSaved: (100 * (totalFull - totalRule)) / totalFull,
    meanMs: totalRule / moves.length,
  };
}

const rules = [];
for (const minv of [15, 30, 60]) {
  for (const conf of [0.65, 0.75, 0.85]) {
    rules.push(
      scoreRule(
        `obvious v1/(v1+v2)>=${conf} minv=${minv}`,
        ({ v1, v2 }) => v1 >= minv && (v2 <= 0 || v1 / (v1 + v2) >= conf),
        100,
      ),
    );
  }
}
for (const minv of [30, 60]) {
  for (const hi of [0.9, 0.95, 0.98]) {
    rules.push(scoreRule(`decided mean>=${hi} minv=${minv}`, ({ v1, mean: mn }) => v1 >= minv && mn !== null && mn >= hi, 100));
  }
}
// Composition: either trigger.
rules.push(
  scoreRule(
    "either (v1/(v1+v2)>=0.75 minv=30) OR (mean>=0.95 minv=30)",
    ({ v1, v2, mean: mn }) => v1 >= 30 && ((v2 <= 0 || v1 / (v1 + v2) >= 0.75) || (mn !== null && mn >= 0.95)),
    100,
  ),
);

console.log("EARLY-EXIT RULES, replayed over the recorded searches");
console.log("  (changed% is an UPPER BOUND on harm: a changed move may be better)");
console.log("rule                                              floor  fired%  changed%  ofFired%  ms/move  saved%");
for (const r of rules) {
  console.log(
    [
      r.name.padEnd(48),
      String(r.floorMs).padStart(5),
      r.firedPct.toFixed(1).padStart(7),
      r.changedPct.toFixed(1).padStart(9),
      r.changedOfFired.toFixed(1).padStart(9),
      r.meanMs.toFixed(0).padStart(8),
      r.msSaved.toFixed(1).padStart(7),
    ].join(" "),
  );
}

// --- HOW MUCH DOES A MOVE'S ANSWER MOVE AFTER 100/200/400ms? ---------------
// The blunt version of the same question, with no rule at all: how often is the
// full-budget answer already on the board at time t?
console.log("\nSTABILITY OF THE ANSWER  (fraction of moves whose 800ms choice was already the leader at t)");
for (const t of [50, 100, 200, 400, 600]) {
  let agree = 0;
  let have = 0;
  for (const m of moves) {
    const row = m.tr.find((r) => r[0] >= t);
    if (!row) continue;
    have++;
    if (row[1] === m.finalIdx) agree++;
  }
  console.log(`  t=${String(t).padStart(3)}ms  ${((100 * agree) / have).toFixed(1)}%  (n=${have})`);
}

// --- PASS AT THE ROOT ------------------------------------------------------
// Candidate fix 1 from the original brief: let PASS compete honestly in the
// evaluation. How often would it actually have won the comparison?
const withPass = moves.filter((m) => m.passMean !== null && m.passVisits >= 30);
const passWins = withPass.filter((m) => m.passMean > m.finalMean + 0.02);
console.log(
  `\nPASS AS A ROOT CANDIDATE: on ${withPass.length} of ${moves.length} moves PASS got >=30 visits; ` +
    `it beat the best move's win rate by >0.02 on ${passWins.length} of those ` +
    `(${((100 * passWins.length) / Math.max(1, withPass.length)).toFixed(1)}%).`,
);
console.log(
  `  mean PASS win rate ${mean(withPass.map((m) => m.passMean)).toFixed(3)} vs best-move ` +
    `${mean(withPass.map((m) => m.finalMean)).toFixed(3)}.`,
);
