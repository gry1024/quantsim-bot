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
  last_action_price: number; // 上次任意操作（买入或卖出）的价格
  updated_at: string;
}

// 获取实时行情 (增加随机数防缓存)
async function getMarketPrices(): Promise<Record<string, MarketData>> {
  const symbols = CONFIG.SYMBOLS.map(s => s.toLowerCase()).join(',');
  const symbolListStr = symbols.split(',').map(s => `gb_${s}`).join(',');
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
        const changePercent = parseFloat(parts[3]) / 100; 
        
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
 * 强制从数据库读取最新资金和持仓，防止内存状态滞后
 */
async function executeTrade(
  investorId: string,
  symbol: string,
  action: 'BUY' | 'SELL' | 'SELL_ALL',
  amountUSD: number, 
  price: number,
  reason: string
): Promise<{ newCash: number, newShares: number, newAvgPrice: number, lastActionPrice: number } | null> {
  
  // 1. 🔒 核心锁：交易前强制查库，获取最新状态
  const [ { data: portData }, { data: posData } ] = await Promise.all([
      supabase.from('portfolio').select('cash_balance').eq('investor_id', investorId).single(),
      supabase.from('positions').select('shares, avg_price, last_buy_price, last_action_price').eq('investor_id', investorId).eq('symbol', symbol).single()
  ]);

  const safeCash = portData ? Number(portData.cash_balance) : 0;
  const currentShares = posData ? Number(posData.shares) : 0;
  const currentAvgPrice = posData ? Number(posData.avg_price) : 0;
  // 如果没有 last_buy_price，默认为当前价格 (针对第一次买入)
  const lastBuyPrice = posData?.last_buy_price ? Number(posData.last_buy_price) : price;
  
  const safePrice = Number(price);
  let tradeShares = 0;
  let tradeAmount = 0;

  // 2. 计算交易量
  if (action === 'BUY') {
    if (safeCash < amountUSD) {
        console.warn(`⚠️ [${investorId}] 资金不足，取消买入。当前: $${Math.round(safeCash)}, 需要: $${amountUSD}`);
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
      return null;
  }

  // 6. 更新持仓 (Upsert)
  if (newShares <= 0.0001) {
    // 清仓删除记录
    await supabase.from('positions').delete().eq('investor_id', investorId).eq('symbol', symbol);
  } else {
    // 只有买入才更新 last_buy_price，但任何操作都更新 last_action_price
    const nextLastBuyPrice = action === 'BUY' ? safePrice : lastBuyPrice;
    
    await supabase.from('positions').upsert({
      investor_id: investorId,
      symbol,
      shares: newShares,
      avg_price: newAvgPrice,     
      last_buy_price: nextLastBuyPrice,
      last_action_price: safePrice, // 🔑 关键：记录本次成交价
      updated_at: new Date().toISOString() // 🔑 关键：更新时间用于单日限制
    }, { onConflict: 'investor_id,symbol' });
  }

  // 7. ⚡️ 立即扣款/入账
  await supabase.from('portfolio').update({ 
      cash_balance: newCash,
      updated_at: new Date().toISOString()
  }).eq('investor_id', investorId);

  console.log(`✅ [${investorId}] 交易成功: ${action} ${symbol} | 额度 $${Math.round(tradeAmount)} | 剩余现金 $${Math.round(newCash)}`);
  return { newCash, newShares, newAvgPrice, lastActionPrice: safePrice };
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
    
    // 如果账户不存在，初始化
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

    // 获取持仓
    const { data: positionsRaw } = await supabase.from('positions').select('*').eq('investor_id', investor.id);
    
    // B. 构建内存映射 (用于快速查询)
    // ⚠️ 注意：每次循环开始前，cash必须是最新的
    let currentCash = Number(portfolio.cash_balance);
    
    const posMap = new Map<string, Position>();
    (positionsRaw || []).forEach((p: any) => {
      posMap.set(p.symbol, {
        symbol: p.symbol,
        shares: Number(p.shares),
        last_buy_price: Number(p.last_buy_price || 0),
        last_action_price: Number(p.last_action_price || p.last_buy_price || 0), // 兼容旧数据
        avg_price: Number(p.avg_price || 0),
        updated_at: p.updated_at
      });
    });

    // 计算回撤 (用于兵王)
    // ⚠️ 必须用当前 marketData 计算最新市值
    let tempMarketValue = 0;
    posMap.forEach((p) => {
        const price = marketData[p.symbol]?.price || p.last_action_price;
        tempMarketValue += p.shares * price;
    });
    let currentTotalEquity = currentCash + tempMarketValue;
    
    // 更新最高权益 (Peak Equity)
    let peakEquity = Number(portfolio.peak_equity || portfolio.total_equity);
    if (currentTotalEquity > peakEquity) {
        peakEquity = currentTotalEquity;
        await supabase.from('portfolio').update({ peak_equity: peakEquity }).eq('investor_id', investor.id);
    }
    const drawdown = (peakEquity > 0) ? (peakEquity - currentTotalEquity) / peakEquity : 0;

    // C. 策略循环
    for (const symbol of CONFIG.SYMBOLS) {
      const data = marketData[symbol];
      if (!data) continue;

      const { price } = data; // 当前即时价格
      const pos = posMap.get(symbol); 
      
      const shares = pos ? pos.shares : 0;
      const avgPrice = pos ? pos.avg_price : 0;
      const lastBuyPrice = pos ? pos.last_buy_price : 0;
      const lastActionPrice = pos ? pos.last_action_price : 0; 
      const hasPos = shares > 0;
      
      // 💡 关键逻辑：获取上次交易时间，防止单日重复交易
      const lastUpdateStr = pos?.updated_at;
      const lastUpdateDate = lastUpdateStr ? new Date(lastUpdateStr).toDateString() : '';
      const todayDate = new Date().toDateString();
      const isTradedToday = lastUpdateDate === todayDate;

      const now = Date.now();
      const lastUpdateTime = pos ? new Date(pos.updated_at).getTime() : 0;

      let result = null;

      // --- 策略逻辑 (各路大神) ---
      try {
        switch (investor.id) {
          case 'soldier': // 兵王
              if (drawdown > 0.10) {
                  // 回撤 > 10% 停止买入，若反弹 2% 减仓
                  if (hasPos && lastActionPrice > 0 && price > lastActionPrice * 1.02 && !isTradedToday) {
                      result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, '回撤控制-战术撤退');
                  }
              } else {
                  if (!hasPos && currentCash >= 100000) {
                      result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, '兵王底仓');
                  } else if (hasPos && lastActionPrice > 0) {
                      // 下跌 2% 补仓
                      if (price < lastActionPrice * 0.98 && currentCash >= 10000 && !isTradedToday) {
                          result = await executeTrade(investor.id, symbol, 'BUY', 10000, price, '下跌补给');
                      } 
                      // 上涨 2% 撤退
                      else if (price > lastActionPrice * 1.02 && !isTradedToday) {
                          result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, '战术撤退20%');
                      }
                  }
              }
              break;

          case 'xiaoqing': // 小青 (长线死多头)
              if (!hasPos && currentCash >= 100000) {
                  result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, '小青存股');
              } else if (hasPos && lastActionPrice > 0) {
                  // 较上次成交价下跌 15% 才加仓
                  if (price < lastActionPrice * 0.85 && currentCash >= 50000 && !isTradedToday) {
                      result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, '越跌越买');
                  }
              }
              break;

          case 'dog': // 狗哥 (保本第一)
              const dogAvailable = currentCash - 800000; // 必须保留 80w
              if (!hasPos && dogAvailable >= 40000) {
                  result = await executeTrade(investor.id, symbol, 'BUY', 40000, price, '狗哥底仓');
              } else if (hasPos && lastActionPrice > 0) {
                  if (price > lastActionPrice * 1.05 && !isTradedToday) {
                      result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.5, price, '止盈一半');
                  } else if (price < lastActionPrice * 0.98 && !isTradedToday) {
                      result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, '清仓止损');
                  }
              }
              break;
          
          case 'mom': // 宝妈 (大妈逻辑)
              if (!hasPos && currentCash >= 200000) {
                  result = await executeTrade(investor.id, symbol, 'BUY', 200000, price, '宝妈满仓');
              } else if (hasPos && lastBuyPrice > 0) {
                  // 对比上次买入价
                  if (price > lastBuyPrice * 1.20 && !isTradedToday) {
                      result = await executeTrade(investor.id, symbol, 'SELL', (shares * price) * 0.2, price, '高位减仓');
                  } else if (price < lastBuyPrice * 0.95 && !isTradedToday) {
                      result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, '清仓离场');
                  }
              }
              break;

          case 'gambler': // 赌怪 (马丁格尔策略)
              if (!hasPos && currentCash >= 10000) {
                  result = await executeTrade(investor.id, symbol, 'BUY', 10000, price, '赌怪底仓');
              } else if (hasPos && lastBuyPrice > 0) {
                  // 跌 10% 双倍补仓
                  if (price < lastBuyPrice * 0.90 && currentCash >= (shares * avgPrice) && !isTradedToday) {
                      result = await executeTrade(investor.id, symbol, 'BUY', shares * avgPrice, price, '双倍补仓');
                  } 
                  // 相对均价涨 2% 跑路
                  else if (price > avgPrice * 1.02 && !isTradedToday) {
                      result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, '微利跑路');
                  }
              }
              break;

          case 'leek': // 韭菜 (追涨杀跌)
              if (!hasPos && currentCash >= 50000) {
                  result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, '韭菜进场');
              } else if (hasPos && lastActionPrice > 0) {
                  // 🔑 修复：对比 last_action_price
                  const priceChangeFromLast = (price - lastActionPrice) / lastActionPrice;
                  
                  // 涨超过 5% 追高
                  if (priceChangeFromLast > 0.05 && currentCash >= 50000) {
                      if (!isTradedToday) {
                          result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, '涨停追高');
                      } 
                  }
                  // 跌超过 5% 割肉
                  else if (priceChangeFromLast < -0.05) {
                      if (!isTradedToday) {
                          result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, '跌停割肉');
                      }
                  }
              }
              break;

          case 'zen': // 高僧 (随机漫步)
              if (!hasPos && currentCash >= 100000) {
                  result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, '随缘底仓');
              } else if (hasPos) {
                  const hoursPassed = (now - lastUpdateTime) / (1000 * 3600);
                  if (hoursPassed >= 24) { // 冷却时间 24h
                      const dice = Math.random();
                      if (dice > 0.5 && currentCash >= 50000) {
                          result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, '日行一善-买');
                      } else if (dice <= 0.5) {
                          result = await executeTrade(investor.id, symbol, 'SELL', 50000, price, '日行一善-卖');
                      }
                  }
              }
              break;
        }
      } catch (err: any) {
         console.error(`   ❌ 策略执行出错 [${investor.id}]:`, err.message);
      }

      // 更新内存中的 Cash，确保下一个 Symbol 判断时资金准确
      if (result) {
        currentCash = result.newCash; 
        
        // 更新内存 posMap 以防后续逻辑依赖 (虽然本轮并不依赖跨 symbol 的持仓状态)
        if (result.newShares > 0) {
           const isBuy = result.newShares > shares;
           posMap.set(symbol, {
             symbol: symbol,
             shares: result.newShares,
             avg_price: result.newAvgPrice,
             last_buy_price: isBuy ? price : lastBuyPrice, // 买入更新，卖出保持
             last_action_price: result.lastActionPrice,    // 任意操作都更新
             updated_at: new Date().toISOString()
           });
        } else {
           posMap.delete(symbol);
        }
      }
    } // end of symbol loop

    // D. 结算阶段
    // 再次从数据库确认 Cash (双重保险)
    const { data: finalPortfolio } = await supabase.from('portfolio').select('cash_balance').eq('investor_id', investor.id).single();
    const finalCash = finalPortfolio ? Number(finalPortfolio.cash_balance) : currentCash;
    
    // 计算最新市值 (Market Value)
    // 🔑 必须遍历 posMap 并乘以 Current Price，这才是真实的 Total Equity
    let finalMarketValue = 0;
    posMap.forEach((p) => {
      const currentPrice = marketData[p.symbol]?.price || p.last_action_price;
      finalMarketValue += (p.shares * currentPrice);
    });

    const finalTotalEquity = finalCash + finalMarketValue;

    // 更新 Total Equity
    const { error } = await supabase.from('portfolio').update({ 
      total_equity: finalTotalEquity,
      updated_at: new Date().toISOString()
    }).eq('investor_id', investor.id);

    if (!error) {
        console.log(`   💰 [${investor.name}] 结算: 现金 $${Math.round(finalCash).toLocaleString()} + 持仓 $${Math.round(finalMarketValue).toLocaleString()} = 总值 $${Math.round(finalTotalEquity).toLocaleString()}`);
        
        // 记录快照
        await supabase.from('equity_snapshots').insert({
          investor_id: investor.id,
          total_equity: finalTotalEquity,
          cash_balance: finalCash,
          created_at: new Date().toISOString()
        });
    }
  } // end of investor loop
  
  console.log(`✅ [${new Date().toLocaleTimeString()}] 扫描完成。\n`);
}