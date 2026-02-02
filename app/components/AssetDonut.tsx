// components/AssetDonut.tsx
'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = ['#3B82F6', '#10B981', '#6366F1', '#8B5CF6', '#F59E0B', '#EF4444', '#64748B'];

interface DonutProps {
  positions: any[];
  cash: number;
  total: number;
  // ✨ 新增：接收实时行情
  quotes?: Record<string, { price: number; change: number }>;
}

export default function AssetDonut({ positions, cash, total, quotes }: DonutProps) {
  
  // 1. 构造数据：优先使用实时行情计算市值
  const data = [
    { name: '现金 (Cash)', value: Number(cash), symbol: 'USD' },
    ...positions.map(p => {
      // ✨ 核心修改：如果有实时报价，优先用 quotes.price；否则回退到 last_action_price
      const quote = quotes?.[p.symbol];
      const price = quote?.price || p.last_action_price || p.avg_price || 0;
      
      const marketValue = price * (p.quantity || p.shares || 0);
      return {
        name: p.symbol,
        value: marketValue,
        symbol: p.symbol
      };
    })
  ]
  .filter(item => item.value > 1) // 过滤掉极小值
  .sort((a, b) => b.value - a.value);

  // ✨ 核心修改：重新计算实时总资产 (Cash + Realtime Market Value)
  // 这样中心的 "Net Worth" 也会随行情跳动
  const calculatedTotal = data.reduce((acc, item) => acc + item.value, 0);
  const safeTotal = calculatedTotal > 0 ? calculatedTotal : (total > 0 ? total : 1);

  return (
    <div className="flex flex-col w-full">
      {/* 图表区域 */}
      <div className="h-48 w-full relative -ml-2 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={65}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
              cornerRadius={4}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.symbol === 'USD' ? '#CBD5E1' : COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value: any) => [`$${Number(value).toLocaleString()}`, '市值']}
              contentStyle={{ 
                borderRadius: '8px', 
                border: 'none', 
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                backgroundColor: 'rgba(255, 255, 255, 0.95)'
              }}
              itemStyle={{ color: '#334155', fontSize: '12px', fontWeight: 'bold' }}
            />
          </PieChart>
        </ResponsiveContainer>
        
        {/* 中心文字：实时净值 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Net Worth</span>
          <span className="text-sm font-bold text-slate-800">
            ${(safeTotal / 1000).toFixed(1)}k
          </span>
        </div>
      </div>

      {/* 列表区域：实时数值 */}
      <div className="mt-1 w-full px-2 pb-2 space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar">
        {data.map((item, index) => {
          const percent = (item.value / safeTotal) * 100;
          const color = item.symbol === 'USD' ? '#CBD5E1' : COLORS[index % COLORS.length];

          return (
            <div key={item.symbol} className="flex items-center justify-between text-xs group border-b border-dashed border-slate-100 pb-1 last:border-0">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }}></div>
                <span className="font-medium text-slate-700">
                  {item.name}
                </span>
              </div>
              <div className="text-right">
                <div className="font-mono font-semibold text-slate-700">
                  ${Math.round(item.value).toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-400">
                  {percent.toFixed(1)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}