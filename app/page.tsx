import DashboardClient from './components/DashboardClient';
import { createClient } from '@supabase/supabase-js';

// 强制动态渲染，禁用缓存 (确保每次刷新都能看到最新买入的交易)
export const revalidate = 0;

export default async function Page() {
  // 1. 初始化服务端 Supabase 客户端
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 2. 并行获取所有核心数据
  const [portfolioRes, positionsRes, tradesRes, candlesRes] = await Promise.all([
    supabase.from('portfolio').select('*').single(),
    supabase.from('positions').select('*'),
    // 🔧 关键修复：按时间倒序排列，取最新的 50 条
    supabase.from('trades').select('*').order('created_at', { ascending: false }).limit(50),
    supabase.from('market_candles').select('*').order('date', { ascending: true })
  ]);

  // 3. 数据处理 (转换 K 线格式)
  const historyMap: Record<string, any[]> = {};
  const chartData: any[] = []; // 资产走势数据(这里暂时留空或从 snapshots 表获取)
  
  // 处理 K 线数据分组
  candlesRes.data?.forEach((candle) => {
    if (!historyMap[candle.symbol]) {
      historyMap[candle.symbol] = [];
    }
    historyMap[candle.symbol].push({
      time: candle.date,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    });
  });

  // 4. 获取资产走势快照 (可选，为了画最上面的大图)
  const { data: snapshots } = await supabase
    .from('equity_snapshots')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(100);

  const equityData = snapshots?.map(s => ({
    time: s.created_at.split('T')[0], // 简化为 YYYY-MM-DD
    value: s.total_equity
  })) || [];

  return (
    <DashboardClient 
      portfolio={portfolioRes.data}
      positions={positionsRes.data || []}
      trades={tradesRes.data || []} // 👈 这里的 trades 现在包含最新的买入记录了
      chartData={equityData}
      historyMap={historyMap}
    />
  );
}