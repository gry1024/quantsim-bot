import { supabase } from './config';

/**
 * 使用 Yahoo Finance 接口同步 K 线数据 (JSON 格式，更稳定)
 */
export async function syncSymbolHistory(symbol: string) {
  try {
    // 1. 构造 Yahoo Finance Chart API (请求最近1个月的日线)
    // range=1mo (1个月), interval=1d (1天)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1mo&interval=1d`;
    
    const res = await fetch(url, {
      method: 'GET',
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
      }
    });

    if (!res.ok) {
      console.warn(`⚠️ ${symbol}: Yahoo 请求失败 (HTTP ${res.status})`);
      return;
    }

    const json = await res.json();
    const result = json.chart?.result?.[0];

    if (!result) {
       console.warn(`⚠️ ${symbol}: 未获取到有效数据结构`);
       return;
    }

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    
    // 2. 解析数据
    const candles = timestamps.map((ts: number, index: number) => {
        // 过滤掉数据不全的点
        if (!quotes.open?.[index] || !quotes.close?.[index]) return null;

        const dateStr = new Date(ts * 1000).toISOString().split('T')[0]; // 转换为 YYYY-MM-DD

        return {
          symbol: symbol.toUpperCase(),
          date: dateStr,
          open: parseFloat(quotes.open[index].toFixed(2)),
          high: parseFloat(quotes.high[index].toFixed(2)),
          low: parseFloat(quotes.low[index].toFixed(2)),
          close: parseFloat(quotes.close[index].toFixed(2)),
          // 唯一ID
          id: `${symbol.toUpperCase()}_${dateStr}` 
        };
      })
      .filter((item: any) => item !== null);

    if (candles.length === 0) return;

    // 3. 写入 Supabase
    // 只取最近 30 天，减少数据库压力
    const recentCandles = candles.slice(-30);

    const { error } = await supabase
      .from('market_candles')
      .upsert(recentCandles, { onConflict: 'symbol,date' });

    if (error) {
      console.error(`❌ ${symbol} 写入失败:`, error.message);
    } 
    // 注释掉成功日志，减少刷屏
    // else { console.log(`✅ ${symbol} 同步完成`); }

  } catch (error) {
    console.error(`❌ ${symbol} 过程出错:`, error);
  }
}