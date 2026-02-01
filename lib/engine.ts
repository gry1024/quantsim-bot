import { supabase, CONFIG, INVESTORS } from './config';

// --- 类型定义 ---

interface MarketData {
  price: number;
  open: number; 
  changePercent: number; // 0.05 代表 5%
}

interface Portfolio {
  investor_id: string;
  cash_balance: number;
  total_equity: number;
  peak_equity: number;
  initial_capital: number;
}

interface Position {
  id: string;
  investor_id: string;
  symbol: string;
  shares: number;
  avg_price: number;
  last_buy_price: number; 
}

// --- 辅助函数 ---

/**
 * 获取新浪财经实时价格
 */
async function getMarketPrices(): Promise<Record<string, MarketData>> {
  const symbols = CONFIG.SYMBOLS.map(s => s.toLowerCase()).join(',');
  const url = `https://hq.sinajs.cn/list=${symbols.split(',').map(s => `gb_${s}`).join(',')}`;
  
  try {
    const res = await fetch(url, { 
      headers: { 'Referer': 'https://finance.sina.com.cn/' }, 
      next: { revalidate: 0 } 
    });
    const text = await res.text();
    const marketData: Record<string, MarketData> = {};
    
    // 解析: var hq_str_gb_qqq="Name,Price,Change,ChangePercent,Date,Time...";
    text.split('\n').forEach(line => {
      const match = line.match(/gb_([a-z]+)="([^"]+)"/);
      if (match) {
        const symbol = match[1].toUpperCase();
        const parts = match[2].split(',');
        const price = parseFloat(parts[1]);
        const changePercent = parseFloat(parts[3]) / 100; // 接口返回的是 1.5 代表 1.5%
        const open = price / (1 + changePercent);

        if (!isNaN(price) && price > 0) {
          marketData[symbol] = { price, changePercent, open };
        }
      }
    });
    return marketData;
  } catch (e) {
    console.error("❌ 获取行情网络错误:", e);
    return {};
  }
}

/**
 * 通用交易执行函数
 */
async function executeTrade(
  investorId: string,
  symbol: string,
  action: 'BUY' | 'SELL' | 'SELL_ALL',
  amountUSD: number, // 如果是 SELL_ALL，这里传 0 (自动计算)
  price: number,
  shares: number,
  reason: string,
  cash: number
) {
  let tradeShares = 0;
  let tradeAmount = 0;

  if (action === 'BUY') {
    if (cash < amountUSD) {
        console.log(`⚪ [${investorId}] ${symbol} 资金不足 (${cash.toFixed(0)} < ${amountUSD})`);
        return;
    }
    tradeShares = amountUSD / price;
    tradeAmount = amountUSD;
  } else if (action === 'SELL') {
    tradeShares = amountUSD / price;
    if (tradeShares > shares) tradeShares = shares; 
    tradeAmount = tradeShares * price;
  } else if (action === 'SELL_ALL') {
    tradeShares = shares;
    tradeAmount = shares * price;
    if (tradeShares <= 0) return;
  }

  if (tradeAmount < 10) return; 

  console.log(`⚡ [${investorId}] ${action} ${symbol}: ${reason} | $${tradeAmount.toFixed(0)}`);

  // A. 记录 Trades 表
  await supabase.from('trades').insert({
    investor_id: investorId,
    symbol,
    action: action === 'SELL_ALL' ? 'SELL' : action,
    shares: tradeShares,
    price: price,
    amount: tradeAmount,
    reason,
    created_at: new Date().toISOString()
  });

  // B. 更新 Portfolio 现金
  const newCash = action === 'BUY' ? cash - tradeAmount : cash + tradeAmount;
  await supabase.from('portfolio')
    .update({ cash_balance: newCash })
    .eq('investor_id', investorId);

  // C. 更新 Positions 持仓
  const { data: oldPos } = await supabase.from('positions')
    .select('*')
    .eq('investor_id', investorId)
    .eq('symbol', symbol)
    .maybeSingle();

  let finalShares = oldPos ? Number(oldPos.shares) : 0;
  let finalAvgPrice = oldPos ? Number(oldPos.avg_price) : 0;

  if (action === 'BUY') {
    const oldCost = finalShares * finalAvgPrice;
    finalShares += tradeShares;
    finalAvgPrice = (oldCost + tradeAmount) / finalShares;
    
    await supabase.from('positions').upsert({
      investor_id: investorId,
      symbol,
      shares: finalShares,
      avg_price: finalAvgPrice,
      last_buy_price: price, // 更新最后买入价
      created_at: oldPos ? oldPos.created_at : new Date().toISOString()
    }, { onConflict: 'investor_id,symbol' });

  } else {
    finalShares -= tradeShares;
    if (finalShares < 0.001) {
        await supabase.from('positions').delete().eq('investor_id', investorId).eq('symbol', symbol);
    } else {
        await supabase.from('positions').update({
            shares: finalShares
            // 卖出不影响持仓均价，只影响数量
        }).eq('investor_id', investorId).eq('symbol', symbol);
    }
  }
}

