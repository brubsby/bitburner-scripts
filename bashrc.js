let doc=eval("document")

let terminalInput = (input) => {
  doc.getElementById('terminal-input-text-box').value=input;
  doc.dispatchEvent(new KeyboardEvent('keydown',{keyCode:13}));
};

const scripts_to_alias = [
  "spider.js",
  "training.js",
  "find.js",
  "stock.js",
  "crime.js",
  "eval.js",
  "bashrc.js",
  "hash.js",
  "killhack.js",
  "steve.js",
  "gang.js",
  "pserv.js",
  "sleeve.js",
];

const terminal_block = `
${scripts_to_alias.map(scriptName => `alias ${scriptName.replace(/\.[^/.]+$/, "")}="run ${scriptName}"`).join("\n")}
alias dbuy="home; connect darkweb; buy BruteSSH.exe; buy FTPCrack.exe; buy relaySMTP.exe; buy HTTPWorm.exe; buy SQLInject.exe; buy ServerProfiler.exe; buy AutoLink.exe; buy DeepscanV1.exe; buy DeepscanV2.exe; home;"
alias contracts="run contract.js"
alias servers="run pserv.js"
alias rank="home;run serverrank.js"
alias begin="home; run bashrc.js; run spider.js; run hacknet.js --budget Infinity --payoff-time 8; run sleeve.js; run pserv.js; run stock.js; run buyProgram.js all --wait; run brain.js; run hash.js money;"
alias deepscan="home; run deepscan.js"
alias trainallcheap="home; run training.js --skill all --switch-time 150000 --tail"
alias trainall="home; run training.js --skill all --tail"
alias trainhacking="home; run training.js --skill hacking --tail"
alias traindefense="home; run training.js --skill defense --tail"
alias traincombat="home; run training.js --skill combat --tail"
alias trainuni="home; run training.js --skill uni --tail"
alias traincharisma="home; run training.js --skill charisma --tail"
alias trainhackdef="home; run training.js --skill hackdef --tail --switch-time 60000"
alias crimetrain="home; run crime.js --training --tail"
alias crimemoney="home; run crime.js --money --tail"
alias crimekarma="home; run crime.js --karma --tail"
alias crimekills="home; run crime.js --kills --tail"
alias infil="home; run infilhelper.js; run healer.js; run infiltration.js"
alias programs="home; run buyProgram.js all --wait;"
alias augs="home; run faction.js --print-all-augs"
alias hackingaugs="home; run faction.js --print-augs hack"
alias defenseaugs="home; run faction.js --print-augs defense"
alias factions="home; run faction.js --print-factions"
alias hacknet="home; run hacknet.js"
alias restart="run process.js --restart"
alias start="run process.js --run"
alias stop="run process.js --kill"
`;

export async function main(ns) {
  terminalInput(terminal_block.split("\n").filter(string => string).join(";"));
}
