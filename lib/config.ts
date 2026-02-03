// lib/config.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const INVESTORS = [
  { id: 'leek', name: '韭菜' },
  { id: 'gambler', name: '赌怪' },
  { id: 'mom', name: '宝妈' },
  { id: 'dog', name: '狗哥' },
  { id: 'xiaoqing', name: '小青' },
  { id: 'soldier', name: '兵王' },
  { id: 'zen', name: '高僧' },
  { id: 'poet', name: '诗人' },
];

export const CONFIG = {
  // 包含 COIN
  SYMBOLS: ['QQQ', 'GLD', 'SPY', 'NVDA', 'COIN'],
  INITIAL_CAPITAL: 1000000,
};