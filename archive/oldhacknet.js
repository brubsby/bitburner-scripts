export async function main(ns) {

    const MAX_HACKNET_LEVELS = 200;
    const MAX_HACKNET_RAM = 64;
    const MAX_HACKNET_CORES = 16;

        //1% of current funds, per cycle.
    let allowancePercentage = 0.001;
    while (true) {
        if (ns.hacknet.numNodes() == 0) {
            ns.hacknet.purchaseNode();
        }
        for (let i = 0; i < ns.hacknet.numNodes(); i++) {
            let gain = [0,0,0];
            let currentCash = ns.getServerMoneyAvailable('home');
            currentCash *= allowancePercentage;

            if (ns.hacknet.getPurchaseNodeCost() <= currentCash) {
                ns.hacknet.purchaseNode();
            }

            let node = ns.hacknet.getNodeStats(i);

            if (node.level < MAX_HACKNET_LEVELS) {
                gain[0] = ((node.level + 1) * 1.6) * Math.pow(1.035, (node.ram - 1)) * ((node.cores + 5) / 6) / ns.hacknet.getLevelUpgradeCost(i,1);
            } else {
                gain[0] = 0;
            }

            if (node.ram < MAX_HACKNET_RAM) {
                gain[1] = (node.level * 1.6) * Math.pow(1.035, (node.ram * 2) - 1) * ((node.cores + 5) / 6) / ns.hacknet.getRamUpgradeCost(i,1);
            } else {
                gain[1] = 0;
            }

            if (node.cores < MAX_HACKNET_CORES) {
                gain[2] = (node.level * 1.6) * Math.pow(1.035, node.ram - 1) * ((node.cores + 6) / 6) / ns.hacknet.getCoreUpgradeCost(i,1);
            } else {
                gain[2] = 0;
            }

            ns.print('Level Upgrade:  ' + gain[0]);
            ns.print('Ram Upgrade:  ' + gain[1]);
            ns.print('Core Upgrade:  ' + gain[2]);

            let topgain = 0;

            for (let j = 0; j < 3; j++) {
                if (gain[j] > topgain) {
                    topgain = gain[j];
                }
            }

            if (topgain === 0) {
                ns.print('All Gains maxed on Node' + i);
                continue;
            }

            if (topgain == gain[0] && ns.hacknet.getLevelUpgradeCost(i,1) < currentCash) {
                let k = 1;
                let nextLevelGain;
                do {
                  k++;
                  nextLevelGain = ((node.level + k) * 1.6) * Math.pow(1.035, (node.ram - 1)) * ((node.cores + 5) / 6) / ns.hacknet.getLevelUpgradeCost(i,1);
                }
                while (nextLevelGain >= gain[1] && nextLevelGain >= gain[2] && (k + node.level) < MAX_HACKNET_LEVELS && ns.hacknet.getLevelUpgradeCost(i,k) < currentCash * k);
                k--;
                ns.tprint('Upgrading Level on Node ' + i + ' to ' + (node.level + k));
                ns.hacknet.upgradeLevel(i,k);
            } else if (topgain == gain[1] && ns.hacknet.getRamUpgradeCost(i,1) < currentCash) {
                ns.tprint('Upgrading Ram on Node ' + i + ' to ' + (node.ram + 1));
                ns.hacknet.upgradeRam(i,1);
            } else if (topgain == gain[2] && ns.hacknet.getCoreUpgradeCost(i,1) < currentCash) {
                ns.tprint('Upgrading Core on Node ' + i + ' to ' + (node.cores + 1));
                ns.hacknet.upgradeCore(i,1);
            } else {
                ns.print('Cannot afford upgrades on Node' + i);
            }
        }
        await ns.sleep(300)
    }
}
