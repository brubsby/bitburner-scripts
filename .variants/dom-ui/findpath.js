/** @param {NS} ns */
export async function main(ns) {
  const target = ns.args[0] || "avmnite-02h";
  const visited = new Set(["home"]);
  const parent = { home: null };
  const queue = ["home"];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of ns.scan(cur)) {
      if (!visited.has(nb)) {
        visited.add(nb);
        parent[nb] = cur;
        queue.push(nb);
      }
    }
  }
  if (!parent.hasOwnProperty(target)) {
    ns.tprint(`NOT FOUND: ${target} not reachable in scan graph`);
    return;
  }
  const path = [];
  let cur = target;
  while (cur !== null) {
    path.unshift(cur);
    cur = parent[cur];
  }
  ns.tprint(`PATH: ${path.join(" -> ")}`);
  const s = ns.getServer(target);
  ns.tprint(`hackLevel=${s.requiredHackingSkill} ports=${s.numOpenPortsRequired} rooted=${s.hasAdminRights} maxMoney=${s.moneyMax} ram=${s.maxRam}`);
}
