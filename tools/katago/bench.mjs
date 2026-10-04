// KataGo speed on IPvGO-shaped positions.
//   node tools/katago/bench.mjs [--visits 200] [--positions file.json]
// file.json: an array of simple boards (column strings). Default: the empty
// bitverse 19x19 (Constants.ts bitverseBoardShape) and a 5x5 with one hole.
import fs from "node:fs";
import { startKataGo } from "./katago.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const visits = Number(arg("visits", 200));
const kg = await startKataGo({ visits, log: console.error });
if (!kg) process.exit(2);
const valid = (b) => {
  const out = [];
  for (let x = 0; x < b.length; x++) for (let y = 0; y < b.length; y++) if (b[x][y] === ".") out.push([x, y]);
  return out;
};
const bitverse = [
  "########...########", "######.#...#.######", "###.#..#...#..#.###", ".#..#..#...#..#..#.", ".#.....#...#.....#.",
  "...................", "...................", "...................", "...................", ".....##.....##.....",
  "....###.....###....", "....##.......##....", "....#.........#....", ".........#.........", "#........#........#",
  "##.......#.......##", "##.......#.......##", "###.............###", "####...........####",
];
const positions = arg("positions", null) ? JSON.parse(fs.readFileSync(arg("positions"), "utf8")) : [["....#", ".....", "..O..", ".....", "....."], bitverse];
for (const b of positions) {
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    const r = await kg.choose(b, valid(b), b.length === 19 ? 9.5 : 7.5);
    console.log(`${b.length}x${b.length}: ${JSON.stringify(r)} in ${Date.now() - t0}ms (${visits} visits)`);
  }
}
kg.close();
