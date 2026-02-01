// lib/engine.ts
import { supabase, CONFIG, INVESTORS } from './config';
import { STRATEGIES } from './strategies';
import { MarketData, Position, TradeDecision } from './type';

// Helper 1: 获取最近7天的高低点 (专门服务于 Soldier 兵王策略)
async function getWeeklyStats(symbol: string): Promise<{ high: number; low: number } | null> {
  try {
    const { data } = await supabase
      .from('market_candles')
      .select('high, low')
      .eq('symbol', symbol)
      .order('date', { ascending: false })
      .limit(7); // 取最近7个交易日数据

    if (!data || data.length === 0) return null;

    let maxHigh = -Infinity;
    let minLow = Infinity;

    data.forEach(candle => {
      if (candle.high > maxHigh) maxHigh = candle.high;
      if (candle.low < minLow) minLow = candle.low;
    });

    return { high: maxHigh, low: minLow };
  } catch (e) {
    console.warn(`⚠️ [${symbol}] 获取周线数据失败`);
    return null;
  }
}

// Helper 2: 获取实时行情
async function getMarketPrices(): Promise<Record<string, MarketData>> {
  // 构造 sina 接口参数: gb_qqq,gb_spy...
  const symbols = CONFIG.SYMBOLS.map(s => s.toLowerCase()).join(',');
  const url = `https://hq.sinajs.cn/list=${symbols.split(',').map(s => `gb_${s}`).join(',')}&t=${Date.now()}`;
  
  try {
    const res = await fetch(url, { headers: { 'Referer': 'https://finance.sina.com.cn/' }, cache: 'no-store' });
    const text = await res.text();
    const marketData: Record<string, MarketData> = {};
    
    // 解析新浪美股数据格式: var hq_str_gb_qqq="Name,Price,ChangeDiff,ChangePercent,Date,Time,Open,High,Low,..."
    text.split('\n').forEach((line) => {
      const match = line.match(/gb_([a-z]+)="([^"]+)"/);
      if (match) {
        const symbol = match[1].toUpperCase();
        const parts = match[2].split(',');
        const price = parseFloat(parts[1]);
        
        if (!isNaN(price) && price > 0) {
          marketData[symbol] = { 
            symbol, 
            price, 
            // 新浪返回的是 1.25 代表 1.25%，所以我们要除以 100 变成 0.0125 以便计算
            changePercent: parseFloat(parts[3]) / 100, 
            open: parseFloat(parts[5]) || price
          };
        }
      }
    });
    return marketData;
  } catch (e: any) {
    console.error(`❌ 行情获取失败: ${e.message}`);
    return {};
  }
}

// Helper 3: 执行原子更新 (写数据库)
async function executeUpdate(
  investorId: string, 
  symbol: string, 
  action: 'BUY' | 'SELL', 
  sharesDelta: number, 
  price: number, 
  amountUSD: number, 
  reason: string
) {
  // 1. 写入交易日志
  await supabase.from('trades').insert({
    investor_id: investorId,
    symbol,
    action,
    shares: sharesDelta,
    price,
    amount: amountUSD,
    reason,
    created_at: new Date().toISOString()
  });

  // 2. 查最新的持仓 (Double Check)
  const { data: currentPos } = await supabase.from('positions')
    .select('*')
    .eq('investor_id', investorId)
    .eq('symbol', symbol)
    .single();

  let newShares = currentPos ? currentPos.shares : 0;
  let newAvgPrice = currentPos ? currentPos.avg_price : 0;
  const oldCost = newShares * newAvgPrice;

  if (action === 'BUY') {
    newShares += sharesDelta;
    // 移动加权平均成本
    newAvgPrice = newShares > 0 ? (oldCost + amountUSD) / newShares : price;
  } else {
    newShares -= sharesDelta;
    // 卖出不影响剩余持仓的成本均价
  }

  // 3. 更新或删除持仓
  if (newShares <= 0.01) { // 浮点数容错，小于 0.01 股视为空仓
    await supabase.from('positions').delete().eq('investor_id', investorId).eq('symbol', symbol);
  } else {
    await supabase.from('positions').upsert({
      investor_id: investorId,
      symbol,
      shares: newShares,
      avg_price: newAvgPrice,
      // 只有买入更新 last_buy_price；last_action_price 永远更新
      last_buy_price: action === 'BUY' ? price : (currentPos?.last_buy_price || price),
      last_action_price: price,
      updated_at: new Date().toISOString()
    }, { onConflict: 'investor_id,symbol' });
  }
}

