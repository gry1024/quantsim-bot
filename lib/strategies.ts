
    import { StrategyFunction, StrategyDecision } from './types';
    
    // 辅助函数：判断今天是否已经操作过
    const hasTradedToday = (trades: any[]): boolean => {
      return trades.length > 0;
    };
    
    // ================= 策略实现 =================
    
    // 1. 韭菜 (Leek): 追涨杀跌
    const leekStrategy: StrategyFunction = ({ price, cash, position, todayTrades }) => {
      if (hasTradedToday(todayTrades)) return { action: 'HOLD', reason: '日内限制' };
    
      // 建仓
      if (!position && cash >= 50000) {
        return { action: 'BUY', amountUSD: 50000, reason: '韭菜底仓' };
      }
    
      // 持仓检测
      if (position) {
        const lastPrice = position.last_action_price || position.avg_price;
        const change = (price - lastPrice) / lastPrice;
    
        // 涨 > 5% 追高
        if (change > 0.05 && cash >= 50000) {
          return { action: 'BUY', amountUSD: 50000, reason: '追涨杀跌-追高' };
        }
        // 跌 > 5% 割肉
        if (change < -0.05) {
          return { action: 'SELL', quantity: position.shares, reason: '追涨杀跌-割肉' }; // 全部卖出
        }
      }
    
      return { action: 'HOLD', reason: '无信号' };
    };
    
    // 2. 赌怪 (Gambler): 马丁格尔策略
    const gamblerStrategy: StrategyFunction = ({ price, cash, position, todayTrades }) => {
      if (hasTradedToday(todayTrades)) return { action: 'HOLD', reason: '日内限制' };
    
      if (!position && cash >= 10000) {
        return { action: 'BUY', amountUSD: 10000, reason: '赌怪底仓' };
      }
    
      if (position) {
        // 相对上次买入价下跌 10%，双倍补仓
        const lastBuy = position.last_buy_price || position.avg_price;
        if (price < lastBuy * 0.90) {
          const currentCost = position.shares * position.avg_price;
          // 补仓金额等于当前持仓总成本 (Double Down)
          if (cash >= currentCost) {
            return { action: 'BUY', amountUSD: currentCost, reason: '马丁格尔-双倍补仓' };
          }
        }
    
        // 相对均价上涨 2%，全部止盈
        if (price > position.avg_price * 1.02) {
          return { action: 'SELL', quantity: position.shares, reason: '获利离场' };
        }
      }
    
      return { action: 'HOLD', reason: '无信号' };
    };
    
    // 3. 宝妈 (Mom): 止盈止损明确
    const momStrategy: StrategyFunction = ({ price, cash, position, todayTrades }) => {
      if (hasTradedToday(todayTrades)) return { action: 'HOLD', reason: '日内限制' };
    
      if (!position && cash >= 200000) {
        return { action: 'BUY', amountUSD: 200000, reason: '宝妈满仓' };
      }
    
      if (position) {
        const lastBuy = position.last_buy_price || position.avg_price;
        // 涨 20% 卖出 20%
        if (price > lastBuy * 1.20) {
          return { action: 'SELL', quantity: position.shares * 0.2, reason: '高位取现' };
        }
        // 跌 5% 全部止损
        if (price < lastBuy * 0.95) {
          return { action: 'SELL', quantity: position.shares, reason: '严格止损' };
        }
      }
      return { action: 'HOLD', reason: '无信号' };
    };
    
    // 4. 狗哥 (Dog): 保本流
    const dogStrategy: StrategyFunction = ({ price, cash, position, todayTrades }) => {
      if (hasTradedToday(todayTrades)) return { action: 'HOLD', reason: '日内限制' };
      
      // 必须保留 80w 现金
      const safeCash = cash - 800000;
    
      if (!position && safeCash >= 40000) {
        return { action: 'BUY', amountUSD: 40000, reason: '狗哥底仓' };
      }
    
      if (position) {
        const lastAction = position.last_action_price || position.avg_price;
        // 涨 5% 卖一半
        if (price > lastAction * 1.05) {
          return { action: 'SELL', quantity: position.shares * 0.5, reason: '落袋为安' };
        }
        // 跌 2% 清仓
        if (price < lastAction * 0.98) {
          return { action: 'SELL', quantity: position.shares, reason: '快速止损' };
        }
      }
      return { action: 'HOLD', reason: '无信号' };
    };
    
    // 5. 小青 (Xiaoqing): 死多头
    const xiaoqingStrategy: StrategyFunction = ({ price, cash, position, todayTrades }) => {
      if (hasTradedToday(todayTrades)) return { action: 'HOLD', reason: '日内限制' };
    
      if (!position && cash >= 100000) {
        return { action: 'BUY', amountUSD: 100000, reason: '长期主义' };
      }
    
      if (position) {
        const lastAction = position.last_action_price || position.avg_price;
        // 跌 15% 加仓
        if (price < lastAction * 0.85 && cash >= 50000) {
          return { action: 'BUY', amountUSD: 50000, reason: '越跌越买' };
        }
      }
      // 永不卖出
      return { action: 'HOLD', reason: '坚定持有' };
    };
    
    // 6. 兵王 (Soldier): 动态回撤控制
    const soldierStrategy: StrategyFunction = ({ price, cash, position, todayTrades, totalEquity }) => {
      if (hasTradedToday(todayTrades)) return { action: 'HOLD', reason: '日内限制' };
    
      // 假设初始资金 100w，如果总资产跌破 90w (回撤10%)，停止买入
      const isDrawdownSafe = totalEquity >= 900000;
    
      if (!position && cash >= 100000 && isDrawdownSafe) {
        return { action: 'BUY', amountUSD: 100000, reason: '兵王出击' };
      }
    
      if (position) {
        const lastAction = position.last_action_price || position.avg_price;
        // 跌 2% 补仓 (仅当回撤安全时)
        if (price < lastAction * 0.98 && cash >= 10000 && isDrawdownSafe) {
          return { action: 'BUY', amountUSD: 10000, reason: '战术补给' };
        }
        // 涨 2% 撤退 20%
        if (price > lastAction * 1.02) {
          return { action: 'SELL', quantity: position.shares * 0.2, reason: '战术撤退' };
        }
      }
      return { action: 'HOLD', reason: '等待指令' };
    };
    
    // 7. 高僧 (Zen): 随机
    const zenStrategy: StrategyFunction = ({ cash, position }) => {
      // 高僧不受日内限制，但受冷却时间限制（Engine层假设每小时运行一次，这里用随机数模拟24h触发）
      // 为了简化，这里假设每次都有 1/24 的概率触发操作
      const shouldAct = Math.random() < (1/24); 
      
      if (!shouldAct) return { action: 'HOLD', reason: '打坐中' };
    
      const dice = Math.random();
      if (dice > 0.5 && cash >= 50000) {
        return { action: 'BUY', amountUSD: 50000, reason: '缘分到了-买' };
      } else if (dice <= 0.5 && position && position.shares > 0) {
        // 卖出价值 50000 的份额
        return { action: 'SELL', amountUSD: 50000, reason: '缘分到了-卖' };
      }
    
      return { action: 'HOLD', reason: '随缘' };
    };
    
    // 注册所有策略
    export const STRATEGIES: Record<string, StrategyFunction> = {
      leek: leekStrategy,
      gambler: gamblerStrategy,
      mom: momStrategy,
      dog: dogStrategy,
      xiaoqing: xiaoqingStrategy,
      soldier: soldierStrategy,
      zen: zenStrategy
    };
    