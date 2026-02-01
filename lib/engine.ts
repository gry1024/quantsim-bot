
  import { supabase, CONFIG, INVESTORS } from './config';
  import { STRATEGIES } from './strategies';
  import { MarketData, Position, Trade, Portfolio, StrategyDecision } from './types';
  
  // 获取实时行情
  async function getMarketPrices(): Promise<Record<string, MarketData>> {
    const symbols = CONFIG.SYMBOLS.map(s => s.toLowerCase()).join(',');
    const url = `https://hq.sinajs.cn/list=${symbols.split(',').map(s => `gb_${s}`).join(',')}&t=${Date.now()}`;
    
    try {
      const res = await fetch(url, { headers: { 'Referer': 'https://finance.sina.com.cn/' }, cache: 'no-store' });
      const text = await res.text();
      const marketData: Record<string, MarketData> = {};
      
      text.split('\n').forEach((line) => {
        const match = line.match(/gb_([a-z]+)="([^"]+)"/);
        if (match) {
          const symbol = match[1].toUpperCase();
          const parts = match[2].split(',');
          const price = parseFloat(parts[1]);
          const changePercent = parseFloat(parts[3]) / 100;
          
          if (!isNaN(price) && price > 0) {
            marketData[symbol] = { 
              symbol, 
              price, 
              changePercent, 
              open: parseFloat(parts[5]) || price // part 5 is usually open
            };
          }
        }
      });
      return marketData;
    } catch (e: any) {
      console.error(`❌ 行情失败: ${e.message}`);
      return {};
    }
  }
  
  // 核心执行逻辑
  export async function runTradingBot() {
    console.log(`\n🔄 [${new Date().toLocaleTimeString()}] 启动量化引擎...`);
    
    // 1. 获取市场行情
    const marketMap = await getMarketPrices();
    if (Object.keys(marketMap).length === 0) return;
  
    // 2. 遍历每一位投资者
    for (const investor of INVESTORS) {
      const investorId = investor.id;
      console.log(`👤 正在扫描: ${investor.name}`);
  
      // --- A. 数据加载阶段 ---
      // 并行获取 Portfolio, Positions, Trades(Today)
      const todayStr = new Date().toISOString().split('T')[0];
      const [portRes, posRes, tradeRes] = await Promise.all([
        supabase.from('portfolio').select('*').eq('investor_id', investorId).single(),
        supabase.from('positions').select('*').eq('investor_id', investorId),
        supabase.from('trades').select('*').eq('investor_id', investorId).gte('created_at', todayStr)
      ]);
  
      // 初始化账户 (如果不存在)
      let portfolio: Portfolio = portRes.data;
      if (!portfolio) {
        const { data } = await supabase.from('portfolio').insert({
          investor_id: investorId,
          cash_balance: CONFIG.INITIAL_CAPITAL,
          total_equity: CONFIG.INITIAL_CAPITAL,
          initial_capital: CONFIG.INITIAL_CAPITAL
        }).select().single();
        portfolio = data;
      }
  
      const positions: Position[] = posRes.data || [];
      const todaysTrades: Trade[] = tradeRes.data || [];
  
      // 当前现金缓存（随交易扣减）
      let currentCash = Number(portfolio.cash_balance);
      const updatedPositions = new Map<string, Position>(); // 用于计算最终净值
      positions.forEach(p => updatedPositions.set(p.symbol, p));
  
      // --- B. 策略执行阶段 ---
      const strategy = STRATEGIES[investorId];
      if (!strategy) {
        console.warn(`   ⚠️ 未找到策略: ${investorId}`);
        continue;
      }
  
      // 遍历每一个关注的股票
      for (const symbol of CONFIG.SYMBOLS) {
        const market = marketMap[symbol];
        if (!market) continue;
  
        const position = updatedPositions.get(symbol) || null;
        const symbolTrades = todaysTrades.filter(t => t.symbol === symbol);
        
        // 计算当前估算总资产（用于兵王等依赖回撤的策略）
        let tempTotalEquity = currentCash;
        updatedPositions.forEach(p => {
          const mPrice = marketMap[p.symbol]?.price || p.last_action_price;
          tempTotalEquity += (p.shares * mPrice);
        });
  
        // 1. 调用策略获取决策
        const decision: StrategyDecision = strategy({
          symbol,
          price: market.price,
          cash: currentCash,
          position,
          todayTrades: symbolTrades,
          marketData: market,
          totalEquity: tempTotalEquity
        });
  
        if (decision.action === 'HOLD') continue;
  
        // 2. 执行交易计算
        let tradeShares = 0;
        let tradeAmount = 0;
  
        if (decision.action === 'BUY') {
          const amountToUse = Math.min(decision.amountUSD || 0, currentCash);
          if (amountToUse < 100) continue; // 忽略过小交易
          tradeShares = amountToUse / market.price;
          tradeAmount = amountToUse;
        } else if (decision.action === 'SELL') {
          if (!position || position.shares <= 0) continue;
          // 如果指定了数量则用数量，否则用金额算
          if (decision.quantity) {
             tradeShares = Math.min(decision.quantity, position.shares);
          } else if (decision.amountUSD) {
             tradeShares = Math.min(decision.amountUSD / market.price, position.shares);
          } else {
             continue;
          }
          tradeAmount = tradeShares * market.price;
        }
  
        // 3. 数据库原子操作模拟
        if (tradeShares > 0) {
          // 更新现金
          const newCash = decision.action === 'BUY' ? (currentCash - tradeAmount) : (currentCash + tradeAmount);
          
          // 更新持仓对象
          let newPosShares = position ? position.shares : 0;
          let newPosAvg = position ? position.avg_price : 0;
          const oldCost = newPosShares * newPosAvg;
  
          if (decision.action === 'BUY') {
            newPosShares += tradeShares;
            newPosAvg = (oldCost + tradeAmount) / newPosShares;
          } else {
            newPosShares -= tradeShares;
            // 卖出不改变剩余持仓的成本均价
          }
  
          // 数据库写入: Trade Log
          await supabase.from('trades').insert({
            investor_id: investorId,
            symbol,
            action: decision.action,
            price: market.price,
            shares: tradeShares,
            amount: tradeAmount,
            reason: decision.reason
          });
  
          // 数据库写入: Position
          if (newPosShares < 0.01) {
            await supabase.from('positions').delete().eq('investor_id', investorId).eq('symbol', symbol);
            updatedPositions.delete(symbol);
          } else {
            const upsertData = {
              investor_id: investorId,
              symbol,
              shares: newPosShares,
              avg_price: newPosAvg,
              last_buy_price: decision.action === 'BUY' ? market.price : (position?.last_buy_price || market.price),
              last_action_price: market.price,
              updated_at: new Date().toISOString()
            };
            await supabase.from('positions').upsert(upsertData, { onConflict: 'investor_id,symbol' });
            // 更新内存 Map 以便计算最终 Net Worth
            updatedPositions.set(symbol, upsertData as Position);
          }
  
          // 更新内存 Cash
          currentCash = newCash;
          console.log(`   ✅ [${investor.name}] ${decision.action} ${symbol}: $${tradeAmount.toFixed(0)} (${decision.reason})`);
        }
      } // End Symbol Loop
  
      // --- C. 结算阶段 ---
      // 计算最终总权益 (Total Equity) = 最终现金 + 所有持仓最新市值
      let finalMarketValue = 0;
      updatedPositions.forEach((pos) => {
        const currentPrice = marketMap[pos.symbol]?.price || pos.last_action_price;
        finalMarketValue += (pos.shares * currentPrice);
      });
      
      const finalEquity = currentCash + finalMarketValue;
  
      // 更新 Portfolio 表
      await supabase.from('portfolio').update({
        cash_balance: currentCash,
        total_equity: finalEquity,
        updated_at: new Date().toISOString()
      }).eq('investor_id', investorId);
  
      // 记录权益快照
      await supabase.from('equity_snapshots').insert({
        investor_id: investorId,
        total_equity: finalEquity,
        cash_balance: currentCash,
        created_at: new Date().toISOString()
      });
  
    } // End Investor Loop
    
    console.log(`✅ 扫描结束。`);
  }
