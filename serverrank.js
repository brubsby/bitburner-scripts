function compareMoneyRateColumn(a, b) {
    if (a[0] == "Name"){
        return 0;
    }
    if (a[13] === b[13]) {
        return 0;
    }
    else {
        return (a[13] > b[13]) ? -1 : 1;
    }
}
function ServerTable(ns){
    var servers = ["home"];
    var notRooted = [[],[]];
    var ServerDataList = [["Name","HackLevel","Ports","ram","Sec","MinSec","Money","MaxMoney","GrowRate","BaseTime","Hack%","MoneyPerHack","AvgMoneyPerHack","AvgMoneyRate","HasRoot"]];
    var myMult = ns.getHackingMultipliers();//chance speed money growth
    var myHackLevel = ns.getHackingLevel();
    var rootList = [];


    for (let i = 0; i < servers.length; ++i) {
        var hostname = servers[i];
        var srvReqHackLevel=ns.getServerRequiredHackingLevel(hostname);
        var srvMinSec=ns.getServerMinSecurityLevel(hostname);
        var srvMaxMoney=ns.getServerMaxMoney(hostname);
        var srvBaseTime=((2.5 * srvReqHackLevel * srvMinSec + 500) / (myHackLevel + 50)) / myMult.speed;
        var srvHackSuccessChance=Math.min(Math.max((((1.75 * myHackLevel) - srvReqHackLevel)/(1.75 * myHackLevel))*((100 - srvMinSec)/100)*(myMult.chance),0),1);
        var srvMoneyPerHack=Math.max(srvMaxMoney * ((100 - srvMinSec / 100)*((myHackLevel - (srvReqHackLevel - 1)) / myHackLevel) * (myMult.money) / 24000),0);
        ServerDataList.push([hostname,
            srvReqHackLevel,
            ns.getServerNumPortsRequired(hostname),
            ns.getServerMaxRam(hostname),
            Math.round(ns.getServerSecurityLevel(hostname)*10)/10,
            srvMinSec,
            Math.round(ns.getServerMoneyAvailable(hostname)),
            Math.round(srvMaxMoney),
            ns.getServerGrowth(hostname),
            Math.round(srvBaseTime),
            Math.round(srvHackSuccessChance * 100),
            Math.round(srvMoneyPerHack),
            Math.round(srvMoneyPerHack * srvHackSuccessChance),
            Math.round(srvMoneyPerHack * srvHackSuccessChance / srvBaseTime),
            ns.hasRootAccess(hostname)
            ]);

        var newScan = ns.scan(hostname);
        for (let j = 0; j < newScan.length; j++) {
            if (servers.indexOf(newScan[j]) == -1) {
                servers.push(newScan[j]);
            }
        }
    }
    ServerDataList.sort(compareMoneyRateColumn);
    var outputHTML='<table style="white-space:nowrap; text-align: center; border: 1px solid white; border-left: 1px solid white"><thead><tr>';
    for(let i in ServerDataList[0]){
        outputHTML+="<th>" + ServerDataList[0][i] + "</th>";
    }
    outputHTML+="</tr></thead><tbody>";
    //warp the next part in an iterator going through first 10 servers
    for(let i=1;i<=11;i++){
        outputHTML+="<tr>";
        for(let j in ServerDataList[i]){
            outputHTML+="<td>" + ServerDataList[i][j].toLocaleString() + "</td>";
        }
        outputHTML+="</tr>";
    }
    outputHTML+="</tbody></table>";
    return outputHTML;
}




let doc = eval("document");
let u = doc.getElementById("unclickable");
function createWindow(prefix,title,width,mainContent){
    if (u.style.display == "none"){
        u.style = "position:absolute;left:0px;top:0px;height:100vh;width:100vw;display:block;pointer-events:none;";
        u.innerHTML = "";
    }
    u.innerHTML += `<div id="${prefix}-custom-box" style="position:absolute;width:${width}px;left:100px;top:100px;border:1px solid white;background-color:rgba(57, 54, 54, 0.7);z-index:10;"><h1 id="${prefix}-header" style="background-color:#555;color:white;margin:0px 0px;text-align:center;padding:0px 25px;"><div id="${prefix}-dragger" onmousedown="event.preventDefault();X=event.clientX;Y=event.clientY;Left=document.getElementById('${prefix}-custom-box').offsetLeft;Top=document.getElementById('${prefix}-custom-box').offsetTop;document.onmousemove=function(e){Left+=e.clientX-X;Top+=e.clientY-Y;document.getElementById('${prefix}-custom-box').style.left=Left+'px';document.getElementById('${prefix}-custom-box').style.top=Top+'px';X=e.clientX;Y=e.clientY;};document.onmouseup=function(){document.onmousemove=null;document.onmouseup=null;};" style="pointer-events:auto;position:absolute;left:1px;right:1px;top:1px;height:20px;cursor:move;"></div>${title}<span onclick="document.getElementById('${prefix}-custom-box').remove();" style="position:absolute;right:6px;height:20px;margin-top:3px;cursor:pointer;pointer-events:auto;">✕</span></h1>${mainContent}</div>`;
}
export async function main(ns) {
    let prefix = ns.args[0] || "ServerView-prefix", //This needs to be unique for every window, you can make multiple test windows by using arguments.
        title = `Top 10 Server Statistics`,
        width = "100%",
        mainContent = `<p><span id="${prefix}-Table"></span> `;

    createWindow(prefix,title,width,mainContent);

    while(doc.body.contains(doc.getElementById(`${prefix}-custom-box`))){

        doc.getElementById(`${prefix}-Table`).innerHTML = ServerTable(ns);

        //Edge detection will only function if this script continues running.
        let viewport = u.getBoundingClientRect();
        let coords = doc.getElementById(`${prefix}-custom-box`).getBoundingClientRect();
        if (coords.top < 0) doc.getElementById(`${prefix}-custom-box`).style.top = "0px";
        if (coords.left < 0) doc.getElementById(`${prefix}-custom-box`).style.left = "0px";
        if (coords.right > viewport.width) doc.getElementById(`${prefix}-custom-box`).style.left = (coords.left + viewport.width - coords.right) + "px";
        if (coords.bottom > viewport.height) doc.getElementById(`${prefix}-custom-box`).style.top = (coords.top + viewport.height - coords.bottom) + "px";
        //
        await ns.sleep(1000);
    }
}
