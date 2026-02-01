
    export interface MarketData {
      symbol: string;
      price: number;
      changePercent: number; // e.g. 0.05 for 5%
      open: number;
    }
    
    export interface Portfolio {
      investor_id: string;
      cash_balance: number;
      total_equity: number;
      initial_capital: number;
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
    
    export interface Trade {
      investor_id: string;
      symbol: string;
      action: 'BUY' | 'SELL';
      shares: number;
      price: number;
      amount: number;
      reason: string;
      created_at?: string;
    }
    
    // 策略返回的决策结果
    export interface StrategyDecision {
      action: 'BUY' | 'SELL' | 'HOLD';
      amountUSD?: number; // 期望交易的金额（USD）
      quantity?: number;  // 或者期望交易的数量（优先使用 quantity，若无则用 amountUSD 计算）
      reason: string;
    }
    
    // 策略函数的统一签名
    export type StrategyFunction = (
      context: {
        symbol: string;
        price: number;
        cash: number;
        position: Position | null; // 当前该标的的持仓
        todayTrades: Trade[];      // 今日该标的的交易记录（用于限制频率）
        marketData: MarketData;    // 完整行情
        totalEquity: number;       // 当前总权益（用于计算仓位占比）
      }
    ) => StrategyDecision;
    