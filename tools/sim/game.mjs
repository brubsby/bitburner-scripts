// The game's own formulas, importable from node.
//
//   import { calculateHackingTime, calculateGrowMoney } from "./game.mjs";
//
// Everything re-exported here is the real bitburner-src implementation rather
// than a port, so it cannot drift from the game. The bundle is rebuilt
// automatically when the game source is newer (see env.mjs).
//
// The bundle is pulled in with a dynamic import on purpose. A static
// `export * from "./game.bundle.mjs"` is evaluated as a sibling of env.mjs,
// and the bundle touches the DOM while initialising its theme — it has to run
// strictly after the environment exists, which only awaiting guarantees.

import "./env.mjs";

const game = await import("./game.bundle.mjs");

export default game;

export const {
  // src/Hacking.ts
  calculateHackingChance,
  calculateHackingExpGain,
  calculatePercentMoneyHacked,
  calculateHackingTime,
  calculateGrowTime,
  calculateWeakenTime,
  // src/Server/formulas/grow.ts
  calculateServerGrowth,
  calculateServerGrowthLog,
  calculateGrowMoney,
  // src/Server/ServerHelpers.ts
  numCycleForGrowthCorrected,
  processSingleServerGrowth,
  getCoreBonus,
  getWeakenEffect,
  // src/PersonObjects/formulas/*
  calculateSkill,
  calculateExp,
  calculateSkillProgress,
  getEmptySkillProgress,
  calculateIntelligenceBonus,
  // misc
  Server,
  ServerConstants,
  currentNodeMults,
  getUpgradeHomeRamCost,
  getUpgradeHomeCoresCost,
} = game;
