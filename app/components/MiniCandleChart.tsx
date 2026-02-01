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
        fixLeftEdge: true, // 防止拖动到第一根K线之前的空白处
        fixRightEdge: true, // 防止拖动到最后一根K线之后的空白处
        tickMarkFormatter: (time: any, tickMarkType: any, locale: any) => {
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
        // 窗口调整时，保持当前的逻辑范围，不强制 fitContent
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
      
      // ✅ 关键优化：智能适配视图
      // 如果数据非常多（>100条），只默认展示最近 100 条，保持 K 线清晰度，同时允许用户向左拖动查看历史。
      // 如果数据较少，则展示全部。
      if (chartRef.current) {
        const total = uniqueData.length;
        if (total > 100) {
          chartRef.current.timeScale().setVisibleLogicalRange({
            from: total - 100, // 从倒数第 100 条开始
            to: total,         // 到最后一条
          });
        } else {
          chartRef.current.timeScale().fitContent(); 
        }
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