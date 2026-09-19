// BitNode multipliers, cached in localStorage.
//
// TWO BUGS WERE FIXED HERE ON 2026-09-13, both silent:
//
// 1. The defaults table was Bitburner v1. Five key names no longer exist in the
//    game (`PurchasedServerCost/Limit/MaxRam`, `RepToDonateToFaction`,
//    `GangKarmaRequirement`), so every lookup of a renamed key silently
//    resolved to the v1 default in EVERY BitNode. Worse with SF5 than without:
//    the real object has no `PurchasedServerCost`, so `55000 * undefined` is
//    NaN and pserv.js silently bought nothing at all, forever. Renamed per
//    BitNodeMultipliers.ts:131,137,140,143 and utils/APIBreaks/3.0.0.ts:461.
//    `GangKarmaRequirement` is no longer a multiplier — it is the fixed
//    constant GangConstants.GangKarmaRequirement = -54000 (Gang/data/Constants.ts:27).
//
// 2. `DaedalusAugsRequirement` defaulted to 1. The game's default is **30**
//    (BitNodeMultipliers.ts:61) and it is an ABSOLUTE augmentation count, not a
//    scale factor (FactionInfo.tsx:142). faction.js:20 computes
//    `30 * getBitNodeMultipliers().DaedalusAugsRequirement`, which was right by
//    accident at 1 and would have demanded 900 augmentations with SF5.
//
// The export is named `readBitNodeMults`, NOT `getBitNodeMultipliers`: the RAM
// checker prices every bare identifier by name (Script/RamCalculations.ts:407),
// so the old name collided with ns.getBitNodeMultipliers and cost **4GB** to
// this module and to every importer, for a function whose body is a
// localStorage read.
//
// This table is still only a FALLBACK. ns.getBitNodeMultipliers() needs SF5
// (NetscriptFunctions.ts:875); prefer sfgate.js's canReadBitNodeMultipliers()
// and the live call when it is available.

import { canReadBitNodeMultipliers } from 'sfgate.js'

const bit_node_multipliers_key = 'BB_BITNODE_MULTIPLIERS'

const defaultBitNodeMultipliers = {
  HackingLevelMultiplier:     1,
  StrengthLevelMultiplier:    1,
  DefenseLevelMultiplier:     1,
  DexterityLevelMultiplier:   1,
  AgilityLevelMultiplier:     1,
  CharismaLevelMultiplier:    1,

  ServerGrowthRate:           1,
  ServerMaxMoney:             1,
  ServerStartingMoney:        1,
  ServerStartingSecurity:     1,
  ServerWeakenRate:           1,

  HomeComputerRamCost:        1,

  CloudServerCost:        1,
  CloudServerLimit:       1,
  CloudServerMaxRam:      1,

  CompanyWorkMoney:           1,
  CrimeMoney:                 1,
  HacknetNodeMoney:           1,
  ManualHackMoney:            1,
  ScriptHackMoney:            1,
  ScriptHackMoneyGain:        1,
  CodingContractMoney:        1,

  ClassGymExpGain:            1,
  CompanyWorkExpGain:         1,
  CrimeExpGain:               1,
  FactionWorkExpGain:         1,
  HackExpGain:                1,

  FactionPassiveRepGain:      1,
  FactionWorkRepGain:         1,
  FavorToDonateToFaction:       1,

  AugmentationMoneyCost:      1,
  AugmentationRepCost:        1,

  InfiltrationMoney:          1,
  InfiltrationRep:            1,

  FourSigmaMarketDataCost:    1,
  FourSigmaMarketDataApiCost: 1,

  CorporationValuation:       1,

  BladeburnerRank:            1,
  BladeburnerSkillCost:       1,

  DaedalusAugsRequirement:   30,

  // Added 2026-09-15, when CompanyWorkRepGain's ABSENCE made every megacorp
  // faction unpriceable: the consumer read `undefined`, refused (correctly,
  // by design), and the refusal traced back here. The other thirteen were
  // found by diffing this table against the game's class fields
  // (BitNodeMultipliers.ts:22-96) — the same diff check BN1 now runs on every
  // test pass, so a key added upstream cannot go missing here again.
  CompanyWorkRepGain:         1,
  CrimeSuccessRate:           1,
  HackingSpeedMultiplier:     1,
  CloudServerSoftcap:         1,
  GangSoftcap:                1,
  GangUniqueAugs:             1,
  GoPower:                    1,
  CorporationDivisions:       1,
  CorporationSoftcap:         1,
  StaneksGiftPowerMultiplier: 1,
  StaneksGiftExtraSize:       0,
  DarknetMoneyMultiplier:     1,
  DarknetLabyrinthRewardsTheRedPill: 1,
  WorldDaemonDifficulty:      1,
  };

