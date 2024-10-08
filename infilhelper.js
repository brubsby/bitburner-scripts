import {doc, win} from "/cw/exports.js";
export let
// --- Functions used in window creation - usually in exports file --- //
pxToNum=input=>Number(input.replaceAll("px","")),
slp=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
enableEdgeDetection=async el=>{while(doc.body.contains(el)){
    let cs = win.getComputedStyle(el),
        pos = {l: pxToNum(cs.left), r: pxToNum(cs.right), t: pxToNum(cs.top), b: pxToNum(cs.bottom)};
    el.style.top = (pos.b<0?pos.t+pos.b:pos.t<0?0:pos.t)+"px";
    el.style.left = (pos.r<0?pos.l+pos.r:pos.l<0?0:pos.l)+"px";
    await slp(100);
}},
createWindow=(prefix,title,mainContent)=>{
    let el = doc.createElement('div');
    el.style = `position:absolute;width:min-content;left:100px;top:100px;border:1px solid white;background-color:rgba(57, 54, 54, 0.7);z-index:10;`;
    el.id = `${prefix}-created-window`;
    let elText = `document.getElementById('${el.id}')`;
    el.innerHTML = `<h2 id="${prefix}-header" style="background-color:#555;color:white;margin:0px 0px;text-align:center;padding:0px 25px;"><div id="${prefix}-dragger" onmousedown="event.preventDefault();X=event.clientX;Y=event.clientY;Left=${elText}.offsetLeft;Top=${elText}.offsetTop;document.onmousemove=e=>{Left+=e.clientX-X;Top+=e.clientY-Y;${elText}.style.left=Left+'px';${elText}.style.top=Top+'px';X=e.clientX;Y=e.clientY;};document.onmouseup=()=>{document.onmousemove=null;document.onmouseup=null;};" style="position:absolute;left:1px;right:1px;top:1px;height:18px;cursor:move;"></div>${title.replaceAll(" ","&nbsp;")}<span onclick="${elText}.remove();" style="position:absolute;right:2px;height:20px;margin-top:1px;cursor:pointer">✕</span></h2>${mainContent}`;
    doc.body.appendChild(el);
    enableEdgeDetection(el);
    return el;
},
// --- Main function --- //
main=async ns=>{
    let
// --- Declarations --- //
    infilContainer = doc.querySelector("#infiltration-container"),
    mainContent = `<p style="font-size:1em">Assistance:<input type=checkbox class=checkbox id="infil-assistance-toggle"/></p><p id="infil-helper-content"></p>`,
    infilWin = createWindow("infil","Infiltration Helper Lite",mainContent),
    helperContent = infilWin.querySelector("#infil-helper-content"),
    assistanceToggle = infilWin.querySelector("#infil-assistance-toggle"),
    changeContent=content=>helperContent.innerHTML=content,
    getGameText=()=>{
        try{return infilContainer.children[0].children[1].children[0].children[1].children[0].innerText;}
        catch(e){return null;}
    },
    styleToColorMap=(style)=>{
      if(style.includes("red")) return "red";
      if(style.includes("blue")) return "blue";
      if(style.includes("white")) return "white";
      if(style.includes("rgb(255, 193, 7)")) return "yellow";
    },
    all1IndexOf=(array,value)=> {
      return array.reduce((a, e, i) => (e === value) ? a.concat(i+1) : a, []);
    },
    wireColors=["red","blue","white","yellow"],
    wirePositions=[0,1,2,3,4,5,6,7,8,9],
    questionsToWireMap=(questions,currentWireColors)=>{
      let result = [];
      questions.forEach(question=>{
        wireColors.forEach(color=>{
            if(question.includes(`${color}.`)) {
              result = result.concat(all1IndexOf(currentWireColors[0],color)
                .concat(all1IndexOf(currentWireColors[1],color)));
              }
        });
        wirePositions.forEach(position=>{
          if(question.includes(position.toString())) {
            result.push(position);
          }
        });
      });
      return [...new Set(result)].sort((a,b)=>a-b);
    };
// --- Main Loop --- //

    while(doc.body.contains(infilWin)){
        while(getGameText() && assistanceToggle.checked){
            switch (getGameText()){
                case "Remember all the mines!":
                    let minefield = infilContainer.children[0].children[1].children[0].children[1].innerHTML;
                    changeContent(`Game: Minesweeper<br>${minefield}`);
                    while(getGameText() == "Remember all the mines!") await ns.sleep(100);
                    while(getGameText() == "Mark all the mines!") await ns.sleep(100);
                    break;
                case "Type it backward":
                    let fullTypingChallenge = infilContainer.querySelector(`[style="transform: scaleX(-1);"]`).innerText;
                    changeContent(`Game: Type Backwards<br>${fullTypingChallenge.replaceAll(" ","<br>")}`);
                    while(getGameText() == "Type it backward") await ns.sleep(100);
                    break;
                case "Say something nice about the guard.":
                    let niceWords = ["affectionate","agreeable","bright","charming","creative",
                                     "determined","diplomatic","dynamic","energetic","friendly",
                                     "funny","generous","giving","hardworking","helpful","kind",
                                     "likable","loyal","patient","polite"];
                    while(getGameText() == "Say something nice about the guard."){
                        let isNice = niceWords.includes(infilContainer.querySelectorAll(`h2[style="font-size: 2em;"]`)[1].innerText);
                        changeContent(`Game: Say Something Nice<br>${isNice ? "<strong>A NICE word is selected</strong>" : "<span style='color:red'>A MEAN word is selected</span>"}`);
                        await ns.sleep(50);
                    }
                    break;
                case "Match the symbols!":
                    while(getGameText() == "Match the symbols!") {
                      let targetElement = infilContainer.children[0].children[1].children[0].children[1].children[1]
                        .querySelector("span[style='font-size: 1em; color: blue;']");
                      let targetValue = targetElement.innerText.trim();
                      let nextTargetValue = ((targetElement.parentElement.children[
                        [...targetElement.parentElement.children]
                          .indexOf(targetElement)+1]||{}).innerText||"").trim();
                      let cursorElement = infilContainer.children[0].children[1].children[0].children[1]
                        .querySelector("div span[style='font-size: 2em; color: blue;']");
                      let cursorRowElement = cursorElement.parentElement.parentElement;
                      let cursorValue = cursorElement.innerText.trim();
                      let cursorCoords = [
                        [...cursorRowElement.parentElement.children].indexOf(cursorRowElement)-3,
                        [...cursorElement.parentElement.children].indexOf(cursorElement),
                      ];
                      let symbolsGrid = [...infilContainer.children[0].children[1].children[0].children[1]
                        .querySelectorAll("div")]
                        .slice(0,-1).map(rowhtml =>
                          [...rowhtml.querySelectorAll("span")]
                        .map(cellhtml => cellhtml.textContent.trim()));
                      let gridString = symbolsGrid.map((symbolRow, rowIndex) => symbolRow.map((symbol, colIndex) => {
                        let cell = symbol;
                        if (symbol == nextTargetValue) cell = `<span style='color:orange'>${symbol}</span>`;
                        if (symbol == targetValue) cell = `<span style='color:red'>${symbol}</span>`;
                        if (symbol == targetValue && symbol == nextTargetValue) cell = `<span style='color:pink'>${symbol}</span>`;
                        if (cursorCoords.toString() == [rowIndex, colIndex].toString()) cell = `<span style='color:blue'>${symbol}</span>`;
                        if (symbol == targetValue && cursorCoords.toString() == [rowIndex, colIndex].toString()) cell = `<span style='color:purple'>${symbol}</span>`;
                        return cell;
                      }).join('&nbsp;')).join('<br>');
                      changeContent(`Game: Hexcode Match<br><br>${gridString}`);
                      await ns.sleep(50);
                    }
                    break;
                case "Cut the wires with the following properties! (keyboard 1 to 9)":
                    let wires1 = Array.from(infilContainer.children[0].children[1].children[0].children[1].querySelectorAll("pre")[1].querySelectorAll("span")).map(span => styleToColorMap(span.style.cssText));
                    let wires2 = Array.from(infilContainer.children[0].children[1].children[0].children[1].querySelectorAll("pre")[2].querySelectorAll("span")).map(span => styleToColorMap(span.style.cssText));
                    let questions = Array.from(infilContainer.children[0].children[1].children[0].children[1].querySelectorAll("h3")).map(h3 => h3.innerText);
                    let toCut = questionsToWireMap(questions,[wires1,wires2]);
                    let toCutString = [...Array(wires1.length).keys()].map(index => toCut.includes(index + 1) ? index + 1 : '_').join(' ');
                    changeContent(`Game: Wire Cutting<br>${toCutString}`);
                    while(getGameText() == "Cut the wires with the following properties!") await ns.sleep(100);
                    break;
                case "Enter the Code!":
                    changeContent("Game: Enter Code<br>No assistance to provide.");
                    while(getGameText() == "Enter the Code!") await ns.sleep(100);
                    break;
                case "Close the brackets":
                    let bracketDict = {"(":")","{":"}","[":"<span style='color: red; font-size: 1em;'>]</span>","<":">",};
                    let brackets = infilContainer.children[0].children[1].children[0].children[1].children[1].textContent
                      .trim().split('').reverse().map(bracket => bracketDict[bracket]).join('')
                    changeContent(`Game: Close Brackets<br> <span style='font-size: 3em;'>${brackets}</span>`);
                    while(getGameText() == "Close the brackets") await ns.sleep(100);
                    break;
                case "Slash when his guard is down!":
                    let startTime = performance.now()
                    while(getGameText() == "Slash when his guard is down!") {
                      let ellapsed = performance.now() - startTime;
                      changeContent(`Game: Slash the Guard<br> Window time left: ${ns.nFormat(4750 - ellapsed, "0.00").padStart(8)}`);
                      await ns.sleep(50);
                    }
                    break;
                default:
                    changeContent("Game not recognized");
                    await ns.sleep(100);
                    break;
            }
            await ns.sleep(100);
        }
        changeContent(assistanceToggle.checked ? "No game active" : "Assistance not enabled");
        await ns.sleep(100);
    }
};
