import { supabase } from './config';

export interface KlineData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

// --- 核心功能 A: 从 Stooq 抓取 CSV 并同步到数据库 (Write) ---
export async function syncSymbolHistory(symbol: string) {
  // Stooq 格式: 代码 + .US (例如 NVDA.US)
  const stooqSymbol = `${symbol.toUpperCase()}.US`;
  // 接口: s=代码, i=d (日线)
  const url = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    
    const csvText = await res.text();
    
    // Stooq 返回 CSV 格式:
    // Date,Open,High,Low,Close,Volume
    // 2024-01-30,120.5,122.0,119.5,121.0,5000000
    
    const lines = csvText.split('\n');
    
    // 检查是否有数据 (第一行是表头，第二行开始是数据)
    if (lines.length < 2 || !lines[0].includes('Date')) {
      console.warn(`⚠️ [WARN] ${symbol} Stooq 未返回有效 CSV 数据。Content: ${csvText.substring(0, 50)}`);
      return;
    }

    const candlesToUpsert = [];

    // 从第 1 行开始遍历 (跳过表头)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      // parts: [Date, Open, High, Low, Close, Volume]
      // index: 0=Date, 1=Open, 2=High, 3=Low, 4=Close
      
      const date = parts[0];
      const open = parseFloat(parts[1]);
      const high = parseFloat(parts[2]);
      const low = parseFloat(parts[3]);
      const close = parseFloat(parts[4]);

      // 过滤掉无效数据
      if (isNaN(open) || isNaN(close)) continue;

      candlesToUpsert.push({
        symbol: symbol.toUpperCase(),
        date: date, // "2024-01-30"
        open,
        high,
        low,
        close,
      });
    }

    // 只保留最近 180 天的数据 (Stooq 会返回几十年的，太大了)
    const recentCandles = candlesToUpsert
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-180);

    if (recentCandles.length === 0) return;

    // ⚡️ 写入数据库
    const { error } = await supabase
      .from('market_candles')
      .upsert(recentCandles, { onConflict: 'symbol,date' });

    if (error) {
      console.error(`❌ [ERROR] DB Write Failed (${symbol}):`, error.message);
    } else {
      console.log(`✅ [SUCCESS] ${symbol}: 成功同步 ${recentCandles.length} 条数据 (Source: Stooq)`);
    }

  } catch (error) {
    console.error(`❌ [FATAL] ${symbol} 网络异常:`, error);
  }
}

// --- 核心功能 B: 从数据库读取数据给前端 (Read) ---
export async function getHistoryFromDB(symbol: string): Promise<KlineData[]> {
  const { data, error } = await supabase
    .from('market_candles')
    .select('date, open, high, low, close')
    .eq('symbol', symbol)
    .order('date', { ascending: true })
    .limit(180);

  if (error) {
    console.error("DB Read Error:", error.message);
    return [];
  }
  
  if (!data || data.length === 0) {
    return []; 
  }

  return data.map(d => ({
    time: d.date,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close
  }));
}

// 批量获取
export async function fetchAllPositionsHistory(positions: any[]) {
  const historyMap: Record<string, KlineData[]> = {};
  if (!positions || positions.length === 0) return historyMap;

  const promises = positions.map(async (pos) => {
    const data = await getHistoryFromDB(pos.symbol);
    historyMap[pos.symbol] = data;
  });

  await Promise.all(promises);
  return historyMap;
}