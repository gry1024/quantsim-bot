import { supabase, CONFIG } from './config';

/**
 * 获取新浪财经实时价格
 */
async function getMarketPrices() {
  const symbols = CONFIG.SYMBOLS.map(s => s.toLowerCase()).join(',');
  const url = `https://hq.sinajs.cn/list=${symbols.split(',').map(s => `gb_${s}`).join(',')}`;
  
  try {
    const res = await fetch(url, { headers: { 'Referer': 'https://finance.sina.com.cn/' }, next: { revalidate: 0 } });
    const text = await res.text();
    const prices: Record<string, number> = {};
    text.split('\n').forEach(line => {
      const match = line.match(/gb_([a-z]+)="([^"]+)"/);
      if (match) {
        const symbol = match[1].toUpperCase();
        const price = parseFloat(match[2].split(',')[1]); 
        if (!isNaN(price) && price > 0) prices[symbol] = price;
      }
    });
    return prices;
  } catch (e) {
    console.error("❌ 获取行情失败:", e);
    return {};
  }
}

/**
 * 核心交易引擎 (Strategy V2)
 */
export async function runTradingBot() {
  // 1. 准备数据
  const { data: portfolio } = await supabase.from('portfolio').select('*').single();
  const { data: positions } = await supabase.from('positions').select('*');
  const posMap = new Map(positions?.map(p => [p.symbol, p]));
  const marketPrices = await getMarketPrices();

  if (!portfolio || Object.keys(marketPrices).length === 0) return;

  let currentCash = portfolio.cash_balance;
  let totalEquity = currentCash; // 先算现金，后面加上市值
  
  // --- 🛑 规则 4: 极速熔断机制 (Circuit Breaker) ---
  // 计算当前总回撤：(初始资金 - 当前净值) / 初始资金
  // 为了更严谨，这里我们简单用 (Initial - Current) 计算硬性亏损回撤
  // 注意：在循环前我们还不知道最新市值，所以得先估算一遍市值
  let tempMarketValue = 0;
  CONFIG.SYMBOLS.forEach(sym => {
    const pos = posMap.get(sym);
    if (pos && marketPrices[sym]) {
      tempMarketValue += pos.quantity * marketPrices[sym];
    }
  });
  const estimatedEquity = currentCash + tempMarketValue;
  const drawdown = (CONFIG.INITIAL_CAPITAL - estimatedEquity) / CONFIG.INITIAL_CAPITAL;

  if (drawdown > CONFIG.MAX_DRAWDOWN_LIMIT) {
    console.warn(`🛑 触发熔断！当前回撤 ${(drawdown*100).toFixed(2)}% > 10%。停止买入。`);
    // 熔断状态下，只允许卖出，不允许买入，或者完全停止。这里我们选择完全停止开新仓。
    // 为了演示，我们直接 return，冻结一切操作，直到人工干预或资金回补。
    return;
  }

  // --- 交易循环 ---
  for (const symbol of CONFIG.SYMBOLS) {
    const price = marketPrices[symbol];
    if (!price) continue;

    const pos = posMap.get(symbol);
    const quantity = pos?.quantity || 0;
    const lastPrice = pos?.last_action_price || price; // 首次默认现价
    const avgCost = pos?.average_cost || 0;

    let action: 'BUY' | 'SELL' | null = null;
    let tradeReason = '';
    let tradeAmountUSD = 0; // 交易金额

    // --- 🟢 规则 1: 初始建仓 (Initial Entry) ---
    // 条件：无持仓，且现金足够 $100,000
    if (quantity === 0) {
      if (currentCash >= CONFIG.INITIAL_ENTRY_AMOUNT) {
        action = 'BUY';
        tradeReason = 'Initial Entry (初始建仓)';
        tradeAmountUSD = CONFIG.INITIAL_ENTRY_AMOUNT; // $100,000
      }
    }

    // --- 🔵 规则 2: 下跌补仓 (Buy the Dip) ---
    // 条件：现价 < 上次成交价 * 0.98 (-2%)
    else if (price < lastPrice * (1 - CONFIG.THRESHOLD_DIP)) {
      if (currentCash >= CONFIG.DIP_ADD_AMOUNT) {
        action = 'BUY';
        tradeReason = `Dip Buy (下跌 ${(1 - price/lastPrice)*100}%)`;
        tradeAmountUSD = CONFIG.DIP_ADD_AMOUNT; // $10,000
      }
    }

    // --- 🟠 规则 3: 动态止盈 (Take Profit) ---
    // 条件：现价 > 上次成交价 * 1.02 (+2%)
    else if (price > lastPrice * (1 + CONFIG.THRESHOLD_PROFIT)) {
      if (quantity > 0) {
        action = 'SELL';
        tradeReason = `Take Profit (上涨 ${(price/lastPrice - 1)*100}%)`;
        // 卖出持仓的 20%
        tradeAmountUSD = (quantity * price) * CONFIG.SELL_RATIO; 
      }
    }

    // --- 执行交易 ---
    if (action && tradeAmountUSD > 10) { // 忽略极小额交易
      const tradeQty = tradeAmountUSD / price;
      
      // 更新内存现金
      if (action === 'BUY') currentCash -= tradeAmountUSD;
      else currentCash += tradeAmountUSD;

      // 1. 写日志
      await supabase.from('trades').insert({
        symbol, action, price, quantity: tradeQty, reason: tradeReason, created_at: new Date().toISOString()
      });

      // 2. 更新持仓
      let newQty = quantity;
      let newAvgCost = avgCost;

      if (action === 'BUY') {
        const totalCost = (quantity * avgCost) + tradeAmountUSD;
        newQty = quantity + tradeQty;
        newAvgCost = totalCost / newQty;
      } else {
        newQty = quantity - tradeQty;
        // 卖出不改变剩余持仓成本
      }
      
      if (newQty < 0.01) newQty = 0; // 清理碎股

      await supabase.from('positions').upsert({
        id: pos?.id, symbol, quantity: newQty, average_cost: newAvgCost, last_action_price: price, updated_at: new Date().toISOString()
      }, { onConflict: 'symbol' });

      console.log(`✅ ${action} ${symbol} | $${tradeAmountUSD.toFixed(0)} | ${tradeReason}`);
    }
  }

  // 5. 最终结算净值
  let finalMarketValue = 0;
  const { data: latestPositions } = await supabase.from('positions').select('*');
  latestPositions?.forEach(p => {
    const pPrice = marketPrices[p.symbol] || p.last_action_price || 0;
    finalMarketValue += (p.quantity * pPrice);
  });
  
  const finalEquity = currentCash + finalMarketValue;

  await supabase.from('portfolio').update({
    cash_balance: currentCash, total_equity: finalEquity, updated_at: new Date().toISOString()
  }).eq('id', portfolio.id);

  // 写入快照
  await supabase.from('equity_snapshots').insert({
    total_equity: finalEquity, cash_balance: currentCash, positions_value: finalMarketValue, created_at: new Date().toISOString()
  });

  console.log(`💰 结算 | 总值: $${finalEquity.toFixed(0)} | 现金: $${currentCash.toFixed(0)}`);
}