// lib/strategies.ts
import { StrategyFn, TradeDecision, StrategyParams } from './type';

// 1. 韭菜 (Leek)
const leekStrategy: StrategyFn = ({ position, cash, isTradedToday, marketData }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  if (!position) {
    return cash >= 100000 ? { action: 'BUY', amountUSD: 100000, reason: '底仓' } : { action: 'HOLD', reason: '资金不足' };
  }

  const change = marketData.changePercent; 

  if (change > 0.02 && cash >= 50000) return { action: 'BUY', amountUSD: 50000, reason: '追涨' };
  if (change < -0.05) return { action: 'SELL', shares: position.shares, reason: '割肉止损' };

  return { action: 'HOLD', reason: '观望' };
};

// 2. 赌怪 (Gambler)
const gamblerStrategy: StrategyFn = ({ position, price, cash, isTradedToday }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  if (!position) {
    return cash >= 100000 ? { action: 'BUY', amountUSD: 100000, reason: '底仓' } : { action: 'HOLD', reason: '资金不足' };
  }

  const lastBuy = position.last_buy_price || position.avg_price;
  
  if (price < lastBuy * 0.97) {
    const cost = position.shares * position.avg_price;
    if (cash >= cost) return { action: 'BUY', amountUSD: cost, reason: '马丁补仓' };
  }

  if (price > lastBuy * 1.03) {
    return { action: 'SELL', shares: position.shares * 0.3, reason: '获利减仓' };
  }

  return { action: 'HOLD', reason: '观望' };
};

// 3. 宝妈 (Mom)
const momStrategy: StrategyFn = ({ position, price, cash, isTradedToday }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  if (!position) {
    return cash >= 200000 ? { action: 'BUY', amountUSD: 200000, reason: '满仓买入' } : { action: 'HOLD', reason: '资金不足' };
  }

  const lastBuy = position.last_buy_price || position.avg_price;
  
  if (price > lastBuy * 1.10) {
    return { action: 'SELL', shares: position.shares * 0.20, reason: '止盈取现' };
  }

  return { action: 'HOLD', reason: '持有' };
};

// 4. 狗哥 (Dog)
const dogStrategy: StrategyFn = ({ position, price, cash, isTradedToday, marketData, totalEquity }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  if (totalEquity < 500000 && position) {
    return { action: 'SELL', shares: position.shares, reason: '破产清仓' };
  }
  if (totalEquity < 500000 && !position) {
    return { action: 'HOLD', reason: '退场观望' };
  }

  if (!position) {
    return cash >= 50000 ? { action: 'BUY', amountUSD: 50000, reason: '底仓' } : { action: 'HOLD', reason: '资金不足' };
  }

  const lastAction = position.last_action_price || position.avg_price;
  const change = marketData.changePercent;

  if (price > lastAction * 1.05) {
    return { action: 'SELL', shares: position.shares * 0.5, reason: '止盈一半' };
  }

  if (change < -0.02 && cash >= 10000) {
    return { action: 'BUY', amountUSD: 10000, reason: '大跌补仓' };
  }

  return { action: 'HOLD', reason: '观望' };
};

// 5. 小青 (Xiaoqing)
const xiaoqingStrategy: StrategyFn = ({ position, price, cash, isTradedToday }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  if (!position) {
    return cash >= 100000 ? { action: 'BUY', amountUSD: 100000, reason: '存股开始' } : { action: 'HOLD', reason: '资金不足' };
  }

  const lastAction = position.last_action_price || position.avg_price;

  if (price < lastAction * 0.97 && cash >= 50000) {
    return { action: 'BUY', amountUSD: 50000, reason: '低位定投' };
  }

  return { action: 'HOLD', reason: '囤币' };
};

// 6. 兵王 (Soldier)
const soldierStrategy: StrategyFn = ({ position, price, cash, isTradedToday, weeklyHigh, weeklyLow }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  if (!position) {
    return cash >= 100000 ? { action: 'BUY', amountUSD: 100000, reason: '战术底仓' } : { action: 'HOLD', reason: '资金不足' };
  }

  if (!weeklyHigh || !weeklyLow) return { action: 'HOLD', reason: '无情报' };

  if (price < weeklyLow) {
    const addAmount = (position.shares * 0.5) * price;
    if (cash >= addAmount) return { action: 'BUY', amountUSD: addAmount, reason: '破位抄底' };
  }

  if (price > weeklyHigh) {
    return { action: 'SELL', shares: position.shares * 0.1, reason: '新高减仓' };
  }

  return { action: 'HOLD', reason: '潜伏' };
};

// 7. 高僧 (Zen)
const zenStrategy: StrategyFn = ({ position, price, cash, isTradedToday }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  if (!position) {
    return cash >= 100000 ? { action: 'BUY', amountUSD: 100000, reason: '缘起' } : { action: 'HOLD', reason: '缘灭' };
  }

  const roll = Math.random(); 
  const operateValue = (position.shares * price) * 0.10; 

  if (roll < 0.5) {
    if (cash >= operateValue) return { action: 'BUY', amountUSD: operateValue, reason: '随缘化缘' };
  } else {
    return { action: 'SELL', shares: position.shares * 0.10, reason: '随缘布施' };
  }

  return { action: 'HOLD', reason: '入定' };
};

export const STRATEGIES: Record<string, StrategyFn> = {
  leek: leekStrategy,
  gambler: gamblerStrategy,
  mom: momStrategy,
  dog: dogStrategy,
  xiaoqing: xiaoqingStrategy,
  soldier: soldierStrategy,
  zen: zenStrategy
};