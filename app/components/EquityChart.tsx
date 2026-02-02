// components/EquityChart.tsx
'use client';

import { createChart, ColorType, LineSeries, Time } from 'lightweight-charts';
import { useEffect, useRef } from 'react';

interface ChartProps {
  data: { time: Time; value: number }[];
}

export default function EquityChart({ data }: ChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'white' },
        textColor: '#64748B',
        fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: '#F1F5F9', style: 1 },
      },
      width: chartContainerRef.current.clientWidth,
      height: 320,
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.2, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
      },
      handleScale: { mouseWheel: false, pinch: false },
    });

    // ✨ 修改：使用 LineSeries (折线图) 替代 AreaSeries (面积图)
    const newSeries = chart.addSeries(LineSeries, {
      color: '#2563EB',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });

    chartRef.current = chart;
    seriesRef.current = newSeries;

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
  }, []);

  // 响应数据变化更新图表
  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      // 排序并去重
      const sortedData = [...data].sort((a, b) => (String(a.time) > String(b.time) ? 1 : -1));
      const uniqueData = sortedData.filter((item, index, self) =>
        index === self.findIndex((t) => t.time === item.time)
      );
      
      seriesRef.current.setData(uniqueData);
      // ✨ 确保显示范围覆盖：建仓(起点) -> 现总资产(终点)
      chartRef.current.timeScale().fitContent(); 
    }
  }, [data]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4 px-2">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-600"></span>
          资产净值走势 (实时同步)
        </h3>
      </div>
      <div ref={chartContainerRef} className="w-full rounded-xl border border-slate-100 shadow-sm overflow-hidden" />
    </div>
  );
}