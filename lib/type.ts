// lib/type.ts

export interface MarketData {
    symbol: string;
    price: number;
    changePercent: number;
    open: number;
  }
  
  export interface Portfolio {
    investor_id: string;
    cash_balance: number;
    total_equity: number;
    initial_capital: number;
    peak_equity?: number;
  }
  
  export interface Position {
    investor_id: string;
    symbol: string;
    shares: number;
    avg_price: number;
    last_buy_price: number;
    last_action_price: number;
    updated_at: string;
  }
  
  export interface TradeDecision {
    action: 'BUY' | 'SELL' | 'HOLD';
    amountUSD?: number;
    shares?: number;
    reason: string;
  }
  
  // 🔧 修改这里：增加 weeklyStats
  export interface StrategyParams {
    symbol: string;
    price: number;
    cash: number;
    position: Position | null;
    isTradedToday: boolean;
    totalEquity: number;
    marketData: MarketData;
    weeklyHigh?: number; // 新增：周高
    weeklyLow?: number;  // 新增：周低
  }
  
  export type StrategyFn = (params: StrategyParams) => TradeDecision;