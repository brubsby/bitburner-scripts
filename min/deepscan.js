let doc=eval("document"),f=["CSEC","avmnite-02h","I.I.I.I","run4theh111z","w0r1d_d43m0n"],
    css=`<style id="scanCSS">.sc{color:#ccc}.sc .s{color:#080;cursor:pointer;text-decoration:underline}.sc .f{color:#088}.sc .r{color:#6f3}.sc .r.f{color:#0ff}.sc .s::before{content:"◉";color:red}.sc .r::before{color:#6f3}</style>`;
export let main=(ns,j)=>{
    let s=["home"],p=[""],r={home:s[0]},
        fName=x=>`<a class="s${f.includes(x)?" f":""}${ns.hasRootAccess(x)?" r":""}">${x}</a>`;
    let conn=x=>{
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
    for(let i=0;i<s.length;i++)for(j of ns.scan(s[i]))if(!s.includes(j))s.push(j),p.push(s[i]),r[j]=r[s[i]]+";connect "+j;
    ns.tprint(`${doc.getElementById("scanCSS")?"":css}<span class="sc new">${showScan()}</span>`);
    doc.querySelectorAll(".sc.new .s").forEach(q=>q.addEventListener('click',conn.bind(null,q.childNodes[0].nodeValue)));
    doc.querySelector(".sc.new").classList.remove("new");
};
