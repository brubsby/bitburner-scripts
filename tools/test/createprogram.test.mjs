// [PG] program creation — createProgram.js's table and model against game source.
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";
import { GAME } from "./build-ram.mjs";

const cp = await import("../../createProgram.js");
const { programs, programPlan, effectiveLevel, INT_PROGRAM_EXP_PER_SEC } = cp;

export async function run() {
  const c = new Check("PG1", "program levels and times match Programs.ts; time and intelligence exp follow CreateProgramWork.ts");
  const src = fs.readFileSync(path.join(GAME, "src/Programs/Programs.ts"), "utf8");
  const consts = fs.readFileSync(path.join(GAME, "src/Constants.ts"), "utf8");
  const ms = (name) => Number(consts.match(new RegExp(`${name}:\\s*([\\d*e ]+),`))?.[1]?.replace(/\s/g, "") ?? NaN);
  const table = { MillisecondsPerFiveMinutes: 300000, MillisecondsPerHalfHour: 1800000, MillisecondsPer2Hours: 7200000, MillisecondsPer4Hours: 14400000, MillisecondsPer8Hours: 28800000, MillisecondsPerQuarterHour: 900000 };
  const enums = fs.readFileSync(path.join(GAME, "src/Programs/Enums.ts"), "utf8");
  const names = Object.fromEntries([...enums.matchAll(/^\s*(\w+) = "([^"]+)"/gm)].map((m) => [m[1], m[2]]));
  let n = 0;
  for (const m of src.matchAll(/\[CompletedProgramName\.(\w+)\]: new Program\(\{[\s\S]*?create: \{\s*level: (\d+),[\s\S]*?time: ([^,]+),/g)) {
    const file = names[m[1]];
    const level = Number(m[2]);
    const expr = m[3].trim();
    const time = expr.split("*").map((t) => t.trim()).reduce((a, t) => a * (t.startsWith("CONSTANTS.") ? (table[t.slice(10)] ?? ms(t.slice(10))) : Number(t)), 1);
    c.examined(1);
    n++;
    const ours = programs[file];
    if (!ours) { c.fail(`${file} is creatable in the game and missing from programs`); continue; }
    if (ours.level !== level || ours.time !== time) c.fail(`${file}: ours level ${ours.level} time ${ours.time} vs game ${level} ${time}`);
  }
  if (n < 6) c.fail(`parsed only ${n} creatable programs from Programs.ts`);
  c.examined(1);
  if (!consts.includes(`IntelligenceProgramBaseExpGain: ${INT_PROGRAM_EXP_PER_SEC}`)) c.fail("IntelligenceProgramBaseExpGain drifted");
  // Hand-check the formula: hacking 200, level 100, int 61, focused.
  const int = 61;
  const bonus = 1 + (3 * Math.pow(int, 0.8)) / 600;
  const sm = 1 + ((200 / 100) * bonus - 1) / 5;
  const p = programPlan("FTPCrack.exe", { hacking: 200, intelligence: int });
  if (Math.abs(p.seconds - 1800000 / (1000 * sm)) > 1e-9) c.fail("seconds must be time / (1000 x skillMult)");
  if (Math.abs(p.intExp - 0.1 * p.seconds) > 1e-9) c.fail("int exp is 0.1 per second worked");
  const un = programPlan("FTPCrack.exe", { hacking: 200, intelligence: int, focus: 0.8 });
  if (!(un.seconds > p.seconds)) c.fail("unfocused work is slower");
  if (effectiveLevel(100, 61) !== 69.5 || effectiveLevel(1, 500) !== 1) c.fail("effective level is max(1, level - int/2)");
  if (programPlan("FTPCrack.exe", { hacking: 70, intelligence: 61 }).eligible !== true) c.fail("intelligence lowers the level needed to start");
  if (programPlan("FTPCrack.exe", { hacking: 70 }).eligible !== false) c.fail("without intelligence 70 < 100 is not eligible");
  if (programPlan("nope.exe", { hacking: 1 }) !== null) c.fail("unknown program must refuse");
  c.note(`${n} programs matched; FTPCrack at hacking 200 / int 61: ${(p.seconds / 60).toFixed(1)} min, ${p.intExp.toFixed(1)} int exp`);
  return c;
}
