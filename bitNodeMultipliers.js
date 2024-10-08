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

  PurchasedServerCost:        1,
  PurchasedServerLimit:       1,
  PurchasedServerMaxRam:      1,

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
  RepToDonateToFaction:       1,

  AugmentationMoneyCost:      1,
  AugmentationRepCost:        1,

  InfiltrationMoney:          1,
  InfiltrationRep:            1,

  FourSigmaMarketDataCost:    1,
  FourSigmaMarketDataApiCost: 1,

  CorporationValuation:       1,

  BladeburnerRank:            1,
  BladeburnerSkillCost:       1,

  DaedalusAugsRequirement:    1,
  GangKarmaRequirement:       1,
};

export const getBitNodeMultipliers = () => getItem(bit_node_multipliers_key) || defaultBitNodeMultipliers;

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

  let bitNodeMultipliers;
  try {
    bitNodeMultipliers = ns.getBitNodeMultipliers();
  } catch (error) {
    ns.tprint("Unable to access ns.getBitNodeMultipliers(...), please acquire SF-5.");
  }
  if (!bitNodeMultipliers) {
    bitNodeMultipliers = defaultBitNodeMultipliers;
      ns.tprint("Default BitNode multipliers used, some calculations may be off");
  }
  setItem(bit_node_multipliers_key, bitNodeMultipliers);
  ns.tprint("Saved BitNode multipliers to localstorage");

  if (flag_data.print) {
    ns.tprint(`\n{\n${Object.entries(getBitNodeMultipliers()).sort((a,b)=>b[1]-a[1]).map(entry => `${entry[0].padStart(26)}: ${ns.nFormat(entry[1],"0.00").padStart(4)}`).join("\n")}\n}`);
  }
}
