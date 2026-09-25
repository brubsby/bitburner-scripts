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
    const meta = G.serverMetadata.filter((s) => s.organizationName === m.name);
    const servers = meta.map((s) => s.hostname);
    // Required hacking level range over the company's servers (the live value
    // is drawn in [min, max] per server, Server/data/servers.ts): the lowest
    // server's range, since serving ANY one of them nudges the forecast.
    const ranges = meta.map((s) => (typeof s.requiredHackingSkill === "number" ? [s.requiredHackingSkill, s.requiredHackingSkill] : [s.requiredHackingSkill.min, s.requiredHackingSkill.max]));
    const req = ranges.length ? ranges.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
    out[m.symbol] = { S, servers, req };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t = symbolMeta();
  for (const [k, v] of Object.entries(t)) console.log(`  ${k}: { S: ${v.S}, servers: ${JSON.stringify(v.servers).replace(/"/g, "'").replace(/,/g, ', ')}, req: ${JSON.stringify(v.req)?.replace(/,/g, ', ') ?? 'null'} },`);
  process.exit(0); // the bundle leaves jsdom timers alive
}
