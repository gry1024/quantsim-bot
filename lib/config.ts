import { createClient } from '@supabase/supabase-js';

// 1. 获取 URL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// 2. 获取 Key
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
      from: () => ({ select: () => ({ single: () => ({ data: null }), order: () => ({ limit: () => ({ data: [] }) }), upsert: () => ({ select: () => ({}) }), eq: () => ({ single: () => ({ data: null }), maybeSingle: () => ({ data: null }) }) }) }), 
      channel: () => ({ on: () => ({ on: () => ({ subscribe: () => {} }) }), subscribe: () => {}, unsubscribe: () => {} }),
      removeChannel: () => {}
    } as any;

// 定义投资者列表 (与数据库一致)
export const INVESTORS = [
  { id: 'leek', name: '韭菜 (Leek)' },
  { id: 'gambler', name: '赌怪 (Gambler)' },
  { id: 'mom', name: '宝妈 (Mom)' },
  { id: 'dog', name: '狗哥 (Dog)' },
  { id: 'xiaoqing', name: '小青 (Xiaoqing)' },
  { id: 'soldier', name: '兵王 (Soldier)' },
  { id: 'zen', name: '禅定 (Zen)' }, // 👈 新增这一行
];

// 基础配置
export const CONFIG = {
  SYMBOLS: ['QQQ', 'GLD', 'SPY', 'NVDA', 'TLT'], // 标的池
};