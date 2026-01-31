'use client';

import { useEffect, useRef, useState } from 'react';
import { 
  createChart, 
  ColorType, 
  CandlestickData, 
  Time, 
  IChartApi, 
  ISeriesApi,
  CandlestickSeriesOptions 
} from 'lightweight-charts';
import { supabase } from '@/lib/config';

// ----------------------------------------------------------------------
// 1. 类型补丁 (Type Shim)
// 这是一个安全措施：如果 IChartApi 里的定义缺失，我们在这里手动补上
// 这样 TS 就不会报错 "Property does not exist"
// ----------------------------------------------------------------------
interface IChartApiExtended extends IChartApi {
  addCandlestickSeries(options?: Partial<CandlestickSeriesOptions>): ISeriesApi<"Candlestick">;
}

// 2. 数据库行数据接口
interface MarketCandleRow {
  id: string;
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  created_at?: string;
}

export default function MiniCandleChart({ symbol }: { symbol: string }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApiExtended | null>(null); // 使用扩展后的类型
  const [loading, setLoading] = useState<boolean>(true);
  const [hasData, setHasData] = useState<boolean>(false);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 3. 初始化图表并强制转换为扩展类型
    // 这里使用 'as unknown as IChartApiExtended' 是安全的，因为运行时该方法确实存在
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9CA3AF',
      },
      width: chartContainerRef.current.clientWidth,
      height: 200,
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0)' },
        horzLines: { color: 'rgba(42, 46, 57, 0.1)' },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
    }) as unknown as IChartApiExtended;

    chartRef.current = chart;

    // 4. 现在 TS 知道 addCandlestickSeries 是存在的了
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    const fetchData = async () => {
      try {
        const { data, error } = await supabase
          .from('market_candles')
          .select('*')
          .eq('symbol', symbol)
          .order('date', { ascending: true })
          .limit(60);

        if (error) throw error;

        if (data && data.length > 0) {
          const typedData = data as unknown as MarketCandleRow[];

          const chartData: CandlestickData<Time>[] = typedData
            .map((item) => ({
              time: item.date as Time,
              open: Number(item.open),
              high: Number(item.high),
              low: Number(item.low),
              close: Number(item.close),
            }))
            .sort((a, b) => (String(a.time) > String(b.time) ? 1 : -1))
            .filter((item, index, self) => 
              index === self.findIndex((t) => t.time === item.time)
            );

          candleSeries.setData(chartData);
          chart.timeScale().fitContent();
          setHasData(true);
        }
      } catch (err) {
        console.error('Failed to fetch candle data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [symbol]);

  return (
    <div className="relative w-full h-[200px]">
      <div ref={chartContainerRef} className="w-full h-full" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm z-10">
           <span className="text-xs text-gray-500 animate-pulse">加载数据中...</span>
        </div>
      )}
      {!loading && !hasData && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-gray-600">暂无数据</span>
        </div>
      )}
    </div>
  );
}