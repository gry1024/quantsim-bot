import { supabase } from './config';

/**
 * 核心同步逻辑：从新浪财经抓取美股历史 K 线
 */
export async function syncSymbolHistory(symbol: string) {
  try {
    const sym = symbol.toLowerCase();
    // 新浪日线接口
    const url = `https://stock.finance.sina.com.cn/usstock/api/jsonp.php/cb/US_MinKService.getDailyK?symbol=${sym}`;
    
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    
    const text = await res.text();

    // 1. 极其强悍的正则解析：提取被 cb(...) 包裹的数组内容
    const match = text.match(/cb\(\s*(\[[\s\S]*\])\s*\);/);
    if (!match || !match[1]) {
      console.warn(`⚠️ ${symbol}: 无法解析新浪返回的数据格式`);
      return;
    }

    const rawData = JSON.parse(match[1]);
    if (!Array.isArray(rawData)) return;

    // 2. 转换数据格式并清洗
    const candles = rawData.map((item: any) => {
      // 新浪字段含义: d=日期, o=开盘, h=最高, l=最低, c=收盘, v=成交量
      const date = item.d;
      return {
        id: `${symbol.toUpperCase()}_${date}`, // 现在的数据库 id 是 text，直接存字符串
        symbol: symbol.toUpperCase(),
        date: date,
        open: parseFloat(item.o),
        high: parseFloat(item.h),
        low: parseFloat(item.l),
        close: parseFloat(item.c),
        volume: parseInt(item.v) || 0
      };
    })
    .filter(c => c.date && !isNaN(c.close)) // 剔除无效数据
    .slice(-50); // 只保留最近 50 天的数据，减轻前端压力

    if (candles.length === 0) {
      console.warn(`⚠️ ${symbol}: 解析后无有效 K 线`);
      return;
    }

    // 3. 写入 Supabase (使用 upsert 覆盖更新)
    const { error } = await supabase
      .from('market_candles')
      .upsert(candles, { onConflict: 'id' });

    if (error) {
      console.error(`❌ ${symbol} 数据库写入失败:`, error.message);
    } else {
      console.log(`✅ ${symbol} K线同步成功: ${candles.length} 条数据`);
    }

  } catch (err: any) {
    console.error(`❌ ${symbol} 同步过程崩溃:`, err.message);
  }
}