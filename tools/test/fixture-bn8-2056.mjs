// The live BitNode 8 state at 2026-09-25 20:56:38 UTC, the pass that installed
// 15 augmentations on the count floor ("14 distinct augmentation(s) toward the
// 30 ... decided by the floor of 3"). Reconstructed from that pass's
// /tel/orders.txt (each buyaug's planned price at its rank k, divided by 1.9^k
// for the base; each donation's dollars) and the pass-adjacent exit inputs
// and stock record. Multipliers of the tickets are NOT in the order file:
// every ticket is carried at hacking x1 (they were bought as count tickets,
// M = 1.0215 for the batch). A fixture, not a measurement of anything new.

const planned = [
  ["Magnetism Amplifier", 250000000, 0],
  ["Neural-Retention Enhancement", 475000000, 0],
  ["Hacknet Node Core Direct-Neural Interface", 216600000, 0],
  ["Neurotrainer II", 308655000, 0],
  ["Hacknet Node Kernel Direct-Neural Interface", 521284000, 0],
  ["Combat Rib I", 588073513, 3701906745],
  ["Nuoptimal Nootropic Injector Implant", 940917620, 2460912933],
  ["Augmented Targeting I", 1340807608, 2465151750],
  ["Hacknet Node CPU Architecture Neural-Upload", 1868191935, 0],
  ["Hacknet Node Cache Architecture Neural-Upload", 1774782338, 0],
  ["Hacknet Node NIC Architecture Neural-Upload", 2758979816, 0],
  ["Neurotrainer I", 4659610356, 0],
  ["Wired Reflexes", 5533287298, 610019258],
  ["NutriGen Implant", 10513245866, 3079478025],
];

/** Tickets at their unescalated base price plus the donation that pass paid. */
export const LADDER = planned.map(([name, p, donation], k) => {
  const base = p / Math.pow(1.9, k);
  return { name, price: base + donation, laterPrice: base + donation, hacking: 1 };
});

/** NeuroFlux: the pass's first level was planned at $5,992,550,143 at rank 14 -> $750k base, level 0. */
export const NFG = { price: 5992550143 / Math.pow(1.9, 14), level: 0 };

/** Installed distinct augmentations at 20:56: 0 (BitNode 8 life 1); the gate is 30. */
export const COUNT_SHORT = 30;

export const INPUTS = {
  money: 63.5e9, // the book liquidated at 20:52 (lead's report), cash + equity
  incomePerSec: 0,
  hacking: 485,
  hackingMult: 1.3392,
  expPerSec: 2349,
  repPerSec: 4.6,
  exitRep: 0,
  exitFavor: 0,
  exitLevel: 3000,
  joinMoney: 100e9,
  terminalRep: 0,
  favorToDonate: 0,
  capitalReturnPerSec: 3.71e-4, // stock.txt 20:37 returnPerSec
  capitalCap: 6.0e12,
  installCash: 250e6,
  workWhileDonating: true,
  cycleHours: 2.438, // the BitNode 10 cadence prior in force (exitinputs 21:06)
  multGainPerCycle: 1.1705,
};
