import { supabase, CONFIG, INVESTORS } from './config';

interface MarketData {
  price: number;
  open: number; 
  changePercent: number;
}

interface Portfolio {
  investor_id: string;
  cash_balance: number;
  total_equity: number;
  peak_equity: number;
  initial_capital: number;
}

interface Position {
  id: string;
  investor_id: string;
  symbol: string;
  shares: number;
  avg_price: number;
  last_buy_price: number; 
}

// ----------------------------------------------------------------------
// 🚨 MOCK DATA GENERATOR (兜底模拟数据)
// ----------------------------------------------------------------------
function getMockPrices(): Record<string, MarketData> {
  console.log("⚠️ [Engine] 启用模拟行情数据 (Mock Mode)");
  const mock: Record<string, MarketData> = {};
  
  const basePrices: Record<string, number> = {
    'QQQ': 440, 'GLD': 200, 'SPY': 500, 'NVDA': 800, 'TLT': 95
  };

  CONFIG.SYMBOLS.forEach(sym => {
    const base = basePrices[sym] || 100;
    const changePct = (Math.random() * 0.06) - 0.03; 
    const price = base * (1 + changePct);
    mock[sym] = {
      price: parseFloat(price.toFixed(2)),
      open: base,
      changePercent: changePct
    };
  });
  return mock;
}

// ----------------------------------------------------------------------
// 📡 真实行情获取
// ----------------------------------------------------------------------
async function getMarketPrices(): Promise<Record<string, MarketData>> {
  const symbols = CONFIG.SYMBOLS.map(s => s.toLowerCase()).join(',');
  const url = `https://hq.sinajs.cn/list=${symbols.split(',').map(s => `gb_${s}`).join(',')}`;
  
  try {
    const res = await fetch(url, { 
      headers: { 'Referer': 'https://finance.sina.com.cn/' }, 
      next: { revalidate: 0 } 
    });
    
    if (!res.ok) throw new Error("Network response was not ok");

    const text = await res.text();
    const marketData: Record<string, MarketData> = {};
    
    text.split('\n').forEach(line => {
      const match = line.match(/gb_([a-z]+)="([^"]+)"/);
      if (match) {
        const symbol = match[1].toUpperCase();
        const parts = match[2].split(',');
        const price = parseFloat(parts[1]);
        const changePercent = parseFloat(parts[3]) / 100;
        const open = price / (1 + changePercent);

        if (!isNaN(price) && price > 0) {
          marketData[symbol] = { price, changePercent, open };
        }
      }
    });
    
    if (Object.keys(marketData).length === 0) return getMockPrices();
    return marketData;

  } catch (e) {
    console.warn("❌ [Engine] 获取行情失败，切换到 Mock:", e);
    return getMockPrices();
  }
}

