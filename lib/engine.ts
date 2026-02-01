// lib/engine.ts
import { supabase, CONFIG, INVESTORS } from './config';
import { STRATEGIES } from './strategies';
import { MarketData, Position, TradeDecision } from './type';

/**
 * 获取最近7天的高低点 (用于兵王策略)
 */
async function getWeeklyStats(symbol: string): Promise<{ high: number; low: number } | null> {
  try {
    const { data } = await supabase
      .from('market_candles')
      .select('high, low')
      .eq('symbol', symbol)
      .order('date', { ascending: false })
      .limit(7);

    if (!data || data.length === 0) return null;

    let maxHigh = -Infinity;
    let minLow = Infinity;
    data.forEach(candle => {
      if (candle.high > maxHigh) maxHigh = candle.high;
      if (candle.low < minLow) minLow = candle.low;
    });
    return { high: maxHigh, low: minLow };
  } catch (e) {
    return null;
  }
}

/**
 * 获取实时行情 (Sina API)
 */
async function getMarketPrices(): Promise<Record<string, MarketData>> {
  const symbols = CONFIG.SYMBOLS.map(s => s.toLowerCase()).join(',');
  
  // 🔧 修复点：将时间戳 t 参数移到 list 之前，防止新浪解析器将 &t 误认为是股票代码的一部分
  const url = `https://hq.sinajs.cn/t=${Date.now()}&list=${symbols.split(',').map(s => `gb_${s}`).join(',')}`;
  
  try {
    const res = await fetch(url, { headers: { 'Referer': 'https://finance.sina.com.cn/' }, cache: 'no-store' });
    const text = await res.text();
    const marketData: Record<string, MarketData> = {};
    
    text.split('\n').forEach((line) => {
      // 兼容大小写的正则
      const match = line.match(/gb_(\w+)="([^"]+)"/);
      if (match) {
        const symbol = match[1].toUpperCase();
        const parts = match[2].split(',');
        const price = parseFloat(parts[1]);
        
        // 调试日志（确认修复后可注释掉）
        // console.log(`🔍 解析: ${symbol} = ${price}`);

        if (!isNaN(price) && price > 0) {
          marketData[symbol] = { 
            symbol, 
            price, 
            changePercent: parseFloat(parts[3]) / 100, 
            open: parseFloat(parts[5]) || price
          };
        }
      }
    });
    return marketData;
  } catch (e: any) {
    console.error(`❌ 行情接口调用失败: ${e.message}`);
    return {};
  }
}
/**
 * 执行交易 (更新 positions 和 trades)
 */
async function executeUpdate(id: string, sym: string, action: 'BUY' | 'SELL', shares: number, price: number, amount: number, reason: string) {
  // 1. 记录交易
  await supabase.from('trades').insert({
    investor_id: id, symbol: sym, action, shares, price, amount, reason, created_at: new Date().toISOString()
  });

  // 2. 更新持仓
  const { data: currentPos } = await supabase.from('positions').select('*').eq('investor_id', id).eq('symbol', sym).single();
  let newShares = currentPos ? currentPos.shares : 0;
  let newAvgPrice = currentPos ? currentPos.avg_price : 0;

  if (action === 'BUY') {
    const oldCost = (currentPos?.shares || 0) * (currentPos?.avg_price || 0);
    newShares += shares;
    newAvgPrice = newShares > 0 ? (oldCost + amount) / newShares : price;
  } else {
    newShares -= shares;
  }

  // 防止浮点数误差
  if (newShares <= 0.001) {
    await supabase.from('positions').delete().eq('investor_id', id).eq('symbol', sym);
  } else {
    await supabase.from('positions').upsert({
      investor_id: id, 
      symbol: sym, 
      shares: newShares, 
      avg_price: newAvgPrice,
      last_buy_price: action === 'BUY' ? price : (currentPos?.last_buy_price || price),
      last_action_price: price, 
      updated_at: new Date().toISOString()
    }, { onConflict: 'investor_id,symbol' });
  }
}

/**
 * 最终结算
 */
