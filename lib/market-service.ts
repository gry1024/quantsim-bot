import { supabase } from './config';

// 不需要引入任何第三方库，直接用原生 fetch

export async function syncSymbolHistory(symbol: string) {
  try {
    console.log(`📊 正在同步 ${symbol} 的 K 线数据...`);

    // 1. 直接构造 Stooq CSV 下载链接
    // 参数说明: s=代码, i=d(日线), e=csv(格式)
    // 某些美股可能需要加 .US 后缀，但通常大盘股直接输代码也行
    const url = `https://stooq.com/q/d/l/?s=${symbol.toLowerCase()}&i=d&e=csv`;
    
    // 2. 发起请求
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; QuantSimBot/1.0)'
      }
    });

    if (!res.ok) {
      console.warn(`⚠️ ${symbol}: 请求失败 (HTTP ${res.status})`);
      return;
    }

    const text = await res.text();

    // 3. 解析 CSV 文本
    // 格式通常为: Date,Open,High,Low,Close,Volume
    // 2023-10-27,415.20,418.50,412.10,415.50,5000000
    
    const lines = text.split('\n');
    
    // 去掉第一行表头 (Date,Open...)，并过滤空行
    const dataLines = lines.slice(1).filter((l: string) => l.trim().length > 0 && !l.includes('No data'));

    if (dataLines.length === 0) {
       console.warn(`⚠️ ${symbol}: 未获取到 K 线数据 (可能是代码错误或 Stooq 限制)`);
       return;
    }

    // 4. 转换为对象数组
    const candles = dataLines.map((line: string) => {
        const parts = line.split(',');
        // Stooq CSV: Date[0], Open[1], High[2], Low[3], Close[4]
        if (parts.length < 5) return null;

        const date = parts[0];
        const open = parseFloat(parts[1]);
        const high = parseFloat(parts[2]);
        const low = parseFloat(parts[3]);
        const close = parseFloat(parts[4]);

        // 简单的完整性检查
        if (isNaN(close) || isNaN(open)) return null;

        return {
          symbol: symbol.toUpperCase(),
          date: date, 
          open: open,
          high: high,
          low: low,
          close: close,
          // 唯一ID: symbol + date
          id: `${symbol.toUpperCase()}_${date}` 
        };
      })
      .filter((item: any) => item !== null) // 过滤掉解析失败的行
      .slice(0, 50); // 只取最近 50 天的数据，避免写入太多

    if (candles.length === 0) {
      return;
    }

    // 5. 写入 Supabase
    const { error } = await supabase
      .from('market_candles')
      .upsert(candles, { onConflict: 'symbol,date' });

    if (error) {
      console.error(`❌ ${symbol} K 线写入失败:`, error.message);
    } else {
      console.log(`✅ ${symbol} K 线同步完成 (${candles.length} 条)`);
    }

  } catch (error) {
    console.error(`❌ ${symbol} 同步过程出错:`, error);
  }
}