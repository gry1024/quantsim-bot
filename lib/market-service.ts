import { supabase } from './config';

/**
 * 零依赖同步 K 线数据：直接请求 Stooq CSV 接口并解析
 */
export async function syncSymbolHistory(symbol: string) {
  try {
    console.log(`📊 正在同步 ${symbol} 的 K 线数据...`);

    // 1. 构造 Stooq 官方 CSV 接口 URL
    const url = `https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}&i=d&e=csv`;
    
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    if (!res.ok) {
      console.warn(`⚠️ ${symbol}: 获取失败 (HTTP ${res.status})`);
      return;
    }

    const text = await res.text();
    const lines = text.split('\n');
    
    // 2. 解析 CSV (跳过表头，过滤空行)
    const dataLines = lines.slice(1).filter((l: string) => l.trim().length > 0 && !l.includes('No data'));

    if (dataLines.length === 0) {
       console.warn(`⚠️ ${symbol}: 未获取到有效数据`);
       return;
    }

    // 3. 转换为数据库格式
    const candles = dataLines.map((line: string) => {
        const parts = line.split(',');
        if (parts.length < 5) return null;

        return {
          symbol: symbol.toUpperCase(),
          date: parts[0].trim(),           // Date
          open: parseFloat(parts[1]),     // Open
          high: parseFloat(parts[2]),     // High
          low: parseFloat(parts[3]),      // Low
          close: parseFloat(parts[4]),    // Close
          id: `${symbol.toUpperCase()}_${parts[0].trim()}` 
        };
      })
      .filter((item: any) => item !== null && !isNaN(item.close))
      .slice(0, 50); 

    // 4. 写入 Supabase
    const { error } = await supabase
      .from('market_candles')
      .upsert(candles, { onConflict: 'symbol,date' });

    if (error) {
      console.error(`❌ ${symbol} 写入失败:`, error.message);
    } else {
      console.log(`✅ ${symbol} 同步完成 (${candles.length} 条)`);
    }

  } catch (error) {
    console.error(`❌ ${symbol} 过程出错:`, error);
  }
}