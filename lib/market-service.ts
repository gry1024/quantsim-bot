// lib/market-service.ts

import { supabase } from './config';

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
 * 核心同步逻辑
 * @param symbol 股票代码
 * @param days 需要同步的交易日天数 (默认 260 天 ≈ 1年)
 */
export async function syncSymbolHistory(symbol: string, days: number = 260) {
  const cleanSymbol = symbol.toUpperCase();
  
  try {
    console.log(`📊 [${cleanSymbol}] 开始同步最近 ${days} 天 K 线...`);

    const url = `https://stock.finance.sina.com.cn/usstock/api/jsonp.php/cb/US_MinKService.getDailyK?symbol=${cleanSymbol.toLowerCase()}`;
    
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuantBot/1.0)' }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const text = await res.text();
    const match = text.match(/\[.*\]/);
    
    if (!match) {
      console.warn(`⚠️ [${cleanSymbol}] 接口返回为空`);
      return;
    }

    let rawData: any[] = [];
    try {
      rawData = JSON.parse(match[0]);
    } catch (e) {
      console.warn(`⚠️ [${cleanSymbol}] JSON 解析失败`);
      return;
    }

    if (!Array.isArray(rawData) || rawData.length === 0) return;

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
    .filter(c => c.date && !isNaN(c.close) && c.close > 0)
    // ✅ 修改核心：使用传入的 days 参数进行截取
    .slice(-days);

    if (candles.length === 0) return;

    const { error } = await supabase
      .from('market_candles')
      .upsert(candles, { onConflict: 'id' });

    if (error) {
      console.error(`❌ [${cleanSymbol}] 写入 DB 失败:`, error.message);
    }

  } catch (err: any) {
    console.error(`❌ [${cleanSymbol}] 错误:`, err.message);
  }
}