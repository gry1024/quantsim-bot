// app/page.tsx
import DashboardClient from './components/DashboardClient';
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../lib/config';

// 强制动态渲染，确保每次刷新获取最新排名
export const revalidate = 0;

export default async function Page() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 默认视角
  const defaultId = 'leek';

  // 1. 并行获取数据
  const [allPortfoliosRes, positionsRes, tradesRes, candlesRes, snapshotsRes] = await Promise.all([
    supabase.from('portfolio').select('*'), // 获取【所有】人的资产数据
    supabase.from('positions').select('*').eq('investor_id', defaultId),
    supabase.from('trades').select('*').eq('investor_id', defaultId).order('created_at', { ascending: false }).limit(50),
    
    // 🔥【核心修复】
    // 1. order('date', { ascending: false }): 降序排列，保证优先拿到“2026年”的最新数据。
    // 2. limit(3000): Supabase 默认一次只给 1000 条。你有 5 个标的，如果总量超 1000，升序取就会截断最新数据。
    //    扩大到 30000 足以覆盖 5 个标的近 2 年的所有 K 线。
    supabase
      .from('market_candles')
      .select('*')
      .in('symbol', CONFIG.SYMBOLS) // ✅ 新增：只查询配置文件中定义的有效标的
      .order('date', { ascending: false }) 
      .limit(30000), 

    supabase.from('equity_snapshots').select('*').eq('investor_id', defaultId).order('created_at', { ascending: true }).limit(100)
  ]);

  // 2. 数据处理
  const allPortfolios = allPortfoliosRes.data || [];
  // 从列表中找到默认用户的 portfolio
  const currentPortfolio = allPortfolios.find(p => p.investor_id === defaultId) || null;

  const historyMap: Record<string, any[]> = {};
  const rawCandles = candlesRes.data || [];

  // 3. 数据整理到 Map 中
  rawCandles.forEach((candle) => {
    if (!historyMap[candle.symbol]) historyMap[candle.symbol] = [];
    historyMap[candle.symbol].push({
      time: candle.date,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
  });

  // 🔥【再次排序】
  // 我们从数据库拿的是“降序”（为了不丢失最新数据），但图表需要“升序”（时间从左到右）。
  // 所以在这里对每个标的的数据进行反转排序。
  Object.keys(historyMap).forEach(symbol => {
    historyMap[symbol].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  });

  const equityData = snapshotsRes.data?.map(s => ({
    time: s.created_at.split('T')[0],
    value: s.total_equity
  })) || [];

  return (
    <DashboardClient 
      defaultInvestorId={defaultId}
      initialAllPortfolios={allPortfolios} 
      initialPortfolio={currentPortfolio}
      initialPositions={positionsRes.data || []}
      initialTrades={tradesRes.data || []}
      initialChartData={equityData}
      historyMap={historyMap}
    />
  );
}