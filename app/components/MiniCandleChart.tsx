// app/components/MiniCandleChart.tsx
'use client';

import { useEffect, useRef } from 'react';
import { 
  createChart, 
  ColorType, 
  Time, 
  CandlestickSeries, 
  LineSeries, 
  ISeriesApi,
  CrosshairMode
} from 'lightweight-charts';

interface CandleData {
  time: string | Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface MiniCandleChartProps {
  data: CandleData[];
}

export default function MiniCandleChart({ data }: MiniCandleChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const maSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const containerWidth = chartContainerRef.current.clientWidth;
    const containerHeight = chartContainerRef.current.clientHeight;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94A3B8',
        fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
      },
      width: containerWidth,
      height: containerHeight || 200,
      localization: { locale: 'zh-CN', dateFormat: 'yyyy-MM-dd' },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(42, 46, 57, 0.05)', style: 1 },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.2, bottom: 0.1 } },
      timeScale: { borderVisible: true, borderColor: '#E2E8F0', visible: true },
    });

    chartRef.current = chart;

    // 1. K 线系列
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#EF4444',
      downColor: '#10B981',
      borderVisible: false,
      wickUpColor: '#EF4444',
      wickDownColor: '#10B981',
    });
    candleSeriesRef.current = candleSeries;

    // 2. MA5 均线系列
    const maSeries = chart.addSeries(LineSeries, {
      color: '#3B82F6',
      lineWidth: 1, 
      priceLineVisible: false, 
      crosshairMarkerVisible: false,
    });
    maSeriesRef.current = maSeries;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, []); 

  useEffect(() => {
    if (candleSeriesRef.current && maSeriesRef.current && data && data.length > 0) {
      const sortedData = [...data].sort((a, b) => (String(a.time) > String(b.time) ? 1 : -1));
      const uniqueData = sortedData.filter((item, index, self) => 
        index === self.findIndex((t) => t.time === item.time)
      );
      
      candleSeriesRef.current.setData(uniqueData as any);
      
      const maData = uniqueData.map((item, index) => {
        if (index < 4) return null;
        const period = uniqueData.slice(index - 4, index + 1);
        const sum = period.reduce((acc, curr) => acc + curr.close, 0);
        return { time: item.time, value: sum / 5 };
      }).filter(item => item !== null);

      maSeriesRef.current.setData(maData as any);
      
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent(); 
      }
    }
  }, [data]);

  return (
    <div className="relative w-full h-full">
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
}