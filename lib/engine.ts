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
  updated_at: string; // 用于高僧判断时间
}

// 获取实时行情
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
        const changePercent = parseFloat(parts[3]) / 100;
        // Sina 接口的 changePercent 是百分比，例如 1.5 代表 1.5%
        // 但为了计算 open price，我们需要准确的涨跌幅小数
        // Open = Price / (1 + changePercent)
        
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
 * 核心交易执行：负责算钱和写日志
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
  
  // 1. 安全检查：强制转为 Number
  const safeCash = Number(currentCash);
  const safePrice = Number(price);
  
  let tradeShares = 0;
  let tradeAmount = 0;

  if (action === 'BUY') {
    if (safeCash < amountUSD) return null; // 钱不够
    tradeShares = amountUSD / safePrice;
    tradeAmount = tradeShares * safePrice;
  } else if (action === 'SELL' || action === 'SELL_ALL') {
    tradeShares = action === 'SELL_ALL' ? currentShares : Math.min(amountUSD / safePrice, currentShares);
    tradeAmount = tradeShares * safePrice;
  }

  if (tradeAmount < 1) return null; // 忽略过小交易

  // 2. 资金结算 (Double Check)
  const newCash = action === 'BUY' ? (safeCash - tradeAmount) : (safeCash + tradeAmount);
  const newShares = action === 'BUY' ? (currentShares + tradeShares) : (currentShares - tradeShares);

  // 3. 成本均价计算 (加权平均)
  let newAvgPrice = Number(currentAvgPrice);
  if (action === 'BUY') {
    const oldVal = currentShares * newAvgPrice;
    const newVal = tradeAmount;
    // 防止除以0
    newAvgPrice = (newShares > 0) ? (oldVal + newVal) / newShares : 0;
  }
  if (newShares <= 0.0001) {
    // newShares = 0;
    newAvgPrice = 0;
  }

  // 4. 写入交易日志
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

  // 5. 更新持仓表
  if (newShares === 0) {
    await supabase.from('positions').delete().eq('investor_id', investorId).eq('symbol', symbol);
  } else {
    // 关键：last_buy_price 只有在 BUY 时才更新，SELL 时保持不变（作为参考锚点）
    const nextLastBuyPrice = action === 'BUY' ? safePrice : (await getLastBuyPrice(investorId, symbol) || safePrice);

    await supabase.from('positions').upsert({
      investor_id: investorId,
      symbol,
      shares: newShares,
      avg_price: newAvgPrice,     
      last_buy_price: nextLastBuyPrice, // 保持逻辑一致性      
      updated_at: new Date().toISOString()
    }, { onConflict: 'investor_id,symbol' });
  }

  console.log(`✅ [${investorId}] ${action} ${symbol}: 现金 ${Math.round(safeCash)} -> ${Math.round(newCash)} (变动 $${Math.round(tradeAmount)})`);
  
  return { newCash, newShares, newAvgPrice };
}

// 辅助：获取上次买入价（防止内存中丢失）
async function getLastBuyPrice(investorId: string, symbol: string) {
    const { data } = await supabase.from('positions').select('last_buy_price').eq('investor_id', investorId).eq('symbol', symbol).single();
    return data?.last_buy_price;
}

