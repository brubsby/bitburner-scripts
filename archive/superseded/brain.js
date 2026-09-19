export async function main(ns) {
	while (true) {
		ns.exec("contract.js", "home");
		await ns.sleep(5*60*1000);
	}
}
