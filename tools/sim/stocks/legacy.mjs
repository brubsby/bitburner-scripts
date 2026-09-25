// A faithful port of the stock.js decision rule that shipped before this
// rewrite (git show ee29130:stock.js), for the comparison in compare.mjs.
//
// Kept exactly, including its quirks, because the point is to measure what
// it would have earned:
//   - reads getForecast AND getVolatility (4S TIX API, both 2.5GB);
//   - expRet = vol * (2f-1) / 2, ranked; values positions at getPrice (not bid);
//   - holds fracH = 20% of the corpus as cash, sells down to it when cash falls
//     below fracL = 10%;
//   - `unpurchasedStocks` is never cleared between loops, so its order is that
//     of the FIRST refresh plus appended duplicates — the swap loop compares
//     held stocks against a stale list;
//   - buy gate numShares*expRet*price*2 > commission, with the `fails` counter
//     that retries the same stock rather than advancing;
//   - loop period 5*1000*2 + 200 ms = 10.2s, so it acts on ~3 ticks in 5.
//
// One thing is NOT kept: `format()` calls Math.sgn, which does not exist in
// JavaScript, so the shipped script threw a TypeError at its first
// ns.print(`Corpus: ...`) and never traded at all. As shipped it earned $0/h;
// the port replaces format() so the RULE can be measured.

const fracL = 0.1;
const fracH = 0.2;
const commission = 100000;
const numCycles = 2;

export class Legacy {
  constructor(mkt) {
    this.stocks = mkt.symbols.map((sym) => ({ sym }));
    this.myStocks = [];
    this.unpurchasedStocks = [];
  }

  refresh(mkt) {
    let corpus = mkt.money;
    this.myStocks.length = 0;
    for (const s of this.stocks) {
      s.price = mkt.price(s.sym);
      s.shares = mkt.position(s.sym)[0];
      s.maxShares = mkt.maxShares(s.sym);
      s.buyPrice = mkt.position(s.sym)[1];
      s.vol = mkt.volatility(s.sym);
      s.prob = 2 * (mkt.forecast(s.sym) - 0.5);
      s.expRet = (s.vol * s.prob) / 2;
      corpus += s.price * s.shares;
    }
    this.stocks.sort((a, b) => b.expRet - a.expRet);
    for (const s of this.stocks) {
      if (s.shares > 0) this.myStocks.push(s);
      if (s.shares == 0) this.unpurchasedStocks.push(s);
    }
    return corpus;
  }

  step(mkt) {
    const { myStocks, unpurchasedStocks, stocks } = this;
    let corpus = this.refresh(mkt);
    let myIndex = myStocks.length - 1;
    let unpurchasedIndex = 0;
    let moneyToFind = -(mkt.money - fracH * corpus);
    while (myIndex >= 0 && unpurchasedIndex < unpurchasedStocks.length) {
      if (myStocks[myIndex].expRet < 0) {
        mkt.sell(myStocks[myIndex].sym, myStocks[myIndex].shares);
        corpus -= commission;
        myIndex--;
      } else if (myStocks[myIndex].expRet < unpurchasedStocks[unpurchasedIndex].expRet) {
        moneyToFind += unpurchasedStocks[unpurchasedIndex].maxShares * unpurchasedStocks[unpurchasedIndex].price + commission;
        unpurchasedIndex++;
        while (moneyToFind > 0) {
          const sharesToSell = Math.min(myStocks[myIndex].maxShares, moneyToFind / myStocks[myIndex].price);
          mkt.sell(myStocks[myIndex].sym, sharesToSell);
          moneyToFind -= sharesToSell * myStocks[myIndex].price;
          corpus -= commission;
          myIndex--;
          if (myIndex < 0 || myStocks[myIndex].expRet >= unpurchasedStocks[unpurchasedIndex - 1].expRet) break;
        }
      } else {
        break;
      }
    }
    for (let i = myStocks.length - 1; i >= 0; i--) {
      if (mkt.money < fracL * corpus) {
        const cashNeeded = corpus * fracH - mkt.money + commission;
        const numShares = Math.floor(cashNeeded / myStocks[i].price);
        mkt.sell(myStocks[i].sym, numShares);
        corpus -= commission;
      }
    }
    let cashToSpend = mkt.money - fracH * corpus;
    let stockIndex = 0;
    let fails = 0;
    while (cashToSpend > 0 && stockIndex < stocks.length) {
      let numShares = Math.floor((cashToSpend - commission) / stocks[stockIndex].price);
      numShares = Math.min(numShares, stocks[stockIndex].maxShares - stocks[stockIndex].shares);
      if (numShares <= 0) {
        stockIndex++;
        continue;
      }
      if (numShares * stocks[stockIndex].expRet * stocks[stockIndex].price * numCycles > commission) {
        mkt.buy(stocks[stockIndex].sym, numShares);
        cashToSpend -= stocks[stockIndex].price * numShares + commission;
        stockIndex++;
      } else {
        if (fails > 3) break;
        fails++;
      }
    }
  }
}
