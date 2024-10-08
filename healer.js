export async function main(ns) {
    try {
        ns.hospitalize();
        while (true) {
            if (ns.getPlayer().hp < ns.getPlayer().max_hp) {
                ns.hospitalize();
            }
            await ns.sleep(1000);
        }
    } catch (err) {
        ns.tprint("Healer script killed due to not having appropriate singularity source file");
        ns.exit();
    }
}
