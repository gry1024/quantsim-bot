// lib/strategies.ts
import { StrategyFn, TradeDecision, StrategyParams } from './type';

// ================== 策略实现 ==================

// 1. 韭菜 (Leek)
// 逻辑: 底仓10w. 日涨幅>2%追5w. 日跌幅>5%清仓.
const leekStrategy: StrategyFn = ({ position, cash, isTradedToday, marketData }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  // 底仓
  if (!position) {
    return cash >= 100000 ? { action: 'BUY', amountUSD: 100000, reason: '底仓' } : { action: 'HOLD', reason: '资金不足' };
  }

  // Sina API 的 changePercent 通常是 2.5 代表 2.5%
  // 假设 engine 中解析时做了 /100 处理，如果是原样数值则需调整。
  // 原 engine 代码: changePercent: parseFloat(parts[3]) / 100. 所以 0.02 就是 2%.
  const change = marketData.changePercent; 

  if (change > 0.02 && cash >= 50000) return { action: 'BUY', amountUSD: 50000, reason: '追涨' };
  if (change < -0.05) return { action: 'SELL', shares: position.shares, reason: '割肉止损' };

  return { action: 'HOLD', reason: '观望' };
};

// 2. 赌怪 (Gambler)
// 逻辑: 底仓10w. 现价 < 上次买入价 * 0.97 (-3%) -> 加倍补仓(买入当前持仓市值的金额). 现价 > 上次买入价 * 1.03 (+3%) -> 卖出30%.
const gamblerStrategy: StrategyFn = ({ position, price, cash, isTradedToday }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  if (!position) {
    return cash >= 100000 ? { action: 'BUY', amountUSD: 100000, reason: '底仓' } : { action: 'HOLD', reason: '资金不足' };
  }

  const lastBuy = position.last_buy_price || position.avg_price;
  
  // 补仓逻辑
  if (price < lastBuy * 0.97) {
    const currentMarketValue = position.shares * price;
    // 假设是“同等金额”补仓，指当前持仓价值
    // 也可以理解为“持仓成本”同等金额。原文“当前持仓成本同等金额”。
    const cost = position.shares * position.avg_price;
    if (cash >= cost) return { action: 'BUY', amountUSD: cost, reason: '马丁补仓' };
  }

  // 止盈逻辑
  if (price > lastBuy * 1.03) {
    return { action: 'SELL', shares: position.shares * 0.3, reason: '获利减仓' };
  }

  return { action: 'HOLD', reason: '观望' };
};

// 3. 宝妈 (Mom)
// 逻辑: 满仓20w. 现价 > 上次买入 * 1.10 -> 卖出20%取现. 永不买入(除底仓).
const momStrategy: StrategyFn = ({ position, price, cash, isTradedToday }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  if (!position) {
    // 只有第一次允许买入
    return cash >= 200000 ? { action: 'BUY', amountUSD: 200000, reason: '满仓买入' } : { action: 'HOLD', reason: '资金不足' };
  }

  const lastBuy = position.last_buy_price || position.avg_price;
  
  if (price > lastBuy * 1.10) {
    return { action: 'SELL', shares: position.shares * 0.20, reason: '止盈取现' };
  }

  return { action: 'HOLD', reason: '持有' };
};

// 4. 狗哥 (Dog)
// 逻辑: 底仓5w. 现价 > 上次成交 * 1.05 -> 卖一半. 单日跌幅 > 2% -> 买1w. 总资产 < 50w -> 清仓.
const dogStrategy: StrategyFn = ({ position, price, cash, isTradedToday, marketData, totalEquity }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  // 止损退场线
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
  const change = marketData.changePercent; // 0.02 = 2%

  // 止盈
  if (price > lastAction * 1.05) {
    return { action: 'SELL', shares: position.shares * 0.5, reason: '止盈一半' };
  }

  // 抄底
  if (change < -0.02 && cash >= 10000) {
    return { action: 'BUY', amountUSD: 10000, reason: '大跌补仓' };
  }

  return { action: 'HOLD', reason: '观望' };
};

// 5. 小青 (Xiaoqing)
// 逻辑: 底仓10w. 现价 < 上次成交 * 0.97 (-3%) -> 加仓5w. 永不卖出.
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
// 逻辑: 底仓10w. 跌破周低 -> 买入50%仓位(加仓). 突破周高 -> 卖出10%仓位.
const soldierStrategy: StrategyFn = ({ position, price, cash, isTradedToday, weeklyHigh, weeklyLow }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  if (!position) {
    return cash >= 100000 ? { action: 'BUY', amountUSD: 100000, reason: '战术底仓' } : { action: 'HOLD', reason: '资金不足' };
  }

  // 如果没有历史数据，无法决策
  if (!weeklyHigh || !weeklyLow) return { action: 'HOLD', reason: '无情报' };

  // 跌破周低 -> 抄底
  if (price < weeklyLow) {
    // 买入 50% 仓位 = 当前持仓股数 * 0.5 * 当前价格
    const addAmount = (position.shares * 0.5) * price;
    if (cash >= addAmount) return { action: 'BUY', amountUSD: addAmount, reason: '破位抄底' };
  }

  // 突破周高 -> 止盈
  if (price > weeklyHigh) {
    return { action: 'SELL', shares: position.shares * 0.1, reason: '新高减仓' };
  }

  return { action: 'HOLD', reason: '潜伏' };
};

// 7. 高僧 (Zen)
// 逻辑: 底仓10w. 每天对每支标的以持仓金额的10%随机买入或卖出.
const zenStrategy: StrategyFn = ({ position, price, cash, isTradedToday }: StrategyParams): TradeDecision => {
  if (isTradedToday) return { action: 'HOLD', reason: '日内限频' };

  if (!position) {
    return cash >= 100000 ? { action: 'BUY', amountUSD: 100000, reason: '缘起' } : { action: 'HOLD', reason: '缘灭' };
  }

  // 随机操作
  const roll = Math.random(); 
  const operateValue = (position.shares * price) * 0.10; // 持仓金额的 10%

  // 50% 概率买，50% 概率卖 (或者只要触发了就只做一件事? 题目说"随机买入或卖出")
  // 我们可以设 0-0.5 买， 0.5-1.0 卖
  if (roll < 0.5) {
    // 买
    if (cash >= operateValue) return { action: 'BUY', amountUSD: operateValue, reason: '随缘化缘' };
  } else {
    // 卖
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