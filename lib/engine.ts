import { supabase, CONFIG, INVESTORS } from './config';

// 1. 定义接口解决类型报错
interface MarketData {
  price: number;
  open: number; 
  changePercent: number;
}

interface Position {
  investor_id: string;
  symbol: string;
  shares: number;
  last_buy_price: number;
  avg_price: number;
}

// 获取行情
async function getMarketPrices(): Promise<Record<string, MarketData>> {
  const symbols = CONFIG.SYMBOLS.map(s => s.toLowerCase()).join(',');
  const url = `https://hq.sinajs.cn/list=${symbols.split(',').map(s => `gb_${s}`).join(',')}`;
  
  try {
    const res = await fetch(url, { headers: { 'Referer': 'https://finance.sina.com.cn/' } });
    const text = await res.text();
    const marketData: Record<string, MarketData> = {};
    
    text.split('\n').forEach((line: string) => {
      const match = line.match(/gb_([a-z]+)="([^"]+)"/);
      if (match) {
        const symbol = match[1].toUpperCase();
        const parts = match[2].split(',');
        const price = parseFloat(parts[1]);
        const changePercent = parseFloat(parts[3]) / 100;
        if (!isNaN(price) && price > 0) {
          marketData[symbol] = { price, changePercent, open: price / (1 + changePercent) };
        }
      }
    });
    return marketData;
  } catch (e) {
    return {};
  }
}

// 交易执行逻辑：修正数学计算，保证资产对齐
async function executeTrade(
  investorId: string,
  symbol: string,
  action: 'BUY' | 'SELL' | 'SELL_ALL',
  amountUSD: number, 
  price: number,
  currentShares: number,
  currentCash: number,
  reason: string
): Promise<{ newCash: number, newShares: number } | null> {
  let tradeShares = 0;
  let tradeAmount = 0;

  if (action === 'BUY') {
    if (currentCash < amountUSD) return null;
    tradeShares = amountUSD / price;
    tradeAmount = tradeShares * price; // ⚠️ 关键：按实际份额扣款
  } else if (action === 'SELL' || action === 'SELL_ALL') {
    tradeShares = action === 'SELL_ALL' ? currentShares : Math.min(amountUSD / price, currentShares);
    tradeAmount = tradeShares * price;
  }

  if (tradeAmount < 1) return null;

  const newCash = action === 'BUY' ? currentCash - tradeAmount : currentCash + tradeAmount;
  const newShares = action === 'BUY' ? currentShares + tradeShares : currentShares - tradeShares;

  // 1. 记录日志
  await supabase.from('trades').insert({
    investor_id: investorId,
    symbol,
    action: action === 'SELL_ALL' ? 'SELL' : action,
    shares: tradeShares,
    price,
    amount: tradeAmount,
    reason,
    created_at: new Date().toISOString()
  });

  // 2. 更新持仓 (使用 upsert 覆盖)
  if (newShares < 0.0001) {
    await supabase.from('positions').delete().eq('investor_id', investorId).eq('symbol', symbol);
  } else {
    await supabase.from('positions').upsert({
      investor_id: investorId,
      symbol,
      shares: newShares,
      last_buy_price: price, // 关键：更新此价格以触发下次阈值
      updated_at: new Date().toISOString()
    }, { onConflict: 'investor_id,symbol' });
  }

  return { newCash, newShares };
}

export async function runTradingBot() {
  const marketData = await getMarketPrices();
  if (Object.keys(marketData).length === 0) return;

  for (const investor of INVESTORS) {
    const { data: portfolio } = await supabase.from('portfolio').select('*').eq('investor_id', investor.id).single();
    if (!portfolio) continue;

    const { data: positionsRaw } = await supabase.from('positions').select('*').eq('investor_id', investor.id);
    let currentCash = Number(portfolio.cash_balance);
    const posMap = new Map<string, Position>();
    
    // 🔧 修复 p: any 报错
    (positionsRaw as Position[] || []).forEach((p: Position) => posMap.set(p.symbol, p));

    for (const symbol of CONFIG.SYMBOLS) {
      const data = marketData[symbol];
      if (!data) continue;

      const { price } = data;
      const pos = posMap.get(symbol);
      const shares = pos ? pos.shares : 0;
      const lastPrice = pos ? pos.last_buy_price : 0;
      const hasPos = shares > 0;

      // 策略逻辑修复：从状态判断改为阈值判断
      switch (investor.id) {
        case 'leek': 
          if (!hasPos && currentCash >= 50000) {
            const res = await executeTrade(investor.id, symbol, 'BUY', 50000, price, 0, currentCash, '韭菜建仓');
            if (res) currentCash = res.newCash;
          } else if (hasPos) {
            // 只有当价格比上次成交价又涨了 5%，才触发加仓，避免 5 秒一次的重复买入
            if (price > lastPrice * 1.05 && currentCash >= 50000) {
              const res = await executeTrade(investor.id, symbol, 'BUY', 50000, price, shares, currentCash, '追高加仓');
              if (res) currentCash = res.newCash;
            } else if (price < lastPrice * 0.95) {
              const res = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, currentCash, '杀跌离场');
              if (res) currentCash = res.newCash;
            }
          }
          break;
        // 其他投资者逻辑... (以此类推，使用 price 与 lastPrice 比较)
      }
    }

    // 周期结算资产
    let totalEquity = currentCash;
    const { data: finalPos } = await supabase.from('positions').select('*').eq('investor_id', investor.id);
    (finalPos as Position[] || []).forEach((p: Position) => {
      const pPrice = marketData[p.symbol]?.price || p.last_buy_price;
      totalEquity += (p.shares * pPrice);
    });

    await supabase.from('portfolio').update({ 
      cash_balance: currentCash, 
      total_equity: totalEquity,
      updated_at: new Date().toISOString()
    }).eq('investor_id', investor.id);

    await supabase.from('equity_snapshots').insert({
      investor_id: investor.id,
      total_equity: totalEquity,
      cash_balance: currentCash,
      created_at: new Date().toISOString()
    });
  }
}