// ---------------------------------------------------------------------------
// THE OVERRIDE TABLE — why this exists, and what it fixes
//
// `readBitNodeMults()` reads localStorage, and the ONLY writer is this file's
// own main(), which needs SF5 to read the real values. We do not have SF5. So
// in BitNode 4 the call returned BitNode 1 values for every key, silently, and
// had done since we arrived: measured live, `FactionWorkRepGain` read back as
// 1 where the true value is 0.75 — a 33% overstatement of every donation.
//
// That is exactly the failure shape CLAUDE.md names as "a lookup that silently
// defaults", and the same one that made `PurchasedServerCost` always 1. It
// produces no error and a wrong number.
//
// The fix does not need SF5. `getBitNodeMultipliers` is a pure function of the
// BitNode number (BitNode.tsx, one `case n:` per node), so the overrides can be
// read straight out of game source. This table is generated from
// ~/Repos/bitburner/src/BitNode/BitNode.tsx and carries only the keys each node
// actually overrides; everything else genuinely is the BitNode 1 default.
//
// REGENERATE IT when the fork is fast-forwarded — `npm test` check BN1 diffs
// this table against game source and fails if they have drifted apart, so a
// stale table is loud rather than quiet.
const BITNODE_OVERRIDES = {
  2: { HackingLevelMultiplier: 0.8, ServerGrowthRate: 0.8, ServerMaxMoney: 0.08, ServerStartingMoney: 0.4, CloudServerSoftcap: 1.3, CrimeMoney: 3, FactionPassiveRepGain: 0, FactionWorkRepGain: 0.5, CorporationSoftcap: 0.9, CorporationDivisions: 0.9, InfiltrationMoney: 3, StaneksGiftPowerMultiplier: 2, WorldDaemonDifficulty: 5 },
  3: { HackingLevelMultiplier: 0.8, ServerGrowthRate: 0.2, ServerMaxMoney: 0.04, ServerStartingMoney: 0.2, HomeComputerRamCost: 1.5, CloudServerCost: 2, CloudServerSoftcap: 1.3, CompanyWorkMoney: 0.25, CrimeMoney: 0.25, HacknetNodeMoney: 0.25, ScriptHackMoney: 0.2, FavorToDonateToFaction: 0.5, AugmentationMoneyCost: 3, AugmentationRepCost: 3, GangSoftcap: 0.9, GangUniqueAugs: 0.5, StaneksGiftPowerMultiplier: 0.75, DarknetMoneyMultiplier: 0.4, WorldDaemonDifficulty: 2 },
  4: { ServerMaxMoney: 0.1125, ServerStartingMoney: 0.75, CloudServerSoftcap: 1.2, CompanyWorkMoney: 0.1, CrimeMoney: 0.2, HacknetNodeMoney: 0.05, ScriptHackMoney: 0.2, ClassGymExpGain: 0.5, CompanyWorkExpGain: 0.5, CrimeExpGain: 0.5, FactionWorkExpGain: 0.5, HackExpGain: 0.4, FactionWorkRepGain: 0.75, GangUniqueAugs: 0.5, StaneksGiftPowerMultiplier: 1.5, StaneksGiftExtraSize: 0, DarknetMoneyMultiplier: 0.4, WorldDaemonDifficulty: 3 },
  5: { ServerStartingSecurity: 2, ServerStartingMoney: 0.5, CloudServerSoftcap: 1.2, CrimeMoney: 0.5, HacknetNodeMoney: 0.2, ScriptHackMoney: 0.15, HackExpGain: 0.5, AugmentationMoneyCost: 2, InfiltrationMoney: 1.5, InfiltrationRep: 1.5, CorporationValuation: 0.75, CorporationDivisions: 0.75, GangUniqueAugs: 0.5, StaneksGiftPowerMultiplier: 1.3, StaneksGiftExtraSize: 0, DarknetMoneyMultiplier: 0.7, WorldDaemonDifficulty: 1.5 },
  6: { HackingLevelMultiplier: 0.35, ServerMaxMoney: 0.2, ServerStartingMoney: 0.5, ServerStartingSecurity: 1.5, CloudServerSoftcap: 2, CompanyWorkMoney: 0.5, CrimeMoney: 0.75, HacknetNodeMoney: 0.2, ScriptHackMoney: 0.75, HackExpGain: 0.25, InfiltrationMoney: 0.75, CorporationValuation: 0.2, CorporationSoftcap: 0.9, CorporationDivisions: 0.8, GangSoftcap: 0.7, GangUniqueAugs: 0.2, DaedalusAugsRequirement: 35, StaneksGiftPowerMultiplier: 0.5, StaneksGiftExtraSize: 2, WorldDaemonDifficulty: 2 },
  7: { HackingLevelMultiplier: 0.35, ServerMaxMoney: 0.2, ServerStartingMoney: 0.5, ServerStartingSecurity: 1.5, CloudServerSoftcap: 2, CompanyWorkMoney: 0.5, CrimeMoney: 0.75, HacknetNodeMoney: 0.2, ScriptHackMoney: 0.5, HackExpGain: 0.25, AugmentationMoneyCost: 3, InfiltrationMoney: 0.75, FourSigmaMarketDataCost: 2, FourSigmaMarketDataApiCost: 2, CorporationValuation: 0.2, CorporationSoftcap: 0.9, CorporationDivisions: 0.8, BladeburnerRank: 0.6, BladeburnerSkillCost: 2, GangSoftcap: 0.7, GangUniqueAugs: 0.2, DaedalusAugsRequirement: 35, StaneksGiftPowerMultiplier: 0.9, WorldDaemonDifficulty: 2 },
  8: { CloudServerSoftcap: 4, CompanyWorkMoney: 0, CrimeMoney: 0, HacknetNodeMoney: 0, ManualHackMoney: 0, ScriptHackMoney: 0.3, ScriptHackMoneyGain: 0, CodingContractMoney: 0, FavorToDonateToFaction: 0, InfiltrationMoney: 0, CorporationValuation: 0, CorporationSoftcap: 0, CorporationDivisions: 0, BladeburnerRank: 0, DarknetLabyrinthRewardsTheRedPill: 0, DarknetMoneyMultiplier: 0, GangSoftcap: 0, GangUniqueAugs: 0 },
  9: { HackingLevelMultiplier: 0.5, StrengthLevelMultiplier: 0.45, DefenseLevelMultiplier: 0.45, DexterityLevelMultiplier: 0.45, AgilityLevelMultiplier: 0.45, CharismaLevelMultiplier: 0.45, ServerMaxMoney: 0.01, ServerStartingMoney: 0.1, ServerStartingSecurity: 2.5, HomeComputerRamCost: 5, CloudServerLimit: 0, CrimeMoney: 0.5, ScriptHackMoney: 0.1, HackExpGain: 0.05, FourSigmaMarketDataCost: 5, FourSigmaMarketDataApiCost: 4, CorporationValuation: 0.5, CorporationSoftcap: 0.75, CorporationDivisions: 0.8, BladeburnerRank: 0.9, BladeburnerSkillCost: 1.2, GangSoftcap: 0.8, GangUniqueAugs: 0.25, StaneksGiftPowerMultiplier: 0.5, StaneksGiftExtraSize: 2, DarknetMoneyMultiplier: 0.05, WorldDaemonDifficulty: 2 },
  10: { HackingLevelMultiplier: 0.35, StrengthLevelMultiplier: 0.4, DefenseLevelMultiplier: 0.4, DexterityLevelMultiplier: 0.4, AgilityLevelMultiplier: 0.4, CharismaLevelMultiplier: 0.4, HomeComputerRamCost: 1.5, CloudServerCost: 5, CloudServerSoftcap: 1.1, CloudServerLimit: 0.6, CloudServerMaxRam: 0.5, CompanyWorkMoney: 0.5, CrimeMoney: 0.5, HacknetNodeMoney: 0.5, ManualHackMoney: 0.5, ScriptHackMoney: 0.5, CodingContractMoney: 0.5, AugmentationMoneyCost: 5, AugmentationRepCost: 2, InfiltrationMoney: 0.5, CorporationValuation: 0.5, CorporationSoftcap: 0.9, CorporationDivisions: 0.9, BladeburnerRank: 0.8, GangSoftcap: 0.9, GangUniqueAugs: 0.25, StaneksGiftPowerMultiplier: 0.75, DarknetMoneyMultiplier: 0.4, WorldDaemonDifficulty: 2 },
  11: { HackingLevelMultiplier: 0.6, ServerGrowthRate: 0.2, ServerMaxMoney: 0.01, ServerStartingMoney: 0.1, ServerWeakenRate: 2, CloudServerSoftcap: 2, CompanyWorkMoney: 0.5, CrimeMoney: 3, HacknetNodeMoney: 0.1, CodingContractMoney: 0.25, HackExpGain: 0.5, AugmentationMoneyCost: 2, InfiltrationMoney: 2.5, InfiltrationRep: 2.5, FourSigmaMarketDataCost: 4, FourSigmaMarketDataApiCost: 4, CorporationValuation: 0.1, CorporationSoftcap: 0.9, CorporationDivisions: 0.9, GangUniqueAugs: 0.75, WorldDaemonDifficulty: 1.5 },
  13: { HackingLevelMultiplier: 0.25, StrengthLevelMultiplier: 0.7, DefenseLevelMultiplier: 0.7, DexterityLevelMultiplier: 0.7, AgilityLevelMultiplier: 0.7, CharismaLevelMultiplier: 0.7, CloudServerSoftcap: 1.6, ServerMaxMoney: 0.3375, ServerStartingMoney: 0.75, ServerStartingSecurity: 3, CompanyWorkMoney: 0.4, CrimeMoney: 0.4, HacknetNodeMoney: 0.4, ScriptHackMoney: 0.2, CodingContractMoney: 0.4, ClassGymExpGain: 0.5, CompanyWorkExpGain: 0.5, CrimeExpGain: 0.5, FactionWorkExpGain: 0.5, HackExpGain: 0.1, FactionWorkRepGain: 0.6, FourSigmaMarketDataCost: 10, FourSigmaMarketDataApiCost: 10, CorporationValuation: 0.001, CorporationSoftcap: 0.4, CorporationDivisions: 0.4, BladeburnerRank: 0.45, BladeburnerSkillCost: 2, GangSoftcap: 0.3, GangUniqueAugs: 0.1, StaneksGiftPowerMultiplier: 2, StaneksGiftExtraSize: 1, DarknetMoneyMultiplier: 0.1, WorldDaemonDifficulty: 3 },
  14: { GoPower: 4, HackingLevelMultiplier: 0.4, HackingSpeedMultiplier: 0.3, ServerMaxMoney: 0.7, ServerStartingMoney: 0.5, ServerStartingSecurity: 1.5, CrimeMoney: 0.75, CrimeSuccessRate: 0.4, HacknetNodeMoney: 0.25, ScriptHackMoney: 0.3, StrengthLevelMultiplier: 0.5, DexterityLevelMultiplier: 0.5, AgilityLevelMultiplier: 0.5, DefenseLevelMultiplier: 0.5, AugmentationMoneyCost: 1.5, InfiltrationMoney: 0.75, FactionWorkRepGain: 0.2, CompanyWorkRepGain: 0.2, CorporationValuation: 0.4, CorporationSoftcap: 0.9, CorporationDivisions: 0.8, BladeburnerRank: 0.6, BladeburnerSkillCost: 2, GangSoftcap: 0.7, GangUniqueAugs: 0.4, StaneksGiftPowerMultiplier: 0.5, WorldDaemonDifficulty: 5 },
  15: { HackingLevelMultiplier: 0.6, HackingSpeedMultiplier: 0.6, StrengthLevelMultiplier: 0.7, DefenseLevelMultiplier: 0.7, DexterityLevelMultiplier: 0.7, AgilityLevelMultiplier: 0.7, CharismaLevelMultiplier: 1.1, ServerMaxMoney: 0.8, ServerStartingMoney: 0.5, ServerStartingSecurity: 1.5, AugmentationMoneyCost: 3, CorporationValuation: 0.2, CorporationSoftcap: 0.4, CorporationDivisions: 0.4, DaedalusAugsRequirement: 20, BladeburnerRank: 0.2, BladeburnerSkillCost: 3, GangUniqueAugs: 0.3, StaneksGiftPowerMultiplier: 0.7, WorldDaemonDifficulty: 2 },
}

