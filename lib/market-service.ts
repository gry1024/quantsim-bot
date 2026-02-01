import { supabase } from './config';

// 定义接口，确保类型安全
interface CandleData {
  id: string;
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 核心同步逻辑：从新浪财经抓取美股历史 K 线
 * 稳健性重写版
 */
export async function syncSymbolHistory(symbol: string) {
  const cleanSymbol = symbol.toUpperCase(); 
  
  try {
    console.log(`📊 [${cleanSymbol}] 开始同步 K 线数据...`);

    // 1. 请求新浪财经接口
    const url = `https://stock.finance.sina.com.cn/usstock/api/jsonp.php/cb/US_MinKService.getDailyK?symbol=${cleanSymbol.toLowerCase()}`;
    
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuantBot/1.0)' }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const text = await res.text();

    // 2. 暴力正则提取
    const match = text.match(/\[.*\]/);
    
    if (!match) {
      console.warn(`⚠️ [${cleanSymbol}] 接口返回内容为空或格式异常`);
      return;
    }

    let rawData: any[] = [];
    try {
      rawData = JSON.parse(match[0]);
    } catch (e) {
      console.warn(`⚠️ [${cleanSymbol}] JSON 解析失败`);
      return;
    }

    if (!Array.isArray(rawData) || rawData.length === 0) {
      console.warn(`⚠️ [${cleanSymbol}] 只有空数组`);
      return;
    }

    // 3. 数据清洗与映射
    const candles: CandleData[] = rawData.map((item: any) => {
      const dateStr = item.d; 
      
      return {
        id: `${cleanSymbol}_${dateStr}`,
        symbol: cleanSymbol,
        date: dateStr,
        open: parseFloat(item.o),
        high: parseFloat(item.h),
        low: parseFloat(item.l),
        close: parseFloat(item.c),
        volume: parseInt(item.v) || 0
      };
    })
    .filter(c => 
      c.date && 
      !isNaN(c.close) && 
      c.close > 0
    );
    // 🚩 修改：删除了 .slice(-60)，现在保存所有历史数据

    if (candles.length === 0) return;

    // 4. 写入 Supabase
    const { error } = await supabase
      .from('market_candles')
      .upsert(candles, { onConflict: 'id' });

    if (error) {
      console.error(`❌ [${cleanSymbol}] 写入 DB 失败:`, error.message);
    } else {
      // console.log(`✅ [${cleanSymbol}] 同步成功 (${candles.length} 条)`);
    }

  } catch (err: any) {
    console.error(`❌ [${cleanSymbol}] 致命错误:`, err.message);
  }
}