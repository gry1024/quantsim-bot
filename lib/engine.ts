import { supabase, CONFIG } from './config';

// 1. 定义数据接口，彻底解决类型推断失败的问题
interface Portfolio {
  id: number;
  cash_balance: number;
  total_equity: number;
  initial_capital: number;
}

interface Position {
  id: number;
  symbol: string;
  quantity: number;
  average_cost: number;
  last_action_price: number;
  updated_at?: string;
}

/**
 * 获取新浪财经实时价格
 */
async function getMarketPrices(): Promise<Record<string, number>> {
  const symbols = CONFIG.SYMBOLS.map(s => s.toLowerCase()).join(',');
  const url = `https://hq.sinajs.cn/list=${symbols.split(',').map(s => `gb_${s}`).join(',')}`;
  
  try {
    const res = await fetch(url, { 
      headers: { 
        'Referer': 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }, 
      next: { revalidate: 0 } 
    });
    const text = await res.text();
    const prices: Record<string, number> = {};
    
    text.split('\n').forEach(line => {
      const match = line.match(/gb_([a-z]+)="([^"]+)"/);
      if (match) {
        const symbol = match[1].toUpperCase();
        const parts = match[2].split(',');
        const price = parseFloat(parts[1]); 
        if (!isNaN(price) && price > 0) prices[symbol] = price;
      }
    });
    
    console.log(`🔍 [行情] 获取到 ${Object.keys(prices).length} 个标的价格:`, JSON.stringify(prices));
    return prices;
  } catch (e) {
    console.error("❌ 获取行情网络错误:", e);
    return {};
  }
}

/**
 * 核心交易引擎 (Strategy V2 - Debug Mode)
 */
export async function runTradingBot() {
  // 2. 使用泛型显式告知 Supabase 返回的数据结构
  const { data: portfolioData } = await supabase.from('portfolio').select('*').single();
  const portfolio = portfolioData as Portfolio;

  const { data: positionsData } = await supabase.from('positions').select('*');
  const positions = positionsData as Position[];

  // 3. 修复之前的报错：显式指定 p 的类型
  const posMap = new Map(positions?.map((p: Position) => [p.symbol, p]));
  const marketPrices = await getMarketPrices();

  if (!portfolio) {
    console.error("❌ 严重错误: 找不到 Portfolio 数据表！");
    return;
  }
  
  if (Object.keys(marketPrices).length === 0) {
    console.warn("⚠️ 本轮未获取到任何价格，跳过交易。请检查网络或新浪接口。");
    return;
  }

  let currentCash = portfolio.cash_balance;
  
  console.log(`🔍 [账户] 现金: $${currentCash.toFixed(0)} | 持仓数量: ${positions?.length || 0}`);

  // --- 交易循环 ---
  for (const symbol of CONFIG.SYMBOLS) {
    const price = marketPrices[symbol];
    if (!price) {
      console.log(`⚪ ${symbol}: 无价格数据，跳过`);
      continue;
    }

    const pos = posMap.get(symbol);
    const quantity = pos?.quantity || 0;
    const lastPrice = pos?.last_action_price || price; 
    
    let action: 'BUY' | 'SELL' | null = null;
    let tradeReason = '';
    let tradeAmountUSD = 0; 

    // --- 🟢 规则 1: 初始建仓 ---
    if (quantity < 0.001) { 
      if (currentCash >= CONFIG.INITIAL_ENTRY_AMOUNT) {
        action = 'BUY';
        tradeReason = 'Initial Entry (初始建仓)';
        tradeAmountUSD = CONFIG.INITIAL_ENTRY_AMOUNT;
      } else {
        console.log(`⚪ ${symbol}: 触发建仓但现金不足 ($${currentCash.toFixed(0)} < $${CONFIG.INITIAL_ENTRY_AMOUNT})`);
      }
    }

    // --- 🔵 规则 2: 下跌补仓 ---
    else if (price < lastPrice * (1 - CONFIG.THRESHOLD_DIP)) {
      if (currentCash >= CONFIG.DIP_ADD_AMOUNT) {
        action = 'BUY';
        tradeReason = `Dip Buy (跌 ${(1 - price/lastPrice)*100}%)`;
        tradeAmountUSD = CONFIG.DIP_ADD_AMOUNT;
      }
    }

    // --- 🟠 规则 3: 动态止盈 ---
    else if (price > lastPrice * (1 + CONFIG.THRESHOLD_PROFIT)) {
      if (quantity > 0) {
        action = 'SELL';
        tradeReason = `Take Profit (涨 ${(price/lastPrice - 1)*100}%)`;
        tradeAmountUSD = (quantity * price) * CONFIG.SELL_RATIO; 
      }
    }

    // --- 执行交易 ---
    if (action && tradeAmountUSD > 10) {
      const tradeQty = tradeAmountUSD / price;
      
      if (action === 'BUY') currentCash -= tradeAmountUSD;
      else currentCash += tradeAmountUSD;

      // 写入交易日志
      const { error: tradeErr } = await supabase.from('trades').insert({
        symbol, action, price, quantity: tradeQty, reason: tradeReason, created_at: new Date().toISOString()
      });
      if (tradeErr) console.error(`❌ ${symbol} 交易日志写入失败:`, tradeErr.message);

      // 更新持仓
      let newQty = quantity;
      let newAvgCost = pos?.average_cost || 0;

      if (action === 'BUY') {
        const totalCost = (quantity * newAvgCost) + tradeAmountUSD;
        newQty = quantity + tradeQty;
        newAvgCost = totalCost / newQty;
      } else {
        newQty = quantity - tradeQty;
      }
      
      if (newQty < 0.001) newQty = 0; 

      const { error: posErr } = await supabase.from('positions').upsert({
        id: pos?.id, 
        symbol, 
        quantity: newQty, 
        average_cost: newAvgCost, 
        last_action_price: price, 
        updated_at: new Date().toISOString()
      }, { onConflict: 'symbol' });

      if (posErr) console.error(`❌ ${symbol} 持仓更新失败:`, posErr.message);
      else console.log(`✅ ${action} ${symbol} | $${tradeAmountUSD.toFixed(0)} | ${tradeReason}`);
    }
  }

  // 5. 结算
  let finalMarketValue = 0;
  // 重新查询一次持仓
  const { data: latestPositionsData } = await supabase.from('positions').select('*');
  const latestPositions = latestPositionsData as Position[];

  latestPositions?.forEach(p => {
    const pPrice = marketPrices[p.symbol] || p.last_action_price || 0;
    finalMarketValue += (p.quantity * pPrice);
  });
  
  const finalEquity = currentCash + finalMarketValue;

  await supabase.from('portfolio').update({
    cash_balance: currentCash, total_equity: finalEquity, updated_at: new Date().toISOString()
  }).gt('id', 0); 

  // 写入快照
  await supabase.from('equity_snapshots').insert({
     total_equity: finalEquity, 
     cash_balance: currentCash, 
     positions_value: finalMarketValue, 
     created_at: new Date().toISOString()
  });

  console.log(`💰 结算 | 总资产: $${finalEquity.toFixed(0)} | 现金: $${currentCash.toFixed(0)}`);
}