// ----------------------------------------------------------------------
// ⚡ 交易执行器 (返回更新后的现金余额)
// ----------------------------------------------------------------------
async function executeTrade(
  investorId: string,
  symbol: string,
  action: 'BUY' | 'SELL' | 'SELL_ALL',
  amountUSD: number, 
  price: number,
  shares: number,
  reason: string,
  cash: number
): Promise<number | null> { // 👈 修改：返回 number | null
  let tradeShares = 0;
  let tradeAmount = 0;

  if (action === 'BUY') {
    if (cash < amountUSD) return null; // 资金不足
    tradeShares = amountUSD / price;
    tradeAmount = amountUSD;
  } else if (action === 'SELL') {
    tradeShares = amountUSD / price;
    if (tradeShares > shares) tradeShares = shares; 
    tradeAmount = tradeShares * price;
  } else if (action === 'SELL_ALL') {
    tradeShares = shares;
    tradeAmount = shares * price;
  }

  if (tradeAmount < 10 || tradeShares <= 0) return null; 

  console.log(`⚡ [${investorId}] ${action} ${symbol}: ${reason} | $${tradeAmount.toFixed(0)}`);

  // 1. 记录交易
  await supabase.from('trades').insert({
    investor_id: investorId,
    symbol,
    action: action === 'SELL_ALL' ? 'SELL' : action,
    shares: tradeShares,
    price: price,
    amount: tradeAmount,
    reason,
    created_at: new Date().toISOString()
  });

  // 2. 更新现金
  const newCash = action === 'BUY' ? cash - tradeAmount : cash + tradeAmount;
  await supabase.from('portfolio').update({ cash_balance: newCash }).eq('investor_id', investorId);

  // 3. 更新持仓
  const { data: oldPos } = await supabase.from('positions')
    .select('*')
    .eq('investor_id', investorId)
    .eq('symbol', symbol)
    .maybeSingle();

  let finalShares = oldPos ? Number(oldPos.shares) : 0;
  let finalAvgPrice = oldPos ? Number(oldPos.avg_price) : 0;

  if (action === 'BUY') {
    const oldCost = finalShares * finalAvgPrice;
    finalShares += tradeShares;
    finalAvgPrice = (oldCost + tradeAmount) / finalShares;
    
    await supabase.from('positions').upsert({
      investor_id: investorId,
      symbol,
      shares: finalShares,
      avg_price: finalAvgPrice,
      last_buy_price: price, 
      created_at: oldPos ? oldPos.created_at : new Date().toISOString()
    }, { onConflict: 'investor_id,symbol' });
  } else {
    finalShares -= tradeShares;
    if (finalShares < 0.001) {
        await supabase.from('positions').delete().eq('investor_id', investorId).eq('symbol', symbol);
    } else {
        await supabase.from('positions').update({ shares: finalShares }).eq('investor_id', investorId).eq('symbol', symbol);
    }
  }
  
  return newCash; // 👈 返回最新现金
}

