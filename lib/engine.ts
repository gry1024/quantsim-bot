import { supabase, CONFIG, INVESTORS } from './config';

// 1. 定义精确的接口
interface MarketData {
  price: number;
  open: number; 
  changePercent: number;
}

// 内存中的持仓对象，用于实时计算
interface Position {
  symbol: string;
  shares: number;
  last_buy_price: number;
  avg_price: number; 
}

// 获取行情 (保持不变)
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

/**
 * 核心交易函数：只负责计算和写入数据库日志，不负责更新总资产
 */
async function executeTrade(
  investorId: string,
  symbol: string,
  action: 'BUY' | 'SELL' | 'SELL_ALL',
  amountUSD: number, 
  price: number,
  currentShares: number,
  currentAvgPrice: number,
  currentCash: number,
  reason: string
): Promise<{ newCash: number, newShares: number, newAvgPrice: number } | null> {
  
  let tradeShares = 0;
  let tradeAmount = 0;

  // 1. 严格计算份额和金额
  if (action === 'BUY') {
    if (currentCash < amountUSD) return null; // 现金不足
    tradeShares = amountUSD / price;
    tradeAmount = tradeShares * price; // ⚠️ 关键：扣款金额必须严格等于 份额*单价
  } else if (action === 'SELL' || action === 'SELL_ALL') {
    tradeShares = action === 'SELL_ALL' ? currentShares : Math.min(amountUSD / price, currentShares);
    tradeAmount = tradeShares * price;
  }

  if (tradeAmount < 1) return null; // 忽略微小交易

  // 2. 资金结算 (原子性计算)
  const newCash = action === 'BUY' ? currentCash - tradeAmount : currentCash + tradeAmount;
  const newShares = action === 'BUY' ? currentShares + tradeShares : currentShares - tradeShares;

  // 3. 计算新的持仓成本 (加权平均法)
  let newAvgPrice = currentAvgPrice;
  if (action === 'BUY') {
    const oldCost = currentShares * currentAvgPrice;
    const newCost = tradeAmount;
    newAvgPrice = (oldCost + newCost) / newShares;
  }
  if (newShares <= 0.0001) {
    newAvgPrice = 0;
  }

  // 4. 写入交易日志 (异步写入，不阻塞计算)
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

  // 5. 更新持仓表 (Upsert)
  if (newShares === 0) {
    await supabase.from('positions').delete().eq('investor_id', investorId).eq('symbol', symbol);
  } else {
    await supabase.from('positions').upsert({
      investor_id: investorId,
      symbol,
      shares: newShares,
      avg_price: newAvgPrice,     // 写入正确成本
      last_buy_price: price,      // 更新参考价
      updated_at: new Date().toISOString()
    }, { onConflict: 'investor_id,symbol' });
  }

  // 返回最新的状态供内存更新
  return { newCash, newShares, newAvgPrice };
}

