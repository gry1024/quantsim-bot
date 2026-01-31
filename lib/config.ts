import { createClient } from '@supabase/supabase-js';

// 1. 获取 URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// 2. 获取 Key (适配多种情况)
const supabaseKey = 
  process.env.SUPABASE_SERVICE_ROLE_KEY || 
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || 
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// 3. 初始化客户端
export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : { 
      from: () => ({ select: () => ({ single: () => ({ data: null }), order: () => ({ limit: () => ({ data: [] }) }), upsert: () => ({ select: () => ({}) }) }) }), 
      channel: () => ({ on: () => ({ on: () => ({ subscribe: () => {} }) }), subscribe: () => {}, unsubscribe: () => {} }),
      removeChannel: () => {}
    } as any;

// 4. 🚀 新版全局策略配置 (Strategy V2)
export const CONFIG = {
  SYMBOLS: ['QQQ', 'GLD', 'SPY', 'NVDA', 'TLT'], // 标的池
  
  // 资金参数
  INITIAL_CAPITAL: 1000000,      // 初始总资金
  INITIAL_ENTRY_AMOUNT: 100000,  // 初始建仓金额 (每股 $100,000)
  DIP_ADD_AMOUNT: 10000,         // 补仓金额 ($10,000)
  
  // 阈值参数
  THRESHOLD_DIP: 0.02,           // 下跌补仓阈值 (-2.0%)
  THRESHOLD_PROFIT: 0.02,        // 上涨止盈阈值 (+2.0%)
  SELL_RATIO: 0.20,              // 止盈卖出比例 (20%)
  
  // 风控参数
  MAX_DRAWDOWN_LIMIT: 0.10,      // 最大回撤熔断线 (10%)
};