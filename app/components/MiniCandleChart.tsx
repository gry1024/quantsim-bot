'use client';

import { createChart, ColorType, CandlestickSeries } from 'lightweight-charts';
import { useEffect, useRef } from 'react';

// 定义接口
interface KlineData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

// 接收真实的 data 属性
export default function MiniCandleChart({ data }: { data: KlineData[] }) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    if (!data || data.length === 0) return; // 如果没数据就不画

    const width = chartContainerRef.current.clientWidth;
    const height = chartContainerRef.current.clientHeight;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94A3B8', 
        fontFamily: "'Inter', sans-serif",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: '#F1F5F9', style: 1 },
      },
      width: width,
      height: height,
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        visible: true,
        borderVisible: false,
        timeVisible: true,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScale: { mouseWheel: false, pinch: false },
      handleScroll: { mouseWheel: false, pressedMouseMove: false },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#EF4444',       
      downColor: '#10B981',     
      borderVisible: false,
      wickUpColor: '#EF4444',   
      wickDownColor: '#10B981',
    });

    // 直接注入真实数据
    series.setData(data);
    
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight 
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data]); // 当数据变化时重绘

  return <div ref={chartContainerRef} className="w-full h-full" />;
}