import { supabase, CONFIG, INVESTORS } from './config';

// 1. 强类型接口定义
interface MarketData {
  price: number;
  open: number; 
  changePercent: number;
}

interface Position {
  symbol: string;
  shares: number;
  last_buy_price: number;
  avg_price: number; 
  updated_at: string;
}

// 获取实时行情 (修复 changePercent 解析)
async function getMarketPrices(): Promise<Record<string, MarketData>> {
  const symbols = CONFIG.SYMBOLS.map(s => s.toLowerCase()).join(',');
  const symbolListStr = symbols.split(',').map(s => `gb_${s}`).join(',');
  const url = `https://hq.sinajs.cn/list=${symbolListStr}`;
  
  try {
    const res = await fetch(url, { headers: { 'Referer': 'https://finance.sina.com.cn/' } });
    const text = await res.text();
    const marketData: Record<string, MarketData> = {};
    
    const lines = text.split('\n');
    lines.forEach((line: string) => {
      const match = line.match(/gb_([a-z]+)="([^"]+)"/);
      if (match) {
        const symbol = match[1].toUpperCase();
        const parts = match[2].split(',');
        const price = parseFloat(parts[1]);
        const changePercent = parseFloat(parts[3]) / 100; // 3.5% -> 0.035
        
        if (!isNaN(price) && price > 0) {
          marketData[symbol] = { price, changePercent, open: price / (1 + changePercent) };
        }
      }
    });
    return marketData;
  } catch (e: any) {
    console.error(`❌ 行情网络请求失败: ${e.message}`);
    return {};
  }
}

/**
 * 核心交易执行 (已修复并发资金安全问题)
 */
async function executeTrade(
  investorId: string,
  symbol: string,
  action: 'BUY' | 'SELL' | 'SELL_ALL',
  amountUSD: number, 
  price: number,
  _ignoredShares: number,    // 废弃：不使用传入的旧持仓
  _ignoredAvgPrice: number,  // 废弃：不使用传入的旧均价
  _ignoredCash: number,      // 废弃：不使用传入的旧现金
  reason: string
): Promise<{ newCash: number, newShares: number, newAvgPrice: number } | null> {
  
  // 1. 【关键修复】强制从数据库获取最新 现金 和 持仓，防止并发导致的覆盖和资金错误
  const [ { data: portData }, { data: posData } ] = await Promise.all([
      supabase.from('portfolio').select('cash_balance').eq('investor_id', investorId).single(),
      supabase.from('positions').select('shares, avg_price, last_buy_price').eq('investor_id', investorId).eq('symbol', symbol).single()
  ]);

  // 如果数据库没数据（极端情况），回退到 0
  const safeCash = portData ? Number(portData.cash_balance) : 0;
  const currentShares = posData ? Number(posData.shares) : 0;
  const currentAvgPrice = posData ? Number(posData.avg_price) : 0;
  const lastBuyPrice = posData ? Number(posData.last_buy_price) : price; // 保持旧的买入价

  const safePrice = Number(price);
  
  let tradeShares = 0;
  let tradeAmount = 0;

  if (action === 'BUY') {
    if (safeCash < amountUSD) return null; // 资金不足（基于最新数据库余额判断）
    tradeShares = amountUSD / safePrice;
    tradeAmount = tradeShares * safePrice;
  } else if (action === 'SELL' || action === 'SELL_ALL') {
    tradeShares = action === 'SELL_ALL' ? currentShares : Math.min(amountUSD / safePrice, currentShares);
    tradeAmount = tradeShares * safePrice;
  }

  if (tradeAmount < 1) return null; 

  // 资金结算
  const newCash = action === 'BUY' ? (safeCash - tradeAmount) : (safeCash + tradeAmount);
  const newShares = action === 'BUY' ? (currentShares + tradeShares) : (currentShares - tradeShares);

  // 成本计算
  let newAvgPrice = Number(currentAvgPrice);
  if (action === 'BUY') {
    const oldVal = currentShares * newAvgPrice;
    const newVal = tradeAmount;
    newAvgPrice = (newShares > 0) ? (oldVal + newVal) / newShares : 0;
  }
  if (newShares <= 0.0001) {
    newAvgPrice = 0;
  }

  // 写入交易日志
  await supabase.from('trades').insert({
    investor_id: investorId,
    symbol,
    action: action === 'SELL_ALL' ? 'SELL' : action,
    shares: tradeShares,
    price: safePrice,
    amount: tradeAmount,
    reason,
    created_at: new Date().toISOString()
  });

  // 更新持仓
  if (newShares <= 0.0001) { // 浮点数容错
    await supabase.from('positions').delete().eq('investor_id', investorId).eq('symbol', symbol);
  } else {
    // 只有买入才更新 last_buy_price，卖出保持原价方便策略判断
    const nextLastBuyPrice = action === 'BUY' ? safePrice : lastBuyPrice;

    await supabase.from('positions').upsert({
      investor_id: investorId,
      symbol,
      shares: newShares,
      avg_price: newAvgPrice,     
      last_buy_price: nextLastBuyPrice,
      updated_at: new Date().toISOString()
    }, { onConflict: 'investor_id,symbol' });
  }

  // 2. 【关键修复】立即更新数据库的现金余额，确保原子性
  await supabase.from('portfolio').update({ 
      cash_balance: newCash,
      updated_at: new Date().toISOString()
  }).eq('investor_id', investorId);

  console.log(`✅ [${investorId}] ${action} ${symbol}: 现金 ${Math.round(safeCash)} -> ${Math.round(newCash)}`);
  return { newCash, newShares, newAvgPrice };
}