export async function runTradingBot() {
  const marketData = await getMarketPrices();
  if (Object.keys(marketData).length === 0) return;

  for (const investor of INVESTORS) {
    // A. 准备阶段：从数据库加载一次初始状态
    const { data: portfolio } = await supabase.from('portfolio').select('*').eq('investor_id', investor.id).single();
    if (!portfolio) continue;

    const { data: positionsRaw } = await supabase.from('positions').select('*').eq('investor_id', investor.id);
    
    // B. 内存初始化：将数据库状态完全加载到内存变量中
    let currentCash = Number(portfolio.cash_balance);
    const posMap = new Map<string, Position>(); // 内存持仓账本
    
    // 填充内存账本
    (positionsRaw || []).forEach((p: any) => {
      posMap.set(p.symbol, {
        symbol: p.symbol,
        shares: Number(p.shares),
        last_buy_price: Number(p.last_buy_price || 0),
        avg_price: Number(p.avg_price || 0)
      });
    });

    // C. 交易阶段：所有操作只更新内存，不依赖数据库回查
    for (const symbol of CONFIG.SYMBOLS) {
      const data = marketData[symbol];
      if (!data) continue;

      const { price } = data;
      // 从内存账本获取最新状态 (这确保了如果循环中有多次交易，状态是连续的)
      const pos = posMap.get(symbol); 
      const shares = pos ? pos.shares : 0;
      const avgPrice = pos ? pos.avg_price : 0;
      const lastPrice = pos ? pos.last_buy_price : 0;
      const hasPos = shares > 0;

      // --- 策略执行 (这里调用 executeTrade) ---
      let result = null;

      switch (investor.id) {
        case 'leek': // 韭菜策略
          if (!hasPos && currentCash >= 50000) {
            result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, 0, 0, currentCash, '韭菜建仓');
          } else if (hasPos) {
            if (price > lastPrice * 1.05 && currentCash >= 50000) {
               result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, shares, avgPrice, currentCash, '追高加仓');
            } else if (price < lastPrice * 0.95) {
               result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, avgPrice, currentCash, '杀跌离场');
            }
          }
          break;
        
        case 'gambler': // 赌怪策略
          if (!hasPos && currentCash >= 10000) {
             result = await executeTrade(investor.id, symbol, 'BUY', 10000, price, 0, 0, currentCash, '赌怪试探');
          } else if (hasPos) {
            if (price < lastPrice * 0.90 && currentCash >= (shares * price)) { // 跌10%双倍补仓
              result = await executeTrade(investor.id, symbol, 'BUY', (shares * price), price, shares, avgPrice, currentCash, '输了加倍');
            } else if (price > lastPrice * 1.02) {
              result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, avgPrice, currentCash, '赢了就跑');
            }
          }
          break;

        case 'dog': // 狗哥 (80% 现金底线)
          const keepCash = 800000;
          if (!hasPos && currentCash > (keepCash + 40000)) {
             result = await executeTrade(investor.id, symbol, 'BUY', 40000, price, 0, 0, currentCash, '狗哥偷鸡');
          } else if (hasPos) {
            if (price > lastPrice * 1.05) {
               result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) / 2, price, shares, avgPrice, currentCash, '狗哥止盈一半');
            } else if (price < lastPrice * 0.98) {
               result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, avgPrice, currentCash, '狗哥跑路');
            }
          }
          break;
        
        case 'mom': // 宝妈 (满仓操作)
          if (!hasPos && currentCash >= 200000) {
             result = await executeTrade(investor.id, symbol, 'BUY', 200000, price, 0, 0, currentCash, '宝妈买入');
          } else if (hasPos) {
            if (price > lastPrice * 1.20) {
               result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, shares, avgPrice, currentCash, '宝妈取钱买菜');
            } else if (price < lastPrice * 0.95) {
               result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, avgPrice, currentCash, '宝妈止损');
            }
          }
          break;

        case 'xiaoqing': // 小青 (死拿)
          if (!hasPos && currentCash >= 100000) {
             result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, 0, 0, currentCash, '小青存股');
          } else if (hasPos && price < lastPrice * 0.85 && currentCash >= 50000) {
             result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, shares, avgPrice, currentCash, '小青越跌越买');
          }
          break;
          
        case 'zen': // 禅定 (随机)
           const dice = Math.random();
           if (!hasPos && currentCash >= 100000 && dice > 0.95) {
              result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, 0, 0, currentCash, '缘分到了');
           } else if (hasPos && dice < 0.05) {
              result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, avgPrice, currentCash, '缘分尽了');
           }
           break;

        case 'soldier': // 兵王
          if (!hasPos && currentCash >= 100000) {
             result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, 0, 0, currentCash, '兵王突击');
          } else if (hasPos) {
             if (price < lastPrice * 0.98 && currentCash >= 10000) {
                result = await executeTrade(investor.id, symbol, 'BUY', 10000, price, shares, avgPrice, currentCash, '请求支援');
             } else if (price > lastPrice * 1.02) {
                result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, shares, avgPrice, currentCash, '战术撤退');
             }
          }
          break;
      }

      // 🔥 关键步骤：如果交易发生，立即更新【内存】中的状态
      if (result) {
        currentCash = result.newCash; // 更新现金
        
        if (result.newShares > 0) {
          // 更新持仓映射
          posMap.set(symbol, {
            symbol: symbol,
            shares: result.newShares,
            avg_price: result.newAvgPrice,
            last_buy_price: price // 刚成交的价格即为 last_buy_price
          });
        } else {
          // 清仓
          posMap.delete(symbol);
        }
      }
    }

    // D. 结算阶段：使用【内存】中最新的 Cash 和 Positions 计算总资产
    // 这样彻底避免了数据库读写延迟导致的“账实不符”
    let marketValue = 0;
    posMap.forEach((p) => {
      // 这里的价格必须和 executeTrade 里的价格完全一致 (都来自 marketData)
      // 因此：Total Equity = Cash(已扣减) + MarketValue(已增加) === 恒定
      const currentPrice = marketData[p.symbol]?.price || p.last_buy_price;
      marketValue += (p.shares * currentPrice);
    });

    const totalEquity = currentCash + marketValue;

    // E. 最终落库
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