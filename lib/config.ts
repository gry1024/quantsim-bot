
  import { createClient } from '@supabase/supabase-js';
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  
  export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  
  export const INVESTORS = [
    { id: 'leek', name: '韭菜 (Leek)' },
    { id: 'gambler', name: '赌怪 (Gambler)' },
    { id: 'mom', name: '宝妈 (Mom)' },
    { id: 'dog', name: '狗哥 (Dog)' },
    { id: 'xiaoqing', name: '小青 (Xiaoqing)' },
    { id: 'soldier', name: '兵王 (Soldier)' },
    { id: 'zen', name: '高僧 (Monk)' },
  ];
  
  export const CONFIG = {
    // ✅ 确保这里包含 'TLT'
    SYMBOLS: ['QQQ', 'GLD', 'SPY', 'NVDA', 'TLT'],
    INITIAL_CAPITAL: 1000000,
  };