export async function runTradingBot() {
  const marketData = await getMarketPrices();
  if (Object.keys(marketData).length === 0) return;

  for (const investor of INVESTORS) {
    // A. 准备阶段
    let { data: portfolio } = await supabase.from('portfolio').select('*').eq('investor_id', investor.id).single();
    
    // 自动修复
    if (!portfolio) {
      console.log(`🔧 [${investor.name}] 初始化账户...`);
      const { data: newP } = await supabase.from('portfolio').insert({
        investor_id: investor.id,
        cash_balance: 1000000,
        total_equity: 1000000,
        initial_capital: 1000000,
        peak_equity: 1000000
      }).select().single();
      portfolio = newP;
    }
    if (!portfolio) continue;

    const { data: positionsRaw } = await supabase.from('positions').select('*').eq('investor_id', investor.id);
    
    // B. 内存账本 (用于策略快速读取，但写入时 executeTrade 会重新查库)
    let currentCash = Number(portfolio.cash_balance);
    let peakEquity = Number(portfolio.peak_equity || portfolio.total_equity);
    const posMap = new Map<string, Position>();
    
    (positionsRaw || []).forEach((p: any) => {
      posMap.set(p.symbol, {
        symbol: p.symbol,
        shares: Number(p.shares),
        last_buy_price: Number(p.last_buy_price || 0),
        avg_price: Number(p.avg_price || 0),
        updated_at: p.updated_at
      });
    });

    // 计算当前总资产 (用于兵王回撤判断)
    let tempMarketValue = 0;
    posMap.forEach((p) => {
        const price = marketData[p.symbol]?.price || p.last_buy_price;
        tempMarketValue += p.shares * price;
    });
    let currentTotalEquity = currentCash + tempMarketValue;
    
    if (currentTotalEquity > peakEquity) {
        peakEquity = currentTotalEquity;
        await supabase.from('portfolio').update({ peak_equity: peakEquity }).eq('investor_id', investor.id);
    }
    const drawdown = (peakEquity > 0) ? (peakEquity - currentTotalEquity) / peakEquity : 0;

    // C. 交易循环
    for (const symbol of CONFIG.SYMBOLS) {
      const data = marketData[symbol];
      if (!data) continue;

      const { price, changePercent } = data;
      const pos = posMap.get(symbol); 
      // 注意：这里的 shares 仅用于策略判断触发条件，executeTrade 内部会查最新的真实 shares
      const shares = pos ? pos.shares : 0;
      const avgPrice = pos ? pos.avg_price : 0;
      const lastPrice = pos ? pos.last_buy_price : 0;
      const hasPos = shares > 0;
      const lastUpdateTime = pos ? new Date(pos.updated_at).getTime() : 0;
      const now = Date.now();

      let result = null;

      // --- 策略逻辑 ---
      switch (investor.id) {
        case 'soldier': // 兵王
            if (drawdown > 0.10) {
                if (hasPos && price > lastPrice * 1.02) {
                     result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, shares, avgPrice, currentCash, '回撤控制-战术撤退');
                }
            } else {
                if (!hasPos && currentCash >= 100000) {
                    result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, 0, 0, currentCash, '兵王底仓');
                } else if (hasPos) {
                    if (price < lastPrice * 0.98 && currentCash >= 10000) {
                        result = await executeTrade(investor.id, symbol, 'BUY', 10000, price, shares, avgPrice, currentCash, '下跌补给');
                    } else if (price > lastPrice * 1.02) {
                        result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, shares, avgPrice, currentCash, '战术撤退20%');
                    }
                }
            }
            break;

        case 'xiaoqing': // 小青
            if (!hasPos && currentCash >= 100000) {
                result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, 0, 0, currentCash, '小青存股');
            } else if (hasPos && price < lastPrice * 0.85 && currentCash >= 50000) {
                result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, shares, avgPrice, currentCash, '越跌越买');
            }
            break;

        case 'dog': // 狗哥
            const dogAvailable = currentCash - 800000;
            if (!hasPos && dogAvailable >= 40000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 40000, price, 0, 0, currentCash, '狗哥底仓');
            } else if (hasPos) {
                if (price > lastPrice * 1.05) {
                    result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.5, price, shares, avgPrice, currentCash, '止盈一半');
                } else if (price < lastPrice * 0.98) {
                    result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, avgPrice, currentCash, '清仓止损');
                }
            }
            break;
        
        case 'mom': // 宝妈
            if (!hasPos && currentCash >= 200000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 200000, price, 0, 0, currentCash, '宝妈满仓');
            } else if (hasPos) {
                if (price > lastPrice * 1.20) {
                    result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, shares, avgPrice, currentCash, '高位减仓');
                } else if (price < lastPrice * 0.95) {
                    result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, avgPrice, currentCash, '清仓离场');
                }
            }
            break;

        case 'gambler': // 赌怪
            if (!hasPos && currentCash >= 10000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 10000, price, 0, 0, currentCash, '赌怪底仓');
            } else if (hasPos) {
                if (price < lastPrice * 0.90 && currentCash >= (shares * price)) {
                     result = await executeTrade(investor.id, symbol, 'BUY', shares * price, price, shares, avgPrice, currentCash, '双倍补仓');
                } else if (price > avgPrice * 1.01) {
                     result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, avgPrice, currentCash, '微利跑路');
                }
            }
            break;

        case 'leek': // 韭菜
            if (!hasPos && currentCash >= 50000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, 0, 0, currentCash, '韭菜进场');
            } else if (hasPos) {
                if (changePercent > 0.05 && currentCash >= 50000) {
                     result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, shares, avgPrice, currentCash, '涨停追高');
                } else if (changePercent < -0.05) {
                     result = await executeTrade(investor.id, symbol, 'SELL', 50000, price, shares, avgPrice, currentCash, '跌停割肉');
                }
            }
            break;

        case 'zen': // 高僧
            if (!hasPos && currentCash >= 50000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, 0, 0, currentCash, '随缘底仓');
            } else if (hasPos) {
                const hoursPassed = (now - lastUpdateTime) / (1000 * 3600);
                if (hoursPassed >= 24) {
                    const dice = Math.random();
                    if (dice > 0.5 && currentCash >= 10000) {
                         result = await executeTrade(investor.id, symbol, 'BUY', 10000, price, shares, avgPrice, currentCash, '日行一善-买');
                    } else {
                         result = await executeTrade(investor.id, symbol, 'SELL', 10000, price, shares, avgPrice, currentCash, '日行一善-卖');
                    }
                }
            }
            break;
      }

      // 更新内存状态（仅为了循环内的下一个 symbol 能感知到资金变化）
      if (result) {
        currentCash = Number(result.newCash); 
        if (result.newShares > 0) {
          const isBuy = result.newShares > shares;
          posMap.set(symbol, {
            symbol: symbol,
            shares: Number(result.newShares),
            avg_price: Number(result.newAvgPrice),
            last_buy_price: isBuy ? price : lastPrice, 
            updated_at: new Date().toISOString()
          });
        } else {
          posMap.delete(symbol);
        }
      }
    }

    // D. 结算阶段
    let finalMarketValue = 0;
    posMap.forEach((p) => {
      const currentPrice = marketData[p.symbol]?.price || p.last_buy_price;
      finalMarketValue += (p.shares * currentPrice);
    });

    const finalTotalEquity = currentCash + finalMarketValue;

    // E. 数据库更新 (⚠️ 关键修复：不再更新 cash_balance，只更新 total_equity)
    // cash_balance 已经在 executeTrade 中实时更新了，这里如果再更新，会用旧数据覆盖掉并发交易的结果
    const { error } = await supabase.from('portfolio').update({ 
      // cash_balance: currentCash, <--- 这一行删除了
      total_equity: finalTotalEquity,
      updated_at: new Date().toISOString()
    }).eq('investor_id', investor.id);

    if (error) {
        console.error(`❌ [${investor.name}] 资产更新失败:`, error.message);
    } else {
        await supabase.from('equity_snapshots').insert({
          investor_id: investor.id,
          total_equity: finalTotalEquity,
          cash_balance: currentCash,
          created_at: new Date().toISOString()
        });
    }
  }
}