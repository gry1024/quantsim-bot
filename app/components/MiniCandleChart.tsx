'use client';

import { useEffect, useRef } from 'react';
import { 
  createChart, 
  ColorType, 
  Time, 
  CandlestickSeries, // 👈 关键修改：引入 CandlestickSeries 类
  ISeriesApi
} from 'lightweight-charts';

// 1. 定义数据接口
interface CandleData {
  time: string | Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

// 2. 接收 data
interface MiniCandleChartProps {
  data: CandleData[];
}

export default function MiniCandleChart({ data }: MiniCandleChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // A. 初始化图表
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9CA3AF',
        fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
      },
      width: chartContainerRef.current.clientWidth,
      height: 200,
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(42, 46, 57, 0.05)', style: 1 },
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
      handleScale: { mouseWheel: false },
    });

    chartRef.current = chart;

    // B. 添加 K 线系列 (关键修改：使用 v4 新版 API)
    // 旧版: chart.addCandlestickSeries({...}) ❌
    // 新版: chart.addSeries(CandlestickSeries, {...}) ✅
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981',
      downColor: '#EF4444',
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });
    
    seriesRef.current = candleSeries;

    // C. 响应窗口大小变化
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, []); 

  // D. 数据更新逻辑
  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      // 排序
      const sortedData = [...data].sort((a, b) => (String(a.time) > String(b.time) ? 1 : -1));
      
      // 去重
      const uniqueData = sortedData.filter((item, index, self) => 
        index === self.findIndex((t) => t.time === item.time)
      );

      seriesRef.current.setData(uniqueData as any);
      
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
    }
  }, [data]);

  return (
    <div className="relative w-full h-[200px]">
      <div ref={chartContainerRef} className="w-full h-full" />
      {(!data || data.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-gray-400">暂无数据</span>
        </div>
      )}
    </div>
  );
}