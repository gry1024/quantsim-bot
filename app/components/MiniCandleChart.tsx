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

// 1. 定义数据接口
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

    // 自动获取父容器的高度，确保在手机/电脑上都能完美填充
    const containerWidth = chartContainerRef.current.clientWidth;
    const containerHeight = chartContainerRef.current.clientHeight;

    // A. 初始化图表 (配置全量交互参数)
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#64748B', // 使用 Slate-500 灰色，更柔和
        fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
      },
      width: containerWidth,
      height: containerHeight || 200, // 默认防守高度
      
      //  grid: 弱化网格线，突出 K 线
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(42, 46, 57, 0.05)', style: 1 },
      },
      
      // 💡 关键：开启所有缩放和拖动功能
      handleScale: {
        mouseWheel: true,       // 允许滚轮缩放
        pinch: true,            // 允许手机捏合缩放
        axisPressedMouseMove: true, // 允许按住坐标轴缩放
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,    // 允许水平触摸拖动
        vertTouchDrag: false,   // 禁止垂直拖动 (防止页面卡顿)
      },

      // 十字光标 (手机点击后显示价格)
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          width: 1,
          color: 'rgba(37, 99, 235, 0.5)', // 品牌蓝
          style: 3, // 虚线
          labelBackgroundColor: '#2563EB',
        },
        horzLine: {
          width: 1,
          color: 'rgba(37, 99, 235, 0.5)',
          style: 3,
          labelBackgroundColor: '#2563EB',
        },
      },

      // 右侧价格轴
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 }, // 留出上下边距，防止 K 线顶天立地
        visible: true,
      },

      // 底部时间轴 (开启后即可拖动)
      timeScale: {
        borderVisible: true,
        borderColor: '#E2E8F0',
        timeVisible: true,
        secondsVisible: false,
        visible: true,
        rightOffset: 5, // 右侧留空，方便查看最新 K 线
        fixLeftEdge: true, // 防止拖到最左边空白处
        fixRightEdge: true, // 允许向右拖动一定距离，但不无限拖
      },
    });

    chartRef.current = chart;

    // B. 添加 K 线系列
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981',       // 涨：绿色
      downColor: '#EF4444',     // 跌：红色
      borderVisible: false,
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });
    
    seriesRef.current = candleSeries;

    // C. 响应窗口大小变化 (包含横竖屏切换)
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

  // D. 数据更新逻辑 (保持不变，稳健性优先)
  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      const sortedData = [...data].sort((a, b) => (String(a.time) > String(b.time) ? 1 : -1));
      const uniqueData = sortedData.filter((item, index, self) => 
        index === self.findIndex((t) => t.time === item.time)
      );
      seriesRef.current.setData(uniqueData as any);
      
      // 仅在首次加载或无操作时自动适配，避免打断用户拖动
      // 如果需要每次更新都回正，可以把 fitContent 放开
      // if (chartRef.current) chartRef.current.timeScale().fitContent(); 
    }
  }, [data]);

  return (
    <div className="relative w-full h-full"> {/* 强制占满父容器 */}
      <div ref={chartContainerRef} className="w-full h-full" />
      {(!data || data.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-gray-400">数据加载中...</span>
        </div>
      )}
    </div>
  );
}