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
  
  // 1. 安全检查：强制转为 Number，防止字符串运算
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
  // 买入：现金减少；卖出：现金增加
  const newCash = action === 'BUY' ? (safeCash - tradeAmount) : (safeCash + tradeAmount);
  const newShares = action === 'BUY' ? (currentShares + tradeShares) : (currentShares - tradeShares);

  // 3. 成本均价计算 (加权平均)
  let newAvgPrice = Number(currentAvgPrice);
  if (action === 'BUY') {
    const oldVal = currentShares * newAvgPrice;
    const newVal = tradeAmount;
    newAvgPrice = (oldVal + newVal) / newShares;
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
    await supabase.from('positions').upsert({
      investor_id: investorId,
      symbol,
      shares: newShares,
      avg_price: newAvgPrice,     
      last_buy_price: safePrice,      
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
    
    // 自动修复缺失账户
    if (!portfolio) {
      console.log(`🔧 [${investor.name}] 初始化账户...`);
      const { data: newP } = await supabase.from('portfolio').insert({
        investor_id: investor.id,
        cash_balance: 1000000,
        total_equity: 1000000,
        initial_capital: 1000000
      }).select().single();
      portfolio = newP;
    }

    if (!portfolio) continue;

    const { data: positionsRaw } = await supabase.from('positions').select('*').eq('investor_id', investor.id);
    
    // B. 内存账本 (这是最关键的一步，所有计算基于内存，防止数据库延迟)
    // 强制转换为 Number 类型
    let currentCash = Number(portfolio.cash_balance);
    const posMap = new Map<string, Position>();
    
    (positionsRaw || []).forEach((p: any) => {
      posMap.set(p.symbol, {
        symbol: p.symbol,
        shares: Number(p.shares),
        last_buy_price: Number(p.last_buy_price || 0),
        avg_price: Number(p.avg_price || 0)
      });
    });

    // C. 交易循环
    for (const symbol of CONFIG.SYMBOLS) {
      const data = marketData[symbol];
      if (!data) continue;

      const { price } = data;
      const pos = posMap.get(symbol); 
      const shares = pos ? pos.shares : 0;
      const avgPrice = pos ? pos.avg_price : 0;
      const lastPrice = pos ? pos.last_buy_price : 0;
      const hasPos = shares > 0;

      let result = null;

      // --- 策略逻辑 ---
      switch (investor.id) {
        case 'leek': 
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
        
        case 'gambler':
          if (!hasPos && currentCash >= 10000) {
             result = await executeTrade(investor.id, symbol, 'BUY', 10000, price, 0, 0, currentCash, '赌怪试探');
          } else if (hasPos) {
            if (price < lastPrice * 0.90 && currentCash >= (shares * price)) { 
              result = await executeTrade(investor.id, symbol, 'BUY', (shares * price), price, shares, avgPrice, currentCash, '输了加倍');
            } else if (price > lastPrice * 1.02) {
              result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, avgPrice, currentCash, '赢了就跑');
            }
          }
          break;

        case 'dog':
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
        
        case 'mom':
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

        case 'xiaoqing':
          if (!hasPos && currentCash >= 100000) {
             result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, 0, 0, currentCash, '小青存股');
          } else if (hasPos && price < lastPrice * 0.85 && currentCash >= 50000) {
             result = await executeTrade(investor.id, symbol, 'BUY', 50000, price, shares, avgPrice, currentCash, '小青越跌越买');
          }
          break;
          
        case 'zen':
           const dice = Math.random();
           if (!hasPos && currentCash >= 100000 && dice > 0.80) {
              result = await executeTrade(investor.id, symbol, 'BUY', 100000, price, 0, 0, currentCash, '缘分到了');
           } else if (hasPos && dice < 0.05) {
              result = await executeTrade(investor.id, symbol, 'SELL_ALL', 0, price, shares, avgPrice, currentCash, '缘分尽了');
           }
           break;

        case 'soldier':
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

      // 🔥 关键修复：立即更新内存中的现金和持仓
      if (result) {
        currentCash = Number(result.newCash); // 确保是数字
        if (result.newShares > 0) {
          posMap.set(symbol, {
            symbol: symbol,
            shares: Number(result.newShares),
            avg_price: Number(result.newAvgPrice),
            last_buy_price: Number(price)
          });
        } else {
          posMap.delete(symbol);
        }
      }
    }

    // D. 结算阶段 (Final Check)
    // 重新计算总资产 = 剩余现金 + (持仓 * 当前市价)
    let marketValue = 0;
    posMap.forEach((p) => {
      const currentPrice = marketData[p.symbol]?.price || p.last_buy_price;
      marketValue += (p.shares * currentPrice);
    });

    const totalEquity = currentCash + marketValue;

    // E. 数据库更新 (带错误检测)
    const { error } = await supabase.from('portfolio').update({ 
      cash_balance: currentCash, 
      total_equity: totalEquity,
      updated_at: new Date().toISOString()
    }).eq('investor_id', investor.id);

    if (error) {
        console.error(`❌ [${investor.name}] 资产更新失败! 原因:`, error.message);
    } else {
        // 成功更新后，写入历史曲线点
        await supabase.from('equity_snapshots').insert({
          investor_id: investor.id,
          total_equity: totalEquity,
          cash_balance: currentCash,
          created_at: new Date().toISOString()
        });
    }
  }
}