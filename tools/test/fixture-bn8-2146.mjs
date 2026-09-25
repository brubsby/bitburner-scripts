// The live BitNode 8 state at 2026-09-25 21:46:49 UTC — the pass that
// installed 6 augmentations with "exit installing now 1309.1h, best wait
// 1313.1h (4.0h wait)", the third install in ~50 minutes. Copied from that
// pass's /tel/exitinputs.txt; the capital lives from the lifetimes ledger
// (life lengths) and the lead's report ($250m -> $63.5b in the 6.14h life;
// the 0.24h and 0.58h lives ended where they began, stock.txt 21:51 wealth
// $249.8m of a $249.5m start). stock.txt calibration.predictedPerSec 2.23e-4.

export const INPUTS = {
  money: 251023086.58,
  incomePerSec: 11056.66,
  lifeIncome: 0,
  hacking: 431,
  hackingExp: 3619306.39,
  hackingMult: 1.5227013846399065,
  expPerSec: 2406.84,
  repPerSec: 3.988,
  exitRep: 0,
  exitFavor: 0,
  cycleHours: 4.1433333333333335,
  multGainPerCycle: 1.0066573455343195,
  nextInstallGain: 1.0510236820832555,
  installGains: { hacking: 1.0510236820832555, rep: 1.0510236820832555, income: 1.1828840987055325, exp: 1.0510236820832555 },
  persistBaseline: { hacking: 1.0510236820832555, rep: 1.0510236820832555, income: 1.1828840987055325, exp: 1.0510236820832555 },
  eRep: 0,
  eBudget: 0,
  exitLevel: 3000,
  joinMoney: 100e9,
  terminalRep: 0,
  donationCost: null,
  favorToDonate: 0,
  flatIncomePerSec: 0,
  capitalReturnPerSec: 0, // what the live pass used: the young life's return, clamped
  capitalCap: 5738860266744.356,
  installCash: 250e6,
  workWhileDonating: true,
};

export const CAPITAL_LIVES = [
  { lifeH: 6.14, start: 250e6, end: 63.5e9 },
  { lifeH: 0.24, start: 250e6, end: 250e6 },
  { lifeH: 0.58, start: 249516986.83, end: 249789309.46 },
];
export const STEADY_PER_SEC = 2.2322963546624866e-4;