// ----------------------------------------------------------------------
// 🚀 核心策略循环
// ----------------------------------------------------------------------
export async function runTradingBot() {
  const marketData = await getMarketPrices();

  for (const investor of INVESTORS) {
    const investorId = investor.id;

    // 获取数据
    const { data: portfolioRaw } = await supabase.from('portfolio').select('*').eq('investor_id', investorId).single();
    if (!portfolioRaw) continue; 
    const portfolio = portfolioRaw as Portfolio;

    const { data: positionsRaw } = await supabase.from('positions').select('*').eq('investor_id', investorId);
    const positions = (positionsRaw as Position[]) || [];
    const posMap = new Map(positions.map(p => [p.symbol, p]));

    let currentCash = Number(portfolio.cash_balance);
    const peakEquity = Number(portfolio.peak_equity);
    
    // 🛠️ 关键：定义局部 trade 函数，自动更新 currentCash
    const trade = async (symbol: string, action: 'BUY' | 'SELL' | 'SELL_ALL', amount: number, price: number, shares: number, reason: string) => {
        const newCash = await executeTrade(investorId, symbol, action, amount, price, shares, reason, currentCash);
        if (newCash !== null) {
            currentCash = newCash; // 👈 实时更新内存中的钱！
        }
    };

    // 计算当前动态总权益
    let currentEquity = currentCash;
    positions.forEach(p => {
        const price = marketData[p.symbol]?.price || p.last_buy_price || 0;
        currentEquity += (Number(p.shares) * price);
    });

    if (currentEquity > peakEquity) {
        await supabase.from('portfolio').update({ peak_equity: currentEquity }).eq('investor_id', investorId);
    }
    const drawdown = peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0;

    // 执行策略
    for (const symbol of CONFIG.SYMBOLS) {
      const data = marketData[symbol];
      if (!data) continue;

      const { price, changePercent } = data;
      const pos = posMap.get(symbol);
      const hasPos = pos && pos.shares > 0;
      const shares = hasPos ? Number(pos.shares) : 0;
      const lastBuyPrice = hasPos ? Number(pos.last_buy_price) : 0; 
      const avgPrice = hasPos ? Number(pos.avg_price) : 0; 

      // 替换所有的 executeTrade 为 trade(...)
      switch (investorId) {
        case 'leek': 
            if (!hasPos && currentCash >= 50000) await trade(symbol, 'BUY', 50000, price, 0, '韭菜建仓');
            else {
                if (changePercent > 0.05) await trade(symbol, 'BUY', 50000, price, 0, `追高(+${(changePercent*100).toFixed(1)}%)`);
                else if (changePercent < -0.05) await trade(symbol, 'SELL', 50000, price, shares, `杀跌(${ (changePercent*100).toFixed(1) }%)`);
            }
            break;

        case 'gambler': 
            if (!hasPos && currentCash >= 10000) await trade(symbol, 'BUY', 10000, price, 0, '首注');
            else {
                if (price < lastBuyPrice * 0.90) {
                    const betAmount = shares * price; 
                    if (currentCash >= betAmount) await trade(symbol, 'BUY', betAmount, price, 0, '输了加倍');
                } else if (price > avgPrice * 1.01) await trade(symbol, 'SELL_ALL', 0, price, shares, '赢钱离场');
            }
            break;

        case 'mom': 
            if (!hasPos && currentCash >= 200000) await trade(symbol, 'BUY', 200000, price, 0, '满仓存钱');
            else {
                if (price > lastBuyPrice * 1.20) await trade(symbol, 'SELL', (shares * price) * 0.20, price, shares, '止盈补贴');
                else if (price < lastBuyPrice * 0.95) await trade(symbol, 'SELL_ALL', 0, price, shares, '亏损离场');
            }
            break;

        case 'dog': 
            const safeCashLine = 800000;
            if (!hasPos && (currentCash - safeCashLine) >= 40000) await trade(symbol, 'BUY', 40000, price, 0, '猥琐建仓');
            else {
                if (price > lastBuyPrice * 1.05) await trade(symbol, 'SELL', (shares * price) * 0.50, price, shares, '赚点狗粮');
                else if (price < lastBuyPrice * 0.98) await trade(symbol, 'SELL_ALL', 0, price, shares, '苗头不对');
            }
            break;

        case 'xiaoqing': 
            if (!hasPos && currentCash >= 100000) await trade(symbol, 'BUY', 100000, price, 0, '痴情建仓');
            else if (price < lastBuyPrice * 0.85 && currentCash >= 50000) await trade(symbol, 'BUY', 50000, price, 0, '深跌补仓');
            break;
            
        case 'soldier': 
            if (drawdown > 0.10) {
                if (hasPos && price > lastBuyPrice * 1.02) await trade(symbol, 'SELL', (shares * price) * 0.20, price, shares, '战术撤退(熔断中)');
                break; 
            }
            if (!hasPos && currentCash >= 100000) await trade(symbol, 'BUY', 100000, price, 0, '战术建仓');
            else {
                if (price < lastBuyPrice * 0.98 && currentCash >= 10000) await trade(symbol, 'BUY', 10000, price, 0, '梯队补给');
                else if (price > lastBuyPrice * 1.02) await trade(symbol, 'SELL', (shares * price) * 0.20, price, shares, '收缩战线');
            }
            break;

        case 'zen':
            if (!hasPos) {
                if (currentCash >= 100000) await trade(symbol, 'BUY', 100000, price, 0, '缘分建仓');
            } else {
                const isBuy = Math.random() > 0.5;
                if (isBuy && currentCash >= 10000) await trade(symbol, 'BUY', 10000, price, 0, '随缘买入');
                else if (!isBuy) {
                    const sellShares = 10000 / price;
                    if (shares >= sellShares) await trade(symbol, 'SELL', 10000, price, shares, '随缘卖出');
                    else if (shares > 0) await trade(symbol, 'SELL_ALL', 0, price, shares, '尘归尘');
                }
            }
            break;
      }
    }

    // 3. 结算更新
    await supabase.from('portfolio').update({ total_equity: currentEquity }).eq('investor_id', investorId);
    await supabase.from('equity_snapshots').insert({
        investor_id: investorId,
        total_equity: currentEquity,
        cash_balance: currentCash,
        created_at: new Date().toISOString()
    });
    
    console.log(`💰 [${investorId}] 结算 | 现金: ${currentCash.toFixed(0)} | 总权益: ${currentEquity.toFixed(0)}`);
  }
}