export async function runTradingBot() {
  const marketData = await getMarketPrices();
  if (Object.keys(marketData).length === 0) return;

  for (const investor of INVESTORS) {
    // A. 准备阶段：获取账户和持仓
    let { data: portfolio } = await supabase.from('portfolio').select('*').eq('investor_id', investor.id).single();
    
    // 自动修复
    if (!portfolio) {
      console.log(`🔧 [${investor.name}] 初始化账户...`);
      const { data: newP } = await supabase.from('portfolio').insert({
        investor_id: investor.id,
        cash_balance: 1000000,
        total_equity: 1000000,
        initial_capital: 1000000,
        peak_equity: 1000000 // 兵王需要
      }).select().single();
      portfolio = newP;
    }
    if (!portfolio) continue;

    const { data: positionsRaw } = await supabase.from('positions').select('*').eq('investor_id', investor.id);
    
    // B. 内存账本 (强制转换为 Number)
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

    // 计算当前总资产，用于更新 peak_equity
    let tempMarketValue = 0;
    posMap.forEach((p) => {
        const price = marketData[p.symbol]?.price || p.last_buy_price;
        tempMarketValue += p.shares * price;
    });
    let currentTotalEquity = currentCash + tempMarketValue;
    
    // 更新最大回撤基准
    if (currentTotalEquity > peakEquity) {
        peakEquity = currentTotalEquity;
        await supabase.from('portfolio').update({ peak_equity: peakEquity }).eq('investor_id', investor.id);
    }
    const drawdown = (peakEquity - currentTotalEquity) / peakEquity;

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

      // ----------------- 策略核心逻辑 (严格重写) -----------------
      switch (investor.id) {
        
        // 1. 兵王 (Soldier)
        case 'soldier':
            if (drawdown > 0.10) {
                // 总回撤 > 10%，停止买入，只允许卖出
                if (hasPos && price > lastPrice * 1.02) {
                     result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, shares, avgPrice, currentCash, '回撤控制中-战术撤退');
                }
            } else {
                // 正常模式
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

        // 2. 小青 (Xiaoqing)
        case 'xiaoqing':
            if (!hasPos && currentCash >= 100000) {
                result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, 0, 0, currentCash, '小青存股');
            } else if (hasPos && price < lastPrice * 0.85 && currentCash >= 50000) {
                result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, shares, avgPrice, currentCash, '越跌越买');
            }
            // 永不卖出
            break;

        // 3. 狗哥 (Dog)
        case 'dog':
            // 保留 800,000 现金 -> 可用资金 = currentCash - 800,000
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
            // 永不追加买入 (逻辑上 !hasPos 限制了只能买底仓)
            break;
        
        // 4. 宝妈 (Mom)
        case 'mom':
            // 满仓：每支 200,000
            if (!hasPos && currentCash >= 200000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 200000, price, 0, 0, currentCash, '宝妈满仓');
            } else if (hasPos) {
                if (price > lastPrice * 1.20) {
                    result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, shares, avgPrice, currentCash, '高位减仓');
                } else if (price < lastPrice * 0.95) {
                    result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, avgPrice, currentCash, '清仓离场');
                }
            }
            // 不加仓
            break;

        // 5. 赌怪 (Gambler)
        case 'gambler':
            if (!hasPos && currentCash >= 10000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 10000, price, 0, 0, currentCash, '赌怪底仓');
            } else if (hasPos) {
                if (price < lastPrice * 0.90) {
                    // 双倍金额补仓 -> 买入金额 = 当前持仓市值 (Martingale)
                    const doublingAmount = shares * price;
                    if (currentCash >= doublingAmount) {
                         result = await executeTrade(investor.id, symbol, 'BUY', doublingAmount, price, shares, avgPrice, currentCash, '双倍补仓');
                    }
                } else if (price > avgPrice * 1.01) {
                     // 现价 > 平均成本 * 1.01
                     result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, avgPrice, currentCash, '微利跑路');
                }
            }
            break;

        // 6. 韭菜 (Leek)
        case 'leek':
            if (!hasPos && currentCash >= 50000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, 0, 0, currentCash, '韭菜进场');
            } else if (hasPos) {
                // 单日涨幅 > 5% 追高
                if (changePercent > 0.05 && currentCash >= 50000) {
                     // 防止同一天无限买入：简单策略暂时允许，或者可以判断 updated_at
                     result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, shares, avgPrice, currentCash, '涨停追高');
                } else if (changePercent < -0.05) {
                     // 单日跌幅 > 5% 杀跌
                     result = await executeTrade(investor.id, symbol, 'SELL', 50000, price, shares, avgPrice, currentCash, '跌停割肉');
                }
            }
            break;

        // 7. 高僧 (Zen)
        case 'zen':
            if (!hasPos && currentCash >= 50000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, 0, 0, currentCash, '随缘底仓');
            } else if (hasPos) {
                // 每隔 24 小时
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

      // 🔥 立即同步内存状态，防止同一轮循环内（或极短时间内）的重复判断
      if (result) {
        currentCash = Number(result.newCash); 
        if (result.newShares > 0) {
          posMap.set(symbol, {
            symbol: symbol,
            shares: Number(result.newShares),
            avg_price: Number(result.newAvgPrice),
            last_buy_price: (result.newShares > shares && action !== 'SELL') ? price : lastPrice, // 只有买入才更新 last_buy
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