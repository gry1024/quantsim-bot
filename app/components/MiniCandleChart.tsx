// app/components/MiniCandleChart.tsx
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
        textColor: '#94A3B8',
        fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
      },
      width: containerWidth,
      height: containerHeight || 200,
      
      localization: {
        locale: 'zh-CN',
        dateFormat: 'yyyy-MM-dd', // 十字光标日期格式
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
        mode: CrosshairMode.Normal, // 启用十字光标
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
        visible: true, // 确保显示价格轴标签
      },

      timeScale: {
        borderVisible: true,
        borderColor: '#E2E8F0',
        timeVisible: true, // 确保显示时间轴标签
        secondsVisible: false,
        visible: true,
        rightOffset: 5, // 右侧保留一点空隙
        fixLeftEdge: true, 
        fixRightEdge: true, 
        tickMarkFormatter: (time: any) => {
          const date = new Date(time);
          return `${date.getMonth() + 1}/${date.getDate()}`;
        },
      },
    });

    chartRef.current = chart;

    // B. 添加 K 线系列 (红涨绿跌)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#EF4444',
      downColor: '#10B981',
      borderVisible: false,
      wickUpColor: '#EF4444',
      wickDownColor: '#10B981',
    });
    
    seriesRef.current = candleSeries;

    // C. 响应窗口大小变化
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

  // D. 数据更新逻辑
  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      const sortedData = [...data].sort((a, b) => (String(a.time) > String(b.time) ? 1 : -1));
      const uniqueData = sortedData.filter((item, index, self) => 
        index === self.findIndex((t) => t.time === item.time)
      );
      seriesRef.current.setData(uniqueData as any);
      
      // ✅ 修改核心：移除 >100 条的限制，强制适配所有内容
      // 这将确保显示数据集中所有日期，且最右侧对齐到最新数据（当天）
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