// Helper 4: 最终结算与快照
async function finalizePortfolio(investorId: string, finalCash: number, marketMap: Record<string, MarketData>) {
  // 重新拉取所有持仓计算最新 Equity
  const { data: positions } = await supabase.from('positions').select('*').eq('investor_id', investorId);
  
  let marketValue = 0;
  if (positions) {
    positions.forEach((p: any) => {
      // 优先用实时价格，如果没有则用最后成交价
      const price = marketMap[p.symbol]?.price || p.last_action_price;
      marketValue += (p.shares * price);
    });
  }

  const totalEquity = finalCash + marketValue;

  // 更新 Portfolio
  await supabase.from('portfolio').update({
    cash_balance: finalCash,
    total_equity: totalEquity,
    // updated_at: new Date().toISOString()
  }).eq('investor_id', investorId);

  // 写入快照
  await supabase.from('equity_snapshots').insert({
    investor_id: investorId,
    total_equity: totalEquity,
    cash_balance: finalCash,
    created_at: new Date().toISOString()
  });
  
  // 这里的日志在 daemon 里会被看到
  console.log(`   💰 [${investorId}] 结算完成: 现金 $${Math.round(finalCash).toLocaleString()} | 总值 $${Math.round(totalEquity).toLocaleString()}`);
}

// ================= 主逻辑 =================

export async function runTradingBot() {
  // 1. 获取实时行情
  const marketMap = await getMarketPrices();
  if (Object.keys(marketMap).length === 0) return;

  const todayStr = new Date().toDateString();

  // 2. 预先获取所有标的的周线高低点 (Soldier 策略专用)
  // 为了性能，一次性并发获取所有 Symbol 的统计数据
  const weeklyStatsMap: Record<string, { high: number; low: number }> = {};
  await Promise.all(CONFIG.SYMBOLS.map(async (sym) => {
    const stats = await getWeeklyStats(sym);
    if (stats) weeklyStatsMap[sym] = stats;
  }));

  // 3. 遍历投资者
  for (const investor of INVESTORS) {
    console.log(`👤 分析: ${investor.name}`);

    // 初始化/获取账户
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

    // 获取持仓
    const { data: positions } = await supabase.from('positions').select('*').eq('investor_id', investor.id);
    const posMap = new Map<string, Position>();
    positions?.forEach((p: Position) => posMap.set(p.symbol, p));

    // 内存中的现金（随循环实时变动，避免数据库读写延迟导致透支）
    let currentCash = Number(portfolio.cash_balance);

    // 计算预估总资产（用于 Dog/Soldier 风控判断）
    let estimatedEquity = currentCash;
    posMap.forEach(p => { 
        estimatedEquity += p.shares * (marketMap[p.symbol]?.price || p.last_action_price); 
    });

    // 4. 遍历每一个 Symbol
    for (const symbol of CONFIG.SYMBOLS) {
      const market = marketMap[symbol];
      if (!market) continue;

      const pos = posMap.get(symbol) || null;
      // 检查今日是否已交易 (通过 update_at 判断)
      const isTradedToday = pos ? new Date(pos.updated_at).toDateString() === todayStr : false;

      // 获取策略
      const strategy = STRATEGIES[investor.id];
      if (!strategy) continue;

      // 获取周线数据 (可能为空)
      const weeklyStats = weeklyStatsMap[symbol];

      // ⚠️ 构造完整的策略参数
      const params: any = { 
        symbol,
        price: market.price,
        cash: currentCash,
        position: pos,
        isTradedToday,
        totalEquity: estimatedEquity,
        marketData: market,
        weeklyHigh: weeklyStats?.high, // 传入周高
        weeklyLow: weeklyStats?.low    // 传入周低
      };

      // 执行策略函数
      const decision: TradeDecision = strategy(params);

      if (decision.action === 'HOLD') continue;

      // === 执行买入 ===
      if (decision.action === 'BUY' && decision.amountUSD) {
        if (currentCash >= decision.amountUSD) {
          const shares = decision.amountUSD / market.price;
          // 1. 立即扣减内存现金
          currentCash -= decision.amountUSD;
          // 2. 执行数据库写操作
          await executeUpdate(investor.id, symbol, 'BUY', shares, market.price, decision.amountUSD, decision.reason);
          console.log(`   ✅ 买入 ${symbol}: $${decision.amountUSD.toFixed(0)} (${decision.reason})`);
        } else {
            // console.log(`   ⚠️ [${investor.name}] 资金不足以买入 ${symbol}`);
        }
      } 
      // === 执行卖出 ===
      else if (decision.action === 'SELL' && pos) {
        let sharesToSell = decision.shares || 0;
        
        // 如果策略返回的是金额，则换算成股数
        if (!sharesToSell && decision.amountUSD) {
          sharesToSell = decision.amountUSD / market.price;
        }
        
        // 修正：卖出数量绝不能超过持仓
        sharesToSell = Math.min(sharesToSell, pos.shares);

        if (sharesToSell > 0) {
          const amountGet = sharesToSell * market.price;
          // 1. 立即增加内存现金
          currentCash += amountGet;
          // 2. 执行数据库写操作
          await executeUpdate(investor.id, symbol, 'SELL', sharesToSell, market.price, amountGet, decision.reason);
          console.log(`   ✅ 卖出 ${symbol}: ${sharesToSell.toFixed(2)} 股 (${decision.reason})`);
        }
      }
    } // End Symbol Loop

    // 5. 最终结算更新总资产
    await finalizePortfolio(investor.id, currentCash, marketMap);

  } // End Investor Loop
  // console.log(`✅ 扫描结束。\n`);
}