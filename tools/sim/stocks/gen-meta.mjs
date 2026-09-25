// Prints the per-symbol table stockstrat.js carries (SYMBOL_META), from game
// source: the midpoint of shareTxForMovement (InitStockMetadata.ts) and the
// servers whose organizationName is the company (Server/data/servers.ts).
// tools/test/stockstrat.test.mjs compares the shipped table against this.
//
//   node tools/sim/stocks/gen-meta.mjs
// CALIBRATION: not a model — a copy of game-source data, compared exactly by ST1.

import "./env.mjs";
const G = await import("./stocks.bundle.mjs");

export function symbolMeta() {
  const out = {};
  for (const m of G.InitStockMetadata) {
    const r = m.shareTxForMovement;
    const S = typeof r === "number" ? r : (r.min + r.max) / 2;
    const servers = G.serverMetadata.filter((s) => s.organizationName === m.name).map((s) => s.hostname);
    out[m.symbol] = { S, servers };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t = symbolMeta();
  for (const [k, v] of Object.entries(t)) console.log(`  ${k}: { S: ${v.S}, servers: ${JSON.stringify(v.servers)} },`);
  process.exit(0); // the bundle leaves jsdom timers alive
}
