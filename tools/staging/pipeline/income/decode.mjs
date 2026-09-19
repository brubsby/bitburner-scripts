import fs from "fs";
import zlib from "zlib";
const D = "/home/tbusby/Repos/bitburner-scripts/tools/staging/pipeline/income/";
const { result } = JSON.parse(fs.readFileSync(D + "save.json", "utf8"));
const raw = result.binary
  ? zlib.gunzipSync(Buffer.from(result.save, "latin1")).toString("utf8")
  : Buffer.from(result.save, "base64").toString("utf8");
const save = JSON.parse(raw);
const sect = (n) => { const v = save?.data?.[n]; return typeof v === "string" ? JSON.parse(v) : v; };
const pd = sect("PlayerSave");
const p = pd?.data ?? pd;
const unwrap = (x) => (x && x.ctor && x.data ? x.data : x);
const out = {
  money: p.money,
  bitNodeN: p.bitNodeN,
  playtimeSinceLastAug: p.playtimeSinceLastAug,
  playtimeSinceLastBitnode: p.playtimeSinceLastBitnode,
  totalPlaytime: p.totalPlaytime,
  scriptProdSinceLastAug: p.scriptProdSinceLastAug,
  moneySourceA: unwrap(p.moneySourceA),
  moneySourceB: unwrap(p.moneySourceB),
};
fs.writeFileSync(D + "money.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
