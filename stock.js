//Requires access to the TIX API and the 4S Mkt Data API

let fracL = 0.1;     //Fraction of assets to keep as cash in hand
let fracH = 0.2;
let commission = 100000; //Buy or sell commission
let numCycles = 2;   //Each cycle is 5 seconds

function refresh(ns, stocks, myStocks, unpurchasedStocks){
    let corpus = ns.getServerMoneyAvailable("home");
    myStocks.length = 0;
    for(let i = 0; i < stocks.length; i++){
        let sym = stocks[i].sym;
        stocks[i].price = ns.getStockPrice(sym);
        stocks[i].shares = ns.getStockPosition(sym)[0];
        stocks[i].maxShares = ns.getStockMaxShares(sym);
        stocks[i].buyPrice = ns.getStockPosition(sym)[1];
        stocks[i].vol = ns.getStockVolatility(sym);
        stocks[i].prob = 2 * (ns.getStockForecast(sym) - 0.5);
        stocks[i].expRet = stocks[i].vol * stocks[i].prob / 2;
        corpus += stocks[i].price * stocks[i].shares;
    }
    stocks.sort(function(a, b){return b.expRet - a.expRet});
    for(let i = 0; i < stocks.length; i++) {
      if(stocks[i].shares > 0) myStocks.push(stocks[i]);
      if(stocks[i].shares == 0) unpurchasedStocks.push(stocks[i]);
    }
    return corpus;
}

function buy(ns, stock, numShares){
    let result = ns.buyStock(stock.sym, numShares);
    if (result) {
      ns.print(`Bought ${stock.sym} for $${format(numShares * stock.price)}`);
    } else {
      ns.print(`Failed to buy ${format(numShares)} shares of ${stock.sym} at $${format(stock.price)} for $${format(numShares * stock.price)}`);
    }
}

function sell(ns, stock, numShares){
    let profit = numShares * (stock.price - stock.buyPrice) - 2 * commission;
    let result = ns.sellStock(stock.sym, numShares);
    if (result) {
      ns.print(`Sold ${stock.sym} for profit of $${format(profit)}`);
    } else {
      ns.print(`Failed to sell ${stock.sym} for profit of $${format(profit)}`);
    }

}

function format(num){
    let num2 = num
    num = Math.abs(num);
    let symbols = ["","K","M","B","T","Qa","Qi","Sx","Sp","Oc"];
    let i = 0;
    for(; (num >= 1000) && (i < symbols.length); i++) num /= 1000;

    return ( (Math.sgn(num2) < 0)?"-":"") + num.toFixed(3) + symbols[i];
}


export async function main(ns) {
    //Initialise
    ns.disableLog("ALL");
    try {
        if (!ns.purchase4SMarketData()) {
            throw new Exception()
        }
    } catch (error) {
        ns.tprint("Exiting stock script, market data not purchased and not enough money.")
        ns.exit()
    }
    try {
        if (!ns.purchase4SMarketDataTixApi()) {
            throw new Exception()
        }
    } catch (error) {
        ns.tprint("Exiting stock script, market data tix api not purchased and not enough money.")
        ns.exit()
    }
    let stocks = [];
    let myStocks = [];
    let unpurchasedStocks = [];
    let corpus = 0;
    for(let i = 0; i < ns.getStockSymbols().length; i++)
        stocks.push({sym:ns.getStockSymbols()[i]});

    while(true){
        corpus = refresh(ns, stocks, myStocks, unpurchasedStocks);
        ns.print(`Corpus: $${format(corpus)}`);

        //Sell underperforming shares
        let myIndex = myStocks.length - 1;
        let unpurchasedIndex = 0;
        let moneyToFind = -(ns.getServerMoneyAvailable("home") - (fracH * corpus));

        while (myIndex >= 0 && unpurchasedIndex < unpurchasedStocks.length) {
          if (myStocks[myIndex].expRet < 0) {
            sell(ns, myStocks[myIndex], myStocks[myIndex].shares);
            corpus -= commission;
            myIndex--;
          } else if (myStocks[myIndex].expRet < unpurchasedStocks[unpurchasedIndex].expRet) {
            moneyToFind += unpurchasedStocks[unpurchasedIndex].maxShares * unpurchasedStocks[unpurchasedIndex].price + commission
            unpurchasedIndex++;
            while (moneyToFind > 0) {
              await ns.sleep(100);
              let sharesToSell = Math.min(myStocks[myIndex].maxShares, moneyToFind / myStocks[myIndex].price);
              sell(ns, myStocks[myIndex], sharesToSell);
              moneyToFind -= sharesToSell * myStocks[myIndex].price
              corpus -= commission;
              myIndex--;
              if (myIndex < 0 || myStocks[myIndex].expRet >= unpurchasedStocks[unpurchasedIndex-1].expRet) {
                break;
              }
            }
          } else {
            //All stocks doing good
            break;
          }
        }

        // for (let i = 0; i < myStocks.length; i++){
        //     if(stocks[0].expRet > myStocks[i].expRet){
        //         sell(ns, myStocks[i], myStocks[i].shares);
        //         corpus -= commission;
        //     }
        // }
        //Sell shares if not enough cash in hand
        for (let i = myStocks.length - 1; i >= 0; i--){
            if( ns.getServerMoneyAvailable("home") < (fracL * corpus)){
                let cashNeeded = (corpus * fracH - ns.getServerMoneyAvailable("home") + commission);
                let numShares = Math.floor(cashNeeded/myStocks[i].price);
                sell(ns, myStocks[i], numShares);
                corpus -= commission;
            }
        }

        //Buy shares with cash remaining in hand
        let cashToSpend = ns.getServerMoneyAvailable("home") - (fracH * corpus);
        let stockIndex = 0;
        let fails = 0;
        while (cashToSpend > 0 && stockIndex < stocks.length) {
          let numShares = Math.floor((cashToSpend - commission)/stocks[stockIndex].price);
          numShares = Math.min(numShares, stocks[stockIndex].maxShares - stocks[stockIndex].shares);
//          ns.tprint(`stock: ${JSON.stringify(stocks[stockIndex])} maxShares: ${stocks[stockIndex].maxShares} shares: ${stocks[stockIndex].shares}`);
          if (numShares <= 0) {
            stockIndex++;
            continue;
          }
          if ((numShares * stocks[stockIndex].expRet * stocks[stockIndex].price * numCycles) > commission) {
            buy(ns, stocks[stockIndex], numShares);
            cashToSpend -= stocks[stockIndex].price * numShares + commission;
            stockIndex++;
          } else {
            if (fails > 3) {
              break;
            }
            fails++;
          }
        }

        await ns.sleep(5 * 1000 * numCycles + 200);
    }
}
