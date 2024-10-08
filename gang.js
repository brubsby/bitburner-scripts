import { steve } from "steve.js"

export async function main(ns) {

  let flags = ns.flags([
    ["faction", "NiteSec"],
    ["print-tasks", false],
  ]);

  if (flags["print-tasks"]) {
    ns.tprint(JSON.stringify(ns.gang.getTaskNames().map(taskName =>
      ns.gang.getTaskStats(taskName)), null, 2));
    ns.exit();
    return;
  }

  while (!ns.gang.inGang()) {
    ns.gang.createGang(flags.faction);
    await ns.sleep(10000);
  }

  while (true) {
    while (ns.gang.canRecruitMember()) {
      ns.gang.recruitMember(steve());
      ns.print(`Attempting to recruit new member.`);
      await ns.sleep(1000);
    }

    let members = ns.gang.getMemberNames().map(name =>
      ns.gang.getMemberInformation(name));

    await ns.sleep(1000);
  }
}
