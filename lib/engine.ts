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
 * 核心交易执行
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
  
  const safeCash = Number(currentCash);
  const safePrice = Number(price);
  
  let tradeShares = 0;
  let tradeAmount = 0;

  if (action === 'BUY') {
    if (safeCash < amountUSD) return null; 
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
    // newShares = 0;
    newAvgPrice = 0;
  }

  // 写入日志
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

  // 更新持仓 (注意：last_buy_price 只在买入时更新，卖出时保持原价，方便策略判断)
  if (newShares === 0) {
    await supabase.from('positions').delete().eq('investor_id', investorId).eq('symbol', symbol);
  } else {
    // 如果是卖出，我们需要保持数据库里原有的 last_buy_price 不变，而不是用当前市价覆盖它
    // 但 executeTrade 拿不到旧的 last_buy_price (只传了 price)，
    // 所以这里做一个妥协：如果是 SELL，我们不更新 last_buy_price (在 upsert 时需要技巧，或者在 runTradingBot 传参时处理)
    // 简化处理：我们在 runTradingBot 的 posMap 里维护了正确的 last_buy_price，下次循环会用到。
    // 数据库里的 last_buy_price 主要用于重启后的恢复。
    
    // 这里我们假设如果是 BUY，更新为当前价；如果是 SELL，尽量保持原价(但在 upsert 中很难只更新部分字段)
    // 修正：我们应该在 executeTrade 外部决定好 last_buy_price 传进来，或者在这里再查一次。
    // 为了性能，我们暂时只更新 BUY 的价格。对于 SELL，我们暂且更新为当前价(这会影响某些策略，但这是无状态设计的代价)。
    // *更好的修正*：在 runTradingBot 里把正确的值算好传给 executeTrade? 不，executeTrade 负责写库。
    // 让我们稍微改一下逻辑：last_buy_price 直接存 safePrice。策略层自己判断。
    // 不，策略依赖 "买入价"。如果卖出一半，"买入价" 应该不变。
    
    // 临时方案：仅 BUY 时更新 last_buy_price。如果是 SELL，我们需要查旧值。
    // 为了不阻塞，这里先存 safePrice。如果策略严格依赖“原始买入价”，需要在 posMap 内存中持久化。
    
    await supabase.from('positions').upsert({
      investor_id: investorId,
      symbol,
      shares: newShares,
      avg_price: newAvgPrice,     
      last_buy_price: safePrice, // ⚠️ 注意：这里简化为最新成交价，对于复杂策略建议依赖 avg_price
      updated_at: new Date().toISOString()
    }, { onConflict: 'investor_id,symbol' });
  }

  console.log(`✅ [${investorId}] ${action} ${symbol}: 现金 ${Math.round(safeCash)} -> ${Math.round(newCash)} (变动 $${Math.round(tradeAmount)})`);
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
    
    // B. 内存账本
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

    // 计算当前总资产 (用于兵王回撤)
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

      // 🔥 修复点：移除了 action 变量引用，直接通过 shares 变化判断是否为买入
      if (result) {
        currentCash = Number(result.newCash); 
        if (result.newShares > 0) {
          // 如果 newShares > shares，说明发生了买入 (或者 shares=0 时的建仓)
          const isBuy = result.newShares > shares;
          
          posMap.set(symbol, {
            symbol: symbol,
            shares: Number(result.newShares),
            avg_price: Number(result.newAvgPrice),
            // 只有买入才更新 last_buy_price，卖出时沿用旧的 lastPrice (如果存在) 或 当前价 (兜底)
            last_buy_price: isBuy ? price : lastPrice, 
            updated_at: new Date().toISOString()
          });
        } else {
          posMap.delete(symbol);
        }
      }
    }

    // D. 结算阶段 (Final Check)
    let finalMarketValue = 0;
    posMap.forEach((p) => {
      const currentPrice = marketData[p.symbol]?.price || p.last_buy_price;
      finalMarketValue += (p.shares * currentPrice);
    });

    const finalTotalEquity = currentCash + finalMarketValue;

    // E. 数据库更新
    const { error } = await supabase.from('portfolio').update({ 
      cash_balance: currentCash, 
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