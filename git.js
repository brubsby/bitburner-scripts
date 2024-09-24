async function readDirectory(ns, url, noClobber) {
    let extensions = [".js", ".js", ".txt"];
    let index = await fetch(url).then(res => { return res.json(); });
    let localCounter = 0;
    await Promise.all(index.map(async file => {
        if (file.type === "file" && extensions.some(extension => file.name.endsWith(extension))) {
            await fetch(file.download_url).then(res => res.text())
              .then(res => {
                let path = `${file.path.includes('/')?'/':''}${file.path}`;
                if (ns.fileExists(path, ns.getHostname())) {
                  if (noClobber) {
                    return;
                  } else {
                    ns.write(path, res, "w");
                    localCounter++;
                  }
                } else {
                  ns.write(path, res, "w");
                  localCounter++;
                }
              });
        } else if (file.type === "dir") {
            let tempCounter = await readDirectory(ns, file.url, noClobber);
            localCounter += tempCounter;
        }
    }));
    return localCounter;
}

export async function main (ns) {

    let flags = ns.flags([
      ["username", "brubsby"],
      ["repo", "bitburner-scripts"],
      ["no-clobber", false],
    ]);

    let counter = await readDirectory(ns, `https://api.github.com/repos/${
      flags.username}/${flags.repo}/contents`/*, flags["no-clobber"]*/);
    ns.tprint(`${counter} files updated`);
}
