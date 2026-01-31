'use client';

import { createChart, ColorType, AreaSeries, Time } from 'lightweight-charts';
import { useEffect, useRef } from 'react';

interface ChartProps {
  data: { time: Time; value: number }[];
}

export default function EquityChart({ data }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 1. 初始化图表
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'white' },
        textColor: '#64748B',
        fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
      },
      grid: {
        vertLines: { visible: false }, // 隐藏竖向网格，保持干净
        horzLines: { color: '#F1F5F9', style: 1 },
      },
      width: chartContainerRef.current.clientWidth,
      height: 320, // 💡 加高图表，让波动更明显
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.2, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        // 💡 增强十字光标体验
        vertLine: {
          width: 1,
          color: '#94A3B8',
          style: 3,
          labelBackgroundColor: '#94A3B8',
        },
        horzLine: {
          width: 1,
          color: '#94A3B8',
          style: 3,
          labelBackgroundColor: '#94A3B8',
        },
      },
      handleScale: { mouseWheel: false },
    });

    // 2. 添加面积图系列
    const newSeries = chart.addSeries(AreaSeries, {
      lineColor: '#2563EB', // 使用更专业的“金融蓝”
      topColor: 'rgba(37, 99, 235, 0.2)',
      bottomColor: 'rgba(37, 99, 235, 0.0)',
      lineWidth: 2,
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    });

    // 3. 注入数据
    if (data && data.length > 0) {
      const uniqueData = data.filter((item, index, self) =>
        index === self.findIndex((t) => (t.time === item.time))
      );
      newSeries.setData(uniqueData);
    }

    chart.timeScale().fitContent();

    // 4. 响应式调整
    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4 px-2">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-600"></span>
          资产净值走势 (Real-time)
        </h3>
      </div>
      {/* 图表容器 */}
      <div ref={chartContainerRef} className="w-full rounded-xl border border-slate-100 shadow-sm overflow-hidden" />
    </div>
  );
}