/**
 * Multipliers for a given BitNode, without needing SF5.
 *
 * Pass the node from `ns.getResetInfo().currentNode` (1GB, and already paid by
 * every caller that needs this). An UNKNOWN node returns `null` rather than the
 * BitNode 1 defaults — "I do not know this node" must not present as "no
 * multipliers apply", which is the bug this replaced.
 */
export function bitNodeMults(node) {
  if (typeof node !== 'number' || !isFinite(node)) return null
  const over = BITNODE_OVERRIDES[node]
  // A node with no entry is only safe if it is BitNode 1, which by definition
  // has no overrides. Any other missing node is a gap in the table.
  if (!over) return node === 1 ? { ...defaultBitNodeMultipliers } : null
  return { ...defaultBitNodeMultipliers, ...over }
}

export const readBitNodeMults = () => getItem(bit_node_multipliers_key) || defaultBitNodeMultipliers;

function getItem(key) {
  let item = localStorage.getItem(key)

  return item ? JSON.parse(item) : undefined
}

function setItem(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export async function main(ns) {
  let flag_data = ns.flags([
    ["print", false],
  ])

  // GATE THE SF5 CALL, do not probe it with try/catch.
  //
  // The try/catch was wrong twice over. It does not save the RAM — the 4GB for
  // ns.getBitNodeMultipliers is billed statically to this module AND to every
  // importer whether or not the call is reachable (RamCalculations.ts:407
  // prices the identifier), which is what SF3/invariant B4 is about; this file
  // is imported by faction.js, so the cost travelled. And catching is not even
  // safe: NetscriptHelpers.tsx:523 calls killWorkerScript before throwing on a
  // Source-File gate, so the catch block runs inside a process that is already
  // dead — the same defect progress.js documents at length as "THE PROBE".
  //
  // canReadBitNodeMultipliers is the game's own rule (canAccessBitNodeFeature(5)),
  // answered from ns.getResetInfo for 1GB, and it is correct on the first tick
  // of a fresh life rather than after a failed call.
  let bitNodeMultipliers;
  if (canReadBitNodeMultipliers(ns.getResetInfo())) {
    bitNodeMultipliers = ns.getBitNodeMultipliers();
  } else {
    ns.tprint("Unable to access ns.getBitNodeMultipliers(...), please acquire SF-5.");
  }
  if (!bitNodeMultipliers) {
    bitNodeMultipliers = defaultBitNodeMultipliers;
      ns.tprint("Default BitNode multipliers used, some calculations may be off");
  }
  setItem(bit_node_multipliers_key, bitNodeMultipliers);
  ns.tprint("Saved BitNode multipliers to localstorage");

  if (flag_data.print) {
    ns.tprint(`\n{\n${Object.entries(bitNodeMultipliers).sort((a,b)=>b[1]-a[1]).map(entry => `${entry[0].padStart(26)}: ${(entry[1]).toFixed(2).padStart(4)}`).join("\n")}\n}`);
  }
}
