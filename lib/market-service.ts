import { supabase } from './config';

/**
 * 终极方案：使用新浪财经 K 线接口
 * 优势：云服务器友好，不封 IP，且和你目前的实时行情源一致
 */
export async function syncSymbolHistory(symbol: string) {
  try {
    // 新浪美股 K 线接口 (JSONP 格式)
    // symbol 需要小写，例如 qqq
    const url = `https://stock.finance.sina.com.cn/usstock/api/jsonp.php/cb/US_MinKService.getDailyK?symbol=${symbol.toLowerCase()}`;
    
    const res = await fetch(url);
    const text = await res.text();

    // 解析 JSONP
    // 原始返回格式类似: cb([{"d":"2023-01-01","o":"..."}, ...]);
    // 我们用正则提取括号里的 JSON 数组
    const match = text.match(/cb\((.*)\);/);
    
    if (!match || !match[1]) {
       // 偶尔新浪会返回空数据，属于正常波动
       // console.warn(`⚠️ ${symbol}: 新浪接口返回格式异常或无数据`);
       return;
    }

    const data = JSON.parse(match[1]);

    if (!Array.isArray(data)) return;

    // 格式清洗
    // 新浪字段: d:日期, o:开盘, h:最高, l:最低, c:收盘
    const candles = data.map((item: any) => ({
        symbol: symbol.toUpperCase(),
        date: item.d,
        open: parseFloat(item.o),
        high: parseFloat(item.h),
        low: parseFloat(item.l),
        close: parseFloat(item.c),
        // 唯一ID
        id: `${symbol.toUpperCase()}_${item.d}`
    }))
    // 只取最近 30 天 (新浪返回的是按时间正序的，所以取最后 30 个)
    .slice(-30);

    if (candles.length === 0) return;

    const { error } = await supabase
      .from('market_candles')
      .upsert(candles, { onConflict: 'symbol,date' });

    if (error) {
      console.error(`❌ ${symbol} 写入失败:`, error.message);
    } 
    // 成功时不打印日志，保持清爽

  } catch (error) {
    console.error(`❌ ${symbol} 出错:`, error);
  }
}