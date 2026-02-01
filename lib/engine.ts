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

// 获取实时行情
async function getMarketPrices(): Promise<Record<string, MarketData>> {
  const symbols = CONFIG.SYMBOLS.map(s => s.toLowerCase()).join(',');
  const symbolListStr = symbols.split(',').map(s => `gb_${s}`).join(',');
  // 增加随机数防止缓存
  const url = `https://hq.sinajs.cn/list=${symbolListStr}&t=${Date.now()}`;
  
  try {
    const res = await fetch(url, { 
        headers: { 'Referer': 'https://finance.sina.com.cn/' },
        cache: 'no-store' 
    });
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
 * 核心交易执行 (原子化修复版)
 * 强制从数据库读取最新资金和持仓，防止内存状态滞后导致的重复买入
 */
async function executeTrade(
  investorId: string,
  symbol: string,
  action: 'BUY' | 'SELL' | 'SELL_ALL',
  amountUSD: number, 
  price: number,
  reason: string
): Promise<{ newCash: number, newShares: number, newAvgPrice: number } | null> {
  
  // 1. 🔒 核心锁：交易前强制查库，获取最新状态
  const [ { data: portData }, { data: posData } ] = await Promise.all([
      supabase.from('portfolio').select('cash_balance').eq('investor_id', investorId).single(),
      supabase.from('positions').select('shares, avg_price, last_buy_price').eq('investor_id', investorId).eq('symbol', symbol).single()
  ]);

  const safeCash = portData ? Number(portData.cash_balance) : 0;
  const currentShares = posData ? Number(posData.shares) : 0;
  const currentAvgPrice = posData ? Number(posData.avg_price) : 0;
  const lastBuyPrice = posData ? Number(posData.last_buy_price) : price;

  const safePrice = Number(price);
  let tradeShares = 0;
  let tradeAmount = 0;

  // 2. 计算交易量
  if (action === 'BUY') {
    if (safeCash < amountUSD) {
        console.warn(`⚠️ [${investorId}] 资金不足，取消买入。当前: $${safeCash}, 需要: $${amountUSD}`);
        return null; 
    }
    tradeShares = amountUSD / safePrice;
    tradeAmount = tradeShares * safePrice;
  } else if (action === 'SELL' || action === 'SELL_ALL') {
    if (currentShares <= 0) return null; // 没货不卖
    tradeShares = action === 'SELL_ALL' ? currentShares : Math.min(amountUSD / safePrice, currentShares);
    tradeAmount = tradeShares * safePrice;
  }

  if (tradeAmount < 1) return null; // 忽略微小交易

  // 3. 资金结算
  const newCash = action === 'BUY' ? (safeCash - tradeAmount) : (safeCash + tradeAmount);
  const newShares = action === 'BUY' ? (currentShares + tradeShares) : (currentShares - tradeShares);

  // 4. 均价计算
  let newAvgPrice = Number(currentAvgPrice);
  if (action === 'BUY') {
    const oldVal = currentShares * newAvgPrice;
    const newVal = tradeAmount;
    newAvgPrice = (newShares > 0) ? (oldVal + newVal) / newShares : 0;
  }
  if (newShares <= 0.0001) newAvgPrice = 0;

  // 5. 写入交易日志
  const { error: tradeError } = await supabase.from('trades').insert({
    investor_id: investorId,
    symbol,
    action: action === 'SELL_ALL' ? 'SELL' : action,
    shares: tradeShares,
    price: safePrice,
    amount: tradeAmount,
    reason,
    created_at: new Date().toISOString()
  });

  if (tradeError) {
      console.error(`❌ [${investorId}] 交易日志写入失败:`, tradeError.message);
      return null; // 关键步骤失败，中止以防数据不一致
  }

  // 6. 更新持仓 (Upsert)
  if (newShares <= 0.0001) {
    await supabase.from('positions').delete().eq('investor_id', investorId).eq('symbol', symbol);
  } else {
    // 只有买入更新 last_buy_price，卖出保持原价
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

  // 7. ⚡️ 立即扣款 (不再等待循环结束)
  await supabase.from('portfolio').update({ 
      cash_balance: newCash,
      updated_at: new Date().toISOString()
  }).eq('investor_id', investorId);

  console.log(`✅ [${investorId}] 交易成功: ${action} ${symbol} | 额度 $${Math.round(tradeAmount)} | 剩余现金 $${Math.round(newCash)}`);
  return { newCash, newShares, newAvgPrice };
}

export async function runTradingBot() {
  console.log(`\n🔄 [${new Date().toLocaleTimeString()}] 开始执行量化策略扫描...`);
  
  const marketData = await getMarketPrices();
  if (Object.keys(marketData).length === 0) {
      console.log("⚠️ 无法获取市场行情，本次跳过。");
      return;
  }

  for (const investor of INVESTORS) {
    console.log(`👤 分析投资者: ${investor.name} (${investor.id})`);

    // A. 准备阶段：初始化/获取账户
    let { data: portfolio } = await supabase.from('portfolio').select('*').eq('investor_id', investor.id).single();
    if (!portfolio) {
      console.log(`   🔧 初始化新账户...`);
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
    
    // B. 构建内存状态 (仅用于策略判断，交易时会再次查库)
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

    // 计算回撤
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

    // C. 策略循环
    for (const symbol of CONFIG.SYMBOLS) {
      const data = marketData[symbol];
      if (!data) continue;

      const { price, changePercent } = data;
      const pos = posMap.get(symbol); 
      const shares = pos ? pos.shares : 0;
      const avgPrice = pos ? pos.avg_price : 0;
      const lastPrice = pos ? pos.last_buy_price : 0;
      const hasPos = shares > 0;
      
      // 💡 关键逻辑：获取上次交易时间，防止单日重复交易
      const lastUpdateStr = pos?.updated_at;
      const lastUpdateDate = lastUpdateStr ? new Date(lastUpdateStr).toDateString() : '';
      const todayDate = new Date().toDateString();
      const isTradedToday = lastUpdateDate === todayDate;

      const now = Date.now();
      const lastUpdateTime = pos ? new Date(pos.updated_at).getTime() : 0;

      let result = null;

      // --- 策略逻辑 ---
      switch (investor.id) {
        case 'soldier': // 兵王
            if (drawdown > 0.10) {
                if (hasPos && price > lastPrice * 1.02) {
                     result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, '回撤控制-战术撤退');
                }
            } else {
                if (!hasPos && currentCash >= 100000) {
                    result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, '兵王底仓');
                } else if (hasPos) {
                    // 下跌 2% 补仓 (且今天没操作过，避免无限补)
                    if (price < lastPrice * 0.98 && currentCash >= 10000 && !isTradedToday) {
                        result = await executeTrade(investor.id, symbol, 'BUY', 10000, price, '下跌补给');
                    } else if (price > lastPrice * 1.02 && !isTradedToday) {
                        result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, '战术撤退20%');
                    }
                }
            }
            break;

        case 'xiaoqing': // 小青
            if (!hasPos && currentCash >= 100000) {
                result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, '小青存股');
            } else if (hasPos && price < lastPrice * 0.85 && currentCash >= 50000) {
                result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, '越跌越买');
            }
            break;

        case 'dog': // 狗哥
            const dogAvailable = currentCash - 800000;
            if (!hasPos && dogAvailable >= 40000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 40000, price, '狗哥底仓');
            } else if (hasPos) {
                if (price > lastPrice * 1.05) {
                    result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.5, price, '止盈一半');
                } else if (price < lastPrice * 0.98) {
                    result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, '清仓止损');
                }
            }
            break;
        
        case 'mom': // 宝妈
            if (!hasPos && currentCash >= 200000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 200000, price, '宝妈满仓');
            } else if (hasPos) {
                if (price > lastPrice * 1.20) {
                    result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, '高位减仓');
                } else if (price < lastPrice * 0.95) {
                    result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, '清仓离场');
                }
            }
            break;

        case 'gambler': // 赌怪
            if (!hasPos && currentCash >= 10000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 10000, price, '赌怪底仓');
            } else if (hasPos) {
                if (price < lastPrice * 0.90 && currentCash >= (shares * price)) {
                     result = await executeTrade(investor.id, symbol, 'BUY', shares * price, price, '双倍补仓');
                } else if (price > avgPrice * 1.01) {
                     result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, '微利跑路');
                }
            }
            break;

        case 'leek': // 韭菜 🟢 (已修复)
            if (!hasPos && currentCash >= 50000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, '韭菜进场');
            } else if (hasPos) {
                // 涨停追高：必须检查 !isTradedToday，否则涨幅一直 > 5% 会导致无限买入
                if (changePercent > 0.05 && currentCash >= 50000) {
                     if (!isTradedToday) {
                        result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, '涨停追高');
                     } else {
                        // 打印详细日志，让用户知道为什么没买
                        console.log(`   [Leek] ${symbol} 涨幅 ${Math.round(changePercent*100)}% > 5%，但今日已操作过，跳过。`);
                     }
                } else if (changePercent < -0.05) {
                     if (!isTradedToday) {
                        result = await executeTrade(investor.id, symbol, 'SELL', 50000, price, '跌停割肉');
                     }
                }
            }
            break;

        case 'zen': // 高僧
            if (!hasPos && currentCash >= 50000) {
                 result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, '随缘底仓');
            } else if (hasPos) {
                const hoursPassed = (now - lastUpdateTime) / (1000 * 3600);
                if (hoursPassed >= 24) { // 每天只做一次决定
                    const dice = Math.random();
                    if (dice > 0.5 && currentCash >= 10000) {
                         result = await executeTrade(investor.id, symbol, 'BUY', 10000, price, '日行一善-买');
                    } else {
                         result = await executeTrade(investor.id, symbol, 'SELL', 10000, price, '日行一善-卖');
                    }
                }
            }
            break;
      }

      // 更新内存状态 (用于当前循环的后续计算，虽然 cash 已经在 DB 更新，但这里保持同步是个好习惯)
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
    // ⚠️ 修复：不再覆盖更新 cash_balance，只更新 total_equity
    // 现金流在 executeTrade 中已经原子化扣除了，这里只负责计算最新的市值展示
    let finalMarketValue = 0;
    posMap.forEach((p) => {
      const currentPrice = marketData[p.symbol]?.price || p.last_buy_price;
      finalMarketValue += (p.shares * currentPrice);
    });

    const finalTotalEquity = currentCash + finalMarketValue;

    const { error } = await supabase.from('portfolio').update({ 
      // cash_balance: currentCash, // ❌ 删除此行，防止覆盖并发交易的结果
      total_equity: finalTotalEquity,
      updated_at: new Date().toISOString()
    }).eq('investor_id', investor.id);

    if (error) {
        console.error(`   ❌ 资产更新失败:`, error.message);
    } else {
        // 记录快照
        await supabase.from('equity_snapshots').insert({
          investor_id: investor.id,
          total_equity: finalTotalEquity,
          cash_balance: currentCash,
          created_at: new Date().toISOString()
        });
    }
  }
  console.log(`✅ [${new Date().toLocaleTimeString()}] 扫描完成。\n`);
}