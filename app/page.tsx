import DashboardClient from './components/DashboardClient';
import { createClient } from '@supabase/supabase-js';

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
    supabase.from('portfolio').select('*'), // 👈 改动：获取【所有】人的资产数据
    supabase.from('positions').select('*').eq('investor_id', defaultId),
    supabase.from('trades').select('*').eq('investor_id', defaultId).order('created_at', { ascending: false }).limit(50),
    supabase.from('market_candles').select('*').order('date', { ascending: true }),
    supabase.from('equity_snapshots').select('*').eq('investor_id', defaultId).order('created_at', { ascending: true }).limit(100)
  ]);

  // 2. 数据处理
  const allPortfolios = allPortfoliosRes.data || [];
  // 从列表中找到默认用户的 portfolio
  const currentPortfolio = allPortfolios.find(p => p.investor_id === defaultId) || null;

  const historyMap: Record<string, any[]> = {};
  candlesRes.data?.forEach((candle) => {
    if (!historyMap[candle.symbol]) historyMap[candle.symbol] = [];
    historyMap[candle.symbol].push({
      time: candle.date,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
  });

  const equityData = snapshotsRes.data?.map(s => ({
    time: s.created_at.split('T')[0],
    value: s.total_equity
  })) || [];

  return (
    <DashboardClient 
      defaultInvestorId={defaultId}
      initialAllPortfolios={allPortfolios} // 👈 传入所有人的钱包数据
      initialPortfolio={currentPortfolio}
      initialPositions={positionsRes.data || []}
      initialTrades={tradesRes.data || []}
      initialChartData={equityData}
      historyMap={historyMap}
    />
  );
}