async function finalizePortfolio(investorId: string, finalCash: number, marketMap: Record<string, MarketData>) {
  const { data: positions } = await supabase.from('positions').select('*').eq('investor_id', investorId);
  
  let marketValue = 0;
  if (positions) {
    positions.forEach((p: any) => {
      const price = marketMap[p.symbol]?.price || p.last_action_price;
      marketValue += (p.shares * price);
    });
  }
  const totalEquity = finalCash + marketValue;

  const { error } = await supabase.from('portfolio').update({
    cash_balance: finalCash,
    total_equity: totalEquity,
    updated_at: new Date().toISOString()
  }).eq('investor_id', investorId);

  if (error) {
    console.error(`   ❌ [${investorId}] 资产更新失败: ${error.message}`);
    return; 
  }

  await supabase.from('equity_snapshots').insert({
    investor_id: investorId, 
    total_equity: totalEquity, 
    cash_balance: finalCash, 
    created_at: new Date().toISOString()
  });
  
  console.log(`   💰 [${investorId}] 结算完成: 现金 $${Math.round(finalCash).toLocaleString()} | 总值 $${Math.round(totalEquity).toLocaleString()}`);
}

// ================= 主逻辑 =================

export async function runTradingBot() {
  const marketMap = await getMarketPrices();
  if (Object.keys(marketMap).length === 0) return;

  const todayStr = new Date().toDateString();

  // 1. 获取周线数据 (COIN 的数据会自动被同步和读取)
  const weeklyStatsMap: Record<string, { high: number; low: number }> = {};
  await Promise.all(CONFIG.SYMBOLS.map(async (sym) => {
    const stats = await getWeeklyStats(sym);
    if (stats) weeklyStatsMap[sym] = stats;
  }));

  // 2. 遍历投资者
  for (const investor of INVESTORS) {
    console.log(`👤 分析: ${investor.name}`);

    let { data: portfolio } = await supabase.from('portfolio').select('*').eq('investor_id', investor.id).single();
    if (!portfolio) {
         const { data } = await supabase.from('portfolio').insert({
            investor_id: investor.id, 
            cash_balance: CONFIG.INITIAL_CAPITAL, 
            total_equity: CONFIG.INITIAL_CAPITAL, 
            initial_capital: CONFIG.INITIAL_CAPITAL
         }).select().single();
         portfolio = data;
    }

    const { data: positions } = await supabase.from('positions').select('*').eq('investor_id', investor.id);
    const posMap = new Map<string, any>();
    positions?.forEach((p) => posMap.set(p.symbol, p));

    let currentCash = Number(portfolio.cash_balance);
    
    let estimatedEquity = currentCash;
    posMap.forEach(p => { 
        estimatedEquity += p.shares * (marketMap[p.symbol]?.price || p.last_action_price); 
    });

    // 3. 遍历代码 (现在包含 COIN)
    for (const symbol of CONFIG.SYMBOLS) {
      const market = marketMap[symbol];
      if (!market) continue;

      const pos = posMap.get(symbol) || null;
      const isTradedToday = pos ? new Date(pos.updated_at).toDateString() === todayStr : false;

      const strategy = STRATEGIES[investor.id];
      if (!strategy) continue;

      const params = {
        symbol, 
        price: market.price, 
        cash: currentCash, 
        position: pos,
        isTradedToday, 
        totalEquity: estimatedEquity, 
        marketData: market,
        weeklyHigh: weeklyStatsMap[symbol]?.high, 
        weeklyLow: weeklyStatsMap[symbol]?.low
      };

      const decision: TradeDecision = strategy(params as any);
      
      if (decision.action === 'HOLD') continue;

      if (decision.action === 'BUY' && decision.amountUSD) {
        if (currentCash >= decision.amountUSD) {
          const shares = decision.amountUSD / market.price;
          currentCash -= decision.amountUSD;
          await executeUpdate(investor.id, symbol, 'BUY', shares, market.price, decision.amountUSD, decision.reason);
          console.log(`   ✅ 买入 ${symbol}: $${decision.amountUSD.toFixed(0)} (${decision.reason})`);
        }
      } 
      else if (decision.action === 'SELL' && pos) {
        let sharesToSell = decision.shares || (decision.amountUSD ? decision.amountUSD / market.price : 0);
        sharesToSell = Math.min(sharesToSell, pos.shares);
        
        if (sharesToSell > 0) {
          const amountGet = sharesToSell * market.price;
          currentCash += amountGet;
          await executeUpdate(investor.id, symbol, 'SELL', sharesToSell, market.price, amountGet, decision.reason);
          console.log(`   ✅ 卖出 ${symbol}: ${sharesToSell.toFixed(2)} 股 (${decision.reason})`);
        }
      }
    }
    await finalizePortfolio(investor.id, currentCash, marketMap);
  }
}