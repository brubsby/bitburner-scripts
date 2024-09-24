let doc=eval("document"),f=["CSEC","avmnite-02h","I.I.I.I","run4theh111z","w0r1d_d43m0n"],
    css=`<style id="scanCSS">.sc{color:#ccc}.sc .tooltip{color:#080;cursor:pointer;text-decoration:underline}.sc .f{color:#804}.sc .r{color:lime}.sc .r.f{color:#f08}.sc .o{color:#fff}.sc .tooltip::before{content:"◉";color:red}.sc .r::before{color:lime}.sc .c::after{content:"⋐";color:#088}.sc .c.r::after{color:cyan}</style>`;
export let main=async ns=>{
	let s=["home"],p=[""],r={home:s[0]};
    for(let i=0;i<s.length;i++)for(let j of ns.scan(s[i]))if(!s.includes(j))s.push(j),p.push(s[i]),r[j]=r[s[i]]+";connect "+j;
    let fName=x=>`<a class="tooltip${f.includes(x)?" f":""}${ns.hasRootAccess(x)?" r":""}${(ns.ls(x,".cct").length>0)?" c":""}${(ns.getPurchasedServers().includes(x)||x=="home"||x.includes("hacknet")?" o":"")}">${x}<span class="tooltiptext">${x}\n\nHack Level Req: ${ns.getServerRequiredHackingLevel(x)}\nMoney: ${ns.nFormat(ns.getServerMoneyAvailable(x),'$0.000a')} / ${ns.nFormat(ns.getServerMaxMoney(x),'$0.000a')}\nSecurity: ${ns.getServerSecurityLevel(x)} / Min ${Math.round(ns.getServerMinSecurityLevel(x)*100)/100}\nGrowth: ${ns.getServerGrowth(x)}</span></a>`;
    let connectToServer=x=>{
        doc.getElementById('terminal-input-text-box').value=r[x];
        doc.dispatchEvent(new KeyboardEvent('keydown',{keyCode:13}));
    };
    let showScan=(x=s[0],inPre=["\n"],output=inPre.join("")+fName(x))=>{
        for (let i=0;i<s.length;i++){
            if(p[i]!=x) continue;
            let pre=inPre.slice();
            pre[pre.length-1]=pre[pre.push(p.slice(i+1).includes(p[i])?"├>":"└>")-2].replace("├>","│ ").replace("└>","  ");
            output+=showScan(s[i],pre);
        }
		return output;
    };
    ns.tprint(`${doc.getElementById("scanCSS")?"":css}<span class="sc">${showScan()}</span>`);
    doc.querySelectorAll(".sc .tooltip").forEach(q=>q.addEventListener('click',connectToServer.bind(null,q.childNodes[0].nodeValue)));
};