// --- 主逻辑 ---

export async function runTradingBot() {
  const marketData = await getMarketPrices();
  if (Object.keys(marketData).length === 0) return;

  for (const investor of INVESTORS) {
    const investorId = investor.id;

    // 1. 获取资产状况
    const { data: portfolioRaw } = await supabase.from('portfolio').select('*').eq('investor_id', investorId).single();
    if (!portfolioRaw) continue; 
    const portfolio = portfolioRaw as Portfolio;

    const { data: positionsRaw } = await supabase.from('positions').select('*').eq('investor_id', investorId);
    const positions = (positionsRaw as Position[]) || [];
    const posMap = new Map(positions.map(p => [p.symbol, p]));

    let currentCash = Number(portfolio.cash_balance);
    const peakEquity = Number(portfolio.peak_equity);
    
    // 计算当前动态总权益
    let currentEquity = currentCash;
    positions.forEach(p => {
        const price = marketData[p.symbol]?.price || p.last_buy_price || 0;
        currentEquity += (Number(p.shares) * price);
    });

    // 兵王：更新最高权益 & 计算回撤
    if (currentEquity > peakEquity) {
        await supabase.from('portfolio').update({ peak_equity: currentEquity }).eq('investor_id', investorId);
    }
    const drawdown = peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0;

    // 2. 策略执行循环
    for (const symbol of CONFIG.SYMBOLS) {
      const data = marketData[symbol];
      if (!data) continue;

      const { price, changePercent } = data;
      const pos = posMap.get(symbol);
      const hasPos = pos && pos.shares > 0;
      const shares = hasPos ? Number(pos.shares) : 0;
      const lastBuyPrice = hasPos ? Number(pos.last_buy_price) : 0; // 上次成交价
      const avgPrice = hasPos ? Number(pos.avg_price) : 0; // 持仓成本

      // --------------------------------------------------------------------------------
      // 🎭 策略逻辑开始
      // --------------------------------------------------------------------------------
      
      switch (investorId) {
        case 'leek': 
            // 🌿 韭菜：$50k底仓 | 涨 > 5% 追买$50k | 跌 > 5% 杀跌$50k
            if (!hasPos) {
                if (currentCash >= 50000) 
                    await executeTrade(investorId, symbol, 'BUY', 50000, price, 0, '韭菜建仓', currentCash);
            } else {
                if (changePercent > 0.05) 
                    await executeTrade(investorId, symbol, 'BUY', 50000, price, 0, `追高(+${(changePercent*100).toFixed(1)}%)`, currentCash);
                else if (changePercent < -0.05)
                    await executeTrade(investorId, symbol, 'SELL', 50000, price, shares, `杀跌(${ (changePercent*100).toFixed(1) }%)`, currentCash);
            }
            break;

        case 'gambler': 
            // 🎲 赌怪：$10k底仓 | 现价 < 上次*0.9 双倍补仓 | 现价 > 均价*1.01 清仓
            if (!hasPos) {
                if (currentCash >= 10000)
                    await executeTrade(investorId, symbol, 'BUY', 10000, price, 0, '首注', currentCash);
            } else {
                if (price < lastBuyPrice * 0.90) {
                    // 双倍补仓：补仓金额 = 当前持仓的市值 (Martingale 变种)
                    // 或者简单理解为：上次买入额的2倍？这里按 Prompt: "双倍金额"
                    // 假设为了回本，通常是倍投。这里用持仓市值近似"已投入资金"的加倍
                    const betAmount = shares * price; 
                    if (currentCash >= betAmount)
                        await executeTrade(investorId, symbol, 'BUY', betAmount, price, 0, '输了加倍', currentCash);
                } else if (price > avgPrice * 1.01) {
                    await executeTrade(investorId, symbol, 'SELL_ALL', 0, price, shares, '赢钱离场', currentCash);
                }
            }
            break;

        case 'mom': 
            // 👩 宝妈：$200k满仓 | 现价 > 上次*1.2 卖20% | 现价 < 上次*0.95 清仓
            if (!hasPos) {
                if (currentCash >= 200000)
                    await executeTrade(investorId, symbol, 'BUY', 200000, price, 0, '满仓存钱', currentCash);
            } else {
                if (price > lastBuyPrice * 1.20) {
                    const sellAmount = (shares * price) * 0.20;
                    await executeTrade(investorId, symbol, 'SELL', sellAmount, price, shares, '止盈补贴', currentCash);
                } else if (price < lastBuyPrice * 0.95) {
                    await executeTrade(investorId, symbol, 'SELL_ALL', 0, price, shares, '亏损离场', currentCash);
                }
            }
            break;

        case 'dog': 
            // 🐶 狗哥：$40k底仓 (保80w现金) | 现价 > 买入*1.05 卖50% | 现价 < 买入*0.98 清仓
            const safeCashLine = 800000;
            const availableCash = currentCash - safeCashLine;
            
            if (!hasPos) {
                if (availableCash >= 40000)
                    await executeTrade(investorId, symbol, 'BUY', 40000, price, 0, '猥琐建仓', currentCash);
            } else {
                // 注意：狗哥的"买入价"对于底仓来说就是 lastBuyPrice (或者 avgPrice，这里假设不做T，用lastBuyPrice作为参考)
                if (price > lastBuyPrice * 1.05) {
                    const sellAmount = (shares * price) * 0.50;
                    await executeTrade(investorId, symbol, 'SELL', sellAmount, price, shares, '赚点狗粮', currentCash);
                } else if (price < lastBuyPrice * 0.98) {
                    await executeTrade(investorId, symbol, 'SELL_ALL', 0, price, shares, '苗头不对', currentCash);
                }
            }
            break;

        case 'xiaoqing': 
            // 🐍 小青：$100k底仓 | 现价 < 上次*0.85 买$50k | 永不卖出
            if (!hasPos) {
                if (currentCash >= 100000)
                    await executeTrade(investorId, symbol, 'BUY', 100000, price, 0, '痴情建仓', currentCash);
            } else {
                if (price < lastBuyPrice * 0.85 && currentCash >= 50000) {
                    await executeTrade(investorId, symbol, 'BUY', 50000, price, 0, '深跌补仓', currentCash);
                }
            }
            break;
            
        case 'soldier': 
            // 🪖 兵王：$100k底仓 | 现价 < 上次*0.98 买$10k | 现价 > 上次*1.02 卖20% | 回撤>10%停止买入
            
            // 熔断检查
            if (drawdown > 0.10) {
                // 仅允许卖出，不允许买入
                if (hasPos && price > lastBuyPrice * 1.02) {
                     const sellAmount = (shares * price) * 0.20;
                     await executeTrade(investorId, symbol, 'SELL', sellAmount, price, shares, '战术撤退(熔断中)', currentCash);
                }
                break; // 跳过此标的的其他操作
            }

            if (!hasPos) {
                if (currentCash >= 100000)
                    await executeTrade(investorId, symbol, 'BUY', 100000, price, 0, '战术建仓', currentCash);
            } else {
                if (price < lastBuyPrice * 0.98 && currentCash >= 10000) {
                    await executeTrade(investorId, symbol, 'BUY', 10000, price, 0, '梯队补给', currentCash);
                } else if (price > lastBuyPrice * 1.02) {
                    const sellAmount = (shares * price) * 0.20;
                    await executeTrade(investorId, symbol, 'SELL', sellAmount, price, shares, '收缩战线', currentCash);
                }
            }
            break;
            case 'zen': 
            // 🧘 禅定：随机游走，无视涨跌
            if (!hasPos) {
                // 初始建仓 $100,000
                if (currentCash >= 100000) {
                    await executeTrade(investorId, symbol, 'BUY', 100000, price, 0, '缘分到了(建仓)', currentCash);
                }
            } else {
                // 每日随机买入或卖出 $10,000
                const isBuy = Math.random() > 0.5;
                const tradeAmount = 10000;

                if (isBuy) {
                    // 随机买入
                    if (currentCash >= tradeAmount) {
                         await executeTrade(investorId, symbol, 'BUY', tradeAmount, price, 0, '随缘买入', currentCash);
                    }
                } else {
                    // 随机卖出
                    // 确保有足够的持仓可卖 (防止不够卖 $10,000)
                    const sellShares = tradeAmount / price;
                    if (shares >= sellShares) {
                         await executeTrade(investorId, symbol, 'SELL', tradeAmount, price, shares, '随缘卖出', currentCash);
                    } else if (shares > 0) {
                         // 不够 $10,000 就全卖了
                         await executeTrade(investorId, symbol, 'SELL_ALL', 0, price, shares, '尘归尘土归土', currentCash);
                    }
                }
            }
            break;
      }
    }

    // 3. 结算与快照
    await supabase.from('portfolio').update({ 
        total_equity: currentEquity
    }).eq('investor_id', investorId);

    await supabase.from('equity_snapshots').insert({
        investor_id: investorId,
        total_equity: currentEquity,
        cash_balance: currentCash,
        created_at: new Date().toISOString()
    });
    
    console.log(`💰 [${investorId}] 结算完毕 | 总权益: $${currentEquity.toFixed(0)}`);
  }
}