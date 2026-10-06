// Which paired deals (go-w0 --layoutseed S, game i) fall on which catalog
// layout (tools/goai/layouts-5.json index, up to symmetry).
//   node tools/sim/go-layouts-of.mjs SEED GAMES [LAYOUT_INDEX...]
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const SIM = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(SIM, "env.mjs"));
const g = await import(path.join(SIM, "game.bundle.mjs"));
const { dealPaired } = await import(path.join(SIM, "go-board.mjs"));
const golib = await import(pathToFileURL(path.join(SIM, "../../golib.js")).href);
const lay = JSON.parse(fs.readFileSync(path.join(SIM, "../goai/layouts-5.json"), "utf8")).layouts;
const idx = new Map(lay.map((l, i) => [l.key, i]));
const [seed, games, ...want] = process.argv.slice(2).map(Number);
const out = [];
for (let i = 0; i < games; i++) {
  const st = dealPaired(g, 5, g.GoOpponent.Tetrads, seed, i);
  const k = golib.canonicalBoard(g.simpleBoardFromBoard(st.board)).key;
  const li = idx.get(k) ?? -1;
  if (!want.length || want.includes(li)) out.push(`${i}:${li}`);
}
console.log(out.join(" "));
process.exit(0);
