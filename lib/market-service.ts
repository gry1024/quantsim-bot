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
  const cleanSymbol = symbol.toUpperCase(); // 强转大写，防止 qqq != QQQ
  
  try {
    console.log(`📊 [${cleanSymbol}] 开始同步 K 线数据...`);

    // 1. 请求新浪财经接口 (使用小写 symbol 请求)
    const url = `https://stock.finance.sina.com.cn/usstock/api/jsonp.php/cb/US_MinKService.getDailyK?symbol=${cleanSymbol.toLowerCase()}`;
    
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuantBot/1.0)' } // 加上 UA 只有好处
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const text = await res.text();

    // 2. 暴力正则提取：不管它包了几层 cb(...)，直接抓里面的数组
    // 匹配 pattern: 任意字符([ ... ])任意字符
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

    // 3. 数据清洗与映射 (Mapping)
    const candles: CandleData[] = rawData.map((item: any) => {
      // 新浪字段: d=日期(2023-10-25), o=open, h=high, l=low, c=close, v=volume
      const dateStr = item.d; 
      
      return {
        // 🔑 核心 ID：确保唯一性，格式如 "QQQ_2026-02-01"
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
    // 过滤脏数据：确保价格有效且不是 0
    .filter(c => 
      c.date && 
      !isNaN(c.close) && 
      c.close > 0
    )
    // 只取最近 60 天 (减少数据库压力，前端也只需要看最近的)
    .slice(-60);

    if (candles.length === 0) return;

    // 4. 写入 Supabase
    // ⚠️ 关键：onConflict 指定为 'id'，这要求数据库 id 列是 PRIMARY KEY
    const { error } = await supabase
      .from('market_candles')
      .upsert(candles, { onConflict: 'id' });

    if (error) {
      console.error(`❌ [${cleanSymbol}] 写入 DB 失败:`, error.message);
    } else {
      // 成功日志（可选关闭，防止刷屏）
      // console.log(`✅ [${cleanSymbol}] 同步成功 (${candles.length} 条)`);
    }

  } catch (err: any) {
    console.error(`❌ [${cleanSymbol}] 致命错误:`, err.message);
  }
}