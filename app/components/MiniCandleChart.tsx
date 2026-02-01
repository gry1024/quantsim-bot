'use client';

import { useEffect, useRef } from 'react';
import { 
  createChart, 
  ColorType, 
  Time, 
  CandlestickSeries, 
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
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const containerWidth = chartContainerRef.current.clientWidth;
    const containerHeight = chartContainerRef.current.clientHeight;

    // A. 初始化图表
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94A3B8', // 调整文字颜色使其更柔和
        fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
      },
      width: containerWidth,
      height: containerHeight || 200,
      
      // 💡 新增：本地化配置，解决日期显示混乱问题
      localization: {
        locale: 'zh-CN',
        dateFormat: 'yyyy-MM-dd',
      },

      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(42, 46, 57, 0.05)', style: 1 },
      },
      
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },

      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          width: 1,
          color: 'rgba(37, 99, 235, 0.5)',
          style: 3,
          labelBackgroundColor: '#2563EB',
        },
        horzLine: {
          width: 1,
          color: 'rgba(37, 99, 235, 0.5)',
          style: 3,
          labelBackgroundColor: '#2563EB',
        },
      },

      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
        visible: true,
      },

      timeScale: {
        borderVisible: true,
        borderColor: '#E2E8F0',
        timeVisible: true,
        secondsVisible: false,
        visible: true,
        rightOffset: 5,
        fixLeftEdge: true,
        fixRightEdge: true,
        // 💡 新增：自定义刻度格式化，只显示 月/日，避免混乱
        tickMarkFormatter: (time: any, tickMarkType: any, locale: any) => {
          const date = new Date(time);
          // 简单格式化为 MM/DD
          return `${date.getMonth() + 1}/${date.getDate()}`;
        },
      },
    });

    chartRef.current = chart;

    // B. 添加 K 线系列
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
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight
        });
        chartRef.current.timeScale().fitContent(); 
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
      const sortedData = [...data].sort((a, b) => (String(a.time) > String(b.time) ? 1 : -1));
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
    <div className="relative w-full h-full">
      <div ref={chartContainerRef} className="w-full h-full" />
      {(!data || data.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-gray-400">数据加载中...</span>
        </div>
      )}
    </div>
  );
}